import { describe, expect, it } from 'vitest';
import { Wallet } from 'ethers';
import { createChainClient } from '../../apps/api/src/services/chain';
import type { Env } from '../../apps/api/src/env';

/** The payout hot wallet must never be the main supply wallet, even if its key was saved by mistake. */
describe('payout wallet guard', () => {
  const key = Wallet.createRandom();
  const base = { TOKEN_ADDRESS: '0x' + 'c'.repeat(40), RPC_URL: 'http://127.0.0.1:1', PAYOUT_PRIVATE_KEY: key.privateKey } as unknown as Env;

  it('refuses a payout key that belongs to a forbidden wallet', async () => {
    const chain = createChainClient({ ...base, FORBIDDEN_PAYOUT_ADDRESSES: `0x${'1'.repeat(40)}, ${key.address.toUpperCase().replace('0X', '0x')}` });
    expect(chain.payoutBlocked()).toBe(key.address);
    expect(chain.depositAddress()).toBeNull();
    expect(await chain.hotWallet()).toBeNull();
    await expect(chain.send('0x' + '2'.repeat(40), 100)).rejects.toThrow();
  });

  it('uses a payout key that is not forbidden', () => {
    const chain = createChainClient({ ...base, FORBIDDEN_PAYOUT_ADDRESSES: `0x${'1'.repeat(40)}` });
    expect(chain.payoutBlocked()).toBeNull();
    expect(chain.depositAddress()).toBe(key.address.toLowerCase());
  });
});
