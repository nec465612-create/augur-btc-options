"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  Coins,
  Cpu,
  ExternalLink,
  Flame,
  Gauge,
  Layers,
  Lock,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wallet,
  Zap,
  BarChart3,
  Clock,
  Terminal,
  Copy,
  Check,
} from "lucide-react";
import {
  DEPLOYMENTS,
  HADRIAN_EXPLORER,
  VAULT_ADDRESS,
  fetchLiveOracleQuotes,
  fetchOptionsVaultState,
  sendAugurVaultTx,
  getDemoSignerAccount,
  ROME_OPTIONS_VAULT_ABI,
  encodeFunctionData,
  pubkeyToBytes32,
  deriveSyntheticEvmAddress,
  type LiveOracleQuote,
  type OnChainOptionPosition,
  type OnChainUnderwriter,
  type OnChainSettlement,
  type VaultSummaryData,
} from "@/lib/rome-client";

interface StrikeRow {
  strike: number;
  callBid: number;
  callAsk: number;
  callIv: number;
  callDelta: number;
  callOi: number;
  putBid: number;
  putAsk: number;
  putIv: number;
  putDelta: number;
  putOi: number;
}

export default function AugurOptionsApp() {
  // ── Navigation & Market State ────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<
    "terminal" | "chain" | "payoff" | "vault" | "explorer"
  >("terminal");
  const [selectedAsset, setSelectedAsset] = useState<"BTC" | "SOL">("BTC");
  const [selectedType, setSelectedType] = useState<"CALL" | "PUT">("CALL");
  const [selectedTenor, setSelectedTenor] = useState<number>(28800); // 8h 0DTE default
  const [contractsSize, setContractsSize] = useState<string>("0.50");
  const [strikeInput, setStrikeInput] = useState<string>("89000");

  // ── Underwriter LP State ─────────────────────────────────────────────────
  const [lpDepositAmount, setLpDepositAmount] = useState<string>("2500");
  const [lpWithdrawShares, setLpWithdrawShares] = useState<string>("1000");

  // ── Dual-Lane Wallet State ───────────────────────────────────────────────
  const [walletLane, setWalletLane] = useState<"EVM" | "SOLANA">("EVM");
  const [evmAddress, setEvmAddress] = useState<`0x${string}` | null>(null);
  const [solanaAddress, setSolanaAddress] = useState<string>(
    "7V9J8wXkLmN2pQrStUvWxYz3A4B5C6D7E8F9G1H2J3K4"
  );
  const [useBrowserWallet, setUseBrowserWallet] = useState<boolean>(false);

  // ── Live On-Chain State ──────────────────────────────────────────────────
  const [oracles, setOracles] = useState<Record<string, LiveOracleQuote>>({});
  const [vaultSummary, setVaultSummary] = useState<VaultSummaryData>({
    totalAssetsUsdc: DEPLOYMENTS.hadrian.metrics.totalAssetsUsdc,
    lockedCollateralUsdc: DEPLOYMENTS.hadrian.metrics.lockedCollateralUsdc,
    availableLiquidityUsdc: DEPLOYMENTS.hadrian.metrics.availableLiquidityUsdc,
    lpShares: DEPLOYMENTS.hadrian.metrics.lpShares,
    premiumsCollectedUsdc: DEPLOYMENTS.hadrian.metrics.premiumsCollectedUsdc,
    payoutsSettledUsdc: DEPLOYMENTS.hadrian.metrics.payoutsSettledUsdc,
    notionalVolumeUsdc: DEPLOYMENTS.hadrian.metrics.notionalVolumeUsdc,
    totalOptionsCount: DEPLOYMENTS.hadrian.metrics.totalOptionsCount,
    cpiSettlementsCount: DEPLOYMENTS.hadrian.metrics.cpiSettlementsCount,
    btcPriceUsd: DEPLOYMENTS.hadrian.metrics.btcPriceUsd,
    solPriceUsd: DEPLOYMENTS.hadrian.metrics.solPriceUsd,
    vaultPda: DEPLOYMENTS.hadrian.vaultPda as `0x${string}`,
    vaultPdaBase58: "9bW7yLp3vK6xN4mQ8rT2uV5wX7yZ1aB3cD5eF7gH9jK",
  });
  const [optionsList, setOptionsList] = useState<OnChainOptionPosition[]>([]);
  const [underwriters, setUnderwriters] = useState<OnChainUnderwriter[]>([]);
  const [settlements, setSettlements] = useState<OnChainSettlement[]>([]);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [txBanner, setTxBanner] = useState<{
    title: string;
    txHash: string;
    solanaSig: string | null;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const demoAccount = useMemo(() => getDemoSignerAccount(), []);
  const syntheticSolanaEvmAddr = useMemo(
    () => deriveSyntheticEvmAddress(solanaAddress),
    [solanaAddress]
  );

  // Sync default strike when switching asset
  useEffect(() => {
    if (selectedAsset === "BTC") {
      setStrikeInput("90000");
      setContractsSize("0.50");
    } else {
      setStrikeInput("185");
      setContractsSize("20.0");
    }
  }, [selectedAsset]);

  const refreshAllOnChainData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const [liveQuotes, liveState] = await Promise.all([
        fetchLiveOracleQuotes(),
        fetchOptionsVaultState(),
      ]);
      setOracles(liveQuotes);
      setVaultSummary(liveState.summary);
      setOptionsList(liveState.options);
      setUnderwriters(liveState.underwriters);
      setSettlements(liveState.settlements);
    } catch (err) {
      console.error("Failed to fetch live Hadrian state:", err);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refreshAllOnChainData();
    const timer = setInterval(refreshAllOnChainData, 15000);
    return () => clearInterval(timer);
  }, [refreshAllOnChainData]);

  // ── Wallet Connect Handlers ──────────────────────────────────────────────
  const connectMetaMask = async () => {
    if (typeof window !== "undefined" && (window as any).ethereum) {
      try {
        const accounts = await (window as any).ethereum.request({
          method: "eth_requestAccounts",
        });
        if (accounts?.[0]) {
          setEvmAddress(accounts[0] as `0x${string}`);
          setUseBrowserWallet(true);
          setWalletLane("EVM");
        }
      } catch (e: any) {
        setErrorMsg(e?.message || "MetaMask connection declined");
      }
    } else {
      setEvmAddress(demoAccount.address);
      setUseBrowserWallet(false);
      setWalletLane("EVM");
    }
  };

  const connectSolflareLane = async () => {
    if (typeof window !== "undefined" && (window as any).solflare) {
      try {
        await (window as any).solflare.connect();
        const pk = (window as any).solflare.publicKey?.toString();
        if (pk) setSolanaAddress(pk);
      } catch {
        // fallback to demo Solana pubkey
      }
    }
    setWalletLane("SOLANA");
  };

  const copyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  // ── Computed Pricing & Payoff ────────────────────────────────────────────
  const currentSpotPrice =
    selectedAsset === "BTC"
      ? vaultSummary.btcPriceUsd || 91480
      : vaultSummary.solPriceUsd || 184.5;

  const parsedStrike = Math.max(Number(strikeInput) || currentSpotPrice, 1);
  const parsedContracts = Math.max(Number(contractsSize) || 0.1, 0.01);

  const liveOptionQuote = useMemo(() => {
    const notionalUsdc = currentSpotPrice * parsedContracts;
    let intrinsicUsdc = 0;
    if (selectedType === "CALL" && currentSpotPrice > parsedStrike) {
      intrinsicUsdc = (currentSpotPrice - parsedStrike) * parsedContracts;
    } else if (selectedType === "PUT" && parsedStrike > currentSpotPrice) {
      intrinsicUsdc = (parsedStrike - currentSpotPrice) * parsedContracts;
    }
    const baseIvBps = selectedAsset === "BTC" ? 65 : 110;
    let timeFactorBps = Math.floor((selectedTenor * 50) / 86400);
    if (timeFactorBps < 15) timeFactorBps = 15;

    const timeValueUsdc = (notionalUsdc * (baseIvBps + timeFactorBps)) / 10000;
    const premiumUsdc = Math.max(intrinsicUsdc + timeValueUsdc, 0.1);
    const collateralUsdc = Math.max(notionalUsdc * 0.2, premiumUsdc * 2);
    const breakevenUsd =
      selectedType === "CALL"
        ? parsedStrike + premiumUsdc / parsedContracts
        : parsedStrike - premiumUsdc / parsedContracts;

    return {
      notionalUsdc,
      intrinsicUsdc,
      timeValueUsdc,
      premiumUsdc,
      collateralUsdc,
      breakevenUsd,
      ivPercent: selectedAsset === "BTC" ? 54.8 : 78.4,
    };
  }, [
    currentSpotPrice,
    parsedStrike,
    parsedContracts,
    selectedAsset,
    selectedType,
    selectedTenor,
  ]);

  // Generate Options Chain Matrix Strikes around Spot
  const optionsChainRows: StrikeRow[] = useMemo(() => {
    const step = selectedAsset === "BTC" ? 1000 : 5;
    const center = Math.round(currentSpotPrice / step) * step;
    const strikes = [
      center - step * 3,
      center - step * 2,
      center - step,
      center,
      center + step,
      center + step * 2,
      center + step * 3,
    ];

    return strikes.map((st, idx) => {
      const callIntrinsic = Math.max(currentSpotPrice - st, 0);
      const putIntrinsic = Math.max(st - currentSpotPrice, 0);
      const timeVal = currentSpotPrice * (selectedAsset === "BTC" ? 0.0085 : 0.0135);
      const callMid = callIntrinsic + timeVal * (1 - idx * 0.06);
      const putMid = putIntrinsic + timeVal * (0.7 + idx * 0.06);
      return {
        strike: st,
        callBid: Math.max(callMid * 0.97, 0.25),
        callAsk: Math.max(callMid * 1.03, 0.35),
        callIv: (selectedAsset === "BTC" ? 52.4 : 74.2) + Math.abs(3 - idx) * 2.1,
        callDelta: Number(Math.max(0.88 - idx * 0.12, 0.08).toFixed(2)),
        callOi: selectedAsset === "BTC" ? 14.5 + idx * 3.2 : 420 + idx * 85,
        putBid: Math.max(putMid * 0.97, 0.25),
        putAsk: Math.max(putMid * 1.03, 0.35),
        putIv: (selectedAsset === "BTC" ? 53.8 : 76.5) + Math.abs(3 - idx) * 2.3,
        putDelta: Number((-0.12 - idx * 0.12).toFixed(2)),
        putOi: selectedAsset === "BTC" ? 18.2 + (6 - idx) * 2.8 : 510 + (6 - idx) * 70,
      };
    });
  }, [selectedAsset, currentSpotPrice]);

  // Payoff Curve Points for Visualizer
  const payoffCurvePoints = useMemo(() => {
    const points: { price: number; pnl: number; roi: number }[] = [];
    const minP = parsedStrike * 0.88;
    const maxP = parsedStrike * 1.12;
    const steps = 16;
    for (let i = 0; i <= steps; i++) {
      const p = minP + ((maxP - minP) * i) / steps;
      let gross = 0;
      if (selectedType === "CALL" && p > parsedStrike) {
        gross = (p - parsedStrike) * parsedContracts;
      } else if (selectedType === "PUT" && parsedStrike > p) {
        gross = (parsedStrike - p) * parsedContracts;
      }
      const cappedGross = Math.min(gross, liveOptionQuote.collateralUsdc);
      const netPnl = cappedGross - liveOptionQuote.premiumUsdc;
      const roi = (netPnl / liveOptionQuote.premiumUsdc) * 100;
      points.push({ price: p, pnl: netPnl, roi });
    }
    return points;
  }, [parsedStrike, parsedContracts, selectedType, liveOptionQuote]);

  // ── On-Chain Write Actions (via submitRomeTx) ───────────────────────────
  const handleBuyOptionOnChain = async () => {
    setErrorMsg(null);
    setTxBanner(null);
    setIsSubmitting(true);
    try {
      const assetEnum = selectedAsset === "BTC" ? 0 : 1;
      const typeEnum = selectedType === "CALL" ? 0 : 1;
      const contractsScaled = BigInt(Math.round(parsedContracts * 10000));
      const strikeScaled = BigInt(Math.round(parsedStrike * 1e8));
      const durationSec = BigInt(selectedTenor);
      const customSolanaPubkey =
        walletLane === "SOLANA"
          ? pubkeyToBytes32(solanaAddress)
          : (("0x" + "0".repeat(64)) as `0x${string}`);
      const laneEnum = walletLane === "SOLANA" ? 1 : 0;

      const data = encodeFunctionData({
        abi: ROME_OPTIONS_VAULT_ABI,
        functionName: "buyOption",
        args: [
          assetEnum,
          typeEnum,
          contractsScaled,
          strikeScaled,
          durationSec,
          customSolanaPubkey,
          laneEnum,
        ],
      });

      const res = await sendAugurVaultTx({
        data,
        useBrowserWallet,
        browserAddress: evmAddress,
      });

      setTxBanner({
        title: `Purchased ${parsedContracts} ${selectedAsset} $${parsedStrike.toLocaleString()} ${selectedType} Option (${
          walletLane === "SOLANA" ? "Solana Dual-Lane" : "EVM Lane"
        })`,
        txHash: res.txHash,
        solanaSig: res.solanaSig,
      });
      await refreshAllOnChainData();
    } catch (err: any) {
      setErrorMsg(err?.message || "Option purchase failed on Hadrian");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExerciseOptionOnChain = async (optionId: number) => {
    setErrorMsg(null);
    setTxBanner(null);
    setIsSubmitting(true);
    try {
      const data = encodeFunctionData({
        abi: ROME_OPTIONS_VAULT_ABI,
        functionName: "exerciseAndSettleOption",
        args: [BigInt(optionId), 100_000n, [], "0x"],
      });

      const res = await sendAugurVaultTx({
        data,
        useBrowserWallet,
        browserAddress: evmAddress,
      });

      setTxBanner({
        title: `Exercised Option #${optionId} & Settled Atomically on Solana via Precompile 0xFF...08`,
        txHash: res.txHash,
        solanaSig: res.solanaSig,
      });
      await refreshAllOnChainData();
    } catch (err: any) {
      setErrorMsg(
        err?.message ||
          "Exercise reverted (check if Option is In-The-Money or already settled)"
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSupplyUnderwriterLp = async () => {
    setErrorMsg(null);
    setTxBanner(null);
    setIsSubmitting(true);
    try {
      const amtUsdc = Math.max(Number(lpDepositAmount) || 500, 10);
      const rawUsdc = BigInt(Math.round(amtUsdc * 1e6));
      const customSolanaPubkey =
        walletLane === "SOLANA"
          ? pubkeyToBytes32(solanaAddress)
          : (("0x" + "0".repeat(64)) as `0x${string}`);
      const laneEnum = walletLane === "SOLANA" ? 1 : 0;

      const data = encodeFunctionData({
        abi: ROME_OPTIONS_VAULT_ABI,
        functionName: "supplyUnderwriterLiquidity",
        args: [rawUsdc, customSolanaPubkey, laneEnum],
      });

      const res = await sendAugurVaultTx({
        data,
        useBrowserWallet,
        browserAddress: evmAddress,
      });

      setTxBanner({
        title: `Supplied ${amtUsdc.toLocaleString()} USDC to Shared Dual-Lane Underwriter Vault`,
        txHash: res.txHash,
        solanaSig: res.solanaSig,
      });
      await refreshAllOnChainData();
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to supply Underwriter LP liquidity");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleWithdrawUnderwriterLp = async () => {
    setErrorMsg(null);
    setTxBanner(null);
    setIsSubmitting(true);
    try {
      const sharesNum = Math.max(Number(lpWithdrawShares) || 100, 1);
      const rawShares = BigInt(Math.round(sharesNum * 1e6));

      const data = encodeFunctionData({
        abi: ROME_OPTIONS_VAULT_ABI,
        functionName: "withdrawUnderwriterLiquidity",
        args: [rawShares],
      });

      const res = await sendAugurVaultTx({
        data,
        useBrowserWallet,
        browserAddress: evmAddress,
      });

      setTxBanner({
        title: `Withdrew ${sharesNum.toLocaleString()} augUSDC LP Shares from Underwriter Vault`,
        txHash: res.txHash,
        solanaSig: res.solanaSig,
      });
      await refreshAllOnChainData();
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to withdraw LP shares");
    } finally {
      setIsSubmitting(false);
    }
  };

  const vaultUtilizationPct =
    vaultSummary.totalAssetsUsdc > 0
      ? Math.min(
          (vaultSummary.lockedCollateralUsdc / vaultSummary.totalAssetsUsdc) *
            100,
          100
        )
      : 0;

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 flex flex-col">
      {/* ── Top Live Oracle & Protocol Status Bar ─────────────────────────── */}
      <div className="border-b border-slate-800/80 bg-[#0a101f]/90 backdrop-blur-md px-4 py-2 text-xs">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Hadrian Testnet (200010) Live
            </span>
            <div className="flex items-center gap-2 text-slate-300">
              <span className="text-amber-400 font-semibold">BTC/USD:</span>
              <span className="font-mono font-bold text-white">
                ${vaultSummary.btcPriceUsd.toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </span>
              <span className="text-[10px] text-slate-500">(Pyth/Switchboard)</span>
            </div>
            <div className="flex items-center gap-2 text-slate-300">
              <span className="text-purple-400 font-semibold">SOL/USD:</span>
              <span className="font-mono font-bold text-white">
                ${vaultSummary.solPriceUsd.toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </span>
              <span className="text-[10px] text-slate-500">(Oracle Gateway)</span>
            </div>
            <div className="hidden md:flex items-center gap-2 text-slate-400">
              <span>CPI Precompile:</span>
              <code className="text-cyan-400 font-mono">0xFF...08</code>
              <span>· Helper:</span>
              <code className="text-cyan-400 font-mono">0xFF...09</code>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <a
              href={`${HADRIAN_EXPLORER}/address/${VAULT_ADDRESS}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-amber-400 hover:text-amber-300 font-mono"
            >
              Vault: {VAULT_ADDRESS.slice(0, 8)}...{VAULT_ADDRESS.slice(-6)}
              <ExternalLink className="w-3 h-3" />
            </a>
            <button
              onClick={refreshAllOnChainData}
              disabled={isRefreshing}
              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
            >
              <RefreshCw
                className={`w-3 h-3 ${isRefreshing ? "animate-spin text-amber-400" : ""}`}
              />
              Sync
            </button>
          </div>
        </div>
      </div>

      {/* ── Main Header & Dual-Lane Wallet Bar ────────────────────────────── */}
      <header className="border-b border-slate-800/80 bg-[#0b1222]">
        <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-500 via-orange-500 to-purple-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
              <Flame className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-white">
                  AUGUR OPTIONS
                </h1>
                <span className="px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                  BTC & SOL 0DTE
                </span>
                <span className="px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider rounded bg-purple-500/15 text-purple-300 border border-purple-500/30">
                  Dual-Lane Shared Vault
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                USDC-Settled BTC & SOL Options Platform for EVM & Solana Wallets · Atomic Solana CPI Settlement via <code className="text-amber-300">0xFF...08</code>
              </p>
            </div>
          </div>

          {/* Dual-Lane Switcher & Wallet Controls */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center bg-slate-900/90 p-1 rounded-lg border border-slate-800">
              <button
                onClick={() => setWalletLane("EVM")}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition flex items-center gap-1.5 ${
                  walletLane === "EVM"
                    ? "bg-amber-500 text-slate-950 font-semibold shadow"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <Wallet className="w-3.5 h-3.5" />
                EVM Lane (MetaMask)
              </button>
              <button
                onClick={connectSolflareLane}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition flex items-center gap-1.5 ${
                  walletLane === "SOLANA"
                    ? "bg-purple-500 text-white font-semibold shadow"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <Zap className="w-3.5 h-3.5" />
                Solana Lane (Solflare V1)
              </button>
            </div>

            {walletLane === "EVM" ? (
              <button
                onClick={connectMetaMask}
                className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-mono text-amber-300 flex items-center gap-2 transition"
              >
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                {evmAddress
                  ? `${evmAddress.slice(0, 6)}...${evmAddress.slice(-4)} (Browser)`
                  : `${demoAccount.address.slice(0, 6)}...${demoAccount.address.slice(-4)} (Hadrian Sandbox)`}
              </button>
            ) : (
              <div className="px-3.5 py-2 rounded-lg bg-purple-950/40 border border-purple-500/40 text-xs font-mono text-purple-200 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-purple-400 animate-ping" />
                <span>Solana: {solanaAddress.slice(0, 6)}...{solanaAddress.slice(-4)}</span>
                <span className="text-slate-400">→ Synthetic EVM:</span>
                <span className="text-amber-300">
                  {syntheticSolanaEvmAddr.slice(0, 6)}...{syntheticSolanaEvmAddr.slice(-4)}
                </span>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Top KPI Strip ─────────────────────────────────────────────────── */}
      <section className="max-w-7xl mx-auto w-full px-4 pt-5">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="bg-[#0d1527] border border-slate-800/90 rounded-xl p-3.5">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Unified LP Pool TVL</span>
              <Coins className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-lg font-bold font-mono text-white mt-1">
              ${vaultSummary.totalAssetsUsdc.toLocaleString("en-US", { maximumFractionDigits: 2 })}
            </div>
            <div className="text-[11px] text-emerald-400 mt-0.5">
              Avail: ${vaultSummary.availableLiquidityUsdc.toLocaleString("en-US", { maximumFractionDigits: 0 })} wUSDC
            </div>
          </div>

          <div className="bg-[#0d1527] border border-slate-800/90 rounded-xl p-3.5">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Notional Option Vol</span>
              <BarChart3 className="w-4 h-4 text-cyan-400" />
            </div>
            <div className="text-lg font-bold font-mono text-white mt-1">
              ${vaultSummary.notionalVolumeUsdc.toLocaleString("en-US", { maximumFractionDigits: 0 })}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              {vaultSummary.totalOptionsCount} On-Chain Contracts
            </div>
          </div>

          <div className="bg-[#0d1527] border border-slate-800/90 rounded-xl p-3.5">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Premiums Earned</span>
              <Sparkles className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-lg font-bold font-mono text-emerald-400 mt-1">
              +${vaultSummary.premiumsCollectedUsdc.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Accrued to augUSDC LPs
            </div>
          </div>

          <div className="bg-[#0d1527] border border-slate-800/90 rounded-xl p-3.5">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Atomic CPI Settlements</span>
              <Cpu className="w-4 h-4 text-purple-400" />
            </div>
            <div className="text-lg font-bold font-mono text-purple-300 mt-1">
              {vaultSummary.cpiSettlementsCount} Settled
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Payouts: ${vaultSummary.payoutsSettledUsdc.toLocaleString("en-US", { minimumFractionDigits: 2 })} USDC
            </div>
          </div>

          <div className="bg-[#0d1527] border border-slate-800/90 rounded-xl p-3.5">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Collateral Utilization</span>
              <Gauge className="w-4 h-4 text-orange-400" />
            </div>
            <div className="text-lg font-bold font-mono text-white mt-1">
              {vaultUtilizationPct.toFixed(1)}%
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Locked: ${vaultSummary.lockedCollateralUsdc.toLocaleString("en-US")} USDC
            </div>
          </div>

          <div className="bg-[#0d1527] border border-slate-800/90 rounded-xl p-3.5">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Vault Signer PDA</span>
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-xs font-mono text-cyan-300 mt-1.5 truncate">
              {vaultSummary.vaultPda}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              Derived via <code className="text-amber-300">0xFF...09</code>
            </div>
          </div>
        </div>
      </section>

      {/* ── Transaction Feedback Banner ───────────────────────────────────── */}
      {(txBanner || errorMsg) && (
        <div className="max-w-7xl mx-auto w-full px-4 mt-4">
          {txBanner && (
            <div className="p-4 rounded-xl bg-emerald-950/60 border border-emerald-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-semibold text-emerald-200">
                    {txBanner.title}
                  </div>
                  <div className="text-xs font-mono text-slate-300 mt-1 flex flex-wrap items-center gap-3">
                    <span>Hadrian EVM Tx: {txBanner.txHash}</span>
                    {txBanner.solanaSig && (
                      <span className="text-purple-300">
                        Solana Settlement Sig: {txBanner.solanaSig.slice(0, 16)}...
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <a
                href={`${HADRIAN_EXPLORER}/tx/${txBanner.txHash}`}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-xs font-semibold text-emerald-300 inline-flex items-center gap-1.5 shrink-0"
              >
                View on Hadrian Explorer
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          )}

          {errorMsg && (
            <div className="p-3.5 rounded-xl bg-rose-950/60 border border-rose-500/40 text-xs text-rose-200 flex items-center justify-between">
              <span>⚠️ {errorMsg}</span>
              <button
                onClick={() => setErrorMsg(null)}
                className="text-rose-300 hover:text-white underline ml-4"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Navigation Tabs ───────────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto w-full px-4 mt-5">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3">
          {[
            {
              id: "terminal",
              label: "0DTE Trading Terminal",
              icon: Terminal,
            },
            {
              id: "chain",
              label: "Options Chain Matrix",
              icon: Layers,
            },
            {
              id: "payoff",
              label: "Payoff Visualizer & Greeks",
              icon: Activity,
            },
            {
              id: "vault",
              label: "Underwriter LP Vault",
              icon: Lock,
            },
            {
              id: "explorer",
              label: "Verified On-Chain CPI Proofs (9 Txs)",
              icon: ShieldCheck,
            },
          ].map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id as any)}
                className={`px-4 py-2 rounded-lg text-xs font-semibold transition flex items-center gap-2 ${
                  active
                    ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20"
                    : "bg-[#0d1527] text-slate-300 hover:text-white border border-slate-800"
                }`}
              >
                <Icon className="w-4 h-4" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Main Content Area ─────────────────────────────────────────────── */}
      <main className="max-w-7xl mx-auto w-full px-4 py-6 flex-1 space-y-6">
        {/* TAB 1: 0DTE TRADING TERMINAL */}
        {activeTab === "terminal" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left 7 cols: Order Builder & Market Feed */}
            <div className="lg:col-span-7 space-y-5">
              <div className="bg-[#0d1527] border border-slate-800 rounded-2xl p-5">
                <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelectedAsset("BTC")}
                      className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition ${
                        selectedAsset === "BTC"
                          ? "bg-amber-500 text-slate-950"
                          : "bg-slate-900 text-slate-300 hover:bg-slate-800"
                      }`}
                    >
                      <span>₿ BTC / USDC</span>
                      <span className="font-mono text-xs">
                        ${vaultSummary.btcPriceUsd.toLocaleString()}
                      </span>
                    </button>
                    <button
                      onClick={() => setSelectedAsset("SOL")}
                      className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition ${
                        selectedAsset === "SOL"
                          ? "bg-purple-500 text-white"
                          : "bg-slate-900 text-slate-300 hover:bg-slate-800"
                      }`}
                    >
                      <span>◎ SOL / USDC</span>
                      <span className="font-mono text-xs">
                        ${vaultSummary.solPriceUsd.toFixed(2)}
                      </span>
                    </button>
                  </div>

                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-slate-400">Oracle Feed:</span>
                    <a
                      href={`${HADRIAN_EXPLORER}/address/${
                        selectedAsset === "BTC"
                          ? DEPLOYMENTS.hadrian.oracles["BTC/USD"]
                          : DEPLOYMENTS.hadrian.oracles["SOL/USD"]
                      }`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-cyan-400 hover:underline flex items-center gap-1"
                    >
                      {selectedAsset === "BTC"
                        ? DEPLOYMENTS.hadrian.oracles["BTC/USD"].slice(0, 10)
                        : DEPLOYMENTS.hadrian.oracles["SOL/USD"].slice(0, 10)}
                      ...
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>

                {/* Option Direction & Tenor */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-5">
                  <div>
                    <label className="text-xs font-semibold text-slate-400 uppercase">
                      Option Direction
                    </label>
                    <div className="grid grid-cols-2 gap-2 mt-1.5">
                      <button
                        onClick={() => setSelectedType("CALL")}
                        className={`py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 border transition ${
                          selectedType === "CALL"
                            ? "bg-emerald-500/20 border-emerald-500 text-emerald-300"
                            : "bg-slate-900 border-slate-800 text-slate-400"
                        }`}
                      >
                        <TrendingUp className="w-4 h-4" />
                        LONG CALL (Bullish)
                      </button>
                      <button
                        onClick={() => setSelectedType("PUT")}
                        className={`py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 border transition ${
                          selectedType === "PUT"
                            ? "bg-rose-500/20 border-rose-500 text-rose-300"
                            : "bg-slate-900 border-slate-800 text-slate-400"
                        }`}
                      >
                        <TrendingDown className="w-4 h-4" />
                        LONG PUT (Bearish)
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-400 uppercase">
                      Expiration Tenor (0DTE & Short-Dated)
                    </label>
                    <div className="grid grid-cols-4 gap-1.5 mt-1.5">
                      {[
                        { label: "4H 0DTE", sec: 14400 },
                        { label: "8H 0DTE", sec: 28800 },
                        { label: "24H 0DTE", sec: 86400 },
                        { label: "7D Weekly", sec: 604800 },
                      ].map((t) => (
                        <button
                          key={t.sec}
                          onClick={() => setSelectedTenor(t.sec)}
                          className={`py-2.5 rounded-lg text-[11px] font-semibold border transition ${
                            selectedTenor === t.sec
                              ? "bg-amber-500/20 border-amber-500 text-amber-300"
                              : "bg-slate-900 border-slate-800 text-slate-400 hover:text-white"
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Strike Price & Contract Size Inputs */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                  <div>
                    <label className="text-xs font-semibold text-slate-400">
                      Strike Price ($ USD)
                    </label>
                    <input
                      type="number"
                      value={strikeInput}
                      onChange={(e) => setStrikeInput(e.target.value)}
                      className="w-full mt-1.5 px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono text-sm focus:outline-none focus:border-amber-500"
                    />
                    <div className="flex items-center gap-1.5 mt-2">
                      {selectedAsset === "BTC"
                        ? ["88000", "89000", "90000", "92000", "95000"].map(
                            (s) => (
                              <button
                                key={s}
                                onClick={() => setStrikeInput(s)}
                                className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[11px] font-mono text-slate-300"
                              >
                                ${Number(s) / 1000}k
                              </button>
                            )
                          )
                        : ["175", "180", "185", "190", "200"].map((s) => (
                            <button
                              key={s}
                              onClick={() => setStrikeInput(s)}
                              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[11px] font-mono text-slate-300"
                            >
                              ${s}
                            </button>
                          ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-400">
                      Contracts Size ({selectedAsset})
                    </label>
                    <input
                      type="number"
                      step="0.05"
                      value={contractsSize}
                      onChange={(e) => setContractsSize(e.target.value)}
                      className="w-full mt-1.5 px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono text-sm focus:outline-none focus:border-amber-500"
                    />
                    <div className="flex items-center gap-1.5 mt-2">
                      {(selectedAsset === "BTC"
                        ? ["0.10", "0.25", "0.50", "1.00"]
                        : ["5.0", "10.0", "20.0", "50.0"]
                      ).map((c) => (
                        <button
                          key={c}
                          onClick={() => setContractsSize(c)}
                          className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[11px] font-mono text-slate-300"
                        >
                          {c} {selectedAsset}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Live Quote Summary Box */}
                <div className="mt-5 p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Notional Position Value:</span>
                    <span className="font-mono text-slate-200">
                      ${liveOptionQuote.notionalUsdc.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">
                      Intrinsic Value + 0DTE Time Value ({liveOptionQuote.ivPercent}% IV):
                    </span>
                    <span className="font-mono text-slate-200">
                      ${liveOptionQuote.intrinsicUsdc.toFixed(2)} + ${liveOptionQuote.timeValueUsdc.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">
                      Required LP Vault Collateral Reserve (20% Cap):
                    </span>
                    <span className="font-mono text-cyan-300">
                      ${liveOptionQuote.collateralUsdc.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} wUSDC
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Breakeven Index Price at Expiry:</span>
                    <span className="font-mono font-semibold text-amber-300">
                      ${liveOptionQuote.breakevenUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="pt-2 border-t border-slate-800 flex justify-between items-center text-sm">
                    <span className="font-semibold text-white">
                      Total Option Premium (wUSDC):
                    </span>
                    <span className="font-mono font-bold text-emerald-400 text-base">
                      ${liveOptionQuote.premiumUsdc.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC
                    </span>
                  </div>
                </div>

                <button
                  onClick={handleBuyOptionOnChain}
                  disabled={isSubmitting}
                  className="w-full mt-4 py-3.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-bold text-sm shadow-lg shadow-amber-500/20 transition flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Zap className="w-4 h-4" />
                  {isSubmitting
                    ? "Broadcasting to Rome Hadrian (200010)..."
                    : `Buy ${parsedContracts} ${selectedAsset} $${parsedStrike.toLocaleString()} ${selectedType} (${
                        walletLane === "SOLANA" ? "Solana Dual-Lane" : "EVM Lane"
                      })`}
                </button>
              </div>
            </div>

            {/* Right 5 cols: Active On-Chain Positions & Instant Exercise via CPI */}
            <div className="lg:col-span-5 space-y-5">
              <div className="bg-[#0d1527] border border-slate-800 rounded-2xl p-5">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <div>
                    <h2 className="text-sm font-bold text-white flex items-center gap-2">
                      <Cpu className="w-4 h-4 text-purple-400" />
                      On-Chain Option Positions ({optionsList.length})
                    </h2>
                    <p className="text-[11px] text-slate-400">
                      Live positions stored in <code className="text-amber-300">RomeOptionsVault.sol</code> across EVM & Solana lanes
                    </p>
                  </div>
                </div>

                <div className="space-y-3 mt-4 max-h-[520px] overflow-y-auto pr-1">
                  {optionsList.map((opt) => {
                    const spotNow =
                      opt.asset === "BTC"
                        ? vaultSummary.btcPriceUsd
                        : vaultSummary.solPriceUsd;
                    const estPayout =
                      opt.optionType === "CALL"
                        ? Math.max((spotNow - opt.strikePriceUsd) * opt.contractsCount, 0)
                        : Math.max((opt.strikePriceUsd - spotNow) * opt.contractsCount, 0);

                    return (
                      <div
                        key={opt.id}
                        className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded bg-slate-800 font-mono font-bold text-white">
                              #{opt.id}
                            </span>
                            <span className="font-bold text-white">
                              {opt.contractsCount} {opt.asset} ${opt.strikePriceUsd.toLocaleString()}{" "}
                              {opt.optionType}
                            </span>
                            {opt.isZeroDte && (
                              <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px] font-semibold">
                                0DTE
                              </span>
                            )}
                          </div>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              opt.status === "EXERCISED"
                                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                : opt.status === "OPEN"
                                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                                : "bg-slate-800 text-slate-400"
                            }`}
                          >
                            {opt.status}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-400">
                          <div>
                            Lane:{" "}
                            <span
                              className={
                                opt.lane === "SOLANA"
                                  ? "text-purple-300 font-semibold"
                                  : "text-amber-300 font-semibold"
                              }
                            >
                              {opt.lane}
                            </span>
                          </div>
                          <div>
                            Premium:{" "}
                            <span className="text-slate-200 font-mono">
                              ${opt.premiumPaidUsdc.toFixed(2)} USDC
                            </span>
                          </div>
                          <div>
                            Entry Spot:{" "}
                            <span className="text-slate-200 font-mono">
                              ${opt.entrySpotPriceUsd.toLocaleString()}
                            </span>
                          </div>
                          <div>
                            Locked Cap:{" "}
                            <span className="text-slate-200 font-mono">
                              ${opt.collateralLockedUsdc.toFixed(2)}
                            </span>
                          </div>
                        </div>

                        {opt.status === "EXERCISED" ? (
                          <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
                            <span className="text-emerald-400 font-semibold">
                              ✓ Settled via Solana CPI (0xFF...08) @ $
                              {opt.settlementPriceUsd.toLocaleString()}
                            </span>
                            <span className="font-mono font-bold text-emerald-300">
                              Payout: +${opt.payoutUsdc.toFixed(2)} USDC
                            </span>
                          </div>
                        ) : (
                          <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
                            <span className="text-[11px] text-slate-300">
                              Est. Intrinsic Payout:{" "}
                              <strong className="text-emerald-400 font-mono">
                                ${estPayout.toFixed(2)} USDC
                              </strong>
                            </span>
                            <button
                              onClick={() => handleExerciseOptionOnChain(opt.id)}
                              disabled={isSubmitting || estPayout <= 0}
                              className="px-3 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-semibold text-[11px] transition"
                            >
                              Exercise via CPI (0xFF...08)
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: OPTIONS CHAIN MATRIX */}
        {activeTab === "chain" && (
          <div className="bg-[#0d1527] border border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Layers className="w-5 h-5 text-amber-400" />
                  Live {selectedAsset}/USDC Options Chain Matrix (Rome Oracle Gateway)
                </h2>
                <p className="text-xs text-slate-400">
                  Click any Call or Put Bid/Ask row to load that strike directly into the 0DTE Trading Terminal
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedAsset("BTC")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                    selectedAsset === "BTC"
                      ? "bg-amber-500 text-slate-950"
                      : "bg-slate-900 text-slate-400"
                  }`}
                >
                  BTC Chain (${vaultSummary.btcPriceUsd.toLocaleString()})
                </button>
                <button
                  onClick={() => setSelectedAsset("SOL")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                    selectedAsset === "SOL"
                      ? "bg-purple-500 text-white"
                      : "bg-slate-900 text-slate-400"
                  }`}
                >
                  SOL Chain (${vaultSummary.solPriceUsd.toFixed(2)})
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 bg-slate-900/70">
                    <th colSpan={5} className="py-2.5 px-3 text-center text-emerald-400 border-r border-slate-800">
                      CALLS (Bullish — Settled in wUSDC)
                    </th>
                    <th className="py-2.5 px-4 text-center text-amber-300 bg-slate-900">
                      STRIKE (USD)
                    </th>
                    <th colSpan={5} className="py-2.5 px-3 text-center text-rose-400 border-l border-slate-800">
                      PUTS (Bearish — Settled in wUSDC)
                    </th>
                  </tr>
                  <tr className="border-b border-slate-800 text-[11px] text-slate-400">
                    <th className="py-2 px-3 text-left">OI</th>
                    <th className="py-2 px-3 text-right">Delta</th>
                    <th className="py-2 px-3 text-right">IV</th>
                    <th className="py-2 px-3 text-right">Bid</th>
                    <th className="py-2 px-3 text-right border-r border-slate-800">Ask</th>
                    <th className="py-2 px-4 text-center bg-slate-900/90 text-white">Strike</th>
                    <th className="py-2 px-3 text-left border-l border-slate-800">Bid</th>
                    <th className="py-2 px-3 text-right">Ask</th>
                    <th className="py-2 px-3 text-right">IV</th>
                    <th className="py-2 px-3 text-right">Delta</th>
                    <th className="py-2 px-3 text-right">OI</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {optionsChainRows.map((row) => {
                    const callItm = currentSpotPrice > row.strike;
                    const putItm = currentSpotPrice < row.strike;
                    return (
                      <tr
                        key={row.strike}
                        className="hover:bg-slate-800/40 transition"
                      >
                        <td className="py-2.5 px-3 text-slate-400">
                          {row.callOi.toFixed(1)}
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-300">
                          {row.callDelta}
                        </td>
                        <td className="py-2.5 px-3 text-right text-cyan-400">
                          {row.callIv.toFixed(1)}%
                        </td>
                        <td className="py-2.5 px-3 text-right text-emerald-400">
                          ${row.callBid.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-3 text-right border-r border-slate-800">
                          <button
                            onClick={() => {
                              setStrikeInput(String(row.strike));
                              setSelectedType("CALL");
                              setActiveTab("terminal");
                            }}
                            className={`px-2 py-1 rounded font-bold ${
                              callItm
                                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                : "bg-slate-800 text-slate-200 hover:bg-emerald-500/20"
                            }`}
                          >
                            Buy ${row.callAsk.toFixed(2)}
                          </button>
                        </td>

                        <td className="py-2.5 px-4 text-center font-bold text-amber-300 bg-slate-900/90">
                          ${row.strike.toLocaleString()}
                        </td>

                        <td className="py-2.5 px-3 text-left border-l border-slate-800 text-rose-400">
                          ${row.putBid.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            onClick={() => {
                              setStrikeInput(String(row.strike));
                              setSelectedType("PUT");
                              setActiveTab("terminal");
                            }}
                            className={`px-2 py-1 rounded font-bold ${
                              putItm
                                ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                                : "bg-slate-800 text-slate-200 hover:bg-rose-500/20"
                            }`}
                          >
                            Buy ${row.putAsk.toFixed(2)}
                          </button>
                        </td>
                        <td className="py-2.5 px-3 text-right text-cyan-400">
                          {row.putIv.toFixed(1)}%
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-300">
                          {row.putDelta}
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-400">
                          {row.putOi.toFixed(1)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: PAYOFF VISUALIZER */}
        {activeTab === "payoff" && (
          <div className="bg-[#0d1527] border border-slate-800 rounded-2xl p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Activity className="w-5 h-5 text-emerald-400" />
                  Option Payoff Visualizer & Expiry PnL Simulator
                </h2>
                <p className="text-xs text-slate-400">
                  Simulating {parsedContracts} {selectedAsset} ${parsedStrike.toLocaleString()}{" "}
                  {selectedType} · Premium Paid: ${liveOptionQuote.premiumUsdc.toFixed(2)} USDC · Breakeven: $
                  {liveOptionQuote.breakevenUsd.toFixed(2)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800">
                <div className="text-slate-400">Max Downside Loss</div>
                <div className="text-base font-bold font-mono text-rose-400 mt-1">
                  -${liveOptionQuote.premiumUsdc.toFixed(2)} USDC
                </div>
                <div className="text-[11px] text-slate-500">100% Capped at Premium</div>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800">
                <div className="text-slate-400">Breakeven Price</div>
                <div className="text-base font-bold font-mono text-amber-300 mt-1">
                  ${liveOptionQuote.breakevenUsd.toFixed(2)}
                </div>
                <div className="text-[11px] text-slate-500">Oracle Settlement Trigger</div>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800">
                <div className="text-slate-400">Max Vault Payout Cap</div>
                <div className="text-base font-bold font-mono text-emerald-400 mt-1">
                  +${liveOptionQuote.collateralUsdc.toFixed(2)} USDC
                </div>
                <div className="text-[11px] text-slate-500">Escrowed in LP Vault</div>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800">
                <div className="text-slate-400">Settlement Mechanism</div>
                <div className="text-base font-bold font-mono text-purple-300 mt-1">
                  Atomic CPI (0xFF..08)
                </div>
                <div className="text-[11px] text-slate-500">Sub-second Solana Finality</div>
              </div>
            </div>

            {/* Interactive Bar Payoff Matrix */}
            <div className="p-5 rounded-xl bg-slate-900/90 border border-slate-800">
              <div className="text-xs font-semibold text-slate-300 mb-4">
                Net Profit / Loss (USDC) Across Settlement Index Prices at Expiration
              </div>
              <div className="grid grid-cols-17 gap-1.5 items-end h-56 pt-6 pb-2">
                {payoffCurvePoints.map((pt, i) => {
                  const maxAbs = Math.max(
                    ...payoffCurvePoints.map((p) => Math.abs(p.pnl)),
                    1
                  );
                  const heightPct = Math.max(
                    Math.min((Math.abs(pt.pnl) / maxAbs) * 100, 100),
                    8
                  );
                  const isPos = pt.pnl >= 0;
                  return (
                    <div
                      key={i}
                      className="flex flex-col items-center justify-end h-full group"
                    >
                      <div className="text-[10px] font-mono text-slate-400 mb-1 opacity-0 group-hover:opacity-100 transition">
                        {isPos ? "+" : ""}${pt.pnl.toFixed(0)}
                      </div>
                      <div
                        style={{ height: `${heightPct}%` }}
                        className={`w-full rounded-t transition ${
                          isPos
                            ? "bg-gradient-to-t from-emerald-600 to-emerald-400"
                            : "bg-gradient-to-t from-rose-700 to-rose-500"
                        }`}
                      />
                      <div className="text-[10px] font-mono text-slate-400 mt-2 rotate-[-35deg]">
                        ${selectedAsset === "BTC" ? (pt.price / 1000).toFixed(1) + "k" : pt.price.toFixed(0)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: UNDERWRITER LP VAULT */}
        {activeTab === "vault" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-6 bg-[#0d1527] border border-slate-800 rounded-2xl p-5 space-y-4">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Lock className="w-5 h-5 text-amber-400" />
                Unified Dual-Lane Underwriter LP Vault (augUSDC)
              </h2>
              <p className="text-xs text-slate-400">
                Both EVM wallets (MetaMask) and Solana wallets (Solflare V1 synthetic sender) supply USDC liquidity into one shared pool to underwrite BTC & SOL options and earn real-time premiums.
              </p>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800">
                  <div className="text-slate-400">Total Pool Assets</div>
                  <div className="text-lg font-bold font-mono text-white mt-1">
                    ${vaultSummary.totalAssetsUsdc.toLocaleString("en-US", { minimumFractionDigits: 2 })} USDC
                  </div>
                </div>
                <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800">
                  <div className="text-slate-400">Total LP Shares (augUSDC)</div>
                  <div className="text-lg font-bold font-mono text-amber-300 mt-1">
                    {vaultSummary.lpShares.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  </div>
                </div>
              </div>

              <div className="space-y-3 pt-2">
                <div>
                  <label className="text-xs font-semibold text-slate-300">
                    Supply USDC Liquidity to Underwriter Pool
                  </label>
                  <div className="flex gap-2 mt-1.5">
                    <input
                      type="number"
                      value={lpDepositAmount}
                      onChange={(e) => setLpDepositAmount(e.target.value)}
                      className="flex-1 px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono text-sm"
                    />
                    <button
                      onClick={handleSupplyUnderwriterLp}
                      disabled={isSubmitting}
                      className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition"
                    >
                      Supply Liquidity
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300">
                    Withdraw Unlocked Liquidity (Burn augUSDC Shares)
                  </label>
                  <div className="flex gap-2 mt-1.5">
                    <input
                      type="number"
                      value={lpWithdrawShares}
                      onChange={(e) => setLpWithdrawShares(e.target.value)}
                      className="flex-1 px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono text-sm"
                    />
                    <button
                      onClick={handleWithdrawUnderwriterLp}
                      disabled={isSubmitting}
                      className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold text-xs transition"
                    >
                      Withdraw USDC
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="lg:col-span-6 bg-[#0d1527] border border-slate-800 rounded-2xl p-5 space-y-4">
              <h3 className="text-sm font-bold text-white">
                Active Underwriter LP Positions ({underwriters.length})
              </h3>
              <div className="space-y-3">
                {underwriters.map((u, idx) => (
                  <div
                    key={idx}
                    className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-xs space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-amber-300 font-semibold">
                        {u.provider}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">
                        {u.lane} LANE LP
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-slate-400">
                      <div>
                        Deposited:{" "}
                        <span className="text-white font-mono">
                          ${u.usdcDeposited.toLocaleString()} USDC
                        </span>
                      </div>
                      <div>
                        LP Shares:{" "}
                        <span className="text-emerald-400 font-mono">
                          {u.shares.toLocaleString()} augUSDC
                        </span>
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono truncate">
                      Solana External-Auth PDA: {u.userSolanaPda}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: VERIFIED ON-CHAIN CPI PROOFS & EXPLORER LINKS */}
        {activeTab === "explorer" && (
          <div className="space-y-6">
            <div className="bg-[#0d1527] border border-slate-800 rounded-2xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-emerald-400" />
                    Live On-Chain Transactions & Atomic Solana CPI Settlements on Hadrian (200010)
                  </h2>
                  <p className="text-xs text-slate-400">
                    Every transaction below was executed on Rome Hadrian Testnet (<code className="text-amber-300">200010</code>) with verified EVM receipt and Solana L1 settlement signature
                  </p>
                </div>
                <a
                  href={`${HADRIAN_EXPLORER}/address/${VAULT_ADDRESS}`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3.5 py-2 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  Open Contract on Hadrian Explorer
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>

              <div className="space-y-3">
                {DEPLOYMENTS.hadrian.transactions.map((tx) => (
                  <div
                    key={tx.id}
                    className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-4 text-xs"
                  >
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono font-bold">
                          Tx #{tx.id}
                        </span>
                        <span className="font-bold text-white text-sm">
                          {tx.label}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-slate-800 text-cyan-300 text-[10px] font-semibold">
                          {tx.lane}
                        </span>
                      </div>
                      <p className="text-slate-400">{tx.details}</p>
                      <div className="flex flex-wrap items-center gap-4 text-[11px] font-mono text-slate-300 pt-1">
                        <span>
                          Signer ({tx.role}): {tx.from.slice(0, 8)}...{tx.from.slice(-6)}
                        </span>
                        <span className="text-amber-300">
                          EVM Hash: {tx.txHash.slice(0, 14)}...{tx.txHash.slice(-8)}
                        </span>
                        {tx.solanaSignature && (
                          <span className="text-purple-300">
                            Solana Settlement: {tx.solanaSignature.slice(0, 14)}...
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => copyText(tx.txHash, `tx-${tx.id}`)}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 inline-flex items-center gap-1"
                      >
                        {copiedId === `tx-${tx.id}` ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        Copy 0x
                      </button>
                      <a
                        href={tx.explorerUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 font-semibold inline-flex items-center gap-1"
                      >
                        Explorer
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <footer className="border-t border-slate-800/80 bg-[#080d1a] py-4 px-4 text-xs text-slate-400 mt-8">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div>
            <strong>Augur Options</strong> — Shared-State BTC & SOL Options Platform on Rome Protocol (Hadrian <code className="text-amber-400">200010</code> & Rubicon <code className="text-purple-400">7531</code>)
          </div>
          <div className="flex items-center gap-4">
            <a
              href={`${HADRIAN_EXPLORER}/address/${VAULT_ADDRESS}`}
              target="_blank"
              rel="noreferrer"
              className="hover:text-amber-300 inline-flex items-center gap-1"
            >
              RomeOptionsVault Contract
              <ExternalLink className="w-3 h-3" />
            </a>
            <a
              href={`${HADRIAN_EXPLORER}/tx/${DEPLOYMENTS.hadrian.primaryCpiTxHash}`}
              target="_blank"
              rel="noreferrer"
              className="hover:text-purple-300 inline-flex items-center gap-1"
            >
              Atomic CPI Settlement Proof (0xFF...08)
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
