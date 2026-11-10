import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title:
    "Augur Options — Shared-State BTC & SOL Options Platform on Rome Protocol",
  description:
    "USDC-settled BTC and SOL Call/Put Options & 0DTE Trading Terminal for EVM and Solana wallets, powered by Solana Oracle Gateway price feeds and atomic settlement via Rome CPI precompiles (0xFF...08 & 0xFF...09).",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#070b14] text-slate-100 antialiased selection:bg-amber-500/30 selection:text-amber-200">
        {children}
      </body>
    </html>
  );
}
