// ═══════════════════════════════════════════
// TipStream Extension — WDK Wallet
// Tether WDK integration for Chrome extension
// Uses webpack polyfills for sodium/buffer/crypto
// ═══════════════════════════════════════════

import WDK from "@tetherto/wdk";
import WalletManagerEvm from "@tetherto/wdk-wallet-evm";
import { CHAINS, TOKENS, DEFAULT_CHAIN } from "./config.js";
import { getKey, setStore } from "./store.js";

// ── State ──

let wdkInstance = null;
let accountInstance = null;
let cachedAddress = null;

// ── Init ──

export async function initWallet(seed) {
  if (!seed || seed.split(" ").length < 12) {
    throw new Error("Invalid seed phrase — need 12 or 24 words");
  }

  const chain = (await getKey("walletChain")) || DEFAULT_CHAIN;
  const rpcUrl = CHAINS[chain]?.rpcUrl || CHAINS.sepolia.rpcUrl;

  console.log(`[WDK] Initializing wallet on ${chain} (${rpcUrl})`);

  wdkInstance = new WDK(seed).registerWallet("evm", WalletManagerEvm, {
    provider: rpcUrl,
  });

  accountInstance = await wdkInstance.getAccount("evm", 0);
  cachedAddress = await accountInstance.getAddress();

  // Persist
  await setStore({
    walletSeed: seed,
    walletAddress: cachedAddress,
    walletChain: chain,
  });

  console.log(`[WDK] Wallet ready: ${cachedAddress}`);
  return { address: cachedAddress, chain };
}

export async function restoreWallet() {
  const seed = await getKey("walletSeed");
  if (seed) {
    try {
      await initWallet(seed);
      return true;
    } catch (err) {
      console.error("[WDK] Failed to restore wallet:", err.message);
    }
  }
  return false;
}

export function isReady() {
  return !!accountInstance && !!cachedAddress;
}

export function getAddress() {
  return cachedAddress;
}

// ── Balance ──

export async function getBalances() {
  if (!accountInstance) throw new Error("Wallet not initialized");

  const chain = (await getKey("walletChain")) || DEFAULT_CHAIN;
  let balanceETH = "0";
  let balanceUSDT = "0";

  try {
    const native = await accountInstance.getBalance();
    balanceETH = (Number(native) / 1e18).toFixed(6);
  } catch (err) {
    console.warn("[WDK] Native balance error:", err.message);
  }

  try {
    const usdtAddr = TOKENS.USDT.addresses[chain];
    if (usdtAddr) {
      const tokenBal = await accountInstance.getTokenBalance(usdtAddr);
      balanceUSDT = (Number(tokenBal) / 1e6).toFixed(2);
    }
  } catch (err) {
    console.warn("[WDK] USDt balance error:", err.message);
  }

  return { address: cachedAddress, balanceETH, balanceUSDT, chain };
}

// ── Transfer ──

export async function sendTip(recipientAddress, amountUSDT, creatorUsername, trigger) {
  if (!accountInstance) throw new Error("Wallet not initialized");

  const chain = (await getKey("walletChain")) || DEFAULT_CHAIN;
  const usdtAddr = TOKENS.USDT.addresses[chain];
  if (!usdtAddr) throw new Error(`No USDt address for chain: ${chain}`);

  const fromAddress = cachedAddress;
  const amountBase = BigInt(Math.floor(amountUSDT * 1e6));

  console.log(`[WDK] Tipping ${amountUSDT} USDt to ${recipientAddress} (${creatorUsername}) on ${chain}`);

  try {
    const result = await accountInstance.transfer({
      token: usdtAddr,
      recipient: recipientAddress,
      amount: amountBase,
    });

    console.log(`[WDK] Tip confirmed! Hash: ${result.hash}`);

    return {
      id: `tip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      fromAddress,
      toAddress: recipientAddress,
      amount: amountUSDT.toFixed(2),
      amountWei: amountBase.toString(),
      txHash: result.hash,
      creatorUsername,
      triggerReason: trigger,
      timestamp: Date.now(),
      status: "confirmed",
      chain,
    };
  } catch (err) {
    console.error(`[WDK] Tip failed:`, err.message);
    return {
      id: `tip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      fromAddress,
      toAddress: recipientAddress,
      amount: amountUSDT.toFixed(2),
      amountWei: amountBase.toString(),
      txHash: "",
      creatorUsername,
      triggerReason: trigger,
      timestamp: Date.now(),
      status: "failed",
      chain,
      error: err.message,
    };
  }
}

/**
 * Smart Split Tip — splits a tip across creator + collaborators/causes
 * splits: [{ address, pct, label }] where pct is 1-100
 * Creator gets (100 - sum(pct))% of the total
 */
export async function sendSplitTip(creatorAddress, splits, totalAmountUSDT, creatorUsername, trigger) {
  if (!accountInstance) throw new Error("Wallet not initialized");

  const chain = (await getKey("walletChain")) || DEFAULT_CHAIN;
  const usdtAddr = TOKENS.USDT.addresses[chain];
  if (!usdtAddr) throw new Error(`No USDt address for chain: ${chain}`);

  const fromAddress = cachedAddress;
  const results = [];

  // Calculate amounts
  let splitTotal = 0;
  const splitPayments = [];
  for (const s of (splits || [])) {
    if (!s.address || !s.pct || s.pct <= 0) continue;
    const pct = Math.min(s.pct, 50); // Cap at 50% per split
    const amount = Math.round(totalAmountUSDT * (pct / 100) * 100) / 100;
    if (amount >= 0.01) {
      splitPayments.push({ address: s.address, amount, label: s.label || "split" });
      splitTotal += amount;
    }
  }
  const creatorAmount = Math.round((totalAmountUSDT - splitTotal) * 100) / 100;

  console.log(`[WDK] Smart split: $${creatorAmount} to ${creatorUsername} + ${splitPayments.length} splits ($${splitTotal})`);

  // Send to creator first
  if (creatorAmount >= 0.01) {
    try {
      const creatorBase = BigInt(Math.floor(creatorAmount * 1e6));
      const r = await accountInstance.transfer({ token: usdtAddr, recipient: creatorAddress, amount: creatorBase });
      console.log(`[WDK] Creator tip confirmed: ${r.hash}`);
      results.push({
        id: `tip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        fromAddress, toAddress: creatorAddress,
        amount: creatorAmount.toFixed(2), txHash: r.hash,
        creatorUsername, triggerReason: trigger,
        timestamp: Date.now(), status: "confirmed", chain,
        splitLabel: "creator",
      });
    } catch (err) {
      console.error(`[WDK] Creator tip failed:`, err.message);
      results.push({
        id: `tip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        fromAddress, toAddress: creatorAddress,
        amount: creatorAmount.toFixed(2), txHash: "",
        creatorUsername, triggerReason: trigger,
        timestamp: Date.now(), status: "failed", chain,
        splitLabel: "creator", error: err.message,
      });
    }
  }

  // Send to each split recipient
  for (const sp of splitPayments) {
    try {
      const spBase = BigInt(Math.floor(sp.amount * 1e6));
      const r = await accountInstance.transfer({ token: usdtAddr, recipient: sp.address, amount: spBase });
      console.log(`[WDK] Split tip (${sp.label}) confirmed: ${r.hash}`);
      results.push({
        id: `tip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        fromAddress, toAddress: sp.address,
        amount: sp.amount.toFixed(2), txHash: r.hash,
        creatorUsername: `${creatorUsername}/${sp.label}`,
        triggerReason: `${trigger}_split`,
        timestamp: Date.now(), status: "confirmed", chain,
        splitLabel: sp.label,
      });
    } catch (err) {
      console.error(`[WDK] Split (${sp.label}) failed:`, err.message);
      results.push({
        id: `tip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        fromAddress, toAddress: sp.address,
        amount: sp.amount.toFixed(2), txHash: "",
        creatorUsername: `${creatorUsername}/${sp.label}`,
        triggerReason: `${trigger}_split`,
        timestamp: Date.now(), status: "failed", chain,
        splitLabel: sp.label, error: err.message,
      });
    }
  }

  return results;
}

// ── Change chain ──

export async function switchChain(newChain) {
  if (!CHAINS[newChain]) throw new Error(`Unknown chain: ${newChain}`);
  await setStore({ walletChain: newChain });

  // Re-init wallet on new chain
  const seed = await getKey("walletSeed");
  if (seed) {
    await initWallet(seed);
  }

  return { chain: newChain };
}

// ── Generate seed ──

export function generateSeed() {
  return WDK.getRandomSeedPhrase();
}