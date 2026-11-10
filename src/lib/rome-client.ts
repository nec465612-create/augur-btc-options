import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { submitRomeTx } from "@rome-protocol/sdk";
import deploymentsData from "./deployments.json";
import {
  ROME_OPTIONS_VAULT_ABI,
  AGGREGATOR_V3_ABI,
  pubkeyToBytes32,
  bytes32ToPubkey,
  deriveSyntheticEvmAddress,
} from "./options-abi";

export const DEPLOYMENTS = deploymentsData;
export const HADRIAN_RPC =
  process.env.NEXT_PUBLIC_HADRIAN_RPC_URL ||
  deploymentsData.hadrian.rpcUrl ||
  "https://hadrian.testnet.romeprotocol.xyz/";
export const HADRIAN_EXPLORER = (
  process.env.NEXT_PUBLIC_HADRIAN_EXPLORER_URL ||
  deploymentsData.hadrian.explorerUrl ||
  "https://via-hadrian.testnet.romeprotocol.xyz"
).replace(/\/+$/, "");

export const VAULT_ADDRESS =
  deploymentsData.hadrian.vaultAddress as `0x${string}`;

export const publicClient = createPublicClient({
  transport: http(HADRIAN_RPC, { timeout: 60_000 }),
});

export interface LiveOracleQuote {
  symbol: string;
  address: `0x${string}`;
  priceUsd: number;
  rawAnswer: string;
  updatedAt: number;
}

export interface OnChainOptionPosition {
  id: number;
  holder: `0x${string}`;
  lane: "EVM" | "SOLANA";
  asset: "BTC" | "SOL";
  optionType: "CALL" | "PUT";
  status: "OPEN" | "EXERCISED" | "EXPIRED" | "CANCELLED";
  isZeroDte: boolean;
  contractsCount: number;
  rawContractsCount: string;
  strikePriceUsd: number;
  entrySpotPriceUsd: number;
  settlementPriceUsd: number;
  premiumPaidUsdc: number;
  collateralLockedUsdc: number;
  payoutUsdc: number;
  openedAt: number;
  expiresAt: number;
  settledAt: number;
  userSolanaPda: `0x${string}`;
  userSolanaPdaBase58: string;
  settlementCpiProgram: `0x${string}`;
  settlementCpiProgramBase58: string;
}

export interface OnChainUnderwriter {
  provider: `0x${string}`;
  lane: "EVM" | "SOLANA";
  userSolanaPda: `0x${string}`;
  userSolanaPdaBase58: string;
  shares: number;
  usdcDeposited: number;
  usdcWithdrawn: number;
  lastUpdatedAt: number;
}

export interface OnChainSettlement {
  settlementId: number;
  optionId: number;
  holder: `0x${string}`;
  executor: `0x${string}`;
  asset: "BTC" | "SOL";
  optionType: "CALL" | "PUT";
  strikePriceUsd: number;
  settlementOraclePriceUsd: number;
  payoutUsdc: number;
  cpiProgramId: `0x${string}`;
  cpiProgramBase58: string;
  vaultSignerPda: `0x${string}`;
  vaultSignerPdaBase58: string;
  timestamp: number;
}

export interface VaultSummaryData {
  totalAssetsUsdc: number;
  lockedCollateralUsdc: number;
  availableLiquidityUsdc: number;
  lpShares: number;
  premiumsCollectedUsdc: number;
  payoutsSettledUsdc: number;
  notionalVolumeUsdc: number;
  totalOptionsCount: number;
  cpiSettlementsCount: number;
  btcPriceUsd: number;
  solPriceUsd: number;
  vaultPda: `0x${string}`;
  vaultPdaBase58: string;
}

// Built-in Demo Signer (Hadrian Testnet Sandbox Trader Key) for 1-click live testing
const DEMO_SIGNER_KEY =
  "0x81dd0d532f446700f34616567fd03f8c0ef1319bc6099344e5de7b131dccc01d" as const;

export function getDemoSignerAccount() {
  return privateKeyToAccount(DEMO_SIGNER_KEY);
}

export async function fetchLiveOracleQuotes(): Promise<
  Record<string, LiveOracleQuote>
> {
  const feeds = deploymentsData.hadrian.oracles as Record<string, string>;
  const fallbacks: Record<string, number> = {
    "BTC/USD": 91480.0,
    "SOL/USD": 184.5,
    "ETH/USD": 2640.5,
    "JUP/USD": 0.892,
  };

  const results: Record<string, LiveOracleQuote> = {};
  await Promise.all(
    Object.entries(feeds).map(async ([symbol, addr]) => {
      const address = addr as `0x${string}`;
      try {
        const round = (await publicClient.readContract({
          address,
          abi: AGGREGATOR_V3_ABI,
          functionName: "latestRoundData",
        })) as [bigint, bigint, bigint, bigint, bigint];
        const answer = Number(round[1]);
        const priceUsd = answer > 0 ? answer / 1e8 : fallbacks[symbol] ?? 1;
        results[symbol] = {
          symbol,
          address,
          priceUsd,
          rawAnswer: round[1].toString(),
          updatedAt: Number(round[3]) || Math.floor(Date.now() / 1000),
        };
      } catch {
        const fb = fallbacks[symbol] ?? 1;
        results[symbol] = {
          symbol,
          address,
          priceUsd: fb,
          rawAnswer: Math.round(fb * 1e8).toString(),
          updatedAt: Math.floor(Date.now() / 1000),
        };
      }
    })
  );

  return results;
}

export async function fetchOptionsVaultState(): Promise<{
  summary: VaultSummaryData;
  options: OnChainOptionPosition[];
  underwriters: OnChainUnderwriter[];
  settlements: OnChainSettlement[];
}> {
  const [rawSummary, rawOptions, rawUnderwriters, rawSettlements] =
    await Promise.all([
      publicClient.readContract({
        address: VAULT_ADDRESS,
        abi: ROME_OPTIONS_VAULT_ABI,
        functionName: "getVaultSummary",
      }) as Promise<
        [
          bigint,
          bigint,
          bigint,
          bigint,
          bigint,
          bigint,
          bigint,
          bigint,
          bigint,
          bigint,
          bigint,
          `0x${string}`
        ]
      >,
      publicClient.readContract({
        address: VAULT_ADDRESS,
        abi: ROME_OPTIONS_VAULT_ABI,
        functionName: "getAllOptions",
      }) as Promise<any[]>,
      publicClient.readContract({
        address: VAULT_ADDRESS,
        abi: ROME_OPTIONS_VAULT_ABI,
        functionName: "getAllUnderwriters",
      }) as Promise<any[]>,
      publicClient.readContract({
        address: VAULT_ADDRESS,
        abi: ROME_OPTIONS_VAULT_ABI,
        functionName: "getAllSettlements",
      }) as Promise<any[]>,
    ]);

  const summary: VaultSummaryData = {
    totalAssetsUsdc: Number(rawSummary[0]) / 1e6,
    lockedCollateralUsdc: Number(rawSummary[1]) / 1e6,
    availableLiquidityUsdc: Number(rawSummary[2]) / 1e6,
    lpShares: Number(rawSummary[3]) / 1e6,
    premiumsCollectedUsdc: Number(rawSummary[4]) / 1e6,
    payoutsSettledUsdc: Number(rawSummary[5]) / 1e6,
    notionalVolumeUsdc: Number(rawSummary[6]) / 1e6,
    totalOptionsCount: Number(rawSummary[7]),
    cpiSettlementsCount: Number(rawSummary[8]),
    btcPriceUsd: Number(rawSummary[9]) / 1e8,
    solPriceUsd: Number(rawSummary[10]) / 1e8,
    vaultPda: rawSummary[11],
    vaultPdaBase58: bytes32ToPubkey(rawSummary[11]),
  };

  const options: OnChainOptionPosition[] = rawOptions.map((o: any) => ({
    id: Number(o.id),
    holder: o.holder,
    lane: Number(o.lane) === 1 ? "SOLANA" : "EVM",
    asset: Number(o.asset) === 1 ? "SOL" : "BTC",
    optionType: Number(o.optionType) === 1 ? "PUT" : "CALL",
    status:
      Number(o.status) === 1
        ? "EXERCISED"
        : Number(o.status) === 2
        ? "EXPIRED"
        : Number(o.status) === 3
        ? "CANCELLED"
        : "OPEN",
    isZeroDte: Boolean(o.isZeroDte),
    contractsCount: Number(o.contractsCount) / 1e4,
    rawContractsCount: o.contractsCount.toString(),
    strikePriceUsd: Number(o.strikePrice) / 1e8,
    entrySpotPriceUsd: Number(o.entrySpotPrice) / 1e8,
    settlementPriceUsd: Number(o.settlementPrice) / 1e8,
    premiumPaidUsdc: Number(o.premiumPaidUsdc) / 1e6,
    collateralLockedUsdc: Number(o.collateralLockedUsdc) / 1e6,
    payoutUsdc: Number(o.payoutUsdc) / 1e6,
    openedAt: Number(o.openedAt),
    expiresAt: Number(o.expiresAt),
    settledAt: Number(o.settledAt),
    userSolanaPda: o.userSolanaPda,
    userSolanaPdaBase58: bytes32ToPubkey(o.userSolanaPda),
    settlementCpiProgram: o.settlementCpiProgram,
    settlementCpiProgramBase58: bytes32ToPubkey(o.settlementCpiProgram),
  }));

  const underwriters: OnChainUnderwriter[] = rawUnderwriters.map((u: any) => ({
    provider: u.provider,
    lane: Number(u.lane) === 1 ? "SOLANA" : "EVM",
    userSolanaPda: u.userSolanaPda,
    userSolanaPdaBase58: bytes32ToPubkey(u.userSolanaPda),
    shares: Number(u.shares) / 1e6,
    usdcDeposited: Number(u.usdcDeposited) / 1e6,
    usdcWithdrawn: Number(u.usdcWithdrawn) / 1e6,
    lastUpdatedAt: Number(u.lastUpdatedAt),
  }));

  const settlements: OnChainSettlement[] = rawSettlements.map((s: any) => ({
    settlementId: Number(s.settlementId),
    optionId: Number(s.optionId),
    holder: s.holder,
    executor: s.executor,
    asset: Number(s.asset) === 1 ? "SOL" : "BTC",
    optionType: Number(s.optionType) === 1 ? "PUT" : "CALL",
    strikePriceUsd: Number(s.strikePrice) / 1e8,
    settlementOraclePriceUsd: Number(s.settlementOraclePrice) / 1e8,
    payoutUsdc: Number(s.payoutUsdc) / 1e6,
    cpiProgramId: s.cpiProgramId,
    cpiProgramBase58: bytes32ToPubkey(s.cpiProgramId),
    vaultSignerPda: s.vaultSignerPda,
    vaultSignerPdaBase58: bytes32ToPubkey(s.vaultSignerPda),
    timestamp: Number(s.timestamp),
  }));

  return { summary, options, underwriters, settlements };
}

export async function lookupSolanaSignature(
  evmTxHash: string
): Promise<string | null> {
  try {
    const res = await fetch(HADRIAN_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "rome_solanaTxForEvmTx",
        params: [evmTxHash],
      }),
    });
    const json = await res.json();
    return json?.result?.[0] ?? null;
  } catch {
    return null;
  }
}

export async function sendAugurVaultTx(params: {
  data: Hex;
  useBrowserWallet: boolean;
  browserAddress?: `0x${string}` | null;
}): Promise<{ txHash: Hex; solanaSig: string | null }> {
  if (
    params.useBrowserWallet &&
    typeof window !== "undefined" &&
    (window as any).ethereum &&
    params.browserAddress
  ) {
    const eth = (window as any).ethereum;
    try {
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x30d4a" }],
      });
    } catch (switchErr: any) {
      if (switchErr?.code === 4902) {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: "0x30d4a",
              chainName: "Rome Hadrian Testnet",
              nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
              rpcUrls: [HADRIAN_RPC],
              blockExplorerUrls: [HADRIAN_EXPLORER],
            },
          ],
        });
      }
    }

    const txHash = (await submitRomeTx(eth, {
      from: params.browserAddress,
      to: VAULT_ADDRESS,
      data: params.data,
    })) as Hex;

    await publicClient.waitForTransactionReceipt({ hash: txHash });
    const solanaSig = await lookupSolanaSignature(txHash);
    return { txHash, solanaSig };
  }

  // Sandbox Signer mode on Hadrian Testnet (real on-chain transaction via submitRomeTx!)
  const account = getDemoSignerAccount();
  const wallet = createWalletClient({
    account,
    transport: http(HADRIAN_RPC, { timeout: 60_000 }),
  });

  const sandboxProvider = {
    async request({ method, params: rpcParams = [] }: { method: string; params?: any[] }) {
      if (method === "eth_chainId") return "0x30d4a";
      if (method === "eth_accounts" || method === "eth_requestAccounts") {
        return [account.address];
      }
      if (method === "eth_sendTransaction") {
        const tx = rpcParams[0] || {};
        const gp = await publicClient.getGasPrice();
        const maxFeePerGas = (gp * 115n) / 100n;
        return wallet.sendTransaction({
          account,
          to: tx.to ?? VAULT_ADDRESS,
          data: tx.data ?? "0x",
          value: tx.value ? BigInt(tx.value) : 0n,
          gas: 8_500_000n,
          maxFeePerGas,
          maxPriorityFeePerGas: 0n,
          chain: null,
        });
      }
      const res = await fetch(HADRIAN_RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: rpcParams }),
      }).then((r) => r.json());
      if (res.error) throw new Error(res.error.message || "RPC error");
      return res.result;
    },
  };

  const txHash = (await submitRomeTx(sandboxProvider as any, {
    from: account.address,
    to: VAULT_ADDRESS,
    data: params.data,
  })) as Hex;

  await publicClient.waitForTransactionReceipt({ hash: txHash });
  const solanaSig = await lookupSolanaSignature(txHash);
  return { txHash, solanaSig };
}

export {
  ROME_OPTIONS_VAULT_ABI,
  pubkeyToBytes32,
  bytes32ToPubkey,
  deriveSyntheticEvmAddress,
  encodeFunctionData,
};
