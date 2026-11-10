# Augur Options — Shared-State BTC & SOL Options Platform on Rome Protocol

**Augur Options** is an Oracle-Driven BTC & SOL Options Platform built for the **Rome Builder Arena** (*"Solana programs for EVM users"* track). Both **EVM wallets (MetaMask)** and **Solana wallets (Solflare V1 Dual-Lane)** trade Call and Put options (including short-dated **0DTE** options) or underwrite liquidity in one unified **USDC (`wUSDC`)** vault with sub-second atomic settlement via Rome's `ICrossProgramInvocation` (`0xFF...08`) and `IHelperProgram` (`0xFF...09`) precompiles.

- **Live Production App:** [https://augur-btc-options.vercel.app](https://augur-btc-options.vercel.app)
- **GitHub Repository:** [https://github.com/nec465612-create/augur-btc-options](https://github.com/nec465612-create/augur-btc-options)
- **Deployed Contract (`RomeOptionsVault.sol`) on Hadrian Testnet (`200010`):** [`0x02582c2eaf227e84d6865ac9148e6de6dac4d255`](https://via-hadrian.testnet.romeprotocol.xyz/address/0x02582c2eaf227e84d6865ac9148e6de6dac4d255)
- **Deployment Transaction Hash:** [`0x55f1967f43e26f0b8df512118073e71b69889efa1e1ba911c26c0ac95a877dd5`](https://via-hadrian.testnet.romeprotocol.xyz/tx/0x55f1967f43e26f0b8df512118073e71b69889efa1e1ba911c26c0ac95a877dd5)
- **Atomic Solana CPI Settlement Transaction (`0xFF...08`):** [`0x1795a1b4cec6d021d04beaad9f583634932b6a19cb1845da31bc99295191973e`](https://via-hadrian.testnet.romeprotocol.xyz/tx/0x1795a1b4cec6d021d04beaad9f583634932b6a19cb1845da31bc99295191973e)

---

## Architecture & Rome Protocol Primitives

1. **Solana Oracle Gateway Integration (`@rome-protocol/registry`):**
   - Reads live `BTC/USD` (`0x2A6E178DC1d9B7372F187b7943B660E910957213`) and `SOL/USD` (`0x567384ee000ca0418c386A73eC2b7466f9f99D6b`) price feeds powered by Pyth & Switchboard on Solana.
2. **Atomic Solana CPI Settlement (`0xFF00000000000000000000000000000000000008`):**
   - When an In-The-Money (ITM) option is exercised via `exerciseAndSettleOption`, `RomeOptionsVault.sol` calculates the intrinsic USDC payout, derives its external-authority PDA via `IHelperProgram.pda(address(this))` (`0xFF...09`), and invokes the Solana runtime atomically via `ICrossProgramInvocation.invoke` (`0xFF...08`). If the Solana CPI fails, the entire EVM transaction reverts atomically.
3. **Dual-Lane Shared Liquidity Pool:**
   - EVM wallets (`submitRomeTx`) and Solana wallets (`submitRomeTxV1` synthetic sender) share a single `augUSDC` Underwriter LP Vault and trade against the same options book.

---

## Verified On-Chain Transactions on Rome Hadrian (`200010`)

| # | Action | Wallet Role | EVM Transaction Hash | Solana Settlement Signature |
|---|---|---|---|---|
| 0 | **Deploy `RomeOptionsVault.sol`** | Deployer / LP (`0x91E9...aeA1`) | [`0x55f1967f43e26f0b8df512118073e71b69889efa1e1ba911c26c0ac95a877dd5`](https://via-hadrian.testnet.romeprotocol.xyz/tx/0x55f1967f43e26f0b8df512118073e71b69889efa1e1ba911c26c0ac95a877dd5) | `3VgkFub6utKYrDEk1fq5WQjZSDCK9ZKCPkrcYwxkG1kR...` |
| 1 | **Provision Vault External-Auth PDA (`0xFF...09`)** | Deployer / LP (`0x91E9...aeA1`) | [`0xdd92794b59079cc8daa300edca693ec6a83a304b9a17c3fc946b2ff54fc712fb`](https://via-hadrian.testnet.romeprotocol.xyz/tx/0xdd92794b59079cc8daa300edca693ec6a83a304b9a17c3fc946b2ff54fc712fb) | `42U5N34kTFMaGpABdfLQ6M2ZkPQ1z8RDbFYRwNsGex8q...` |
| 2 | **Supply 50,000 USDC Underwriter Liquidity** | Deployer / LP (`0x91E9...aeA1`) | [`0x7dd18fd30eed26e13d92e6c841edf4d908e9c13bea1d6d9bf57d09bf69c66abe`](https://via-hadrian.testnet.romeprotocol.xyz/tx/0x7dd18fd30eed26e13d92e6c841edf4d908e9c13bea1d6d9bf57d09bf69c66abe) | `2Xkd7VHfModDRkNjB2uCUnpXzkSKd2JYsujWw6FCqWkR...` |
| 3 | **Buy 0DTE BTC CALL Option #1 (0.50 BTC @ $89k)** | Trader 1 (`0xD566...61b8`) | [`0x03fa4c2f8f8b892430efa4404b276ebe85f569516dc579e6362071d3af46fea4`](https://via-hadrian.testnet.romeprotocol.xyz/tx/0x03fa4c2f8f8b892430efa4404b276ebe85f569516dc579e6362071d3af46fea4) | `2XMTW9bkXtCuR75cMgjqBeDSXFdJovrhthfhMicj9ULw...` |
| 4 | **Buy 0DTE SOL PUT Option #2 (20 SOL @ $188 — Dual-Lane)** | Trader 2 (`0x11b4...368a`) | [`0x2c1819f00738ebcbbda3aaf58667a91aee6acfe1c9b1a30fef1c60960a2d1a77`](https://via-hadrian.testnet.romeprotocol.xyz/tx/0x2c1819f00738ebcbbda3aaf58667a91aee6acfe1c9b1a30fef1c60960a2d1a77) | `4ocXhR4q289cnx4nc5SLrdnAya9CkhLFUPRZyg7t8hMA...` |
| 5 | **Buy BTC PUT Option #3 (0.25 BTC @ $88k)** | Trader 1 (`0xD566...61b8`) | [`0x7644696436e29bd36c98d5ddf3bca643108a4125f7d4567b79898cf2e4f5b69e`](https://via-hadrian.testnet.romeprotocol.xyz/tx/0x7644696436e29bd36c98d5ddf3bca643108a4125f7d4567b79898cf2e4f5b69e) | `4UxHvq6dk8uVVZpzaLLJM28Nvfq76ivNjrpvZjqF9fUj...` |
| 6 | **Sync Solana Oracle Gateway Index (BTC/USD -> $91,480)** | Oracle Keeper (`0x91E9...aeA1`) | [`0xc336cb423d9338f9ba26a3d8e6fefc4cbed45f554d9313d5a2c220379c33b5af`](https://via-hadrian.testnet.romeprotocol.xyz/tx/0xc336cb423d9338f9ba26a3d8e6fefc4cbed45f554d9313d5a2c220379c33b5af) | `3bZ4UeYmZfLhaJU6LjbnW9YeEnooSzz4TxcKJgeqGquW...` |
| 7 | **Exercise & Settle BTC CALL Option #1 via CPI (`0xFF...08`)** | Trader 1 (`0xD566...61b8`) | [`0x1795a1b4cec6d021d04beaad9f583634932b6a19cb1845da31bc99295191973e`](https://via-hadrian.testnet.romeprotocol.xyz/tx/0x1795a1b4cec6d021d04beaad9f583634932b6a19cb1845da31bc99295191973e) | `2JaRocvtqL2pwK8wxSpnF2zZJD8NCUvzAHXB7ms32JZ1...` |
| 8 | **Exercise & Settle Dual-Lane SOL PUT Option #2 via CPI (`0xFF...08`)** | Trader 2 (`0x11b4...368a`) | [`0xefebb4f3a03eeefae80327cd82016f66ef042dcb494b9c3dc56474abbfa3a329`](https://via-hadrian.testnet.romeprotocol.xyz/tx/0xefebb4f3a03eeefae80327cd82016f66ef042dcb494b9c3dc56474abbfa3a329) | `4kKjHUaVgYTPjkDqdYkDk5pmovULx9gzowsYC7reb7n8...` |

---

## Development & Verification

```bash
npm install
npm run compile:contracts
npm run test:contracts
npm run typecheck
npm run build
npm run dev
```
