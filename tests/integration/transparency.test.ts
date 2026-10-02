import { beforeEach, describe, expect, it } from 'vitest';
import type { ChainClient } from '../../apps/api/src/services/chain';
import { createHarness, TOKENS, type Harness, type TestPlayer } from '../helpers/harness';

const ADDR = '0x' + 'ab'.repeat(20);

/** A chain that knows only token balances. */
function balanceChain(balances: Record<string, string>): ChainClient {
  return {
    configured: true,
    tokenSymbol: 'PMT',
    tokenAddress: '0x' + 'c'.repeat(40),
    chainName: 'BNB Smart Chain',
    explorerTx: 'https://bscscan.com/tx/',
    depositAddress: () => null,
    checkTransaction: async () => ({ status: 'NOT_FOUND', confirmations: 0, transfers: [] }),
    send: async () => {
      throw new Error('not used');
    },
    payoutBlocked: () => null,
    hotWallet: async () => null,
    tokenBalanceOf: async (a) => {
      if (a === 'down') throw new Error('rpc down');
      return balances[a.toLowerCase()] ?? '0';
    },
  };
}

/** The public transparency page: totals anyone can check, and the published wallets. */
describe('transparency', () => {
  let h: Harness;
  let admin: TestPlayer;
  let alice: TestPlayer;

  beforeEach(async () => {
    h = await createHarness({ chain: () => balanceChain({ '0xe328a50732109d129bcf9b302cfe362949f77fb4': '10000000000', [ADDR]: '2000000000' }) });
    admin = await h.admin('SUPER_ADMIN', 'root');
    alice = await h.player('alice');
    await h.issue(admin, TOKENS(1_000_000));
    await h.fund(admin, alice, TOKENS(5_000));
  });

  const feed = async () => {
    const r = await h.call('GET', '/api/transparency');
    expect(r.status).toBe(200);
    return r.body.data;
  };

  it('is public, aggregate-only and shows that every PMT is accounted for', async () => {
    const t = await feed();
    expect(t.players).toBe(2);
    expect(t.inApp.issuedUnits).toBeGreaterThanOrEqual(TOKENS(1_000_000));
    expect(t.inApp.playersSellableUnits).toBe(TOKENS(5_000));
    expect(t.ledgerSum).toBe(0);
    expect(t.token.totalSupply).toBe(10_000_000_000);
    expect(t.wallets).toEqual([expect.objectContaining({ label: 'Supply wallet', balance: '10000000000' })]);
    // no personal data anywhere in the response
    const text = JSON.stringify(t);
    expect(text).not.toContain('alice');
    expect(text).not.toContain('@');
  });

  it('admins publish and remove wallets; players cannot', async () => {
    const body = { label: 'Player sale', address: ADDR.toUpperCase().replace('0X', '0x'), purpose: 'Sold to players', plannedTokens: 2_000_000_000, sort: 10 };
    expect((await h.call('POST', '/api/admin/public-wallets', { token: alice.token, body })).status).toBe(403);
    const added = await h.call('POST', '/api/admin/public-wallets', { token: admin.token, body });
    expect(added.status).toBe(200);
    expect(added.body.data.address).toBe(ADDR);
    expect((await h.call('POST', '/api/admin/public-wallets', { token: admin.token, body })).body.error?.code).toBe('CONFLICT');
    const list = (await h.call('GET', '/api/admin/public-wallets', { token: admin.token })).body.data;
    expect(list.map((w: { label: string; balance: string }) => [w.label, w.balance])).toEqual([
      ['Supply wallet', '10000000000'],
      ['Player sale', '2000000000'],
    ]);
    // the public feed sees the change straight away (cache is cleared)
    expect((await feed()).wallets).toHaveLength(2);
    const del = await h.call('DELETE', `/api/admin/public-wallets/${added.body.data.id}`, { token: admin.token });
    expect(del.status).toBe(200);
    expect((await feed()).wallets).toHaveLength(1);
    const audit = await h.db.prepare("SELECT action FROM audit_logs WHERE entity_type = 'public_wallet' ORDER BY created_at").all<{ action: string }>();
    expect(audit.results.map((a) => a.action)).toEqual(['transparency.wallet_added', 'transparency.wallet_removed']);
  });

  it('rejects addresses that are not BNB Chain addresses', async () => {
    const r = await h.call('POST', '/api/admin/public-wallets', { token: admin.token, body: { label: 'Bad', address: '0x1234' } });
    expect(r.status).toBe(400);
  });

  it('reports the last ledger integrity check', async () => {
    expect((await feed()).lastIntegrityCheck).toBeNull();
    await h.call('POST', '/api/admin/ledger/integrity', { token: admin.token });
    // a new wallet clears the cache, so the feed is rebuilt
    await h.call('POST', '/api/admin/public-wallets', { token: admin.token, body: { label: 'Rewards pool', address: '0x' + '12'.repeat(20) } });
    expect((await feed()).lastIntegrityCheck).toMatchObject({ status: 'PASS' });
  });
});
