#!/usr/bin/env node
/**
 * Read-only health check of the live site. Changes nothing.
 *   npm run health                    (checks https://pmtarcade.com)
 *   npm run health -- --base https://example.com
 * Exit code 1 when something needs attention.
 */
const argv = process.argv.slice(2);
const at = argv.indexOf('--base');
const base = (at >= 0 && argv[at + 1] ? argv[at + 1] : 'https://pmtarcade.com').replace(/\/$/, '');

const GAMES = ['neon-rush', 'fruit-rush', 'slide-puzzle', 'block-fit', 'merge-2048', 'tower-stack', 'bubble-pop', 'brick-breaker', 'color-sort', 'sky-hop', 'knife-throw', 'fruit-slice', 'snake-arena', 'bounce-up', 'rhythm-tiles', 'learn-english'];
const PAGES = ['/', '/token/', '/whitepaper/', '/transparency/', '/whitepaper/PMT-Whitepaper.pdf', '/token/pmt-logo-256.png', '/sitemap.xml', '/ads.txt', '/games/sdk/sdk.js', ...GAMES.map((g) => `/games/${g}/`)];
const SUPPLY = 10_000_000_000;
const POOL_WARN_PMT = 10_000_000; // warn when the rewards pool runs low
const INTEGRITY_MAX_AGE_DAYS = 8;

const problems = [];
const notes = [];
const fmt = (n) => Math.floor(n).toLocaleString('en-US');

async function get(path, { json = false } = {}) {
  const started = Date.now();
  try {
    const res = await fetch(base + path, { redirect: 'follow', signal: AbortSignal.timeout(20_000) });
    const ms = Date.now() - started;
    if (!res.ok) problems.push(`${path} answered HTTP ${res.status}`);
    else if (ms > 5_000) notes.push(`${path} is slow (${ms} ms)`);
    return json ? await res.json() : await res.text();
  } catch (e) {
    problems.push(`${path} did not answer (${e.name === 'TimeoutError' ? 'timeout' : e.message})`);
    return null;
  }
}

for (const p of PAGES) await get(p);

const health = await get('/api/health', { json: true });
if (health && health.data?.status !== 'ok') problems.push('API health is not ok');

const t = (await get('/api/transparency', { json: true }))?.data;
if (t) {
  if (t.ledgerSum !== 0) problems.push(`Ledger does not add up: sum of balances is ${t.ledgerSum} (must be 0)`);
  const pool = t.inApp.rewardsPoolUnits / 100;
  if (pool <= 0) problems.push('Rewards pool is empty: free games, check-ins and invites pay nothing');
  else if (pool < POOL_WARN_PMT) problems.push(`Rewards pool is low: ${fmt(pool)} PMT left`);
  if (t.reserve.coverageBps !== null && t.reserve.coverageBps < 10_000) notes.push(`Taka reserve covers ${(t.reserve.coverageBps / 100).toFixed(1)}% of sell-backs`);
  if (!t.lastIntegrityCheck) notes.push('The full ledger check has never been run');
  else {
    const days = (Date.now() - t.lastIntegrityCheck.at) / 86_400_000;
    if (t.lastIntegrityCheck.status !== 'PASS') problems.push(`Last full ledger check: ${t.lastIntegrityCheck.status}`);
    else if (days > INTEGRITY_MAX_AGE_DAYS) notes.push(`Last full ledger check was ${Math.floor(days)} days ago (Admin → Ledger integrity)`);
  }
  const onchain = t.wallets.reduce((n, w) => n + (w.balance === null ? NaN : Number(w.balance)), 0);
  if (t.wallets.some((w) => w.balance === null)) problems.push('Could not read wallet balances from BNB Chain');
  else if (onchain > SUPPLY + 1) problems.push(`Published wallets hold ${fmt(onchain)} PMT — more than the supply`);
  notes.push(`${fmt(t.players)} players · rewards pool ${fmt(pool)} PMT · players hold ${fmt((t.inApp.playersSellableUnits + t.inApp.playersBonusUnits) / 100)} PMT · fees ${fmt(t.inApp.feesUnits / 100)} PMT`);
  for (const w of t.wallets) notes.push(`${w.label}: ${w.balance === null ? 'unavailable' : fmt(Number(w.balance))} PMT on chain`);
}

const arcade = (await get('/api/arcade/config', { json: true }))?.data;
if (arcade && !arcade.enabled) problems.push('Free-game rewards are switched off');
if (arcade && arcade.games?.length !== GAMES.length) notes.push(`Free games listed: ${arcade.games?.length}`);

console.log(`Health check of ${base} — ${new Date().toISOString()}`);
console.log(problems.length ? `\n${problems.length} PROBLEM(S):` : '\nAll checks passed.');
for (const p of problems) console.log(`  ✗ ${p}`);
if (notes.length) console.log('\nNotes:');
for (const n of notes) console.log(`  · ${n}`);
process.exit(problems.length ? 1 : 0);
