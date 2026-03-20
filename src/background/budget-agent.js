// ═══════════════════════════════════════════
// TipStream Extension — Budget Agent (Strategist)
// 7-gate decision pipeline using chrome.storage
// ═══════════════════════════════════════════

import { getOrCreateBudget, getCreator, getAgentSettings } from "./store.js";

export async function decideTip(creatorUsername, trigger, hype, context) {
  const budget = await getOrCreateBudget(creatorUsername);
  const settings = await getAgentSettings();

  // Gate 1: Enabled
  if (!budget.enabled) return blocked(creatorUsername, trigger, "Budget disabled");

  // Gate 2: Trigger allowed
  if (!budget.triggers.includes(trigger)) return blocked(creatorUsername, trigger, `Trigger "${trigger}" not enabled`);

  // Gate 3: Monthly cap
  const remaining = budget.monthlyBudgetUSDT - budget.spentThisMonthUSDT;
  if (remaining <= 0) return blocked(creatorUsername, trigger, `Monthly budget exhausted ($${budget.spentThisMonthUSDT.toFixed(2)}/$${budget.monthlyBudgetUSDT})`);

  // Gate 4: Cooldown
  const now = Date.now();
  const elapsed = (now - budget.lastTipAt) / 1000;
  if (budget.lastTipAt > 0 && elapsed < budget.cooldownSeconds) {
    return blocked(creatorUsername, trigger, `Cooldown (${Math.ceil(budget.cooldownSeconds - elapsed)}s left)`);
  }

  // Gate 5: Creator address exists
  const addr = await getCreator(creatorUsername);
  if (!addr) return blocked(creatorUsername, trigger, "No wallet address registered");

  // Gate 6: Calculate amount
  let amount = budget.tipPerEvent;
  let confidence = 0.5;
  let reason = "";

  switch (trigger) {
    case "hype_spike": {
      if (!hype || !hype.isSpike) return blocked(creatorUsername, trigger, "No hype spike");
      const t = settings.hypeThreshold || 70;
      const mult = 1 + ((hype.score - t) / (100 - t));
      amount = budget.tipPerEvent * mult;
      confidence = Math.min(0.95, hype.score / 100);
      reason = `Hype spike: ${hype.score}/100 (${hype.chatVelocity.toFixed(1)} msg/s)`;
      break;
    }
    case "watch_time": {
      const mins = context?.watchTimeMinutes || 0;
      if (mins < 1) return blocked(creatorUsername, trigger, `Watch time too short (${mins}min)`);
      amount = Math.min(budget.tipPerEvent, (mins / 10) * 0.1);
      confidence = 0.7;
      reason = `Watch time: ${mins} minutes`;
      break;
    }
    case "milestone_follower": {
      amount = budget.tipPerEvent * 2;
      confidence = 0.9;
      reason = `Follower milestone: ${context?.milestoneValue || "?"}`;
      break;
    }
    case "milestone_subscriber": {
      amount = budget.tipPerEvent * 3;
      confidence = 0.95;
      reason = `Sub milestone: ${context?.milestoneValue || "?"}`;
      break;
    }
    case "manual": {
      confidence = 1.0;
      reason = "Manual tip";
      break;
    }
    case "community_pool": {
      confidence = 0.85;
      reason = "Community pool distribution";
      break;
    }
    default: {
      reason = `Trigger: ${trigger}`;
    }
  }

  // Gate 7: Cap
  amount = Math.min(amount, budget.maxTipPerEvent);
  amount = Math.min(amount, settings.maxTipPerEvent || 5);
  amount = Math.min(amount, remaining);
  amount = Math.round(amount * 100) / 100;

  if (amount < 0.01) return blocked(creatorUsername, trigger, "Amount too small");

  return { shouldTip: true, amount, reason, trigger, confidence, creatorUsername };
}

function blocked(creatorUsername, trigger, reason) {
  return { shouldTip: false, amount: 0, reason, trigger, confidence: 0, creatorUsername, blocked: reason };
}