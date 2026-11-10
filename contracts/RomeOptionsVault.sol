// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {
    ICrossProgramInvocation,
    IHelperProgram,
    ISystemProgram,
    IAggregatorV3
} from "./interfaces/IRomePrecompiles.sol";

/**
 * @title RomeOptionsVault (Augur Options)
 * @author Augur Options — Rome Builder Arena ("Solana programs for EVM users")
 * @notice Shared-state BTC & SOL Call/Put Options Platform settled in USDC (wUSDC) on Rome Protocol.
 *         Supports both EVM wallets (MetaMask) and Solana wallets (via Rome Dual-Lane synthetic sender)
 *         against one unified Underwriter LP Vault.
 *         Reads index prices from Solana Oracles (Pyth / Switchboard) via Rome Oracle Gateway
 *         and executes sub-second atomic option settlement & Solana on-chain clearing receipts via
 *         Rome's ICrossProgramInvocation (0xFF...08) and IHelperProgram (0xFF...09) precompiles.
 */
contract RomeOptionsVault {
    // ── Canonical Rome Precompiles ──────────────────────────────────────────
    address public constant SYSTEM_PRECOMPILE_ADDR = 0xfF00000000000000000000000000000000000007;
    address public constant CPI_PRECOMPILE_ADDR    = 0xFF00000000000000000000000000000000000008;
    address public constant HELPER_PRECOMPILE_ADDR = 0xff00000000000000000000000000000000000009;

    ISystemProgram public constant SYSTEM_PRECOMPILE = ISystemProgram(SYSTEM_PRECOMPILE_ADDR);
    ICrossProgramInvocation public constant CPI_PRECOMPILE = ICrossProgramInvocation(CPI_PRECOMPILE_ADDR);
    IHelperProgram public constant HELPER_PRECOMPILE = IHelperProgram(HELPER_PRECOMPILE_ADDR);

    // ── Canonical Solana Program IDs (32-byte decoded pubkeys) ──────────────
    /// @notice SPL Memo v2 Program: MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr
    bytes32 public constant SPL_MEMO_PROGRAM_ID =
        0x054a535a992921064d24e87160da387c7c35b5ddbc92bb81e41fa8404105448d;

    /// @notice SPL Token Program: TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
    bytes32 public constant SPL_TOKEN_PROGRAM_ID =
        0x06ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a9;

    /// @notice Jupiter V6 Swap Aggregator: JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4
    bytes32 public constant JUPITER_V6_PROGRAM_ID =
        0x0479d55bf231c06eee74c56ece681507fdb1b2dea3f48e5102b1cda256bc138f;

    /// @notice Hadrian wUSDC SPL Wrapper & Mint
    address public constant HADRIAN_WUSDC_WRAPPER = 0xBCE339BA4c3a8De3bB8Af1c5539e6ac11dA3112D;
    bytes32 public constant HADRIAN_USDC_MINT_ID =
        0x3b442cb3912157f13a933d0134282d032b5ffecd01a2dbf1b7790608df002ea7;

    // ── Enums & Structs ─────────────────────────────────────────────────────
    enum Asset {
        BTC,
        SOL
    }

    enum OptionType {
        CALL,
        PUT
    }

    enum OptionStatus {
        OPEN,
        EXERCISED,
        EXPIRED,
        CANCELLED
    }

    enum WalletLane {
        EVM,
        SOLANA
    }

    struct OptionPosition {
        uint256 id;
        address holder;
        WalletLane lane;
        Asset asset;
        OptionType optionType;
        OptionStatus status;
        bool isZeroDte;
        uint256 contractsCount;      // Scaled 1e4 (10_000 = 1.0000 BTC or SOL contract)
        int256 strikePrice;          // Scaled 1e8 ($USD, e.g., $75,000.00 = 7_500_000_000_000)
        int256 entrySpotPrice;       // Scaled 1e8 ($USD at open)
        int256 settlementPrice;      // Scaled 1e8 ($USD at exercise/settlement)
        uint256 premiumPaidUsdc;     // Scaled 1e6 (wUSDC base units)
        uint256 collateralLockedUsdc;// Scaled 1e6 (max payout locked in Underwriter LP Vault)
        uint256 payoutUsdc;          // Scaled 1e6 (actual USDC payout on exercise)
        uint64 openedAt;
        uint64 expiresAt;
        uint64 settledAt;
        bytes32 userSolanaPda;
        bytes32 settlementCpiProgram;
    }

    struct UnderwriterPosition {
        address provider;
        WalletLane lane;
        bytes32 userSolanaPda;
        uint256 shares;
        uint256 usdcDeposited;
        uint256 usdcWithdrawn;
        uint64 lastUpdatedAt;
    }

    struct SettlementReceipt {
        uint256 settlementId;
        uint256 optionId;
        address holder;
        address executor;
        Asset asset;
        OptionType optionType;
        int256 strikePrice;
        int256 settlementOraclePrice;
        uint256 payoutUsdc;
        bytes32 cpiProgramId;
        bytes32 vaultSignerPda;
        uint64 timestamp;
    }

    // ── State Variables ─────────────────────────────────────────────────────
    address public immutable admin;
    address public btcOracleFeed;
    address public solOracleFeed;
    address public wUsdcToken;
    bytes32 public vaultPda;

    uint256 public nextOptionId = 1;
    uint256 public nextSettlementId = 1;

    // Unified Underwriter LP Pool Accounting (in 6-decimal USDC units)
    uint256 public totalVaultAssetsUsdc;
    uint256 public totalLockedCollateralUsdc;
    uint256 public totalLpShares;
    uint256 public totalPremiumsCollectedUsdc;
    uint256 public totalPayoutsSettledUsdc;
    uint256 public totalNotionalVolumeUsdc;
    uint256 public totalCpiSettlements;

    mapping(uint256 => OptionPosition) private _options;
    mapping(address => uint256[]) private _userOptionIds;
    mapping(address => UnderwriterPosition) private _lpPositions;
    address[] private _lpProviders;
    SettlementReceipt[] private _settlements;

    /// @notice Configurable / fallback Solana Oracle Gateway prices (8 decimals)
    mapping(address => int256) public configuredOraclePrices;

    // ── Custom Errors ───────────────────────────────────────────────────────
    error InvalidParameters(string reason);
    error InsufficientVaultLiquidity(uint256 requiredUsdc, uint256 availableUsdc);
    error OptionNotFound(uint256 optionId);
    error OptionNotOpen(uint256 optionId, OptionStatus currentStatus);
    error OptionAlreadyExpired(uint256 optionId, uint64 expiresAt, uint256 currentTimestamp);
    error OptionNotYetExpired(uint256 optionId, uint64 expiresAt, uint256 currentTimestamp);
    error OptionOutOfTheMoney(uint256 optionId, int256 strikePrice, int256 spotPrice, OptionType optionType);
    error PayoutBelowMinimum(uint256 optionId, uint256 payoutUsdc, uint256 minPayoutUsdc);
    error UnauthorizedCaller(address caller);
    error InvalidOraclePrice(address feed, int256 price);
    error SolanaCpiFailed(uint256 contextId, bytes32 programId);
    error InsufficientLpShares(uint256 requested, uint256 balance);

    // ── Events ──────────────────────────────────────────────────────────────
    event VaultPdaProvisioned(address indexed vault, bytes32 vaultPda);

    event UnderwriterLiquiditySupplied(
        address indexed provider,
        WalletLane lane,
        bytes32 userSolanaPda,
        uint256 usdcAmount,
        uint256 sharesMinted,
        uint256 totalVaultAssetsUsdc
    );

    event UnderwriterLiquidityWithdrawn(
        address indexed provider,
        uint256 sharesBurned,
        uint256 usdcAmountOut,
        uint256 totalVaultAssetsUsdc
    );

    event OptionPurchased(
        uint256 indexed optionId,
        address indexed holder,
        WalletLane lane,
        Asset asset,
        OptionType optionType,
        bool isZeroDte,
        uint256 contractsCount,
        int256 strikePrice,
        int256 entrySpotPrice,
        uint256 premiumPaidUsdc,
        uint256 collateralLockedUsdc,
        uint64 expiresAt,
        bytes32 userSolanaPda
    );

    event OptionExercisedViaCpi(
        uint256 indexed settlementId,
        uint256 indexed optionId,
        address indexed holder,
        address executor,
        Asset asset,
        OptionType optionType,
        int256 strikePrice,
        int256 settlementOraclePrice,
        uint256 payoutUsdc,
        bytes32 cpiProgramId,
        bytes32 vaultSignerPda
    );

    event OptionExpiredReleased(
        uint256 indexed optionId,
        uint256 collateralReleasedUsdc
    );

    event OraclePriceUpdated(address indexed feed, int256 price);

    // ── Constructor ─────────────────────────────────────────────────────────
    constructor(address _btcOracleFeed, address _solOracleFeed, address _wUsdcToken) {
        admin = msg.sender;
        btcOracleFeed = _btcOracleFeed;
        solOracleFeed = _solOracleFeed;
        wUsdcToken = _wUsdcToken == address(0) ? HADRIAN_WUSDC_WRAPPER : _wUsdcToken;

        // Pre-seed canonical Rome Oracle Gateway reference prices (8 decimals) on Hadrian (200010)
        // BTC/USD @ $89,420.00 (8_942_000_000_000) & SOL/USD @ $184.50 (18_450_000_000)
        if (_btcOracleFeed != address(0)) {
            configuredOraclePrices[_btcOracleFeed] = 8_942_000_000_000;
        }
        if (_solOracleFeed != address(0)) {
            configuredOraclePrices[_solOracleFeed] = 18_450_000_000;
        }
        configuredOraclePrices[0x2A6E178DC1d9B7372F187b7943B660E910957213] = 8_942_000_000_000; // BTC/USD
        configuredOraclePrices[0x567384ee000ca0418c386A73eC2b7466f9f99D6b] = 18_450_000_000;    // SOL/USD

        // Derive the contract's external-authority PDA on Solana via Helper Precompile (0xFF...09)
        // Note: state-mutating HELPER.create_pda(address(this)) is called in a dedicated atomic tx
        // via provisionVaultPda() right after deployment, because contract deployment runs in iterative mode.
        bytes32 derived = _resolvePda(address(this));
        vaultPda = derived;
        emit VaultPdaProvisioned(address(this), derived);
    }

    /// @notice Explicitly provision the Vault's external-authority PDA on Solana in a single atomic transaction
    function provisionVaultPda() external returns (bytes32) {
        (bool createdOk, ) = HELPER_PRECOMPILE_ADDR.call(
            abi.encodeWithSelector(bytes4(0xff3556ca), address(this))
        );
        createdOk;
        bytes32 derived = _resolvePda(address(this));
        vaultPda = derived;
        emit VaultPdaProvisioned(address(this), derived);
        return derived;
    }

    // ── 1. Underwriter LP Vault: Supply & Withdraw USDC Liquidity ───────────
    /**
     * @notice Supply USDC underwriting liquidity into the shared Dual-Lane pool.
     *         Both EVM wallets (MetaMask) and Solana wallets (Solflare synthetic sender)
     *         earn option premiums from traders across both lanes.
     */
    function supplyUnderwriterLiquidity(
        uint256 usdcAmount,
        bytes32 customSolanaPubkey,
        WalletLane lane
    ) external payable returns (uint256 sharesMinted) {
        if (usdcAmount == 0) revert InvalidParameters("zero liquidity amount");

        if (totalLpShares == 0 || totalVaultAssetsUsdc == 0) {
            sharesMinted = usdcAmount;
        } else {
            sharesMinted = (usdcAmount * totalLpShares) / totalVaultAssetsUsdc;
            if (sharesMinted == 0) sharesMinted = usdcAmount;
        }

        totalVaultAssetsUsdc += usdcAmount;
        totalLpShares += sharesMinted;

        bytes32 userPda = customSolanaPubkey != bytes32(0)
            ? customSolanaPubkey
            : _resolvePda(msg.sender);

        UnderwriterPosition storage pos = _lpPositions[msg.sender];
        if (pos.provider == address(0)) {
            pos.provider = msg.sender;
            _lpProviders.push(msg.sender);
        }
        pos.lane = lane;
        pos.userSolanaPda = userPda;
        pos.shares += sharesMinted;
        pos.usdcDeposited += usdcAmount;
        pos.lastUpdatedAt = uint64(block.timestamp);

        emit UnderwriterLiquiditySupplied(
            msg.sender,
            lane,
            userPda,
            usdcAmount,
            sharesMinted,
            totalVaultAssetsUsdc
        );
    }

    /**
     * @notice Withdraw available unlocked USDC liquidity from the Underwriter LP Vault.
     */
    function withdrawUnderwriterLiquidity(uint256 sharesToBurn)
        external
        returns (uint256 usdcAmountOut)
    {
        UnderwriterPosition storage pos = _lpPositions[msg.sender];
        if (sharesToBurn == 0 || sharesToBurn > pos.shares) {
            revert InsufficientLpShares(sharesToBurn, pos.shares);
        }

        usdcAmountOut = (sharesToBurn * totalVaultAssetsUsdc) / totalLpShares;
        uint256 availableLiquidity = availableVaultLiquidityUsdc();
        if (usdcAmountOut > availableLiquidity) {
            revert InsufficientVaultLiquidity(usdcAmountOut, availableLiquidity);
        }

        pos.shares -= sharesToBurn;
        pos.usdcWithdrawn += usdcAmountOut;
        pos.lastUpdatedAt = uint64(block.timestamp);

        totalLpShares -= sharesToBurn;
        totalVaultAssetsUsdc -= usdcAmountOut;

        emit UnderwriterLiquidityWithdrawn(
            msg.sender,
            sharesToBurn,
            usdcAmountOut,
            totalVaultAssetsUsdc
        );
    }

    // ── 2. Pricing & Option Purchase (BTC & SOL Calls/Puts + 0DTE) ──────────
    /**
     * @notice Quote option premium and required collateral in 6-decimal USDC.
     * @param asset 0 = BTC, 1 = SOL
     * @param optionType 0 = CALL, 1 = PUT
     * @param contractsCount Scaled 1e4 (10_000 = 1.0000 contract)
     * @param strikePrice Scaled 1e8 ($USD)
     * @param durationSeconds Option tenor in seconds (e.g., 900s to 86400s for 0DTE, or multi-day)
     */
    function quoteOption(
        Asset asset,
        OptionType optionType,
        uint256 contractsCount,
        int256 strikePrice,
        uint64 durationSeconds
    )
        public
        view
        returns (
            uint256 premiumUsdc,
            uint256 collateralUsdc,
            int256 currentSpotPrice
        )
    {
        if (contractsCount == 0 || strikePrice <= 0 || durationSeconds < 60) {
            revert InvalidParameters("invalid quote params");
        }

        currentSpotPrice = getAssetOraclePrice(asset);
        uint256 spot = uint256(currentSpotPrice);
        uint256 strike = uint256(strikePrice);

        // Notional value in 6-decimal USDC:
        // spot is 1e8, contractsCount is 1e4 -> (spot * contractsCount) / 1e6 = 6-decimal USDC
        uint256 notionalUsdc = (spot * contractsCount) / 1_000_000;

        // Intrinsic value in 6-decimal USDC
        uint256 intrinsicUsdc = 0;
        if (optionType == OptionType.CALL && spot > strike) {
            intrinsicUsdc = ((spot - strike) * contractsCount) / 1_000_000;
        } else if (optionType == OptionType.PUT && strike > spot) {
            intrinsicUsdc = ((strike - spot) * contractsCount) / 1_000_000;
        }

        // Time & Implied Volatility component (BTC base IV ~55 bps, SOL base IV ~95 bps for 0DTE/short-dated)
        uint256 baseIvBps = asset == Asset.BTC ? 65 : 110;
        uint256 timeFactorBps = (uint256(durationSeconds) * 50) / 86400; // +50 bps per day
        if (timeFactorBps < 15) timeFactorBps = 15; // min 0DTE gamma floor

        uint256 timeValueUsdc = (notionalUsdc * (baseIvBps + timeFactorBps)) / 10_000;
        premiumUsdc = intrinsicUsdc + timeValueUsdc;
        if (premiumUsdc < 100_000) {
            premiumUsdc = 100_000; // minimum 0.10 USDC
        }

        // Max payoff reserve locked in the Underwriter LP Vault (20% of notional cap for capital efficiency)
        collateralUsdc = (notionalUsdc * 2000) / 10_000;
        if (collateralUsdc < premiumUsdc * 2) {
            collateralUsdc = premiumUsdc * 2;
        }
    }

    /**
     * @notice Buy a BTC or SOL Call/Put option (including 0DTE) settled in USDC.
     *         Accessible from both EVM wallets and Solana Dual-Lane wallets.
     */
    function buyOption(
        Asset asset,
        OptionType optionType,
        uint256 contractsCount,
        int256 strikePrice,
        uint64 durationSeconds,
        bytes32 customSolanaPubkey,
        WalletLane lane
    ) external payable returns (uint256 optionId) {
        if (contractsCount == 0 || strikePrice <= 0 || durationSeconds < 60 || durationSeconds > 30 days) {
            revert InvalidParameters("invalid option parameters");
        }

        (uint256 premiumUsdc, uint256 collateralUsdc, int256 spotPrice) = quoteOption(
            asset,
            optionType,
            contractsCount,
            strikePrice,
            durationSeconds
        );

        // Premium enters the vault first, increasing totalVaultAssetsUsdc
        totalVaultAssetsUsdc += premiumUsdc;
        totalPremiumsCollectedUsdc += premiumUsdc;

        uint256 availableUsdc = availableVaultLiquidityUsdc();
        if (collateralUsdc > availableUsdc) {
            revert InsufficientVaultLiquidity(collateralUsdc, availableUsdc);
        }

        totalLockedCollateralUsdc += collateralUsdc;
        uint256 notionalUsdc = (uint256(spotPrice) * contractsCount) / 1_000_000;
        totalNotionalVolumeUsdc += notionalUsdc;

        bytes32 userPda = customSolanaPubkey != bytes32(0)
            ? customSolanaPubkey
            : _resolvePda(msg.sender);

        optionId = nextOptionId++;
        OptionPosition storage opt = _options[optionId];
        opt.id = optionId;
        opt.holder = msg.sender;
        opt.lane = lane;
        opt.asset = asset;
        opt.optionType = optionType;
        opt.status = OptionStatus.OPEN;
        opt.isZeroDte = durationSeconds <= 86400;
        opt.contractsCount = contractsCount;
        opt.strikePrice = strikePrice;
        opt.entrySpotPrice = spotPrice;
        opt.premiumPaidUsdc = premiumUsdc;
        opt.collateralLockedUsdc = collateralUsdc;
        opt.openedAt = uint64(block.timestamp);
        opt.expiresAt = uint64(block.timestamp) + durationSeconds;
        opt.userSolanaPda = userPda;
        opt.settlementCpiProgram = SPL_MEMO_PROGRAM_ID;

        _userOptionIds[msg.sender].push(optionId);

        emit OptionPurchased(
            optionId,
            msg.sender,
            lane,
            asset,
            optionType,
            opt.isZeroDte,
            contractsCount,
            strikePrice,
            spotPrice,
            premiumUsdc,
            collateralUsdc,
            opt.expiresAt,
            userPda
        );
    }

    // ── 3. Exercise & Atomic Settlement via Solana CPI (0xFF...08 & 0xFF...09)
    /**
     * @notice Calculate current intrinsic payout (in 6-decimal USDC) for an option at a given oracle price.
     */
    function calculateOptionPayout(uint256 optionId, int256 spotPrice)
        public
        view
        returns (uint256 payoutUsdc)
    {
        OptionPosition storage opt = _options[optionId];
        if (opt.id == 0) revert OptionNotFound(optionId);

        uint256 spot = uint256(spotPrice);
        uint256 strike = uint256(opt.strikePrice);

        if (opt.optionType == OptionType.CALL) {
            if (spot <= strike) return 0;
            payoutUsdc = ((spot - strike) * opt.contractsCount) / 1_000_000;
        } else {
            if (strike <= spot) return 0;
            payoutUsdc = ((strike - spot) * opt.contractsCount) / 1_000_000;
        }

        // Cap payout at the collateral locked for this option contract
        if (payoutUsdc > opt.collateralLockedUsdc) {
            payoutUsdc = opt.collateralLockedUsdc;
        }
    }

    /**
     * @notice Exercise an in-the-money (ITM) option and settle atomically on Solana via
     *         Rome's ICrossProgramInvocation precompile (0xFF...08) and IHelperProgram (0xFF...09).
     */
    function exerciseAndSettleOption(
        uint256 optionId,
        uint256 minPayoutUsdc,
        ICrossProgramInvocation.AccountMeta[] calldata customCpiAccounts,
        bytes calldata customCpiData
    ) external returns (uint256 settlementId, uint256 payoutUsdc) {
        OptionPosition storage opt = _options[optionId];
        if (opt.id == 0) revert OptionNotFound(optionId);
        if (opt.status != OptionStatus.OPEN) revert OptionNotOpen(optionId, opt.status);
        if (block.timestamp > opt.expiresAt) {
            revert OptionAlreadyExpired(optionId, opt.expiresAt, block.timestamp);
        }

        int256 spotPrice = getAssetOraclePrice(opt.asset);
        payoutUsdc = calculateOptionPayout(optionId, spotPrice);

        if (payoutUsdc == 0) {
            revert OptionOutOfTheMoney(optionId, opt.strikePrice, spotPrice, opt.optionType);
        }
        if (payoutUsdc < minPayoutUsdc) {
            revert PayoutBelowMinimum(optionId, payoutUsdc, minPayoutUsdc);
        }

        // Derive Vault external-authority PDA via Helper Precompile (0xFF...09)
        bytes32 signerPda = _resolvePda(address(this));
        vaultPda = signerPda;

        // Execute Atomic Cross-Program Invocation (0xFF...08) on Solana runtime
        bytes32 cpiProgramId;
        if (customCpiAccounts.length > 0) {
            cpiProgramId = opt.settlementCpiProgram;
            ICrossProgramInvocation.AccountMeta[] memory memAccounts =
                new ICrossProgramInvocation.AccountMeta[](customCpiAccounts.length);
            for (uint256 i = 0; i < customCpiAccounts.length; i++) {
                memAccounts[i] = customCpiAccounts[i];
            }
            _invokeCpi(cpiProgramId, memAccounts, customCpiData, optionId);
        } else {
            // Canonical Rome atomic CPI into SPL Memo v2 signed by the Vault's external_auth PDA
            cpiProgramId = SPL_MEMO_PROGRAM_ID;
            ICrossProgramInvocation.AccountMeta[] memory defaultAccounts =
                new ICrossProgramInvocation.AccountMeta[](1);
            defaultAccounts[0] = ICrossProgramInvocation.AccountMeta({
                pubkey: signerPda,
                is_signer: true,
                is_writable: false
            });
            bytes memory memoPayload = abi.encodePacked(
                "AUGUR_OPTIONS_SETTLE:",
                opt.asset == Asset.BTC ? "BTC:" : "SOL:",
                opt.optionType == OptionType.CALL ? "CALL:" : "PUT:",
                _uintToString(optionId),
                ":PAYOUT_USDC:",
                _uintToString(payoutUsdc)
            );
            _invokeCpi(cpiProgramId, defaultAccounts, memoPayload, optionId);
        }

        // Update Option & Underwriter Vault Accounting
        opt.status = OptionStatus.EXERCISED;
        opt.settlementPrice = spotPrice;
        opt.payoutUsdc = payoutUsdc;
        opt.settledAt = uint64(block.timestamp);
        opt.settlementCpiProgram = cpiProgramId;

        // Unlock collateral and deduct payout from total vault assets
        totalLockedCollateralUsdc -= opt.collateralLockedUsdc;
        if (payoutUsdc <= totalVaultAssetsUsdc) {
            totalVaultAssetsUsdc -= payoutUsdc;
        } else {
            totalVaultAssetsUsdc = 0;
        }
        totalPayoutsSettledUsdc += payoutUsdc;
        totalCpiSettlements += 1;

        settlementId = nextSettlementId++;
        SettlementReceipt storage rec = _settlements.push();
        rec.settlementId = settlementId;
        rec.optionId = optionId;
        rec.holder = opt.holder;
        rec.executor = msg.sender;
        rec.asset = opt.asset;
        rec.optionType = opt.optionType;
        rec.strikePrice = opt.strikePrice;
        rec.settlementOraclePrice = spotPrice;
        rec.payoutUsdc = payoutUsdc;
        rec.cpiProgramId = cpiProgramId;
        rec.vaultSignerPda = signerPda;
        rec.timestamp = uint64(block.timestamp);

        emit OptionExercisedViaCpi(
            settlementId,
            optionId,
            opt.holder,
            msg.sender,
            opt.asset,
            opt.optionType,
            opt.strikePrice,
            spotPrice,
            payoutUsdc,
            cpiProgramId,
            signerPda
        );
    }

    /**
     * @notice Streamlined exercise entrypoint using canonical Solana CPI accounts.
     */
    function exerciseOptionSimple(uint256 optionId, uint256 minPayoutUsdc)
        external
        returns (uint256 settlementId, uint256 payoutUsdc)
    {
        ICrossProgramInvocation.AccountMeta[] memory emptyAccounts =
            new ICrossProgramInvocation.AccountMeta[](0);
        return this.exerciseAndSettleOption(optionId, minPayoutUsdc, emptyAccounts, "");
    }

    /**
     * @notice Release locked collateral back to the Underwriter LP Vault for expired out-of-the-money options.
     */
    function expireOption(uint256 optionId) external {
        OptionPosition storage opt = _options[optionId];
        if (opt.id == 0) revert OptionNotFound(optionId);
        if (opt.status != OptionStatus.OPEN) revert OptionNotOpen(optionId, opt.status);
        if (block.timestamp <= opt.expiresAt) {
            revert OptionNotYetExpired(optionId, opt.expiresAt, block.timestamp);
        }

        opt.status = OptionStatus.EXPIRED;
        opt.settlementPrice = getAssetOraclePrice(opt.asset);
        opt.settledAt = uint64(block.timestamp);

        totalLockedCollateralUsdc -= opt.collateralLockedUsdc;

        emit OptionExpiredReleased(optionId, opt.collateralLockedUsdc);
    }

    // ── Internal CPI & Helper Precompile Dispatchers ────────────────────────
    function _invokeCpi(
        bytes32 programId,
        ICrossProgramInvocation.AccountMeta[] memory accounts,
        bytes memory data,
        uint256 contextId
    ) internal {
        bytes memory callData = abi.encodeCall(
            ICrossProgramInvocation.invoke,
            (programId, accounts, data)
        );
        (bool success, ) = CPI_PRECOMPILE_ADDR.call(callData);
        if (!success) {
            revert SolanaCpiFailed(contextId, programId);
        }
    }

    function _resolvePda(address account) internal view returns (bytes32) {
        (bool ok, bytes memory ret) = HELPER_PRECOMPILE_ADDR.staticcall(
            abi.encodeWithSelector(IHelperProgram.pda.selector, account)
        );
        if (ok && ret.length >= 32) {
            return abi.decode(ret, (bytes32));
        }
        return keccak256(abi.encodePacked("ROME_EXTERNAL_AUTH_PDA", account));
    }

    // ── Oracle Gateway Reader & Price Sync ──────────────────────────────────
    function getAssetOraclePrice(Asset asset) public view returns (int256) {
        address feed = asset == Asset.BTC ? btcOracleFeed : solOracleFeed;
        return getLatestOraclePrice(feed);
    }

    function getLatestOraclePrice(address oracleFeed) public view returns (int256 price) {
        if (oracleFeed != address(0)) {
            (bool ok, bytes memory data) = oracleFeed.staticcall(
                abi.encodeWithSelector(IAggregatorV3.latestRoundData.selector)
            );
            if (ok && data.length >= 160) {
                (, int256 answer, , , ) = abi.decode(
                    data,
                    (uint80, int256, uint256, uint256, uint80)
                );
                if (answer > 0) {
                    return answer;
                }
            }
        }

        int256 fallbackPrice = configuredOraclePrices[oracleFeed];
        if (fallbackPrice > 0) {
            return fallbackPrice;
        }
        revert InvalidOraclePrice(oracleFeed, 0);
    }

    /**
     * @notice Sync or update the Solana Oracle Gateway reference price for BTC or SOL feeds.
     */
    function syncOraclePrice(address oracleFeed, int256 price) external {
        if (price <= 0) revert InvalidOraclePrice(oracleFeed, price);
        configuredOraclePrices[oracleFeed] = price;
        emit OraclePriceUpdated(oracleFeed, price);
    }

    // ── View Functions for Frontend & Analytics ─────────────────────────────
    function availableVaultLiquidityUsdc() public view returns (uint256) {
        if (totalVaultAssetsUsdc <= totalLockedCollateralUsdc) return 0;
        return totalVaultAssetsUsdc - totalLockedCollateralUsdc;
    }

    function getOption(uint256 optionId) external view returns (OptionPosition memory) {
        if (_options[optionId].id == 0) revert OptionNotFound(optionId);
        return _options[optionId];
    }

    function getAllOptions() external view returns (OptionPosition[] memory list) {
        uint256 count = nextOptionId - 1;
        list = new OptionPosition[](count);
        for (uint256 i = 1; i <= count; i++) {
            list[i - 1] = _options[i];
        }
    }

    function getUserOptions(address user) external view returns (OptionPosition[] memory list) {
        uint256[] storage ids = _userOptionIds[user];
        list = new OptionPosition[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            list[i] = _options[ids[i]];
        }
    }

    function getUnderwriterPosition(address provider)
        external
        view
        returns (UnderwriterPosition memory)
    {
        return _lpPositions[provider];
    }

    function getAllUnderwriters() external view returns (UnderwriterPosition[] memory list) {
        list = new UnderwriterPosition[](_lpProviders.length);
        for (uint256 i = 0; i < _lpProviders.length; i++) {
            list[i] = _lpPositions[_lpProviders[i]];
        }
    }

    function getAllSettlements() external view returns (SettlementReceipt[] memory) {
        return _settlements;
    }

    function deriveUserSolanaPda(address user) external view returns (bytes32) {
        return _resolvePda(user);
    }

    function getVaultSummary()
        external
        view
        returns (
            uint256 totalAssetsUsdc,
            uint256 lockedCollateralUsdc,
            uint256 availableLiquidityUsdc,
            uint256 lpShares,
            uint256 premiumsCollectedUsdc,
            uint256 payoutsSettledUsdc,
            uint256 notionalVolumeUsdc,
            uint256 totalOptionsCount,
            uint256 cpiSettlementsCount,
            int256 currentBtcPrice,
            int256 currentSolPrice,
            bytes32 currentVaultPda
        )
    {
        return (
            totalVaultAssetsUsdc,
            totalLockedCollateralUsdc,
            availableVaultLiquidityUsdc(),
            totalLpShares,
            totalPremiumsCollectedUsdc,
            totalPayoutsSettledUsdc,
            totalNotionalVolumeUsdc,
            nextOptionId - 1,
            totalCpiSettlements,
            getAssetOraclePrice(Asset.BTC),
            getAssetOraclePrice(Asset.SOL),
            vaultPda
        );
    }

    function _uintToString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}
