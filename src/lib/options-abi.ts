import { keccak256 } from "viem";
import { PublicKey } from "@solana/web3.js";

export const ROME_OPTIONS_VAULT_ABI = [
  {
    inputs: [
      { internalType: "address", name: "_btcOracleFeed", type: "address" },
      { internalType: "address", name: "_solOracleFeed", type: "address" },
      { internalType: "address", name: "_wUsdcToken", type: "address" },
    ],
    stateMutability: "nonpayable",
    type: "constructor",
  },
  {
    inputs: [],
    name: "provisionVaultPda",
    outputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "usdcAmount", type: "uint256" },
      { internalType: "bytes32", name: "customSolanaPubkey", type: "bytes32" },
      { internalType: "uint8", name: "lane", type: "uint8" },
    ],
    name: "supplyUnderwriterLiquidity",
    outputs: [{ internalType: "uint256", name: "sharesMinted", type: "uint256" }],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "sharesToBurn", type: "uint256" }],
    name: "withdrawUnderwriterLiquidity",
    outputs: [{ internalType: "uint256", name: "usdcAmountOut", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint8", name: "asset", type: "uint8" },
      { internalType: "uint8", name: "optionType", type: "uint8" },
      { internalType: "uint256", name: "contractsCount", type: "uint256" },
      { internalType: "int256", name: "strikePrice", type: "int256" },
      { internalType: "uint64", name: "durationSeconds", type: "uint64" },
    ],
    name: "quoteOption",
    outputs: [
      { internalType: "uint256", name: "premiumUsdc", type: "uint256" },
      { internalType: "uint256", name: "collateralUsdc", type: "uint256" },
      { internalType: "int256", name: "currentSpotPrice", type: "int256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint8", name: "asset", type: "uint8" },
      { internalType: "uint8", name: "optionType", type: "uint8" },
      { internalType: "uint256", name: "contractsCount", type: "uint256" },
      { internalType: "int256", name: "strikePrice", type: "int256" },
      { internalType: "uint64", name: "durationSeconds", type: "uint64" },
      { internalType: "bytes32", name: "customSolanaPubkey", type: "bytes32" },
      { internalType: "uint8", name: "lane", type: "uint8" },
    ],
    name: "buyOption",
    outputs: [{ internalType: "uint256", name: "optionId", type: "uint256" }],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "optionId", type: "uint256" },
      { internalType: "uint256", name: "minPayoutUsdc", type: "uint256" },
      {
        components: [
          { internalType: "bytes32", name: "pubkey", type: "bytes32" },
          { internalType: "bool", name: "is_signer", type: "bool" },
          { internalType: "bool", name: "is_writable", type: "bool" },
        ],
        internalType: "struct ICrossProgramInvocation.AccountMeta[]",
        name: "customCpiAccounts",
        type: "tuple[]",
      },
      { internalType: "bytes", name: "customCpiData", type: "bytes" },
    ],
    name: "exerciseAndSettleOption",
    outputs: [
      { internalType: "uint256", name: "settlementId", type: "uint256" },
      { internalType: "uint256", name: "payoutUsdc", type: "uint256" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "oracleFeed", type: "address" },
      { internalType: "int256", name: "price", type: "int256" },
    ],
    name: "syncOraclePrice",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "getVaultSummary",
    outputs: [
      { internalType: "uint256", name: "totalAssetsUsdc", type: "uint256" },
      { internalType: "uint256", name: "lockedCollateralUsdc", type: "uint256" },
      { internalType: "uint256", name: "availableLiquidityUsdc", type: "uint256" },
      { internalType: "uint256", name: "lpShares", type: "uint256" },
      { internalType: "uint256", name: "premiumsCollectedUsdc", type: "uint256" },
      { internalType: "uint256", name: "payoutsSettledUsdc", type: "uint256" },
      { internalType: "uint256", name: "notionalVolumeUsdc", type: "uint256" },
      { internalType: "uint256", name: "totalOptionsCount", type: "uint256" },
      { internalType: "uint256", name: "cpiSettlementsCount", type: "uint256" },
      { internalType: "int256", name: "currentBtcPrice", type: "int256" },
      { internalType: "int256", name: "currentSolPrice", type: "int256" },
      { internalType: "bytes32", name: "currentVaultPda", type: "bytes32" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getAllOptions",
    outputs: [
      {
        components: [
          { internalType: "uint256", name: "id", type: "uint256" },
          { internalType: "address", name: "holder", type: "address" },
          { internalType: "uint8", name: "lane", type: "uint8" },
          { internalType: "uint8", name: "asset", type: "uint8" },
          { internalType: "uint8", name: "optionType", type: "uint8" },
          { internalType: "uint8", name: "status", type: "uint8" },
          { internalType: "bool", name: "isZeroDte", type: "bool" },
          { internalType: "uint256", name: "contractsCount", type: "uint256" },
          { internalType: "int256", name: "strikePrice", type: "int256" },
          { internalType: "int256", name: "entrySpotPrice", type: "int256" },
          { internalType: "int256", name: "settlementPrice", type: "int256" },
          { internalType: "uint256", name: "premiumPaidUsdc", type: "uint256" },
          { internalType: "uint256", name: "collateralLockedUsdc", type: "uint256" },
          { internalType: "uint256", name: "payoutUsdc", type: "uint256" },
          { internalType: "uint64", name: "openedAt", type: "uint64" },
          { internalType: "uint64", name: "expiresAt", type: "uint64" },
          { internalType: "uint64", name: "settledAt", type: "uint64" },
          { internalType: "bytes32", name: "userSolanaPda", type: "bytes32" },
          { internalType: "bytes32", name: "settlementCpiProgram", type: "bytes32" },
        ],
        internalType: "struct RomeOptionsVault.OptionPosition[]",
        name: "list",
        type: "tuple[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getAllUnderwriters",
    outputs: [
      {
        components: [
          { internalType: "address", name: "provider", type: "address" },
          { internalType: "uint8", name: "lane", type: "uint8" },
          { internalType: "bytes32", name: "userSolanaPda", type: "bytes32" },
          { internalType: "uint256", name: "shares", type: "uint256" },
          { internalType: "uint256", name: "usdcDeposited", type: "uint256" },
          { internalType: "uint256", name: "usdcWithdrawn", type: "uint256" },
          { internalType: "uint64", name: "lastUpdatedAt", type: "uint64" },
        ],
        internalType: "struct RomeOptionsVault.UnderwriterPosition[]",
        name: "list",
        type: "tuple[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getAllSettlements",
    outputs: [
      {
        components: [
          { internalType: "uint256", name: "settlementId", type: "uint256" },
          { internalType: "uint256", name: "optionId", type: "uint256" },
          { internalType: "address", name: "holder", type: "address" },
          { internalType: "address", name: "executor", type: "address" },
          { internalType: "uint8", name: "asset", type: "uint8" },
          { internalType: "uint8", name: "optionType", type: "uint8" },
          { internalType: "int256", name: "strikePrice", type: "int256" },
          { internalType: "int256", name: "settlementOraclePrice", type: "int256" },
          { internalType: "uint256", name: "payoutUsdc", type: "uint256" },
          { internalType: "bytes32", name: "cpiProgramId", type: "bytes32" },
          { internalType: "bytes32", name: "vaultSignerPda", type: "bytes32" },
          { internalType: "uint64", name: "timestamp", type: "uint64" },
        ],
        internalType: "struct RomeOptionsVault.SettlementReceipt[]",
        name: "list",
        type: "tuple[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

export const AGGREGATOR_V3_ABI = [
  {
    inputs: [],
    name: "decimals",
    outputs: [{ internalType: "uint8", name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "latestRoundData",
    outputs: [
      { internalType: "uint80", name: "roundId", type: "uint80" },
      { internalType: "int256", name: "answer", type: "int256" },
      { internalType: "uint256", name: "startedAt", type: "uint256" },
      { internalType: "uint256", name: "updatedAt", type: "uint256" },
      { internalType: "uint80", name: "answeredInRound", type: "uint80" },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function bytes32ToPubkey(hexVal: string): string {
  try {
    const clean = hexVal.replace(/^0x/, "").padStart(64, "0");
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
    return new PublicKey(bytes).toBase58();
  } catch {
    return hexVal;
  }
}

export function pubkeyToBytes32(base58Str: string): `0x${string}` {
  try {
    const pk = new PublicKey(base58Str);
    const bytes = pk.toBytes();
    let hex = "0x";
    for (const b of bytes) {
      hex += b.toString(16).padStart(2, "0");
    }
    return hex as `0x${string}`;
  } catch {
    const hash = keccak256(
      `0x${Buffer.from(base58Str, "utf8").toString("hex")}`
    );
    return hash;
  }
}

export function deriveSyntheticEvmAddress(solanaBase58: string): `0x${string}` {
  const b32 = pubkeyToBytes32(solanaBase58);
  const digest = keccak256(b32);
  return `0x${digest.slice(-40)}` as `0x${string}`;
}
