// ═══════════════════════════════════════════
// TipStream Extension — LLM Agent (GPT-4o-mini)
// AI-enhanced tipping decisions with confidence scoring
// Falls back gracefully to rule-based logic if no API key
// ═══════════════════════════════════════════

import { getKey } from "./store.js";

/**
 * Ask GPT-4o-mini to evaluate a tipping decision
 * Returns: { shouldTip, confidence, adjustedAmount, reasoning }
 */
export async function llmEvaluate({
  creatorUsername,
  trigger,
  ruleAmount,
  hypeScore,
  chatVelocity,
  keywordHits,
  sentimentScore,
  watchMinutes,
  budgetRemaining,
  budgetMonthly,
  spentToday,
  tipHistory,
}) {
  const apiKey = await getKey("openaiApiKey");
  if (!apiKey) {
    return fallback(ruleAmount, "No OpenAI API key — using rule-based logic");
  }

  const systemPrompt = `You are TipStream's AI tipping agent. You evaluate whether to send a USDt cryptocurrency tip to a Rumble livestream creator.

Context you receive:
- Trigger type: hype_spike, watch_time, milestone, manual, community_pool
- Chat engagement: hype score 0-100, velocity, keywords, sentiment
- Budget: remaining monthly budget, daily spend
- Watch time in minutes
- Recent tip history (last 24h)

CRITICAL RULES BY TRIGGER TYPE:

WATCH_TIME triggers:
- These reward the viewer's TIME and LOYALTY, NOT chat engagement
- If watchMinutes >= 1 and budget allows, you should APPROVE with confidence >= 0.7
- The viewer chose to spend their time watching — that alone justifies a small tip
- Only reject if: budget is nearly exhausted, or too many tips to same creator today (>5)

HYPE_SPIKE triggers:
- These ARE about engagement — evaluate hype score, velocity, sentiment
- hypeScore >= 70 with positive sentiment = high confidence (0.8+)
- hypeScore < 50 = reject

VIEWER_SPIKE triggers:
- These reward creators for growing their audience IN REAL TIME
- A viewer spike means live viewers jumped 50%+ — this is exciting and tip-worthy
- If budget allows, APPROVE with confidence >= 0.8
- Larger spikes (200%+) deserve higher amounts

MANUAL triggers:
- Always approve — the user explicitly chose to tip. Confidence 1.0.

ALL triggers:
- NEVER exceed the rule-calculated amount
- NEVER exceed remaining budget
- You can LOWER the amount but never raise it
- Repeated tips to same creator (>3 in 24h) = lower confidence slightly

Respond ONLY with valid JSON, no markdown, no backticks:
{"shouldTip": boolean, "confidence": number, "adjustedAmount": number, "reasoning": "string"}`;

  const userPrompt = `Evaluate this tipping decision:

Creator: ${creatorUsername}
Trigger: ${trigger}
Rule-calculated amount: $${ruleAmount.toFixed(2)} USDt

Engagement:
- Hype Score: ${hypeScore}/100
- Chat Velocity: ${chatVelocity} msg/s
- Keywords detected: ${keywordHits?.join(", ") || "none"}
- Sentiment: ${(sentimentScore * 100).toFixed(0)}%

Budget:
- Monthly budget remaining: $${budgetRemaining.toFixed(2)}
- Monthly budget total: $${budgetMonthly.toFixed(2)}
- Spent today: $${spentToday.toFixed(2)}

Watch time: ${watchMinutes} minutes

Recent tips to this creator (last 24h): ${tipHistory || 0}

Should this tip proceed? Respond with JSON only.`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 200,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.warn("[LLM] API error:", response.status, err);
      return fallback(ruleAmount, `OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();

    if (!content) {
      return fallback(ruleAmount, "Empty LLM response");
    }

    // Parse JSON response
    const clean = content.replace(/```json|```/g, "").trim();
    const result = JSON.parse(clean);

    // Validate and cap
    const adjustedAmount = Math.min(
      result.adjustedAmount || ruleAmount,
      ruleAmount // Never exceed rule amount
    );

    const confidence = Math.max(0, Math.min(1, result.confidence || 0.5));

    console.log(
      `[LLM] Decision for ${creatorUsername}: ` +
      `${result.shouldTip ? "TIP" : "SKIP"} ` +
      `$${adjustedAmount.toFixed(2)} ` +
      `(confidence: ${(confidence * 100).toFixed(0)}%) — ${result.reasoning}`
    );

    return {
      shouldTip: result.shouldTip !== false && confidence >= 0.3,
      confidence,
      adjustedAmount: Math.round(adjustedAmount * 100) / 100,
      reasoning: result.reasoning || "LLM decision",
      mode: "ai",
    };
  } catch (err) {
    console.warn("[LLM] Error:", err.message);
    return fallback(ruleAmount, `LLM parse error: ${err.message}`);
  }
}

/**
 * Check if LLM is available (API key set)
 */
export async function isLLMAvailable() {
  const key = await getKey("openaiApiKey");
  return !!key;
}

/**
 * Fallback to rule-based logic
 */
function fallback(amount, reason) {
  return {
    shouldTip: true,
    confidence: 0.7,
    adjustedAmount: amount,
    reasoning: reason,
    mode: "rule-based",
  };
}