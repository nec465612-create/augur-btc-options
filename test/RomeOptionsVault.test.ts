import { describe, it, expect, beforeAll } from "vitest";
import { EVM } from "@ethereumjs/evm";
import { Common, Hardfork } from "@ethereumjs/common";
import { Address, Account, hexToBytes } from "@ethereumjs/util";
import {
  encodeAbiParameters,
  encodeFunctionData,
  decodeFunctionResult,
} from "viem";
import { compileContracts } from "../scripts/compile";

const CPI_ADDR = "0xff00000000000000000000000000000000000008" as const;
const HELPER_ADDR = "0xff00000000000000000000000000000000000009" as const;

const DEPLOYER = "0x91E97c32289af6c135f025Ad9957F8b2830daeA1" as const;
const EVM_TRADER = "0xD56647bBa764c1b673299baaEB356569a37961b8" as const;
const SOLANA_SYNTHETIC_TRADER =
  "0x11b416689687e51fbe35E3CdF32e65F1a656368a" as const;

describe("RomeOptionsVault (Augur Options) — Comprehensive Unit Test Suite", () => {
  let evm: EVM;
  let compiled: ReturnType<typeof compileContracts>;
  let vaultAddress: `0x${string}`;
  let btcOracleAddress: `0x${string}`;
  let solOracleAddress: `0x${string}`;
  let vaultAbi: any[];
  let oracleAbi: any[];
  let cpiAbi: any[];

  async function deploy(
    from: `0x${string}`,
    bytecode: `0x${string}`,
    ctorTypes: any[] = [],
    ctorArgs: any[] = []
  ): Promise<`0x${string}`> {
    const encodedArgs =
      ctorTypes.length > 0
        ? encodeAbiParameters(ctorTypes, ctorArgs).slice(2)
        : "";
    const fullInitCode = `${bytecode}${encodedArgs}` as `0x${string}`;
    const res = await evm.runCall({
      caller: new Address(hexToBytes(from)),
      data: hexToBytes(fullInitCode),
      gasLimit: 25_000_000n,
    });
    if (res.execResult.exceptionError || !res.createdAddress) {
      throw new Error(`Deploy failed: ${res.execResult.exceptionError?.error}`);
    }
    return res.createdAddress.toString() as `0x${string}`;
  }

  async function callContract(
    from: `0x${string}`,
    to: `0x${string}`,
    abi: any[],
    functionName: string,
    args: any[] = []
  ) {
    const data = encodeFunctionData({ abi, functionName, args });
    const res = await evm.runCall({
      caller: new Address(hexToBytes(from)),
      to: new Address(hexToBytes(to)),
      data: hexToBytes(data),
      gasLimit: 15_000_000n,
    });
    if (res.execResult.exceptionError) {
      throw new Error(`REVERT:${res.execResult.exceptionError.error}`);
    }
    if (res.execResult.returnValue.length === 0) return undefined;
    const hexRet = `0x${Buffer.from(res.execResult.returnValue).toString(
      "hex"
    )}` as `0x${string}`;
    return decodeFunctionResult({ abi, functionName, data: hexRet });
  }

  beforeAll(async () => {
    compiled = compileContracts();
    vaultAbi = compiled.RomeOptionsVault.abi;
    oracleAbi = compiled.MockOracleFeed.abi;
    cpiAbi = compiled.MockCpiPrecompile.abi;

    const common = new Common({ chain: "mainnet", hardfork: Hardfork.Cancun });
    evm = await EVM.create({ common });

    // Fund accounts
    for (const addr of [DEPLOYER, EVM_TRADER, SOLANA_SYNTHETIC_TRADER]) {
      const a = new Address(hexToBytes(addr));
      await evm.stateManager.putAccount(
        a,
        new Account(0n, 100_000_000_000_000_000_000n)
      );
    }

    // Install Rome Helper Precompile (0xFF...09) & CPI Precompile (0xFF...08)
    await evm.stateManager.putContractCode(
      new Address(hexToBytes(HELPER_ADDR)),
      hexToBytes(compiled.MockHelperPrecompile.deployedBytecode)
    );
    await evm.stateManager.putContractCode(
      new Address(hexToBytes(CPI_ADDR)),
      hexToBytes(compiled.MockCpiPrecompile.deployedBytecode)
    );

    // Deploy Mock Rome Oracle Gateway Feeds: BTC/USD @ $89,420.00, SOL/USD @ $184.50
    btcOracleAddress = await deploy(
      DEPLOYER,
      compiled.MockOracleFeed.bytecode,
      [{ type: "int256" }],
      [8_942_000_000_000n]
    );
    solOracleAddress = await deploy(
      DEPLOYER,
      compiled.MockOracleFeed.bytecode,
      [{ type: "int256" }],
      [18_450_000_000n]
    );

    // Deploy RomeOptionsVault
    vaultAddress = await deploy(
      DEPLOYER,
      compiled.RomeOptionsVault.bytecode,
      [{ type: "address" }, { type: "address" }, { type: "address" }],
      [
        btcOracleAddress,
        solOracleAddress,
        "0xbce339ba4c3a8de3bb8af1c5539e6ac11da3112d",
      ]
    );
  });

  it("1. Provisions Vault external-authority PDA via Helper Precompile (0xFF...09) and reads BTC & SOL Oracle Feeds", async () => {
    const vaultPda = (await callContract(
      DEPLOYER,
      vaultAddress,
      vaultAbi,
      "vaultPda"
    )) as `0x${string}`;
    expect(vaultPda).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(vaultPda).not.toBe("0x" + "0".repeat(64));

    const btcPrice = await callContract(
      DEPLOYER,
      vaultAddress,
      vaultAbi,
      "getAssetOraclePrice",
      [0] // Asset.BTC
    );
    const solPrice = await callContract(
      DEPLOYER,
      vaultAddress,
      vaultAbi,
      "getAssetOraclePrice",
      [1] // Asset.SOL
    );

    expect(btcPrice).toBe(8_942_000_000_000n);
    expect(solPrice).toBe(18_450_000_000n);
  });

  it("2. Allows Underwriter LP to supply USDC liquidity into the shared Dual-Lane pool", async () => {
    const shares = await callContract(
      DEPLOYER,
      vaultAddress,
      vaultAbi,
      "supplyUnderwriterLiquidity",
      [
        50_000_000_000n, // 50,000 USDC
        "0x" + "0".repeat(64), // auto-derive PDA
        0, // WalletLane.EVM
      ]
    );
    expect(shares).toBe(50_000_000_000n);

    const lpPos: any = await callContract(
      DEPLOYER,
      vaultAddress,
      vaultAbi,
      "getUnderwriterPosition",
      [DEPLOYER]
    );
    expect(lpPos.shares).toBe(50_000_000_000n);
    expect(lpPos.usdcDeposited).toBe(50_000_000_000n);
  });

  it("3. Allows EVM trader to buy a 0DTE BTC CALL Option and locks collateral in the LP Vault", async () => {
    // Buy 0.5000 BTC (5000 in 1e4 scale) Call Option @ Strike $89,000.00 (8_900_000_000_000)
    const optionId = await callContract(
      EVM_TRADER,
      vaultAddress,
      vaultAbi,
      "buyOption",
      [
        0, // Asset.BTC
        0, // OptionType.CALL
        5000n, // 0.5000 BTC
        8_900_000_000_000n, // $89,000 strike (in-the-money at $89,420 spot)
        28800n, // 8 hours (0DTE)
        "0x" + "0".repeat(64),
        0, // WalletLane.EVM
      ]
    );

    expect(optionId).toBe(1n);

    const opt: any = await callContract(
      EVM_TRADER,
      vaultAddress,
      vaultAbi,
      "getOption",
      [1n]
    );
    expect(opt.holder.toLowerCase()).toBe(EVM_TRADER.toLowerCase());
    expect(opt.asset).toBe(0); // BTC
    expect(opt.optionType).toBe(0); // CALL
    expect(opt.isZeroDte).toBe(true);
    expect(opt.status).toBe(0); // OPEN
    expect(opt.premiumPaidUsdc).toBeGreaterThan(210_000_000n); // > $210 intrinsic
  });

  it("4. Allows Solana Dual-Lane trader to buy a SOL PUT Option against the same shared pool", async () => {
    // Buy 20.0000 SOL (200_000 in 1e4 scale) Put Option @ Strike $188.00 (18_800_000_000)
    const optionId = await callContract(
      SOLANA_SYNTHETIC_TRADER,
      vaultAddress,
      vaultAbi,
      "buyOption",
      [
        1, // Asset.SOL
        1, // OptionType.PUT
        200_000n, // 20.0000 SOL
        18_800_000_000n, // $188.00 strike (ITM when SOL is $184.50)
        86400n, // 24 hours (0DTE)
        "0x" + "0".repeat(64),
        1, // WalletLane.SOLANA
      ]
    );

    expect(optionId).toBe(2n);

    const opt: any = await callContract(
      SOLANA_SYNTHETIC_TRADER,
      vaultAddress,
      vaultAbi,
      "getOption",
      [2n]
    );
    expect(opt.holder.toLowerCase()).toBe(SOLANA_SYNTHETIC_TRADER.toLowerCase());
    expect(opt.lane).toBe(1); // SOLANA
    expect(opt.asset).toBe(1); // SOL
    expect(opt.optionType).toBe(1); // PUT
  });

  it("5. Reverts option exercise when option is Out-Of-The-Money (OTM)", async () => {
    // Buy an OTM BTC Call at $95,000 strike while spot is $89,420
    const otmOptionId = await callContract(
      EVM_TRADER,
      vaultAddress,
      vaultAbi,
      "buyOption",
      [
        0, // BTC
        0, // CALL
        1000n, // 0.1 BTC
        9_500_000_000_000n, // $95,000 strike
        3600n,
        "0x" + "0".repeat(64),
        0,
      ]
    );
    expect(otmOptionId).toBe(3n);

    await expect(
      callContract(
        EVM_TRADER,
        vaultAddress,
        vaultAbi,
        "exerciseAndSettleOption",
        [3n, 1_000_000n, [], "0x"]
      )
    ).rejects.toThrow(/REVERT/);
  });

  it("6. Exercises ITM BTC Call Option (#1) and settles atomically on Solana via CPI (0xFF...08)", async () => {
    // Move BTC Oracle Price up to $91,500.00 -> Option #1 ($89,000 Call, 0.5 BTC) has $1,250.00 intrinsic payout
    await callContract(DEPLOYER, btcOracleAddress, oracleAbi, "setPrice", [
      9_150_000_000_000n,
    ]);

    const res = (await callContract(
      EVM_TRADER,
      vaultAddress,
      vaultAbi,
      "exerciseAndSettleOption",
      [1n, 1_000_000_000n, [], "0x"]
    )) as [bigint, bigint];

    expect(res[0]).toBe(1n); // settlementId #1
    expect(res[1]).toBe(1_250_000_000n); // $1,250.00 USDC (1,250 * 1e6)

    const optAfter: any = await callContract(
      EVM_TRADER,
      vaultAddress,
      vaultAbi,
      "getOption",
      [1n]
    );
    expect(optAfter.status).toBe(1); // EXERCISED
    expect(optAfter.payoutUsdc).toBe(1_250_000_000n);
  });

  it("7. Reverts entire settlement atomically if Solana CPI Precompile (0xFF...08) fails", async () => {
    await callContract(DEPLOYER, CPI_ADDR, cpiAbi, "setShouldFail", [true]);

    await expect(
      callContract(
        SOLANA_SYNTHETIC_TRADER,
        vaultAddress,
        vaultAbi,
        "exerciseAndSettleOption",
        [2n, 1_000_000n, [], "0x"]
      )
    ).rejects.toThrow(/REVERT/);

    // Verify Option #2 remained OPEN
    const opt2: any = await callContract(
      SOLANA_SYNTHETIC_TRADER,
      vaultAddress,
      vaultAbi,
      "getOption",
      [2n]
    );
    expect(opt2.status).toBe(0); // OPEN

    await callContract(DEPLOYER, CPI_ADDR, cpiAbi, "setShouldFail", [false]);
  });

  it("8. Exercises Dual-Lane SOL Put Option (#2) via CPI and updates shared Vault accounting", async () => {
    // SOL drops to $178.00 -> Strike $188.00 Put on 20 SOL has ($10 * 20) = $200.00 USDC payout
    await callContract(DEPLOYER, solOracleAddress, oracleAbi, "setPrice", [
      17_800_000_000n,
    ]);

    const res = (await callContract(
      SOLANA_SYNTHETIC_TRADER,
      vaultAddress,
      vaultAbi,
      "exerciseAndSettleOption",
      [2n, 150_000_000n, [], "0x"]
    )) as [bigint, bigint];

    expect(res[0]).toBe(2n); // settlementId #2
    expect(res[1]).toBe(200_000_000n); // $200.00 USDC

    const summary = (await callContract(
      DEPLOYER,
      vaultAddress,
      vaultAbi,
      "getVaultSummary"
    )) as any[];
    expect(summary[7]).toBe(3n); // totalOptionsCount = 3
    expect(summary[8]).toBe(2n); // cpiSettlementsCount = 2
  });

  it("9. Allows Underwriter LP to withdraw unlocked USDC liquidity", async () => {
    const usdcOut = (await callContract(
      DEPLOYER,
      vaultAddress,
      vaultAbi,
      "withdrawUnderwriterLiquidity",
      [5_000_000_000n] // burn 5,000 LP shares
    )) as bigint;

    expect(usdcOut).toBeGreaterThan(4_800_000_000n);
  });
});
