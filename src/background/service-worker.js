// ═══════════════════════════════════════════
// TipStream Extension — Service Worker
// Central message router + agent orchestrator
// ═══════════════════════════════════════════

import {
    initWallet, restoreWallet, isReady, getBalances,
    sendTip, switchChain, generateSeed, getAddress,
  } from "./wallet.js";
  import {
    getStore, setStore, setKey,
    addTip, getTips, getDashboard,
    setCreator, getCreator, getAllCreators,
    getOrCreateBudget, saveBudget, getBudgets,
    addPool, getPools, fundPool,
    addHypeScore, getLatestHype, getHypeHistory,
    getAgentSettings, saveAgentSettings,
  } from "./store.js";
  import { analyzeHype, deduplicateSpam } from "./hype-agent.js";
  import { decideTip } from "./budget-agent.js";
  import { RUMBLE_API_URL } from "./config.js";
  
  // ── Restore wallet on startup ──
  
  try {
    restoreWallet().then((ok) => {
      if (ok) console.log("[TipStream] Wallet restored from storage");
      else console.log("[TipStream] No stored wallet — waiting for setup");
    }).catch((err) => {
      console.warn("[TipStream] Wallet restore failed (normal on first run):", err.message);
    });
  } catch (err) {
    console.warn("[TipStream] Init error:", err.message);
  }
  
  // ── Open sidebar when extension icon clicked ──

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
.catch((err) => console.error("[TipStream] sidePanel behavior error:", err));
  
  // Enable sidebar on Rumble pages
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tab.url && tab.url.includes("rumble.com")) {
      chrome.sidePanel.setOptions({
        tabId,
        path: "sidebar/sidebar.html",
        enabled: true,
      });
    }
  });
  
  // ── Message Router ──
  
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    handleMessage(msg, sender).then(sendResponse).catch((err) => {
      console.error("[ServiceWorker] Error:", err.message);
      sendResponse({ success: false, error: err.message });
    });
    return true; // async response
  });
  
  async function handleMessage(msg, sender) {
    const { type, data } = msg;
  
    switch (type) {
      // ═══ WALLET ═══
      case "WALLET_INIT":
        const info = await initWallet(data.seed);
        return { success: true, data: info };
  
      case "WALLET_GENERATE_SEED":
        return { success: true, data: { seedPhrase: generateSeed() } };
  
      case "WALLET_GET":
        if (!isReady()) return { success: false, error: "Wallet not initialized", needsSetup: true };
        const balances = await getBalances();
        return { success: true, data: balances };
  
      case "WALLET_SWITCH_CHAIN":
        const chainResult = await switchChain(data.chain);
        return { success: true, data: chainResult };
  
      // ═══ RUMBLE ═══
      case "RUMBLE_CONNECT": {
        const key = data.apiKey;
        if (!key) return { success: false, error: "API key required" };
        try {
          const res = await fetch(`${RUMBLE_API_URL}?key=${key}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const rumbleData = await res.json();
          await setStore({
            rumbleApiKey: key,
            rumbleUsername: rumbleData.username,
            rumbleConnected: true,
          });
          return {
            success: true,
            data: {
              username: rumbleData.username,
              userId: rumbleData.user_id,
              followers: rumbleData.followers?.num_followers_total || 0,
            },
          };
        } catch (err) {
          return { success: false, error: "Invalid Rumble API key" };
        }
      }
  
      case "RUMBLE_STATUS": {
        const store = await getStore();
        if (!store.rumbleApiKey) return { success: false, error: "Not connected" };
        try {
          const res = await fetch(`${RUMBLE_API_URL}?key=${store.rumbleApiKey}`);
          const rumbleData = await res.json();
          const livestream = rumbleData.livestreams?.find((ls) => ls.is_live) || null;
          return {
            success: true,
            data: {
              isLive: !!livestream,
              username: rumbleData.username,
              followers: rumbleData.followers?.num_followers_total || 0,
              livestream: livestream ? {
                title: livestream.title,
                watchingNow: livestream.watching_now,
                chatCount: livestream.chat?.length || 0,
              } : null,
            },
          };
        } catch (err) {
          return { success: false, error: err.message };
        }
      }
  
      case "RUMBLE_DISCONNECT":
        await setStore({ rumbleApiKey: "", rumbleUsername: "", rumbleConnected: false });
        return { success: true };
  
      // ═══ CREATORS ═══
      case "CREATOR_REGISTER":
        if (!data.username || !data.address) return { success: false, error: "username and address required" };
        if (!/^0x[a-fA-F0-9]{40}$/.test(data.address)) return { success: false, error: "Invalid EVM address" };
        await setCreator(data.username, data.address);
        return { success: true, data: { username: data.username, address: data.address } };
  
      case "CREATOR_GET_ALL":
        return { success: true, data: await getAllCreators() };
  
      // ═══ TIPS ═══
      case "TIP_SEND": {
        if (!isReady()) return { success: false, error: "Wallet not initialized" };
        const addr = await getCreator(data.creatorUsername);
        if (!addr) return { success: false, error: `No address for ${data.creatorUsername}` };
        const tx = await sendTip(addr, parseFloat(data.amount), data.creatorUsername, "manual");
        await addTip(tx);
        return { success: true, data: tx };
      }
  
      case "TIP_HISTORY":
        return { success: true, data: await getTips(data?.limit || 20) };
  
      // ═══ BUDGETS ═══
      case "BUDGET_SAVE": {
        const existing = await getOrCreateBudget(data.creatorUsername);
        const updated = { ...existing, ...data };
        await saveBudget(updated);
        return { success: true, data: updated };
      }
  
      case "BUDGET_GET_ALL":
        return { success: true, data: await getBudgets() };
  
      // ═══ POOLS ═══
      case "POOL_CREATE":
        const pool = {
          id: `pool_${Date.now()}`,
          name: data.name,
          creatorUsername: data.creatorUsername,
          totalFunded: 0,
          totalDistributed: 0,
          memberCount: 1,
          hypeThreshold: data.hypeThreshold || 75,
          createdAt: Date.now(),
        };
        await addPool(pool);
        return { success: true, data: pool };
  
      case "POOL_FUND":
        await fundPool(data.poolId, parseFloat(data.amount));
        return { success: true };
  
      case "POOL_GET_ALL":
        return { success: true, data: await getPools() };
  
      // ═══ AGENTS ═══
      case "AGENT_RUN_CYCLE": {
        const store = await getStore();
        const apiKey = store.rumbleApiKey;
        if (!apiKey) return { success: false, error: "Rumble not connected" };
  
        try {
          const res = await fetch(`${RUMBLE_API_URL}?key=${apiKey}`);
          const rumbleData = await res.json();
          const livestream = rumbleData.livestreams?.find((ls) => ls.is_live) || null;
  
          if (!livestream) {
            return { success: true, data: { hype: null, decisions: [], tips: [], milestones: [], message: "No active livestream" } };
          }
  
          // Hype analysis on live chat
          const messages = (livestream.chat || []).map((m) => ({
            id: m.id,
            text: m.text,
            username: m.username,
            user_id: m.user_id || m.username,
            timestamp: m.time || Date.now(),
          }));
          const clean = deduplicateSpam(messages);
          const hype = analyzeHype(clean, 30, store.agentSettings);
          await addHypeScore(hype);
  
          const results = { hype, decisions: [], tips: [], milestones: [] };
          const creatorUsername = rumbleData.username;
  
          // If hype spike, try to tip
          if (hype.isSpike && isReady()) {
            const decision = await decideTip(creatorUsername, "hype_spike", hype);
            results.decisions.push(decision);
  
            if (decision.shouldTip) {
              const addr = await getCreator(creatorUsername);
              if (addr) {
                const tx = await sendTip(addr, decision.amount, creatorUsername, "hype_spike");
                await addTip(tx);
                results.tips.push(tx);
              }
            }
          }
  
          return { success: true, data: results };
        } catch (err) {
          return { success: false, error: err.message };
        }
      }
  
      case "AGENT_TOGGLE_AUTO":
        const store2 = await getStore();
        const newState = !store2.autoTipEnabled;
        await setKey("autoTipEnabled", newState);
        return { success: true, data: { autoTipEnabled: newState } };
  
      case "AGENT_SETTINGS_SAVE":
        await saveAgentSettings(data);
        return { success: true, data: await getAgentSettings() };
  
      case "AGENT_SETTINGS_GET":
        return { success: true, data: await getAgentSettings() };
  
      // ═══ HYPE ═══
      case "HYPE_GET":
        return { success: true, data: { current: await getLatestHype(), history: await getHypeHistory(20) } };
  
      // ═══ DASHBOARD ═══
      case "DASHBOARD_GET":
        return { success: true, data: await getDashboard() };
  
      // ═══ CONTENT SCRIPT MESSAGES ═══
      case "WATCH_UPDATE": {
        // Content script reporting watch time
        const store3 = await getStore();
        const sessions = { ...(store3.watchSessions || {}) };
        sessions[data.tabId] = {
          creator: data.creator,
          watchSeconds: data.watchSeconds,
          url: data.url,
          lastUpdate: Date.now(),
        };
        await setStore({ watchSessions: sessions });
  
        // Check if watch time trigger should fire
        const settings = await getAgentSettings();
        if (data.watchSeconds >= 60 && isReady()) { // Min 1 minute
          const decision = await decideTip(data.creator, "watch_time", null, {
            watchTimeMinutes: Math.floor(data.watchSeconds / 60),
          });
          if (decision.shouldTip) {
            const addr = await getCreator(data.creator);
            if (addr) {
              const tx = await sendTip(addr, decision.amount, data.creator, "watch_time");
              await addTip(tx);
              // Notify sidebar
              chrome.runtime.sendMessage({ type: "TIP_SENT", data: tx }).catch(() => {});
            }
          }
        }
        return { success: true };
      }
  
      case "CREATOR_DETECTED": {
        // Content script found a creator wallet address on page
        if (data.username && data.address) {
          await setCreator(data.username, data.address);
          console.log(`[TipStream] Auto-detected creator: ${data.username} → ${data.address}`);
        }
        return { success: true };
      }
  
      case "CHAT_MESSAGES": {
        // Content script scraped live chat messages
        if (data.messages && data.messages.length > 0) {
          const storeData = await getStore();
          const clean = deduplicateSpam(data.messages);
          const hype = analyzeHype(clean, 30, storeData.agentSettings);
          await addHypeScore(hype);
          // Notify sidebar of hype update
          chrome.runtime.sendMessage({ type: "HYPE_UPDATE", data: hype }).catch(() => {});
          return { success: true, data: hype };
        }
        return { success: true };
      }
  
      default:
        return { success: false, error: `Unknown message type: ${type}` };
    }
  }
  
  // ── Auto-tip interval ──
  
  let autoTipInterval = null;
  
  async function checkAutoTip() {
    const store = await getStore();
    if (!store.autoTipEnabled || !store.rumbleApiKey) return;
  
    chrome.runtime.sendMessage({ type: "AGENT_RUN_CYCLE", data: {} }).catch(() => {});
  }
  
  // Listen for auto-tip toggle
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.autoTipEnabled) {
      if (changes.autoTipEnabled.newValue) {
        console.log("[TipStream] Auto-tip ON — polling every 5s");
        autoTipInterval = setInterval(checkAutoTip, 5000);
      } else {
        console.log("[TipStream] Auto-tip OFF");
        if (autoTipInterval) clearInterval(autoTipInterval);
        autoTipInterval = null;
      }
    }
  });