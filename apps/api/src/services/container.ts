/** Per-request service graph. Every service shares one D1 binding, clock and realtime publisher. */
import type { GameModule } from '@arena/shared';
import { isProduction, type Env, type RequestMeta } from '../env';
import { FinanceRepository } from '../repositories/finance';
import { LedgerReadRepository } from '../repositories/ledger-read';
import { MatchRepository } from '../repositories/matches';
import { UserRepository } from '../repositories/users';
import { WalletRepository } from '../repositories/wallets';
import type { RealtimePublisher } from '../realtime/publisher';
import { AdminService } from './admin';
import { AuditService } from './audit';
import { BuyService } from './buy';
import { ChatService } from './chat';
import { CrashService } from './crash';
import { DisputeService } from './disputes';
import { FraudService } from './fraud';
import { GameService } from './games';
import { IntegrityService } from './integrity';
import { LedgerService } from './ledger';
import { MatchService } from './matches';
import { NotificationService } from './notifications';
import { PlayerService } from './players';
import { RateLimiter, resolveRateLimits } from './rate-limit';
import { SellService } from './sell';
import { SettingsService } from './settings';
import { ReserveService } from './reserve';
import { TransferService } from './transfers';
import { ArcadeService } from './arcade';
import { createChainClient, type ChainClient } from './chain';
import { OnchainService } from './onchain';
import { TransparencyService } from './transparency';
import { SettlementService } from './settlement';
import { TreasuryService } from './treasury';

export interface ContainerOptions {
  publisher: RealtimePublisher;
  now?: () => number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  gameModules?: Record<string, GameModule<any>>;
  /** BNB Chain access; tests pass a fake */
  chain?: (env: Env) => ChainClient;
}

export function createServices(env: Env, meta: RequestMeta, opts: ContainerOptions) {
  const db = env.DB;
  const now = opts.now ?? (() => Date.now());
  const production = isProduction(env);
  const publisher = opts.publisher;

  const users = new UserRepository(db);
  const wallets = new WalletRepository(db);
  const finance = new FinanceRepository(db, now);
  const matchesRepo = new MatchRepository(db, now);
  const ledgerRead = new LedgerReadRepository(db);

  const audit = new AuditService(db, meta, now);
  const settings = new SettingsService(db, production, now);
  const notifications = new NotificationService(db, publisher, now);
  const fraud = new FraudService(db, notifications, now);
  const ledger = new LedgerService(db, now);
  const games = new GameService(db, production, now, opts.gameModules);
  const settlement = new SettlementService(db, matchesRepo, ledger, notifications, publisher, now);
  const matches = new MatchService(db, matchesRepo, wallets, ledger, games, settings, settlement, notifications, fraud, publisher, now);
  const players = new PlayerService(db, users, ledgerRead, finance, matchesRepo, now);
  const buys = new BuyService(db, finance, users, wallets, ledger, settings, notifications, fraud, publisher, now);
  const sells = new SellService(db, finance, users, wallets, ledger, settings, notifications, fraud, publisher, now);
  const chat = new ChatService(db, finance, notifications, publisher, now);
  const treasury = new TreasuryService(db, ledger, users, wallets, notifications, publisher);
  const disputes = new DisputeService(db, matchesRepo, matches, settlement, treasury, users, notifications, now);
  const admin = new AdminService(db, users, wallets, finance, matchesRepo, matches, players, buys, sells, fraud, notifications, now);
  const crash = new CrashService(db, ledger, wallets, settings, games, now);
  const reserve = new ReserveService(db, settings, now);
  const transfers = new TransferService(db, users, wallets, ledger, settings, notifications, now);
  const arcade = new ArcadeService(db, ledger, settings, now);
  const chain = (opts.chain ?? createChainClient)(env);
  const onchain = new OnchainService(db, wallets, ledger, settings, notifications, chain, now);
  const transparency = new TransparencyService(db, reserve, chain, now);
  const integrity = new IntegrityService(db, now);
  const rateLimiter = new RateLimiter(db, resolveRateLimits(env.RATE_LIMIT_OVERRIDES), now);

  return {
    production,
    now,
    users,
    wallets,
    finance,
    ledgerRead,
    matchesRepo,
    audit,
    settings,
    reserve,
    transfers,
    arcade,
    onchain,
    transparency,
    notifications,
    fraud,
    ledger,
    games,
    settlement,
    matches,
    players,
    buys,
    sells,
    chat,
    treasury,
    disputes,
    admin,
    crash,
    integrity,
    rateLimiter,
  };
}

export type Services = ReturnType<typeof createServices>;
