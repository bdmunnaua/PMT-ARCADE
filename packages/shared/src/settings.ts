import { z } from 'zod';
import { isArbitrageSafe } from './exchange';
import { MAX_MATCH_FEE_BPS } from './fees';
import { PAYMENT_METHODS } from './enums';

/**
 * Platform settings. Stored as one row per key in `platform_settings` (JSON value).
 * Units:
 *   *_bdt     → whole taka
 *   *_tokens  → whole TOKEN
 *   MATCH_FEE_BPS → basis points (100 = 1%)
 *   *_TOKENS_PER_BDT → integer tokens per ৳1
 */
export const settingsSchema = z.object({
  platform_name: z.string().trim().min(1).max(60),
  maintenance_mode: z.boolean(),
  MATCH_FEE_BPS: z.int().min(0).max(MAX_MATCH_FEE_BPS),
  BUY_TOKENS_PER_BDT: z.int().min(1).max(1_000_000),
  SELL_TOKENS_PER_BDT: z.int().min(1).max(1_000_000),
  minimum_buy_bdt: z.int().min(1).max(10_000_000),
  maximum_buy_bdt: z.int().min(1).max(10_000_000),
  minimum_sell_tokens: z.int().min(1).max(1_000_000_000),
  maximum_sell_tokens: z.int().min(1).max(1_000_000_000),
  minimum_match_stake: z.int().min(1).max(1_000_000_000),
  maximum_match_stake: z.int().min(1).max(1_000_000_000),
  buy_requests_enabled: z.boolean(),
  sell_requests_enabled: z.boolean(),
  games_enabled: z.boolean(),
  enabled_payment_methods: z.array(z.enum(PAYMENT_METHODS)).max(PAYMENT_METHODS.length),
  bkash_receiving_number: z.string().trim().max(20),
  payment_provider_notice: z.string().trim().max(2000),
  large_transaction_tokens: z.int().min(1).max(1_000_000_000),
  /** Aviator: highest multiplier a round can reach (×100; 10000 = 100.00×) */
  crash_max_multiplier_x100: z.int().min(200).max(1_000_000),
  /** Aviator: largest profit one bet can win, in whole tokens (protects the house bankroll) */
  crash_max_profit_tokens: z.int().min(1).max(1_000_000_000),
  /** PMT sell-backs must fit in the taka reserve (keep on: the owner never pays sellers out of pocket) */
  reserve_guard_enabled: z.boolean(),
  /** players can send PMT to each other (bought or won PMT only, never bonus) */
  transfers_enabled: z.boolean(),
  /** fee kept by the platform on each transfer, in basis points (100 = 1%) */
  transfer_fee_bps: z.int().min(0).max(1_000),
  minimum_transfer_tokens: z.int().min(1).max(1_000_000_000),
  /** most one player can send in 24 hours, in whole PMT */
  daily_transfer_limit_tokens: z.int().min(1).max(1_000_000_000),
  /** free arcade games earn bonus PMT from the rewards pool */
  arcade_enabled: z.boolean(),
  /** most bonus PMT one player can earn from free games per day (Bangladesh time) */
  arcade_daily_cap_tokens: z.int().min(0).max(1_000_000_000),
  arcade_welcome_bonus_tokens: z.int().min(0).max(1_000_000_000),
  /** paid to the inviter once the invited friend has earned arcade_referral_unlock_tokens from games */
  arcade_referral_bonus_tokens: z.int().min(0).max(1_000_000_000),
  arcade_referral_welcome_tokens: z.int().min(0).max(1_000_000_000),
  arcade_referral_unlock_tokens: z.int().min(0).max(1_000_000_000),
  /** weekly free-game tournament (prizes are bonus PMT from the rewards pool) */
  tournament_enabled: z.boolean(),
  /** prize per place in whole PMT: [1st, 2nd, …] — at most 20 places */
  tournament_prizes_tokens: z.array(z.int().min(0).max(100_000_000)).max(20),
  /** PMT on BNB Chain: withdraw to a player's own wallet (admin approves each payout) */
  onchain_withdrawals_enabled: z.boolean(),
  /** PMT on BNB Chain: deposit back (credited as bonus before the public launch) */
  onchain_deposits_enabled: z.boolean(),
  onchain_min_withdraw_tokens: z.int().min(1).max(1_000_000_000),
  /** kept from each withdrawal to pay the BNB network cost */
  onchain_withdraw_fee_tokens: z.int().min(0).max(1_000_000_000),
  onchain_min_deposit_tokens: z.int().min(1).max(1_000_000_000),
  /** blocks a deposit must be buried under before it is credited */
  onchain_confirmations: z.int().min(1).max(500),
});

export type PlatformSettings = z.infer<typeof settingsSchema>;
export type SettingKey = keyof PlatformSettings;
export const SETTING_KEYS = Object.keys(settingsSchema.shape) as SettingKey[];

export const DEFAULT_SETTINGS: PlatformSettings = {
  platform_name: 'PMT Arcade',
  maintenance_mode: false,
  MATCH_FEE_BPS: 100,
  BUY_TOKENS_PER_BDT: 1000,
  SELL_TOKENS_PER_BDT: 1100,
  minimum_buy_bdt: 100,
  maximum_buy_bdt: 50_000,
  minimum_sell_tokens: 110_000,
  maximum_sell_tokens: 55_000_000,
  minimum_match_stake: 5_000,
  maximum_match_stake: 10_000_000,
  buy_requests_enabled: true,
  sell_requests_enabled: true,
  games_enabled: true,
  enabled_payment_methods: ['BKASH_MANUAL'],
  bkash_receiving_number: '',
  payment_provider_notice:
    'Send the exact amount from your own bKash account, then submit the transaction ID. Never share your bKash PIN or OTP with anyone — we will never ask for it.',
  large_transaction_tokens: 10_000_000,
  crash_max_multiplier_x100: 10_000,
  crash_max_profit_tokens: 1_000_000,
  reserve_guard_enabled: true,
  transfers_enabled: true,
  transfer_fee_bps: 100,
  minimum_transfer_tokens: 1_000,
  daily_transfer_limit_tokens: 10_000_000,
  arcade_enabled: true,
  arcade_daily_cap_tokens: 1_000,
  arcade_welcome_bonus_tokens: 50,
  arcade_referral_bonus_tokens: 300,
  arcade_referral_welcome_tokens: 100,
  arcade_referral_unlock_tokens: 500,
  tournament_enabled: true,
  tournament_prizes_tokens: [20_000, 10_000, 5_000, 3_000, 2_000, 1_000, 1_000, 1_000, 1_000, 1_000],
  onchain_withdrawals_enabled: false,
  onchain_deposits_enabled: false,
  onchain_min_withdraw_tokens: 100_000,
  onchain_withdraw_fee_tokens: 5_000,
  onchain_min_deposit_tokens: 1_000,
  onchain_confirmations: 15,
};

export const settingsPatchSchema = settingsSchema.partial().strict();
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export interface SettingsCheck {
  errors: string[];
  warnings: string[];
}

/** Cross-field rules. In production any error refuses the configuration. */
export function checkSettings(s: PlatformSettings, isProduction: boolean): SettingsCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isArbitrageSafe(s.BUY_TOKENS_PER_BDT, s.SELL_TOKENS_PER_BDT)) {
    const msg = `SELL_TOKENS_PER_BDT (${s.SELL_TOKENS_PER_BDT}) must be greater than BUY_TOKENS_PER_BDT (${s.BUY_TOKENS_PER_BDT}); otherwise buying and selling back creates free money.`;
    if (isProduction) errors.push(msg);
    else warnings.push(`${msg} Allowed only because this is not production.`);
  }
  if (s.minimum_buy_bdt > s.maximum_buy_bdt) errors.push('minimum_buy_bdt must not exceed maximum_buy_bdt.');
  if (s.minimum_sell_tokens > s.maximum_sell_tokens) errors.push('minimum_sell_tokens must not exceed maximum_sell_tokens.');
  if (s.minimum_match_stake > s.maximum_match_stake) errors.push('minimum_match_stake must not exceed maximum_match_stake.');
  if (s.MATCH_FEE_BPS > 500) warnings.push('Match fee is above 5%.');
  if (s.enabled_payment_methods.includes('BKASH_MANUAL') && !s.bkash_receiving_number) {
    warnings.push('bKash is enabled but no bkash_receiving_number is set; players will not know where to send money.');
  }
  return { errors, warnings };
}
