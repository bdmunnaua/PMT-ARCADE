/**
 * BNB Chain access for PMT withdrawals and deposits.
 *   - Reading (deposit checks): plain JSON-RPC over fetch — transaction receipts and block height.
 *   - Sending (withdrawal payouts): ethers with the payout hot wallet (PAYOUT_PRIVATE_KEY secret).
 * Internal amounts are units (1 PMT = 100 units); on-chain amounts have TOKEN_DECIMALS (18).
 * Tests replace this with a fake ChainClient, so they never touch a real chain.
 */
import { Contract, JsonRpcProvider, Wallet, formatEther, formatUnits } from 'ethers';
import type { Env } from '../env';

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ERC20 = ['function transfer(address to, uint256 amount) returns (bool)', 'function balanceOf(address owner) view returns (uint256)'];

export interface ChainTransfer {
  from: string;
  to: string;
  units: number;
  logIndex: number;
}
export interface ReceiptCheck {
  /** NOT_FOUND = unknown or not mined yet; FAILED = reverted */
  status: 'NOT_FOUND' | 'FAILED' | 'OK';
  confirmations: number;
  /** PMT Transfer events in the transaction */
  transfers: ChainTransfer[];
}

export interface ChainClient {
  configured: boolean;
  tokenSymbol: string;
  tokenAddress: string;
  chainName: string;
  explorerTx: string;
  depositAddress(): string | null;
  checkTransaction(txHash: string): Promise<ReceiptCheck>;
  /** sends `units` PMT to `to` from the hot wallet; returns the transaction hash */
  send(to: string, units: number): Promise<string>;
  hotWallet(): Promise<{ address: string; gasBnb: string; tokenBalance: string } | null>;
  /** the payout key's address when it is refused because it is a forbidden wallet (e.g. the supply wallet) */
  payoutBlocked(): string | null;
  /** live PMT balance of any address, in whole PMT as text; null when not configured */
  tokenBalanceOf(address: string): Promise<string | null>;
}

const lower = (a: string) => a.toLowerCase();
const topicAddress = (t: string) => `0x${t.slice(-40)}`.toLowerCase();

export function createChainClient(env: Env): ChainClient {
  const tokenAddress = lower(env.TOKEN_ADDRESS ?? '');
  const decimals = Number(env.TOKEN_DECIMALS ?? 18);
  const scale = 10n ** BigInt(decimals - 2); // on-chain base units per internal unit
  const configured = /^0x[0-9a-f]{40}$/.test(tokenAddress) && !!env.RPC_URL;
  const forbidden = new Set(
    (env.FORBIDDEN_PAYOUT_ADDRESSES ?? '')
      .split(',')
      .map((a) => lower(a.trim()))
      .filter(Boolean),
  );
  let wallet: Wallet | null = null;
  let blocked: string | null = null;
  /** the payout hot wallet; never the supply wallet, even if its key was configured by mistake */
  const hot = () => {
    if (!env.PAYOUT_PRIVATE_KEY) return null;
    if (!wallet && !blocked) {
      const w = new Wallet(env.PAYOUT_PRIVATE_KEY, new JsonRpcProvider(env.RPC_URL, Number(env.CHAIN_ID ?? 56), { staticNetwork: true }));
      if (forbidden.has(lower(w.address))) blocked = w.address;
      else wallet = w;
    }
    return wallet;
  };
  const rpc = async <T>(method: string, params: unknown[]): Promise<T> => {
    const res = await fetch(env.RPC_URL!, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const json = (await res.json()) as { result?: T; error?: { message: string } };
    if (json.error) throw new Error(`RPC ${method}: ${json.error.message}`);
    return json.result as T;
  };
  return {
    configured,
    tokenSymbol: env.TOKEN_SYMBOL ?? 'PMT',
    tokenAddress,
    chainName: env.CHAIN_NAME ?? 'BNB Smart Chain',
    explorerTx: env.EXPLORER_TX ?? 'https://bscscan.com/tx/',
    depositAddress() {
      const w = hot();
      return env.DEPOSIT_ADDRESS ? lower(env.DEPOSIT_ADDRESS) : w ? lower(w.address) : null;
    },
    async checkTransaction(txHash) {
      const receipt = await rpc<{ status: string; blockNumber: string; logs: { address: string; topics: string[]; data: string; logIndex: string }[] } | null>('eth_getTransactionReceipt', [txHash]);
      if (!receipt) return { status: 'NOT_FOUND', confirmations: 0, transfers: [] };
      if (receipt.status !== '0x1') return { status: 'FAILED', confirmations: 0, transfers: [] };
      const head = BigInt(await rpc<string>('eth_blockNumber', []));
      const confirmations = Number(head - BigInt(receipt.blockNumber) + 1n);
      const transfers = receipt.logs
        .filter((l) => lower(l.address) === tokenAddress && l.topics[0] === TRANSFER_TOPIC && l.topics.length === 3)
        .map((l) => {
          const raw = BigInt(l.data);
          const units = raw / scale;
          return { from: topicAddress(l.topics[1]!), to: topicAddress(l.topics[2]!), units: units > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(units), logIndex: Number(l.logIndex) };
        });
      return { status: 'OK', confirmations, transfers };
    },
    async send(to, units) {
      const w = hot();
      if (!w) throw new Error('PAYOUT_PRIVATE_KEY is not set');
      const token = new Contract(tokenAddress, ERC20, w);
      const amount = BigInt(units) * scale;
      const balance = (await token.balanceOf!(w.address)) as bigint;
      if (balance < amount) throw new Error('The payout wallet does not hold enough PMT');
      const tx = (await token.transfer!(to, amount)) as { hash: string };
      return tx.hash;
    },
    async tokenBalanceOf(address) {
      if (!configured || !/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
      const data = `0x70a08231${address.slice(2).toLowerCase().padStart(64, '0')}`; // balanceOf(address)
      const hex = await rpc<string>('eth_call', [{ to: tokenAddress, data }, 'latest']);
      return formatUnits(BigInt(hex), decimals);
    },
    payoutBlocked() {
      hot();
      return blocked;
    },
    async hotWallet() {
      const w = hot();
      if (!w || !configured) return null;
      const [gas, bal] = await Promise.all([w.provider!.getBalance(w.address), new Contract(tokenAddress, ERC20, w.provider).balanceOf!(w.address) as Promise<bigint>]);
      return { address: w.address, gasBnb: formatEther(gas), tokenBalance: formatUnits(bal, decimals) };
    },
  };
}
