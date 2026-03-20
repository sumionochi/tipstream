// ═══════════════════════════════════════════
// TipStream Extension — Content Script
// Runs on rumble.com pages
// Tracks video watch time, scrapes live chat,
// detects creator wallet addresses
// ═══════════════════════════════════════════

(function () {
    "use strict";
  
    let watchInterval = null;
    let chatInterval = null;
    let watchSeconds = 0;
    let isPlaying = false;
    let currentCreator = null;
    let lastChatIds = new Set();
    let videoElement = null;
  
    // ── Init ──
  
    function init() {
      console.log("[TipStream] Content script loaded on", window.location.href);
  
      // Detect creator
      detectCreator();
  
      // Detect video and start tracking
      waitForVideo();
  
      // Start chat scraping for livestreams
      startChatScraper();
  
      // Try to detect creator wallet
      detectCreatorWallet();
    }
  
    // ── Creator Detection ──
  
    function detectCreator() {
      // Extract creator username from page
      // Rumble has the channel name in various selectors
      const selectors = [
        ".media-heading-name",         // Video page
        ".channel-header--title",      // Channel page
        ".media-by--a",                // Video listing
        "[class*='channel'] a[href*='/c/']",
        ".rumbles-vote-pill + a",
      ];
  
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim()) {
          currentCreator = el.textContent.trim();
          console.log(`[TipStream] Creator detected: ${currentCreator}`);
          break;
        }
      }
  
      // Fallback: extract from URL
      if (!currentCreator) {
        const match = window.location.pathname.match(/^\/c\/([^\/]+)/);
        if (match) currentCreator = match[1];
      }
  
      // Also try from meta tags
      if (!currentCreator) {
        const meta = document.querySelector('meta[property="og:title"]');
        if (meta) {
          const content = meta.getAttribute("content");
          if (content) currentCreator = content.split(" - ")[0]?.trim();
        }
      }
    }
  
    // ── Video Detection & Watch Time ──
  
    function waitForVideo() {
      const check = setInterval(() => {
        videoElement = document.querySelector("video");
        if (videoElement) {
          clearInterval(check);
          startWatchTracking();
        }
      }, 1000);
  
      // Stop checking after 30 seconds
      setTimeout(() => clearInterval(check), 30000);
    }
  
    function startWatchTracking() {
      if (!videoElement) return;
  
      console.log("[TipStream] Video found, starting watch tracking");
  
      // Listen for play/pause
      videoElement.addEventListener("play", () => { isPlaying = true; });
      videoElement.addEventListener("pause", () => { isPlaying = false; });
      videoElement.addEventListener("ended", () => { isPlaying = false; });
  
      // Check initial state
      isPlaying = !videoElement.paused;
  
      // Count seconds when playing
      watchInterval = setInterval(() => {
        if (isPlaying) {
          watchSeconds++;
  
          // Report every 30 seconds
          if (watchSeconds % 30 === 0 && currentCreator) {
            chrome.runtime.sendMessage({
              type: "WATCH_UPDATE",
              data: {
                creator: currentCreator,
                watchSeconds,
                url: window.location.href,
                tabId: "content",
              },
            }).catch(() => {});
          }
        }
      }, 1000);
  
      // Add watch badge to video
      addWatchBadge();
    }
  
    // ── Watch Badge ──
  
    function addWatchBadge() {
      const container = videoElement?.closest(".video-container, .rumbles-vote, .videoPlayer, [class*='player']");
      if (!container) return;
  
      const badge = document.createElement("div");
      badge.id = "tipstream-badge";
      badge.style.cssText = `
        position: absolute; top: 12px; right: 12px; z-index: 9999;
        background: #171717; color: #F2F1EF; border: 2px solid #10B981;
        padding: 4px 10px; font-family: 'JetBrains Mono', monospace;
        font-size: 11px; font-weight: 700; letter-spacing: 0.5px;
      `;
      badge.textContent = "TIPSTREAM ▶ 0:00";
      container.style.position = "relative";
      container.appendChild(badge);
  
      // Update badge
      setInterval(() => {
        if (badge) {
          const mins = Math.floor(watchSeconds / 60);
          const secs = watchSeconds % 60;
          const status = isPlaying ? "▶" : "⏸";
          badge.textContent = `TIPSTREAM ${status} ${mins}:${secs.toString().padStart(2, "0")}`;
          badge.style.borderColor = isPlaying ? "#10B981" : "#6B7280";
        }
      }, 1000);
    }
  
    // ── Live Chat Scraper ──
  
    function startChatScraper() {
      chatInterval = setInterval(() => {
        scrapeChatMessages();
      }, 4000); // Every 4 seconds
    }
  
    function scrapeChatMessages() {
      // Rumble live chat selectors
      const chatSelectors = [
        ".chat-history--row",
        ".chat--message",
        "[class*='chat'] [class*='message']",
        ".livestream-chat--message",
      ];
  
      let chatElements = [];
      for (const sel of chatSelectors) {
        chatElements = document.querySelectorAll(sel);
        if (chatElements.length > 0) break;
      }
  
      if (chatElements.length === 0) return;
  
      const messages = [];
      chatElements.forEach((el, i) => {
        // Extract username and text
        const usernameEl = el.querySelector("[class*='username'], [class*='user'], .chat-history--username");
        const textEl = el.querySelector("[class*='text'], [class*='message-text'], .chat-history--text");
  
        const username = usernameEl?.textContent?.trim() || `user_${i}`;
        const text = textEl?.textContent?.trim() || el.textContent?.trim() || "";
        const id = `chat_${username}_${text.slice(0, 20)}_${i}`;
  
        if (text && !lastChatIds.has(id)) {
          lastChatIds.add(id);
          messages.push({ id, text, username, user_id: username, timestamp: Date.now() });
        }
      });
  
      // Cap the set
      if (lastChatIds.size > 500) {
        const arr = Array.from(lastChatIds);
        lastChatIds = new Set(arr.slice(-200));
      }
  
      if (messages.length > 0) {
        chrome.runtime.sendMessage({
          type: "CHAT_MESSAGES",
          data: { messages, creator: currentCreator },
        }).catch(() => {});
      }
    }
  
    // ── Creator Wallet Detection (via HTMX endpoints) ──
  
    async function detectCreatorWallet() {
      if (!currentCreator) return;
  
      try {
        // Try to find the tipping/wallet endpoint on the page
        // Rumble uses HTMX to load wallet addresses
        const tipButtons = document.querySelectorAll(
          "[class*='tip'], [class*='rant'], [data-action*='tip'], button[class*='support']"
        );
  
        for (const btn of tipButtons) {
          // Check for HTMX attributes
          const hxGet = btn.getAttribute("hx-get") || btn.getAttribute("data-hx-get");
          if (hxGet && hxGet.includes("wallet")) {
            try {
              const res = await fetch(hxGet, { credentials: "same-origin" });
              const html = await res.text();
              // Look for EVM address pattern
              const addrMatch = html.match(/0x[a-fA-F0-9]{40}/);
              if (addrMatch) {
                console.log(`[TipStream] Creator wallet detected: ${currentCreator} → ${addrMatch[0]}`);
                chrome.runtime.sendMessage({
                  type: "CREATOR_DETECTED",
                  data: { username: currentCreator, address: addrMatch[0] },
                }).catch(() => {});
                return;
              }
            } catch {}
          }
        }
  
        // Also scan page source for wallet addresses near creator info
        const pageHTML = document.body.innerHTML;
        const walletPattern = new RegExp(
          `${currentCreator}[\\s\\S]{0,500}(0x[a-fA-F0-9]{40})`, "i"
        );
        const pageMatch = pageHTML.match(walletPattern);
        if (pageMatch && pageMatch[1]) {
          console.log(`[TipStream] Creator wallet found in page: ${pageMatch[1]}`);
          chrome.runtime.sendMessage({
            type: "CREATOR_DETECTED",
            data: { username: currentCreator, address: pageMatch[1] },
          }).catch(() => {});
        }
      } catch (err) {
        console.warn("[TipStream] Wallet detection error:", err.message);
      }
    }
  
    // ── Cleanup ──
  
    window.addEventListener("beforeunload", () => {
      if (watchInterval) clearInterval(watchInterval);
      if (chatInterval) clearInterval(chatInterval);
  
      // Final watch report
      if (currentCreator && watchSeconds > 0) {
        chrome.runtime.sendMessage({
          type: "WATCH_UPDATE",
          data: {
            creator: currentCreator,
            watchSeconds,
            url: window.location.href,
            tabId: "content",
            final: true,
          },
        }).catch(() => {});
      }
    });
  
    // ── Start ──
  
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  })();