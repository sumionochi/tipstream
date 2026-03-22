# TipStream — AI Tipping Agent Skill

You control a Chrome sidebar extension that autonomously tips Rumble.com creators with real USDt on-chain. The extension uses three cooperating agents: **Hype Agent** (chat NLP), **Budget Agent** (spending rules), and **Tipper Agent** (WDK execution). An optional **LLM layer** (GPT-4o-mini) evaluates every decision with confidence scoring.

## Architecture

```
Rumble Page → Content Script (video tracking, chat scraping, wallet detection)
           → Service Worker (agent pipeline, WDK transfers, milestone detection)
           → Sidebar UI (agent log, hype gauge, tip history, splits config)
```

## Trigger Types

| Trigger                | How it fires                                                               | Default behavior                      |
| ---------------------- | -------------------------------------------------------------------------- | ------------------------------------- |
| `watch_time`           | Every 30s while watching video, tips after cooldown                        | $0.02/min, cooldown-gated             |
| `hype_spike`           | Chat hype score ≥ threshold (NLP: velocity + keywords + emoji + sentiment) | Tip amount scales with hype intensity |
| `milestone_follower`   | Follower count crosses 10/25/50/100/250/500/1K/5K/10K/25K/50K/100K         | 2× normal tip                         |
| `milestone_subscriber` | Subscriber count crosses same thresholds                                   | 3× normal tip                         |
| `manual`               | User clicks "Send Tip" in sidebar                                          | User-specified amount                 |
| `community_pool`       | Pool balance + hype spike on target creator                                | Pool distributes to creator           |

## Available Commands

### Watch Time Tipping

"Set up auto-tipping at 3 cents per minute with a 90 second cooldown"
Parameters:

- `defaultTipAmount`: base tip amount in USDt (e.g. 0.50)
- `cooldownSeconds`: minimum seconds between tips (e.g. 60)
- `monthlyBudgetDefault`: monthly spending cap (e.g. 20)
- `maxTipPerEvent`: single tip cap (e.g. 5.00)

### Hype Detection

"Set hype threshold to 60 and tip $1 on chat spikes"
Parameters:

- `hypeThreshold`: score 0-100 to trigger (default 70)
- Hype score = 35% chat velocity + 25% keyword hits + 20% emoji density + 20% sentiment
- Keywords detected: goat, lfg, lets go, amazing, insane, fire, based, king, legend, hype, pog, etc. (35+ terms)

### Smart Splits

"Split OptimusDan's tips: 80% to creator, 10% to editor, 10% to charity"
Parameters:

- `username`: creator to configure splits for
- `splits[]`: array of `{ label, address, pct }` where pct is 1-50%
- Creator always gets the remainder (100% minus sum of splits)
- Each split fires a separate WDK transfer on-chain

### Budget Management

"Set a $10 monthly budget for OptimusDan with $0.25 per tip and 2 minute cooldown"
Parameters per creator:

- `monthlyBudgetUSDT`: monthly cap
- `tipPerEvent`: per-tip amount
- `maxTipPerEvent`: single tip ceiling
- `cooldownSeconds`: minimum seconds between tips
- `triggers[]`: which triggers are enabled for this creator

### Community Pools

"Create a pool called 'OptimusFans' for OptimusDan with 75 hype threshold"
Parameters:

- `name`: pool display name
- `creatorUsername`: target creator
- `hypeThreshold`: minimum hype to trigger distribution
- Fund pools manually, agent distributes on hype spike

### Creator Registration

"Register OptimusDan with wallet 0x10c6f496b08250bd4059dc1c831bdfd2a7056bcb"

- Extension also auto-detects wallets via Rumble's 3-step HTMX endpoint
- Supports all EVM addresses (Polygon, Arbitrum, Ethereum)

### AI Reasoning

"Enable AI reasoning with my OpenAI key"

- Adds GPT-4o-mini evaluation to every tipping decision
- LLM receives: trigger type, hype metrics, budget state, watch time, tip history
- Returns: shouldTip, confidence (0-1), adjustedAmount, reasoning text
- Watch-time tips: LLM evaluates loyalty (always approves with budget remaining)
- Hype tips: LLM evaluates engagement quality
- Graceful fallback to rule-based when no API key

### Wallet

"Set up my wallet" → guides through BIP-39 seed phrase generation
"Check my balance" → shows ETH + USDt balance
"Switch to Polygon" → changes active chain

### Stats & History

"How much have I tipped today?" → daily spend
"Show my last 20 tips" → tip history with AI reasoning
"Who's my most tipped creator?" → favorite creator stat

## Tip Calculation

### Watch-time formula

```
newMinutes = secondsSinceLastTip / 60
tipAmount = min(newMinutes × $0.02, tipPerEvent, maxTipPerEvent, remainingBudget)
```

### Hype formula

```
hypeMultiplier = 1 + ((hypeScore - threshold) / (100 - threshold))
tipAmount = min(tipPerEvent × hypeMultiplier, maxTipPerEvent, remainingBudget)
```

### Split formula

```
for each split: splitAmount = totalTip × (splitPct / 100)
creatorAmount = totalTip - sum(splitAmounts)
// Each fires a separate on-chain transfer
```

## Decision Pipeline (7 Gates)

1. **Creator enabled?** — budget.enabled must be true
2. **Trigger allowed?** — trigger must be in budget.triggers[]
3. **Monthly budget?** — remaining = monthly - spent must be > 0
4. **Cooldown?** — seconds since last tip must exceed cooldown
5. **Creator address?** — must have a registered EVM address
6. **Calculate amount** — formula varies by trigger type
7. **Cap amount** — min(calculated, maxPerEvent, remainingBudget)

If all gates pass → LLM evaluation (if enabled) → WDK transfer → on-chain confirmation

## Network Cost Guide

| Chain    | Gas Cost | Best For                   |
| -------- | -------- | -------------------------- |
| Polygon  | ~$0.001  | Micro-tips, high frequency |
| Arbitrum | ~$0.01   | Medium tips                |
| Ethereum | ~$1-5    | Large tips only            |
| Sepolia  | Free     | Testing                    |

## Safety

- Monthly spending caps enforced per-creator
- Cooldown prevents rapid-fire duplicate tips
- Per-video cooldown prevents tipping same content repeatedly
- Daily spending tracked and reset at midnight
- LLM can veto tips (confidence < 0.3 = reject)
- Split percentages capped at 50% per recipient, 80% total
- All transactions are real on-chain ERC-20 transfers via Tether WDK
- Non-custodial BIP-39 HD wallet — user controls keys
- Seed phrase stored only in local extension storage

## Tokens Supported

- **USD₮** (USDT) — Primary, all chains
- **USA₮** (USAT) — Ethereum
- **XAU₮** (XAUT) — Tether Gold, Ethereum
- Bitcoin (BTC) — via Rumble's native wallet (detection only)
