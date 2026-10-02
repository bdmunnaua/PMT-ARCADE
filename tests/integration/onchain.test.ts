import { beforeEach, describe, expect, it } from 'vitest';
import type { ChainClient, ReceiptCheck } from '../../apps/api/src/services/chain';
import { createHarness, TOKENS, type Harness, type TestPlayer } from '../helpers/harness';

const DEPOSIT = '0x' + 'd'.repeat(40);
const ALICE_WALLET = '0x' + 'a'.repeat(40);
const TX = (n: number) => '0x' + n.toString(16).padStart(64, '0');

/** A fake BNB Chain: records payouts and serves the receipts the test sets up. */
function fakeChain() {
  const sent: { to: string; units: number }[] = [];
  const receipts = new Map<string, ReceiptCheck>();
  let failNextSend = false;
  const client: ChainClient = {
    configured: true,
    tokenSymbol: 'PMT',
    tokenAddress: '0x' + 'c'.repeat(40),
    chainName: 'BNB Smart Chain',
    explorerTx: 'https://bscscan.com/tx/',
    depositAddress: () => DEPOSIT,
    checkTransaction: async (hash) => receipts.get(hash) ?? { status: 'NOT_FOUND', confirmations: 0, transfers: [] },
    send: async (to, units) => {
      if (failNextSend) {
        failNextSend = false;
        throw new Error('nonce too low');
      }
      sent.push({ to, units });
      return TX(1000 + sent.length);
    },
    payoutBlocked: () => null,
    hotWallet: async () => ({ address: DEPOSIT, gasBnb: '0.1', tokenBalance: '1000000' }),
    tokenBalanceOf: async () => '1000000',
  };
  return { client, sent, receipts, failSend: () => (failNextSend = true) };
}

describe('PMT on BNB Chain (withdraw / deposit)', () => {
  let h: Harness;
  let chain: ReturnType<typeof fakeChain>;
  let admin: TestPlayer;
  let alice: TestPlayer;

  beforeEach(async () => {
    chain = fakeChain();
    h = await createHarness({ chain: () => chain.client });
    admin = await h.admin('SUPER_ADMIN', 'root');
    alice = await h.player('alice');
    await h.fund(admin, alice, TOKENS(300_000));
    await h.db.exec("UPDATE platform_settings SET value = 'true' WHERE key IN ('onchain_withdrawals_enabled', 'onchain_deposits_enabled')");
    expect((await h.call('POST', '/api/wallet/crypto/address', { token: alice.token, body: { address: ALICE_WALLET.toUpperCase().replace('0X', '0x') } })).status).toBe(200);
  });

  const withdraw = (units: number, key = `w-${crypto.randomUUID()}`) => h.call('POST', '/api/wallet/crypto/withdrawals', { token: alice.token, body: { amountUnits: units }, headers: { 'idempotency-key': key } });

  it('withdraw: PMT leaves the balance at once; Pay sends amount − fee on-chain once; the fee goes to platform fees', async () => {
    const r = await withdraw(TOKENS(200_000));
    expect(r.status).toBe(201);
    expect(r.body.data.withdrawal).toMatchObject({ status: 'PENDING', amountUnits: TOKENS(200_000), feeUnits: TOKENS(5_000), sentUnits: TOKENS(195_000), address: ALICE_WALLET });
    expect((await h.wallet(alice.token)).availableUnits).toBe(TOKENS(100_000));
    const id = r.body.data.withdrawal.id;
    const pays = await Promise.all([1, 2].map(() => h.call('POST', `/api/admin/crypto/withdrawals/${id}/pay`, { token: admin.token })));
    expect(pays.filter((p) => p.status === 200)).toHaveLength(1);
    expect(chain.sent).toEqual([{ to: ALICE_WALLET, units: TOKENS(195_000) }]);
    const mine = (await h.call('GET', '/api/wallet/crypto', { token: alice.token })).body.data.withdrawals[0];
    expect(mine).toMatchObject({ status: 'PAID', txHash: TX(1001) });
    expect(await h.systemBalance('sys_platform_fees')).toBe(TOKENS(5_000));
    expect((await h.integrity()).status).toBe('PASS');
  });

  it('a failed payout can be retried or rejected; rejecting returns the PMT to the buckets it came from', async () => {
    // alice holds bought PMT and free (bonus) PMT; a withdrawal takes bonus first
    await h.issue(admin, TOKENS(50_000));
    await h.call('POST', '/api/admin/tokens/distribute', { token: admin.token, body: { playerNumber: alice.playerNumber, amountUnits: TOKENS(50_000), type: 'BONUS', reason: 'free' }, headers: { 'idempotency-key': 'bonus-alice-2' } });
    const before = await h.wallet(alice.token);
    const r = await withdraw(TOKENS(120_000));
    const id = r.body.data.withdrawal.id;
    chain.failSend();
    const failed = await h.call('POST', `/api/admin/crypto/withdrawals/${id}/pay`, { token: admin.token });
    expect(failed.body.error?.code).toBe('PAYOUT_FAILED');
    expect((await withdraw(TOKENS(100_000))).body.error?.code).toBe('CONFLICT'); // one at a time
    const rej = await h.call('POST', `/api/admin/crypto/withdrawals/${id}/reject`, { token: admin.token, body: { reason: 'wrong network' } });
    expect(rej.body.data.status).toBe('REJECTED');
    expect(await h.wallet(alice.token)).toMatchObject({ availableUnits: before.availableUnits, bonusUnits: before.bonusUnits });
    expect(chain.sent).toHaveLength(0);
    expect((await h.integrity()).status).toBe('PASS');
  });

  it('deposit: a PMT transfer from the linked wallet to the deposit address is credited once, as BONUS', async () => {
    chain.receipts.set(TX(1), { status: 'OK', confirmations: 3, transfers: [{ from: ALICE_WALLET, to: DEPOSIT, units: TOKENS(25_000), logIndex: 7 }] });
    const dep = (hash: string) => h.call('POST', '/api/wallet/crypto/deposits', { token: alice.token, body: { txHash: hash } });
    expect((await dep(TX(1))).body.error?.message).toMatch(/more block confirmations/);
    chain.receipts.set(TX(1), { status: 'OK', confirmations: 20, transfers: [{ from: ALICE_WALLET, to: DEPOSIT, units: TOKENS(25_000), logIndex: 7 }] });
    const ok = await dep(TX(1));
    expect(ok.status).toBe(201);
    expect((await h.wallet(alice.token)).bonusUnits).toBe(TOKENS(25_000));
    expect((await dep(TX(1))).body.error?.code).toBe('ALREADY_PROCESSED');
    // someone else's transfer, or one sent elsewhere, is refused
    chain.receipts.set(TX(2), { status: 'OK', confirmations: 20, transfers: [{ from: '0x' + 'e'.repeat(40), to: DEPOSIT, units: TOKENS(25_000), logIndex: 1 }] });
    expect((await dep(TX(2))).body.error?.code).toBe('VALIDATION_ERROR');
    expect((await dep(TX(3))).body.error?.message).toMatch(/not found/);
    expect((await h.integrity()).status).toBe('PASS');
  });

  it('closed until switched on; one address per player', async () => {
    await h.db.exec("UPDATE platform_settings SET value = 'false' WHERE key = 'onchain_withdrawals_enabled'");
    expect((await withdraw(TOKENS(200_000))).body.error?.code).toBe('FEATURE_DISABLED');
    const bob = await h.player('bob');
    expect((await h.call('POST', '/api/wallet/crypto/address', { token: bob.token, body: { address: ALICE_WALLET } })).body.error?.code).toBe('CONFLICT');
  });
});
