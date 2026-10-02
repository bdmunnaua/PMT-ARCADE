/**
 * Builds the development seed SQL (see seed-dev.mjs). Exported separately so the test suite can
 * load the exact same seed into an in-memory database and run the ledger integrity checker on it.
 */
import { q, ulid } from './lib.mjs';

export function buildSeedSql(now = Date.now()) {
  const T = (n) => n * 100;
  let clock = now - 7 * 24 * 60 * 60 * 1000;
  const tick = (ms = 60_000) => (clock += ms);
  const sql = [];
  const push = (s) => sql.push(s.trim().replace(/\s+\n/g, '\n'));

  // guard: abort the whole file if the seed already ran
  push(`INSERT INTO batch_assert (ok) SELECT NOT EXISTS (SELECT 1 FROM users WHERE id = 'seed_superadmin');`);

  // ---------- users
  const people = [
    { id: 'seed_superadmin', username: 'seed_admin', name: 'Seed Super Admin', admin: 'SUPER_ADMIN' },
    { id: 'seed_player_1', username: 'rahim', name: 'Rahim' },
    { id: 'seed_player_2', username: 'karim', name: 'Karim' },
    { id: 'seed_player_3', username: 'nadia', name: 'Nadia' },
    { id: 'seed_player_4', username: 'sadia', name: 'Sadia' },
    { id: 'seed_player_5', username: 'tanvir', name: 'Tanvir' },
  ];
  for (const p of people) {
    const t = tick();
    push(`INSERT INTO users (id, firebase_uid, email, email_verified, account_status, created_at, updated_at) VALUES (${q(p.id)}, ${q(`dev-seed-${p.id}`)}, ${q(`${p.username}@example.test`)}, 1, 'ACTIVE', ${t}, ${t});`);
    push(`UPDATE counters SET value = value + 1 WHERE name = 'player_number';`);
    push(
      `INSERT INTO player_profiles (user_id, player_number, username, username_lower, display_name, created_at, updated_at) VALUES (${q(p.id)}, (SELECT value FROM counters WHERE name = 'player_number'), ${q(p.username)}, ${q(p.username)}, ${q(p.name)}, ${t}, ${t});`,
    );
    push(`INSERT INTO player_stats (user_id, updated_at) VALUES (${q(p.id)}, ${t});`);
    for (const b of ['AVAILABLE', 'LOCKED_GAME', 'LOCKED_SELL', 'BONUS']) {
      push(`INSERT INTO wallet_accounts (id, owner_type, user_id, bucket, balance, allow_negative, created_at, updated_at) VALUES ('wa_${p.id}_${b}', 'PLAYER', ${q(p.id)}, '${b}', 0, 0, ${t}, ${t});`);
    }
    if (p.admin) push(`INSERT INTO admin_users (user_id, role_id, active, created_at, updated_at) VALUES (${q(p.id)}, '${p.admin}', 1, ${t}, ${t});`);
  }

  // ---------- mini ledger (same rules as LedgerService: balanced postings, balance_after, final cached balances)
  const SYS = { ADMIN_TREASURY: 'sys_admin_treasury', PLATFORM_FEES: 'sys_platform_fees', ISSUANCE: 'sys_issuance' };
  const balances = new Map();
  const acct = (ref) => (ref.system ? SYS[ref.system] : `wa_${ref.user}_${ref.bucket}`);
  const touched = new Set();
  function tx({ key, type, refType = null, refId = null, gameId = null, by = 'SYSTEM', byId = null, postings, meta = {} }) {
    const id = ulid(tick());
    const total = postings.reduce((s, p) => s + p.amount, 0);
    push(
      `INSERT INTO ledger_transactions (id, idempotency_key, type, reference_type, reference_id, game_id, created_by_type, created_by_id, metadata, total_units, created_at) VALUES (${q(id)}, ${q(key)}, ${q(type)}, ${q(refType)}, ${q(refId)}, ${q(gameId)}, ${q(by)}, ${q(byId)}, ${q(JSON.stringify(meta))}, ${total}, ${clock});`,
    );
    postings.forEach((p, i) => {
      for (const [ref, amount] of [
        [p.from, -p.amount],
        [p.to, p.amount],
      ]) {
        const a = acct(ref);
        const next = (balances.get(a) ?? 0) + amount;
        if (next < 0 && a !== SYS.ISSUANCE) throw new Error(`seed would overdraw ${a}`);
        balances.set(a, next);
        touched.add(a);
        push(
          `INSERT INTO ledger_entries (id, transaction_id, posting_index, posting_type, account_id, user_id, bucket, amount, balance_after, created_at) VALUES (${q(ulid(clock))}, ${q(id)}, ${i}, ${q(p.type ?? type)}, ${q(a)}, ${q(ref.user ?? null)}, ${q(ref.bucket ?? ref.system)}, ${amount}, ${next}, ${clock});`,
        );
      }
    });
    return id;
  }
  const P = (user, bucket = 'AVAILABLE') => ({ user, bucket });
  const TREASURY = { system: 'ADMIN_TREASURY' };

  // treasury issuance + welcome grants
  tx({ key: 'seed:issue:1', type: 'TREASURY_ISSUANCE', refType: 'TREASURY', refId: 'ADMIN_TREASURY', by: 'ADMIN', byId: 'seed_superadmin', postings: [{ from: { system: 'ISSUANCE' }, to: TREASURY, amount: T(1_000_000) }], meta: { reason: 'Development seed supply' } });
  for (const [i, p] of people.slice(1).entries()) {
    tx({ key: `seed:grant:${p.id}`, type: 'ADMIN_GRANT', refType: 'ADMIN_GRANT', by: 'ADMIN', byId: 'seed_superadmin', postings: [{ from: TREASURY, to: P(p.id), amount: T(5_000 + i * 1_000) }], meta: { grantType: 'PROMOTION', reason: 'Welcome tokens (seed)' } });
  }
  tx({ key: 'seed:bonus:seed_player_3', type: 'ADMIN_GRANT', refType: 'ADMIN_GRANT', by: 'ADMIN', byId: 'seed_superadmin', postings: [{ from: TREASURY, to: P('seed_player_3', 'BONUS'), amount: T(500) }], meta: { grantType: 'BONUS', reason: 'Event bonus (seed)' } });

  // ---------- buy requests
  function buy({ id, user, bdt, status, ref, sender = '01712345678' }) {
    const t = tick();
    const poisha = bdt * 100;
    const units = poisha * 110;
    let ledger = null;
    if (status === 'COMPLETED') {
      ledger = tx({ key: `buy:${id}:credit`, type: 'TOKEN_PURCHASE', refType: 'BUY_REQUEST', refId: id, by: 'ADMIN', byId: 'seed_superadmin', postings: [{ from: TREASURY, to: P(user), amount: units }], meta: { amountPoisha: poisha, rateTokensPerBdt: 110 } });
    }
    push(`UPDATE counters SET value = value + 1 WHERE name = 'buy_request';`);
    push(
      `INSERT INTO buy_requests (id, request_number, user_id, status, amount_poisha, token_units, rate_tokens_per_bdt, payment_method, sender_number, payment_reference, payment_reference_normalized, client_key, reviewed_by, reviewed_at, completed_at, ledger_tx_id, created_at, updated_at) VALUES (${q(id)}, (SELECT value FROM counters WHERE name = 'buy_request'), ${q(user)}, ${q(status)}, ${poisha}, ${units}, 110, 'BKASH_MANUAL', ${q(sender)}, ${q(ref)}, ${q(ref)}, ${q(`seed-${id}`)}, ${status === 'SUBMITTED' ? 'NULL' : "'seed_superadmin'"}, ${status === 'SUBMITTED' ? 'NULL' : t}, ${status === 'COMPLETED' ? t : 'NULL'}, ${q(ledger)}, ${t}, ${t});`,
    );
    const events = status === 'COMPLETED' ? ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'TOKEN_CREDITED', 'COMPLETED'] : status === 'UNDER_REVIEW' ? ['SUBMITTED', 'UNDER_REVIEW'] : ['SUBMITTED'];
    for (const e of events) push(`INSERT INTO finance_request_events (id, request_kind, request_id, status, actor_type, created_at) VALUES (${q(ulid(t))}, 'BUY', ${q(id)}, ${q(e)}, ${e === 'SUBMITTED' ? "'PLAYER'" : "'ADMIN'"}, ${t});`);
  }
  buy({ id: 'seed_buy_1', user: 'seed_player_1', bdt: 100, status: 'COMPLETED', ref: 'SEEDTRX0001' });
  buy({ id: 'seed_buy_2', user: 'seed_player_2', bdt: 250, status: 'SUBMITTED', ref: 'SEEDTRX0002' });
  buy({ id: 'seed_buy_3', user: 'seed_player_4', bdt: 500, status: 'UNDER_REVIEW', ref: 'SEEDTRX0003', sender: '01812345678' });
  push(`INSERT INTO finance_messages (id, request_kind, request_id, sender_type, sender_id, message, created_at) VALUES (${q(ulid(tick()))}, 'BUY', 'seed_buy_3', 'PLAYER', 'seed_player_4', 'Hi, I sent the payment a few minutes ago.', ${clock});`);

  // ---------- sell requests (tokens locked at submission)
  function sell({ id, user, tokens, complete }) {
    const units = T(tokens);
    const poisha = Math.floor(units / 120);
    const lock = tx({ key: `sell:${id}:lock`, type: 'TOKEN_SELL_LOCK', refType: 'SELL_REQUEST', refId: id, by: 'PLAYER', byId: user, postings: [{ from: P(user), to: P(user, 'LOCKED_SELL'), amount: units }], meta: { bdtPoisha: poisha, rateTokensPerBdt: 120 } });
    let resolution = null;
    if (complete) resolution = tx({ key: `sell:${id}:resolution`, type: 'TOKEN_SELL_COMPLETE', refType: 'SELL_REQUEST', refId: id, by: 'ADMIN', byId: 'seed_superadmin', postings: [{ from: P(user, 'LOCKED_SELL'), to: TREASURY, amount: units }], meta: { outgoingReference: `SEEDOUT${id.slice(-1)}` } });
    const t = clock;
    push(`UPDATE counters SET value = value + 1 WHERE name = 'sell_request';`);
    push(
      `INSERT INTO sell_requests (id, request_number, user_id, status, amount_units, bdt_poisha, rate_tokens_per_bdt, payment_method, receiving_number, client_key, lock_tx_id, resolution_tx_id, approved_by, approved_at, payment_amount_poisha, payment_reference, payment_sent_by, payment_sent_at, completed_at, created_at, updated_at) VALUES (${q(id)}, (SELECT value FROM counters WHERE name = 'sell_request'), ${q(user)}, ${complete ? "'COMPLETED'" : "'TOKENS_LOCKED'"}, ${units}, ${poisha}, 120, 'BKASH_MANUAL', '01912345678', ${q(`seed-${id}`)}, ${q(lock)}, ${q(resolution)}, ${complete ? "'seed_superadmin'" : 'NULL'}, ${complete ? t : 'NULL'}, ${complete ? poisha : 'NULL'}, ${complete ? q(`SEEDOUT${id.slice(-1)}`) : 'NULL'}, ${complete ? "'seed_superadmin'" : 'NULL'}, ${complete ? t : 'NULL'}, ${complete ? t : 'NULL'}, ${t}, ${t});`,
    );
    push(`INSERT INTO wallet_holds (id, user_id, bucket, amount, reference_type, reference_id, status, lock_tx_id, release_tx_id, created_at, updated_at) VALUES (${q(ulid(t))}, ${q(user)}, 'LOCKED_SELL', ${units}, 'SELL_REQUEST', ${q(id)}, ${complete ? "'CAPTURED'" : "'ACTIVE'"}, ${q(lock)}, ${q(resolution)}, ${t}, ${t});`);
    for (const e of complete ? ['SUBMITTED', 'TOKENS_LOCKED', 'APPROVED', 'PAYMENT_PROCESSING', 'PAYMENT_SENT', 'COMPLETED'] : ['SUBMITTED', 'TOKENS_LOCKED']) {
      push(`INSERT INTO finance_request_events (id, request_kind, request_id, status, actor_type, created_at) VALUES (${q(ulid(t))}, 'SELL', ${q(id)}, ${q(e)}, 'SYSTEM', ${t});`);
    }
  }
  sell({ id: 'seed_sell_1', user: 'seed_player_5', tokens: 1_200, complete: false });
  sell({ id: 'seed_sell_2', user: 'seed_player_2', tokens: 2_400, complete: true });

  // ---------- one settled match on game-01: player_1 beats player_2 at 1,000 each (1% fee = 20)
  {
    const id = 'seed_match_1';
    const stake = T(1_000);
    const created = tick();
    push(`UPDATE counters SET value = value + 1 WHERE name = 'match';`);
    push(
      `INSERT INTO matches (id, match_number, game_id, creator_id, mode, visibility, stake_units, min_players, max_players, player_count, fee_bps, game_version, status, pot_units, created_at, updated_at) VALUES ('${id}', (SELECT value FROM counters WHERE name = 'match'), 'game-01', 'seed_player_1', 'ROOM', 'PUBLIC', ${stake}, 2, 2, 2, 100, '0.0.0', 'CREATED', ${stake * 2}, ${created}, ${created});`,
    );
    const locks = {};
    for (const [seat, u] of [
      [1, 'seed_player_1'],
      [2, 'seed_player_2'],
    ]) {
      locks[u] = tx({ key: `match:${id}:stake:${u}`, type: 'GAME_STAKE_LOCK', refType: 'MATCH', refId: id, gameId: 'game-01', by: 'PLAYER', byId: u, postings: [{ from: P(u), to: P(u, 'LOCKED_GAME'), amount: stake }] });
      push(`INSERT INTO match_players (id, match_id, user_id, seat, stake_units, stake_bonus_units, stake_available_units, status, result, payout_units, joined_at) VALUES (${q(ulid(clock))}, '${id}', '${u}', ${seat}, ${stake}, 0, ${stake}, 'JOINED', ${seat === 1 ? "'WIN'" : "'LOSS'"}, ${seat === 1 ? T(1_980) : 0}, ${clock});`);
    }
    const fee = T(20);
    const settle = tx({
      key: `match:${id}:resolution`,
      type: 'GAME_WIN_PAYOUT',
      refType: 'MATCH',
      refId: id,
      gameId: 'game-01',
      postings: [
        { from: P('seed_player_2', 'LOCKED_GAME'), to: { system: 'PLATFORM_FEES' }, amount: fee, type: 'PLATFORM_MATCH_FEE' },
        { from: P('seed_player_2', 'LOCKED_GAME'), to: P('seed_player_1'), amount: stake - fee },
        { from: P('seed_player_1', 'LOCKED_GAME'), to: P('seed_player_1'), amount: stake },
      ],
      meta: { outcome: 'WIN', source: 'DEV_SIMULATOR', potUnits: stake * 2, feeUnits: fee, feeBps: 100, payoutUnits: stake * 2 - fee },
    });
    for (const u of ['seed_player_1', 'seed_player_2']) {
      push(`INSERT INTO wallet_holds (id, user_id, bucket, amount, reference_type, reference_id, status, lock_tx_id, release_tx_id, created_at, updated_at) VALUES (${q(ulid(clock))}, '${u}', 'LOCKED_GAME', ${stake}, 'MATCH', '${id}', 'CAPTURED', ${q(locks[u])}, ${q(settle)}, ${clock}, ${clock});`);
    }
    push(
      `UPDATE matches SET status = 'SETTLED', result_type = 'WIN', winner_user_id = 'seed_player_1', fee_units = ${fee}, payout_units = ${stake * 2 - fee}, resolution_tx_id = ${q(settle)}, result_source = 'DEV_SIMULATOR', ready_at = ${created}, started_at = ${created}, ended_at = ${clock}, settled_at = ${clock}, updated_at = ${clock} WHERE id = '${id}';`,
    );
    for (const [type, payload] of [
      ['CREATED', '{}'],
      ['READY', '{}'],
      ['STARTED', '{}'],
      ['SETTLED', JSON.stringify({ outcome: 'WIN', feeUnits: fee })],
    ]) {
      push(`INSERT INTO match_events (id, match_id, type, payload, actor_type, created_at) VALUES (${q(ulid(clock))}, '${id}', '${type}', ${q(payload)}, 'SYSTEM', ${clock});`);
    }
    push(`UPDATE player_stats SET games_played = 1, wins = 1, total_staked_units = ${stake}, total_won_units = ${stake * 2 - fee} WHERE user_id = 'seed_player_1';`);
    push(`UPDATE player_stats SET games_played = 1, losses = 1, total_staked_units = ${stake} WHERE user_id = 'seed_player_2';`);
  }

  // a sample fraud flag (signal only) and a sample notification
  push(
    `INSERT INTO fraud_flags (id, user_id, type, severity, status, details, dedupe_key, created_at, updated_at) VALUES (${q(ulid(tick()))}, 'seed_player_4', 'LARGE_TRANSACTION', 'LOW', 'OPEN', '{"kind":"BUY","note":"seed sample"}', 'seed-flag-1', ${clock}, ${clock});`,
  );
  push(`INSERT INTO notifications (id, user_id, audience, type, title, body, link, created_at) VALUES (${q(ulid(clock))}, 'seed_superadmin', 'ADMIN', 'ADMIN_NEW_BUY_REQUEST', 'New buy request', 'Seed data: a buy request is waiting for review.', '/admin/finance/buy-requests', ${clock});`);

  // final cached balances = sum of ledger entries
  for (const a of touched) push(`UPDATE wallet_accounts SET balance = ${balances.get(a)}, updated_at = ${now} WHERE id = '${a}';`);

  return sql;
}
