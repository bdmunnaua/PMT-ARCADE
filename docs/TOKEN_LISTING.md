# PMT token profile: BscScan, wallets and listings

Everything needed to give PMT a full public profile. The token contract itself needs no change:
it is verified on BscScan (exact match), has a fixed supply of 10,000,000,000, no owner, no mint
and no tax.

| | |
|---|---|
| Contract | `0xc576c15Bf0E06AF1a65d15B8219A90f1e07f025F` (BNB Smart Chain, BEP-20, 18 decimals) |
| Contract creator / supply wallet | `0xe328A50732109d129BCf9B302Cfe362949F77FB4` (holds all 10,000,000,000 PMT) |
| Token page | https://pmtarcade.com/token/ |
| Whitepaper | https://pmtarcade.com/whitepaper/ (PDF: https://pmtarcade.com/whitepaper/PMT-Whitepaper.pdf) |
| Logo | https://pmtarcade.com/token/pmt-logo.svg · 32×32 `pmt-logo-32.png` · 256×256 `pmt-logo-256.png` · 512×512 `pmt-logo-512.png` (in `apps/web/public/token/`) |
| Token list (Uniswap/Pancake format) | https://pmtarcade.com/token/tokenlist.json |

## 1. BscScan “Update Token Info” (owner, ~15 minutes)
BscScan only accepts this from the contract creator, so **you** sign it in MetaMask. Never paste
the wallet's secret phrase or private key anywhere — BscScan only needs a signature.

1. Sign in at https://bscscan.com/login (create a free account with an email on the domain if possible, see 3).
2. Open https://bscscan.com/verifyAddress/0xe328A50732109d129BCf9B302Cfe362949F77FB4 →
   “Sign with Web3”, connect MetaMask with the supply wallet, and sign the message (no gas, no payment).
3. Open https://bscscan.com/tokenupdate/0xc576c15Bf0E06AF1a65d15B8219A90f1e07f025F and fill in:

| Field | Value |
|---|---|
| Project name | PMT Arcade |
| Official website | https://pmtarcade.com |
| Email | an address on pmtarcade.com, e.g. `team@pmtarcade.com` (Cloudflare → Email → Email Routing forwards it to your Gmail for free) |
| Logo (32×32 PNG or SVG) | `apps/web/public/token/pmt-logo-32.png` or `pmt-logo.svg` |
| Project sector | Gaming |
| Description | see below |
| Whitepaper | https://pmtarcade.com/whitepaper/ |
| Social profiles | only real ones (Facebook page, Telegram, X) — leave empty if none |
| Price data (CoinGecko / CMC) | leave empty — PMT is not listed |

Description (under 300 characters):

> PMT is the game token of PMT Arcade (pmtarcade.com), a games platform from Bangladesh. Players earn PMT in free games, compete with it in skill games like Ludo, Chess and Carrom, and send it to friends. Fixed supply of 10 billion, verified contract, no mint, no tax.

BscScan reviews it in a few days. Their checks: the website shows the contract address (the token
page does), and the email domain matches the website.

## 2. Wallets
- **MetaMask:** no listing needed. Players tap “Add PMT to MetaMask” on the token page (it also
  switches MetaMask to BNB Smart Chain), or import the contract address by hand.
- **Trust Wallet logo:** submitted through https://github.com/trustwallet/assets (needs the
  256×256 PNG; Trust Wallet charges a fee and usually requires some on-chain activity). Do this later.

## 3. Price sites (later)
CoinGecko and CoinMarketCap only list tokens that trade on an exchange. PMT has no market yet, so
nothing to do until a DEX listing, which the whitepaper keeps for later.

## 4. Allocation wallets (whitepaper section 9)
To make the allocation public, create one new wallet per share and send it from the supply wallet
(you sign these transfers; they need a little BNB for gas):

| Share | PMT |
|---|---|
| Player sale | 2,000,000,000 |
| Rewards pool | 1,000,000,000 |
| Tournaments & community | 1,000,000,000 |
| Future liquidity | 1,500,000,000 |
| Team & operations | 1,500,000,000 |
| Reserve (stays in the supply wallet) | 3,000,000,000 |

Then send me the addresses and I add them to the token page. The payout hot wallet for player
withdrawals is separate again and only ever holds a small amount.
