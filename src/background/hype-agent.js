// ═══════════════════════════════════════════
// TipStream Extension — Hype Agent (Sentinel)
// Analyzes livestream chat for excitement
// ═══════════════════════════════════════════

import { AGENT_DEFAULTS } from "./config.js";

const HYPE_KEYWORDS = [
  "goat", "w", "lfg", "lets go", "amazing", "insane", "fire",
  "based", "king", "queen", "legend", "clutch", "hype", "pog",
  "pogchamp", "cracked", "massive", "incredible", "perfect",
  "best", "love", "awesome", "epic", "huge", "wow",
  "omg", "lmao", "lol", "bruh", "sheesh", "bussin",
  "tip", "tipping", "donate", "usdt", "crypto",
];

const NEGATIVE_KEYWORDS = [
  "boring", "trash", "bad", "worst", "hate", "cringe",
  "leave", "bye", "dead", "mid", "ratio",
];

const HYPE_EMOJIS = [
  "🔥", "🚀", "💪", "👑", "🙌", "💯", "⚡", "🎉", "🎊",
  "❤️", "💰", "🤑", "😱", "🤯", "👏", "💎", "🏆",
];

export function analyzeHype(messages, windowSeconds = 30, agentSettings = null) {
  const settings = agentSettings || AGENT_DEFAULTS;

  if (!messages || messages.length === 0) {
    return { score: 0, chatVelocity: 0, sentimentScore: 0, emojiDensity: 0, keywordHits: [], isSpike: false, timestamp: Date.now() };
  }

  const chatVelocity = messages.length / windowSeconds;

  const keywordHits = [];
  let positiveCount = 0;
  let negativeCount = 0;

  for (const msg of messages) {
    const lower = (msg.text || "").toLowerCase();
    for (const kw of HYPE_KEYWORDS) {
      if (lower.includes(kw)) {
        if (!keywordHits.includes(kw)) keywordHits.push(kw);
        positiveCount++;
        break;
      }
    }
    for (const kw of NEGATIVE_KEYWORDS) {
      if (lower.includes(kw)) { negativeCount++; break; }
    }
  }

  let emojiCount = 0;
  let totalChars = 0;
  for (const msg of messages) {
    const text = msg.text || "";
    totalChars += text.length;
    for (const emoji of HYPE_EMOJIS) {
      emojiCount += text.split(emoji).length - 1;
    }
    const emojiMatches = text.match(/[\u2600-\u27BF]|[\uD83C-\uDBFF][\uDC00-\uDFFF]/g);
    if (emojiMatches) emojiCount += emojiMatches.length;
  }
  const emojiDensity = totalChars > 0 ? Math.min(1, emojiCount / (totalChars * 0.1)) : 0;

  const totalSent = positiveCount + negativeCount;
  const sentimentScore = totalSent > 0 ? (positiveCount - negativeCount) / totalSent : 0;

  const velocityScore = Math.min(100, chatVelocity * 20);
  const keywordScore = Math.min(100, (positiveCount / Math.max(messages.length, 1)) * 200);
  const emojiScore = emojiDensity * 100;
  const sentimentNorm = ((sentimentScore + 1) / 2) * 100;

  const score = Math.min(100, Math.max(0, Math.round(
    velocityScore * 0.35 + keywordScore * 0.25 + emojiScore * 0.20 + sentimentNorm * 0.20
  )));

  const isSpike = score >= (settings.hypeThreshold || 70);

  if (isSpike) {
    console.log(`[HypeAgent] 🔥 SPIKE! Score: ${score}/100, Velocity: ${chatVelocity.toFixed(1)} msg/s, Keywords: [${keywordHits.join(", ")}]`);
  }

  return {
    score, chatVelocity: Math.round(chatVelocity * 100) / 100,
    sentimentScore: Math.round(sentimentScore * 100) / 100,
    emojiDensity: Math.round(emojiDensity * 100) / 100,
    keywordHits: keywordHits.slice(0, 5), isSpike, timestamp: Date.now(),
  };
}

export function deduplicateSpam(messages) {
  const counts = {};
  return (messages || []).filter((msg) => {
    const uid = msg.user_id || msg.username;
    counts[uid] = (counts[uid] || 0) + 1;
    return counts[uid] <= 3;
  });
}