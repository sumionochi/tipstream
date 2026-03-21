// ═══════════════════════════════════════════
// TipStream Extension — Chrome Storage Store
// Persistent across sessions via chrome.storage.local
// ═══════════════════════════════════════════

import { AGENT_DEFAULTS } from "./config.js";

// ── Default state ──

const DEFAULT_STORE = {
  // Wallet
  walletSeed: "",
  walletAddress: "",
  walletChain: "sepolia",

  // Rumble
  rumbleApiKey: "",
  rumbleUsername: "",
  rumbleConnected: false,

  // Agent settings
  agentSettings: { ...AGENT_DEFAULTS },
  autoTipEnabled: false,

  // Data
  tips: [],         // TipTransaction[]
  budgets: [],      // BudgetRule[]
  pools: [],        // TipPool[]
  hypeHistory: [],  // HypeScore[]
  creators: {},     // { username: walletAddress }

  // Yield tracking
  yield: {
    depositedUSDT: 0,
    currentValueUSDT: 0,
    apy: 4.2,
    yieldEarned: 0,
  },

  // Watch sessions
  watchSessions: {},  // { tabId: { creator, startTime, watchSeconds, ... } }

  // Per-video dedup
  tippedVideos: {},   // { videoId: timestamp }

  // OpenAI
  openaiApiKey: "",

  // Stats
  dailySpend: 0,
  dailySpendDate: new Date().toISOString().slice(0, 10),
};

// ── Core read/write ──

export async function getStore() {
  return new Promise((resolve) => {
    chrome.storage.local.get(null, (result) => {
      // Merge defaults with stored data
      const store = { ...DEFAULT_STORE, ...result };
      // Ensure nested objects have defaults
      store.agentSettings = { ...AGENT_DEFAULTS, ...(result.agentSettings || {}) };
      store.yield = { ...DEFAULT_STORE.yield, ...(result.yield || {}) };
      resolve(store);
    });
  });
}

export async function setStore(updates) {
  return new Promise((resolve) => {
    chrome.storage.local.set(updates, resolve);
  });
}

export async function getKey(key) {
  const store = await getStore();
  return store[key];
}

export async function setKey(key, value) {
  return setStore({ [key]: value });
}

// ── Tips ──

export async function addTip(tip) {
  const store = await getStore();
  const tips = [tip, ...(store.tips || [])].slice(0, 500);
  await setStore({ tips });

  // Update budget spent
  const budgets = store.budgets || [];
  const budget = budgets.find((b) => b.creatorUsername === tip.creatorUsername);
  if (budget) {
    budget.spentThisMonthUSDT += parseFloat(tip.amount);
    budget.lastTipAt = tip.timestamp;
    await setStore({ budgets });
  }

  // Update daily spend
  const today = new Date().toISOString().slice(0, 10);
  let dailySpend = store.dailySpend || 0;
  if (store.dailySpendDate !== today) {
    dailySpend = 0; // Reset for new day
  }
  dailySpend += parseFloat(tip.amount);
  await setStore({ dailySpend, dailySpendDate: today });
}

export async function getTips(limit = 20) {
  const store = await getStore();
  return (store.tips || []).slice(0, limit);
}

export async function getTotalTipped() {
  const store = await getStore();
  return (store.tips || [])
    .filter((t) => t.status === "confirmed")
    .reduce((sum, t) => sum + parseFloat(t.amount), 0);
}

export async function getTipCount() {
  const store = await getStore();
  return (store.tips || []).filter((t) => t.status === "confirmed").length;
}

export async function getFavoriteCreator() {
  const store = await getStore();
  const counts = {};
  for (const tip of store.tips || []) {
    counts[tip.creatorUsername] = (counts[tip.creatorUsername] || 0) + 1;
  }
  let max = 0, fav = "";
  for (const [c, n] of Object.entries(counts)) {
    if (n > max) { max = n; fav = c; }
  }
  return fav;
}

// ── Budgets ──

export async function getBudgets() {
  const store = await getStore();
  return store.budgets || [];
}

export async function getOrCreateBudget(username) {
  const store = await getStore();
  const budgets = store.budgets || [];
  let budget = budgets.find((b) => b.creatorUsername === username);
  if (!budget) {
    const s = store.agentSettings || AGENT_DEFAULTS;
    budget = {
      id: `budget_${Date.now()}`,
      creatorUsername: username,
      monthlyBudgetUSDT: s.monthlyBudgetDefault,
      spentThisMonthUSDT: 0,
      tipPerEvent: s.defaultTipAmount,
      maxTipPerEvent: s.maxTipPerEvent,
      cooldownSeconds: s.cooldownSeconds,
      lastTipAt: 0,
      enabled: true,
      triggers: ["hype_spike", "watch_time", "milestone_follower", "manual"],
    };
    budgets.push(budget);
    await setStore({ budgets });
  }
  return budget;
}

export async function saveBudget(budget) {
  const store = await getStore();
  let budgets = (store.budgets || []).filter(
    (b) => b.creatorUsername !== budget.creatorUsername
  );
  budgets.push(budget);
  await setStore({ budgets });
}

// ── Creators ──

export async function setCreator(username, address) {
  const store = await getStore();
  const creators = { ...(store.creators || {}), [username]: address };
  await setStore({ creators });
}

export async function getCreator(username) {
  const store = await getStore();
  return (store.creators || {})[username] || null;
}

export async function getAllCreators() {
  const store = await getStore();
  return store.creators || {};
}

// ── Pools ──

export async function addPool(pool) {
  const store = await getStore();
  const pools = [...(store.pools || []), pool];
  await setStore({ pools });
}

export async function getPools() {
  const store = await getStore();
  return store.pools || [];
}

export async function fundPool(poolId, amount) {
  const store = await getStore();
  const pools = store.pools || [];
  const pool = pools.find((p) => p.id === poolId);
  if (pool) {
    pool.totalFunded += amount;
    await setStore({ pools });
  }
}

// ── Hype ──

export async function addHypeScore(score) {
  const store = await getStore();
  const history = [score, ...(store.hypeHistory || [])].slice(0, 100);
  await setStore({ hypeHistory: history });
}

export async function getLatestHype() {
  const store = await getStore();
  return (store.hypeHistory || [])[0] || null;
}

export async function getHypeHistory(limit = 20) {
  const store = await getStore();
  return (store.hypeHistory || []).slice(0, limit);
}

// ── Agent settings ──

export async function getAgentSettings() {
  const store = await getStore();
  return store.agentSettings || AGENT_DEFAULTS;
}

export async function saveAgentSettings(settings) {
  await setStore({ agentSettings: { ...AGENT_DEFAULTS, ...settings } });
}

// ── Dashboard (all-in-one) ──

export async function getDashboard() {
  const store = await getStore();
  const tips = store.tips || [];
  const confirmed = tips.filter((t) => t.status === "confirmed");
  const counts = {};
  for (const t of tips) counts[t.creatorUsername] = (counts[t.creatorUsername] || 0) + 1;
  let fav = "", max = 0;
  for (const [c, n] of Object.entries(counts)) { if (n > max) { max = n; fav = c; } }

  return {
    totalTipped: confirmed.reduce((s, t) => s + parseFloat(t.amount), 0),
    tipCount: confirmed.length,
    favoriteCreator: fav,
    recentTips: tips.slice(0, 10),
    budgets: store.budgets || [],
    pools: store.pools || [],
    creators: store.creators || {},
    yield: store.yield || DEFAULT_STORE.yield,
    autoTipEnabled: store.autoTipEnabled || false,
    dailySpend: store.dailySpend || 0,
  };
}