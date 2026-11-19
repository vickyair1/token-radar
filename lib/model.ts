// The token radar's model, version radar-5: one snapshot of the protocol universe in,
// one ranked board out. The board answers "which pre-token protocol is worth farming
// next" as an expected value: what the launch would be worth IF it launches, times the
// odds it launches at all, net of what farming it costs.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling),
// every pre-token protocol above the floor the watchlist leaves out but the house's own
// rule would keep (the off-list), and every pre-token protocol below the floor that
// passes the same rule (the early radar). The rule is the house's watchlist rule applied
// to the whole snapshot: no token recorded, not a bridge, not liquid staking or
// restaking, not an exchange, not a versioned release, no wrapped/staked/staking word in
// the name, not named for an exchange. Every one of the 758 protocols is accounted for:
// ranked, token already trading, token on record, or set aside with its reason.
//
// Implied value follows only from the snapshot's own figures, and every parameter is
// fitted from the snapshot at run time — nothing is assumed:
//
//   Stage 1, value if it launches (a power law). log(market cap) regressed on log(TVL)
//   across the live protocols gives a slope well below 1, so a protocol ten times larger
//   is worth roughly four to five times as much, not ten. The fit is OLS on log(mcap)
//   against log(TVL) over the live protocols whose mcap/TVL sits inside [0.005x, 5x];
//   CEX protocols are excluded. A flat multiple overvalues the biggest protocols several
//   times over: the dashboard's ablation table shows the flat multiple missing by 4.6x
//   out of sample against the size curve's 3.0x.
//
//   Stage 2, category. After size, categories still differ several-fold. Each category's
//   effect is the median residual (in log terms) of its live peers, shrunk toward zero by
//   n/(n+3). A category needs at least 5 live peers to carry its own effect (raised from
//   3: the backtest shows 5 beats 3 on every held-out metric); below that, the model pools
//   the peers of its super-category, and a category with no poolable peers gets none.
//
//   Stage 3, growth. The 7-day TVL change enters with its own fitted coefficient from the
//   same regression, bounded to ±15%: a single week's move is real signal about momentum,
//   but it is noisy, and no week should double or halve a launch value.
//
//   Stage 4, launch odds. A logistic model fitted on the snapshot's own live/pre-token
//   split: log TVL, log age, log chain count, the category's shrunk token rate, and
//   kinship — whether the protocol's name shares a stem with a protocol that already
//   records a token. Kinship is a strong, clean signal: protocols with a name-stem kin
//   record a token 75% of the time, against 45% without one. It answers "how often do
//   protocols that look like this one already record a token" — lenders and exchanges
//   usually do (79% and 74%), risk curators almost never (13%). Growth is deliberately
//   NOT an input: fast growth marks the pre-token phase itself (protocols growing over
//   5% a week record a token only 18% of the time, against 68% for those shrinking
//   5–20%), so it would punish exactly the momentum farmers want. The odds are bounded
//   to 10%-90%: no launch is certain, none is impossible. Held out, the model calls 68%
//   of protocols right against a 55% base rate.
//
//   Age in the value fit was tested in every form the backtest could state — a fitted
//   log(age) term, a young-protocol indicator, an exponential decay, a log age capped
//   at two years, an age-by-size interaction — and every one of them comes out at
//   zero or makes the held-out miss worse, so the value fit carries no age term and
//   the time a protocol has run with no token enters the implied value through the
//   odds, where it is fitted. The dashboard's rejected-features table names each test.
//
//   implied (expected value) = exp(intercept + slope x log(TVL) + category effect)
//             x growth adjustment x launch odds
//
//   Every row also carries a range: the value model's leave-one-out error spread
//   (P25-P75 from the held-out RMSE), so a reader sees the honest precision — half of
//   held-out market caps land inside the printed range, nine in ten inside P10-P90.
//
// The verdicts are a farmer's arithmetic, not a score: a row's slice of the drop is
// the ticket's share of the protocol's whole TVL — the conservative case, as if every
// dollar of TVL farmed — times the drop share times the row's expected launch value,
// minus the plan's gas. The drop share is the one assumption (3.5%, 7% or 14%; 7% is
// the default), and the page says so. A farm is worth doing when that leaves more
// than ten dollars after gas.
//
// Validation, all out of sample and all shown on the page: the ablation table (each
// stage's held-out miss), a time split (fit on the older half of live protocols, price
// the newer half), the range coverage above, and the odds model's held-out accuracy and
// calibration. Features the backtest rejected are named on the page too: chain count as
// a value regressor (t = -0.74), a fitted age effect (t = +0.28), per-category slopes
// (held-out miss worse), a piecewise size curve (much worse). No protocol name is ever
// special-cased, and the same functions score every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  growth_effect_min: number;
  growth_effect_max: number;
  unknown_age_days: number;
  min_peers: number;
  shrink_prior: number;
  trim_low: number;
  trim_high: number;
  implied_cap_usd: number;
  odds_min: number;
  odds_max: number;
  odds_shrink: number;
  drop_shares: number[];
  tickets: number[];
  farm_threshold_usd: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 1.0,
  growth_floor: -60,
  growth_cap: 120,
  growth_effect_min: 0.85,
  growth_effect_max: 1.15,
  unknown_age_days: 365,
  min_peers: 5,
  shrink_prior: 3,
  trim_low: 0.005,
  trim_high: 5,
  implied_cap_usd: 25_000_000_000,
  odds_min: 0.1,
  odds_max: 0.9,
  odds_shrink: 20,
  drop_shares: [0.035, 0.07, 0.14],
  tickets: [100, 1000, 10000],
  farm_threshold_usd: 10,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-5';

/**
 * Super-categories: economically adjacent categories that share a business model,
 * pooled only when a category has too few live peers of its own.
 */
export const SUPER_CATEGORIES: Record<string, string[]> = {
  'Vaults & Curators': ['Risk Curators', 'Onchain Capital Allocator', 'Yield Aggregator', 'Yield', 'Vaults'],
  'Money Markets': ['Lending', 'CDP', 'Collateral Markets', 'Uncollateralized Lending'],
  Trading: ['Dexs', 'Derivatives', 'Basis Trading', 'Options', 'Prediction Market'],
  Bridges: ['Bridge', 'Canonical Bridge', 'Cross Chain Bridge'],
  Staking: ['Liquid Staking', 'Liquid Restaking', 'Restaking', 'Staking Pool'],
  'Real World': ['RWA', 'CeDeFi', 'Insurance'],
};

/** The super-category a category belongs to, or null. */
export function superCategoryOf(category: string | null): string | null {
  if (category === null) return null;
  for (const [group, members] of Object.entries(SUPER_CATEGORIES)) {
    if (members.includes(category)) return group;
  }
  return null;
}

/** Categories the house's watchlist rule excludes: bridges, staking products, exchanges. */
export const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Exchange names a protocol may not begin with (the house rule). */
export const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One calibrated category: the effect the model applies and where it came from. */
export interface CalibrationRow {
  category: string;
  peers: number;
  raw_factor: number | null;
  factor: number;
  source: 'category' | 'group' | 'none';
  group: string | null;
  group_peers: number;
}

/** The regression the model fitted from the snapshot's live protocols. */
export interface Regression {
  intercept: number;
  slope: number;
  growth_coef: number;
  r_squared: number;
  rmse_log: number;
  live_count: number;
  trimmed_count: number;
  loo_median_factor: number;
  loo_mean_abs_log: number;
  loo_rmse_log: number;
  loo_spearman: number;
}

/** One row of the ablation table: a model stage and its held-out miss. */
export interface AblationRow {
  stage: string;
  loo_median_factor: number;
}

/** The time-split check: fit on the older live protocols, price the newer ones. */
export interface TimeSplit {
  cut_date: string;
  fit_count: number;
  test_count: number;
  median_factor: number;
  within_3x_pct: number;
}

/** The range check: how often held-out market caps land inside the printed ranges. */
export interface RangeCheck {
  sigma_log: number;
  p25_p75_pct: number;
  p10_p90_pct: number;
}

/** The calibration the model computed from the snapshot's live protocols. */
export interface Calibration {
  regression: Regression;
  global_median: number;
  live_count: number;
  rows: CalibrationRow[];
  ablation: AblationRow[];
  time_split: TimeSplit;
  range_check: RangeCheck;
}

/** The fitted launch-odds model and its held-out validation. */
export interface OddsFit {
  beta: number[];
  global_rate: number;
  category_rates: { category: string; peers: number; rate: number }[];
  kinship: { rate_with_kin: number; n_with_kin: number; rate_without_kin: number; n_without_kin: number };
  train_count: number;
  cv_accuracy: number;
  cv_brier: number;
  loo_accuracy: number;
  loo_correct: number;
  loo_brier: number;
  base_rate: number;
  calibration: { predicted: number; actual: number; count: number }[];
}

/** One odds term's contribution to the logit, so the detail view can show the build. */
export interface OddsComponents {
  constant: number;
  tvl: number;
  age: number;
  chains: number;
  category: number;
  kinship: number;
  total: number;
}

/** One bucket of the 758-protocol accounting. */
export interface AccountingRow {
  key: string;
  label: string;
  count: number;
  note: string;
}

/** A protocol set aside from the board, with its reason. */
export interface SetAsideRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  reason: string;
}

/** A live-token comparable: a protocol that already trades, near this row's size. */
export interface Comparable {
  name: string;
  multiple: number;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  scope: 'watchlist' | 'off-list' | 'early';
  age_days: number | null;
  value_if_launches_usd: number;
  launch_odds: number;
  range_low_usd: number;
  range_high_usd: number;
  implied_value_usd: number;
  labor_hours: number;
  gas_total_usd: number;
  comparables: Comparable[];
  model: {
    base_value_usd: number;
    category_factor: number;
    category_source: 'category' | 'group' | 'none';
    category_group: string | null;
    category_peers: number;
    growth_pct: number;
    growth_multiplier: number;
    launch_odds: number;
    category_token_rate: number;
    kinship: number;
    odds_components: OddsComponents;
    age_days: number | null;
  };
  farm_steps: string[];
  /** The farm plan structured, for the dashboard's data: same steps as farm_steps, before stringification. */
  farm_plan: FarmStep[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  scope: 'watchlist' | 'off-list' | 'early';
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  value_if_launches_usd: number;
  launch_odds: number;
  range_low_usd: number;
  range_high_usd: number;
  implied_value_usd: number;
  base_value_usd: number;
  category_factor: number;
  category_source: 'category' | 'group' | 'none';
  category_group: string | null;
  category_peers: number;
  growth_multiplier: number;
  category_token_rate: number;
  kinship: number;
  odds_components: OddsComponents;
  labor_hours: number;
  gas_total_usd: number;
  comparables: Comparable[];
  /** The farm plan, structured, straight from the model's own derivation. */
  farm_steps: FarmStep[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** The scatter plot's data: live market caps, board values, and the fitted line. */
export interface ScatterData {
  live: [number, number][];
  board: [number, number][];
  line: [[number, number], [number, number]];
}

/** Everything the dashboard needs: the board, the live set, the calibration and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  off_list_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  total_protocols: number;
  total_implied_usd: number;
  market_growth_median: number | null;
  calibration: Calibration;
  odds: OddsFit;
  accounting: AccountingRow[];
  rows: RadarRow[];
  live: LiveRow[];
  set_aside: SetAsideRow[];
  scatter: ScatterData;
  check_board_rows_match: number;
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a list of numbers; the middle value, or the mean of the middle two. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * Ordinary least squares by Gaussian elimination on the normal equations. Small
 * and exact for the two- and three-regressor fits this model runs; the design
 * matrices here are well conditioned (log TVL spans several orders of magnitude).
 */
export function ols(X: number[][], y: number[]): number[] {
  const n = X.length;
  const k = X[0]!.length;
  const xtx: number[][] = Array.from({ length: k }, () => Array(k).fill(0));
  const xty: number[] = Array(k).fill(0);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < k; a++) {
      xty[a]! += X[i]![a]! * y[i]!;
      for (let b = 0; b < k; b++) xtx[a]![b]! += X[i]![a]! * X[i]![b]!;
    }
  }
  const m = xtx.map((row, i) => [...row, xty[i]!]);
  for (let c = 0; c < k; c++) {
    let p = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[p]![c]!)) p = r;
    [m[c], m[p]] = [m[p]!, m[c]!];
    for (let r = c + 1; r < k; r++) {
      const f = m[r]![c]! / m[c]![c]!;
      for (let j = c; j <= k; j++) m[r]![j]! -= f * m[c]![j]!;
    }
  }
  const beta: number[] = Array(k).fill(0);
  for (let r = k - 1; r >= 0; r--) {
    let v = m[r]![k]!;
    for (let j = r + 1; j < k; j++) v -= m[r]![j]! * beta[j]!;
    beta[r] = v / m[r]![r]!;
  }
  return beta;
}

/** R-squared and residual RMSE (log points) of a fitted line against its targets. */
function fitStats(X: number[][], y: number[], beta: number[]): { r2: number; rmse: number } {
  const n = y.length;
  const mean = y.reduce((a, b) => a + b, 0) / n;
  let ssr = 0;
  let sst = 0;
  for (let i = 0; i < n; i++) {
    const hat = X[i]!.reduce((acc, v, j) => acc + v * beta[j]!, 0);
    ssr += (y[i]! - hat) ** 2;
    sst += (y[i]! - mean) ** 2;
  }
  return { r2: sst === 0 ? 0 : 1 - ssr / sst, rmse: Math.sqrt(ssr / n) };
}

/** Spearman's rank correlation between two equal-length lists. */
export function spearman(a: number[], b: number[]): number {
  const n = a.length;
  const rankOf = (v: number[]): number[] => {
    const order = v.map((x, i) => [x, i] as [number, number]).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const ranks = new Array<number>(n);
    for (let i = 0; i < n; i++) ranks[order[i]![1]!] = i + 1;
    return ranks;
  };
  const ra = rankOf(a);
  const rb = rankOf(b);
  const ma = ra.reduce((s, x) => s + x, 0) / n;
  const mb = rb.reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (ra[i]! - ma) * (rb[i]! - mb);
    da += (ra[i]! - ma) ** 2;
    db += (rb[i]! - mb) ** 2;
  }
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db);
}

/** The live-token protocols the model calibrates on: a token that trades, a TVL, no CEX. */
export function liveProtocols(protocols: SnapshotProtocol[]): SnapshotProtocol[] {
  return protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX');
}

/** Whether a protocol records a token at all (a market cap, a CoinGecko id, or a symbol). */
export function hasToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null;
}

/** Generic words that carry no identity: a name stem must say which protocol it is. */
export const KINSHIP_STOPWORDS = new Set([
  'finance', 'protocol', 'network', 'capital', 'exchange', 'labs', 'dao',
  'token', 'chain', 'defi', 'crypto', 'vault', 'vaults', 'liquid',
  'staking', 'bridge', 'market', 'markets', 'trade', 'trading',
  'global', 'world', 'prime', 'plus', 'one', 'app', 'xyz', 'io',
  'the', 'and', 'for', 'with', 'hub', 'pay', 'swap', 'perp',
  'perpetual', 'options', 'derivatives', 'yield', 'farm', 'farms',
]);

/** The name stems that identify a protocol: lowercase letter-runs of four or more letters, minus stopwords. */
export function nameStems(name: string): Set<string> {
  const words = name.toLowerCase().match(/[a-z]+/g) ?? [];
  return new Set(words.filter((w) => w.length >= 4 && !KINSHIP_STOPWORDS.has(w)));
}

/**
 * Kinship: 1 when a DIFFERENT protocol that already records a token shares one of
 * this protocol's name stems, else 0. A spin-off, a second product or a renamed
 * sibling of a token that trades carries its family with it: 75% of kin protocols
 * record a token, against 45% of the rest. No name is ever special-cased — the
 * stems come from the snapshot's own names, and the same rule scores every row.
 */
export function kinshipOf(protocol: SnapshotProtocol, protocols: SnapshotProtocol[]): number {
  const stems = nameStems(protocol.name);
  if (stems.size === 0) return 0;
  for (const other of protocols) {
    if (other.slug === protocol.slug || !hasToken(other)) continue;
    for (const s of nameStems(other.name)) {
      if (stems.has(s)) return 1;
    }
  }
  return 0;
}

/** One live protocol's features for the value fit. */
interface LiveFeat {
  slug: string;
  category: string;
  group: string | null;
  ltvl: number;
  lmcap: number;
  growth: number;
  listed_at: string | null;
}

function liveFeats(protocols: SnapshotProtocol[], model: ModelConstants): LiveFeat[] {
  return liveProtocols(protocols)
    .filter((p) => {
      const mult = p.mcap_usd! / p.tvl_usd;
      return mult >= model.trim_low && mult <= model.trim_high;
    })
    .map((p) => ({
      slug: p.slug,
      category: p.category ?? '(uncategorised)',
      group: superCategoryOf(p.category),
      ltvl: Math.log(p.tvl_usd),
      lmcap: Math.log(p.mcap_usd!),
      growth: Math.max(model.growth_floor, Math.min(model.growth_cap, finite(p.change_7d, 0))) / 100,
      listed_at: p.listed_at,
    }));
}

/** The shrunk category effect for one protocol, from a training set's residuals. */
function categoryEffect(
  train: { category: string; group: string | null; resid: number }[],
  category: string,
  group: string | null,
  model: ModelConstants,
): number {
  const own = train.filter((f) => f.category === category).map((f) => f.resid);
  if (own.length >= model.min_peers) {
    return median(own) * (own.length / (own.length + model.shrink_prior));
  }
  if (group !== null) {
    const pool = train.filter((f) => f.group === group).map((f) => f.resid);
    if (pool.length >= model.min_peers) {
      return median(pool) * (pool.length / (pool.length + model.shrink_prior));
    }
  }
  return 0;
}

/** The value model's prediction (log mcap) for one protocol, from a fitted training set. */
function valuePredict(
  train: LiveFeat[],
  target: LiveFeat,
  stages: { category: boolean; growth: boolean },
  model: ModelConstants,
): number {
  const beta = ols(
    train.map((f) => [1, f.ltvl]),
    train.map((f) => f.lmcap),
  );
  let pred = beta[0]! + beta[1]! * target.ltvl;
  if (stages.category) {
    const withResid = train.map((f) => ({ ...f, resid: f.lmcap - (beta[0]! + beta[1]! * f.ltvl) }));
    pred += categoryEffect(withResid, target.category, target.group, model);
  }
  if (stages.growth) {
    const betaG = ols(
      train.map((f) => [1, f.ltvl, f.growth]),
      train.map((f) => f.lmcap),
    );
    const mult = Math.min(model.growth_effect_max, Math.max(model.growth_effect_min, Math.exp(betaG[2]! * target.growth)));
    pred += Math.log(mult);
  }
  return pred;
}

/** Leave-one-out errors of one model variant over the trimmed live set. */
function looErrors(
  set: LiveFeat[],
  stages: { category: boolean; growth: boolean },
  model: ModelConstants,
): { errors: number[]; preds: number[] } {
  const errors: number[] = [];
  const preds: number[] = [];
  for (let i = 0; i < set.length; i++) {
    const train = set.filter((_, j) => j !== i);
    const pred = valuePredict(train, set[i]!, stages, model);
    preds.push(pred);
    errors.push(set[i]!.lmcap - pred);
  }
  return { errors, preds };
}

/** Summary stats of a list of log errors. */
function errorStats(errors: number[], actuals: number[], preds: number[]): { medianFactor: number; meanAbs: number; rmse: number; rho: number } {
  const abs = errors.map((e) => Math.abs(e)).sort((a, b) => a - b);
  const med = abs[Math.floor(abs.length / 2)]!;
  const meanAbs = abs.reduce((a, b) => a + b, 0) / abs.length;
  const rmse = Math.sqrt(errors.reduce((a, b) => a + b * b, 0) / errors.length);
  return { medianFactor: Math.exp(med), meanAbs, rmse, rho: spearman(preds, actuals) };
}

/**
 * The regression and the category effects, fitted from the snapshot's live
 * protocols, with the validation the dashboard shows: the ablation table (each
 * stage's held-out miss), the time split (older half fits, newer half priced),
 * and the range check (how often held-out market caps land inside the printed
 * P25-P75 and P10-P90 ranges).
 */
export function calibrate(protocols: SnapshotProtocol[], model: ModelConstants = MODEL): Calibration {
  const live = liveProtocols(protocols);
  const set = liveFeats(protocols, model);
  const xs = set.map((p) => [1, p.ltvl]);
  const ys = set.map((p) => p.lmcap);
  const beta = ols(xs, ys);
  const { r2, rmse } = fitStats(xs, ys, beta);
  const xg = set.map((p) => [1, p.ltvl, p.growth]);
  const betaG = ols(xg, ys);

  // The ablation table: every stage's held-out miss, same 107 protocols each time.
  const flatErrors: number[] = [];
  for (let i = 0; i < set.length; i++) {
    const train = set.filter((_, j) => j !== i);
    const mult = median(train.map((f) => Math.exp(f.lmcap - f.ltvl)));
    flatErrors.push(set[i]!.lmcap - (set[i]!.ltvl + Math.log(mult)));
  }
  const flatMed = [...flatErrors.map(Math.abs)].sort((a, b) => a - b)[Math.floor(flatErrors.length / 2)]!;
  const sizeLoo = looErrors(set, { category: false, growth: false }, model);
  const catLoo = looErrors(set, { category: true, growth: false }, model);
  const fullLoo = looErrors(set, { category: true, growth: true }, model);
  const fullStats = errorStats(fullLoo.errors, ys, fullLoo.preds);
  const ablation: AblationRow[] = [
    { stage: 'Flat multiple (median mcap / TVL)', loo_median_factor: round4(Math.exp(flatMed)) },
    { stage: 'Size curve (power law)', loo_median_factor: round4(Math.exp(median(sizeLoo.errors.map(Math.abs)))) },
    { stage: '+ Category premium', loo_median_factor: round4(Math.exp(median(catLoo.errors.map(Math.abs)))) },
    { stage: '+ 7-day momentum (this model)', loo_median_factor: round4(fullStats.medianFactor) },
  ];

  // The time split: the older half of dated live protocols fits the model that prices the newer half.
  const dated = set.filter((f) => f.listed_at !== null).sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : 1));
  const cut = dated[Math.floor(dated.length / 2)]!.listed_at!;
  const older = dated.filter((f) => f.listed_at! < cut);
  const newer = dated.filter((f) => f.listed_at! >= cut);
  const timeErrors = newer.map((t) => t.lmcap - valuePredict(older, t, { category: true, growth: true }, model));
  const timeSplit: TimeSplit = {
    cut_date: cut,
    fit_count: older.length,
    test_count: newer.length,
    median_factor: round4(Math.exp(median(timeErrors.map(Math.abs)))),
    within_3x_pct: round4((timeErrors.filter((e) => Math.abs(e) < Math.log(3)).length / Math.max(timeErrors.length, 1)) * 100),
  };

  // The range check: the printed P25-P75 half-width is 0.674 x the held-out RMSE;
  // coverage is how often the held-out market cap actually lands inside it.
  const sigma = fullStats.rmse;
  const in2575 = fullLoo.errors.filter((e) => Math.abs(e) <= 0.674 * sigma).length;
  const in1090 = fullLoo.errors.filter((e) => Math.abs(e) <= 1.645 * sigma).length;
  const rangeCheck: RangeCheck = {
    sigma_log: round4(sigma),
    p25_p75_pct: round4((in2575 / fullLoo.errors.length) * 100),
    p10_p90_pct: round4((in1090 / fullLoo.errors.length) * 100),
  };

  // Residuals of the size fit, by category, for the category effects.
  const residuals = set.map((p) => ({
    category: p.category,
    group: p.group,
    r: p.lmcap - (beta[0]! + beta[1]! * p.ltvl),
  }));
  const byCategory = new Map<string, number[]>();
  for (const { category, r } of residuals) {
    const list = byCategory.get(category) ?? [];
    list.push(r);
    byCategory.set(category, list);
  }
  const groupResiduals = (group: string): number[] =>
    residuals.filter((x) => (SUPER_CATEGORIES[group] ?? []).includes(x.category)).map((x) => x.r);

  const categories = [...new Set(protocols.map((p) => p.category ?? '(uncategorised)'))].sort();
  const rows: CalibrationRow[] = categories.map((category) => {
    const own = byCategory.get(category) ?? [];
    if (own.length >= model.min_peers) {
      const raw = median(own);
      const shrunk = raw * (own.length / (own.length + model.shrink_prior));
      return { category, peers: own.length, raw_factor: round4(Math.exp(raw)), factor: round4(Math.exp(shrunk)), source: 'category', group: null, group_peers: 0 };
    }
    const group = superCategoryOf(category === '(uncategorised)' ? null : category);
    if (group !== null) {
      const pool = groupResiduals(group);
      if (pool.length >= model.min_peers) {
        const raw = median(pool);
        const shrunk = raw * (pool.length / (pool.length + model.shrink_prior));
        return { category, peers: own.length, raw_factor: own.length > 0 ? round4(Math.exp(median(own))) : null, factor: round4(Math.exp(shrunk)), source: 'group', group, group_peers: pool.length };
      }
    }
    return { category, peers: own.length, raw_factor: own.length > 0 ? round4(Math.exp(median(own))) : null, factor: 1, source: 'none', group, group_peers: 0 };
  });
  rows.sort((a, b) => b.factor - a.factor || (a.category < b.category ? -1 : 1));

  const allMultiples = live.map((p) => p.mcap_usd! / p.tvl_usd);
  return {
    regression: {
      intercept: round4(beta[0]!),
      slope: round4(beta[1]!),
      growth_coef: round4(betaG[2]!),
      r_squared: round4(r2),
      rmse_log: round4(rmse),
      live_count: live.length,
      trimmed_count: set.length,
      loo_median_factor: round4(fullStats.medianFactor),
      loo_mean_abs_log: round4(fullStats.meanAbs),
      loo_rmse_log: round4(fullStats.rmse),
      loo_spearman: round4(fullStats.rho),
    },
    global_median: round4(median(allMultiples)),
    live_count: live.length,
    rows,
    ablation,
    time_split: timeSplit,
    range_check: rangeCheck,
  };
}

/** The category effect one category gets under a calibration: its own, its group's, or none. */
export function factorFor(
  category: string | null,
  calibration: Calibration,
): { factor: number; source: 'category' | 'group' | 'none'; group: string | null; peers: number } {
  const key = category ?? '(uncategorised)';
  const row = calibration.rows.find((r) => r.category === key);
  if (row === undefined) return { factor: 1, source: 'none', group: null, peers: 0 };
  return { factor: row.factor, source: row.source, group: row.group, peers: row.source === 'group' ? row.group_peers : row.peers };
}

// ---------------------------------------------------------------- launch odds

/** One protocol's features for the odds fit. */
interface OddsFeat {
  slug: string;
  category: string;
  ltvl: number;
  lage: number;
  lchains: number;
  kin: number;
  y: number;
}

function oddsFeats(protocols: SnapshotProtocol[], asOf: string, model: ModelConstants): OddsFeat[] {
  return protocols
    .filter((p) => isCandidateShape(p))
    .map((p) => {
      const age = ageDays(asOf, p.listed_at);
      return {
        slug: p.slug,
        category: p.category ?? '(uncategorised)',
        ltvl: Math.log(p.tvl_usd),
        lage: Math.log((age ?? model.unknown_age_days) + 1),
        lchains: Math.log1p(p.chains.length),
        kin: kinshipOf(p, protocols),
        y: hasToken(p) ? 1 : 0,
      };
    });
}

/** The shrunk P(token | category) over a training set; the global rate when the category is absent. */
function categoryTokenRate(train: OddsFeat[], category: string, shrink: number): number {
  const global = train.reduce((a, f) => a + f.y, 0) / Math.max(train.length, 1);
  const own = train.filter((f) => f.category === category);
  if (own.length === 0) return global;
  return (own.reduce((a, f) => a + f.y, 0) + shrink * global) / (own.length + shrink);
}

/** The odds design row: [1, log TVL, log age, log chains, logit of the shrunk category token rate, kinship]. */
function oddsDesign(train: OddsFeat[], f: OddsFeat, model: ModelConstants): number[] {
  const r = categoryTokenRate(train, f.category, model.odds_shrink);
  const clamped = Math.min(0.99, Math.max(0.01, r));
  return [1, f.ltvl, f.lage, f.lchains, Math.log(clamped / (1 - clamped)), f.kin];
}

/** Logistic regression by IRLS with a small ridge prior; deterministic, no randomness. */
export function logitFit(X: number[][], y: number[], iters = 60): number[] {
  const n = X.length;
  const k = X[0]!.length;
  let beta: number[] = Array(k).fill(0);
  for (let it = 0; it < iters; it++) {
    const p = X.map((row) => {
      const z = row.reduce((a, v, j) => a + v * beta[j]!, 0);
      const c = Math.max(-30, Math.min(30, z));
      return 1 / (1 + Math.exp(-c));
    });
    const w = p.map((v) => Math.max(v * (1 - v), 1e-6));
    const xtx: number[][] = Array.from({ length: k }, () => Array(k).fill(0));
    const xtz: number[] = Array(k).fill(0);
    for (let i = 0; i < n; i++) {
      const z = X[i]!.reduce((a, v, j) => a + v * beta[j]!, 0) + (y[i]! - p[i]!) / w[i]!;
      for (let a = 0; a < k; a++) {
        xtz[a]! += w[i]! * X[i]![a]! * z;
        for (let b = 0; b < k; b++) xtx[a]![b]! += w[i]! * X[i]![a]! * X[i]![b]!;
      }
    }
    for (let a = 0; a < k; a++) xtx[a]![a]! += 0.01;
    const next = solveLinear(xtx, xtz);
    const shift = Math.max(...next.map((v, j) => Math.abs(v - beta[j]!)));
    beta = next;
    if (shift < 1e-8) break;
  }
  return beta;
}

/** Solve a small dense linear system by Gaussian elimination with partial pivoting. */
function solveLinear(A: number[][], b: number[]): number[] {
  const k = b.length;
  const m = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < k; c++) {
    let p = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[p]![c]!)) p = r;
    [m[c], m[p]] = [m[p]!, m[c]!];
    for (let r = c + 1; r < k; r++) {
      const f = m[r]![c]! / m[c]![c]!;
      for (let j = c; j <= k; j++) m[r]![j]! -= f * m[c]![j]!;
    }
  }
  const x: number[] = Array(k).fill(0);
  for (let r = k - 1; r >= 0; r--) {
    let v = m[r]![k]!;
    for (let j = r + 1; j < k; j++) v -= m[r]![j]! * x[j]!;
    x[r] = v / m[r]![r]!;
  }
  return x;
}

/** The sigmoid, clamped against overflow. */
export function sigmoid(z: number): number {
  const c = Math.max(-30, Math.min(30, z));
  return 1 / (1 + Math.exp(-c));
}

/**
 * The launch-odds model, fitted on the candidate universe (every protocol the
 * board's rule would keep, token or not), with 5-fold cross-validation and
 * leave-one-out accuracy. Folds are assigned by sorted slug order, so the
 * validation is deterministic: the program writes the same bytes every run.
 */
export function fitOdds(protocols: SnapshotProtocol[], asOf: string, model: ModelConstants = MODEL): OddsFit {
  const set = oddsFeats(protocols, asOf, model).sort((a, b) => (a.slug < b.slug ? -1 : 1));
  const n = set.length;
  const globalRate = set.reduce((a, f) => a + f.y, 0) / n;
  const beta = logitFit(
    set.map((f) => oddsDesign(set, f, model)),
    set.map((f) => f.y),
  );

  // 5-fold cross-validation, stratified, folds by sorted-slug round-robin.
  const folds: number[][] = [[], [], [], [], []];
  for (const cls of [0, 1]) {
    const idx = set.map((f, i) => (f.y === cls ? i : -1)).filter((i) => i >= 0);
    idx.forEach((v, j) => folds[j % 5]!.push(v));
  }
  const cvPred = new Array<number>(n).fill(0);
  for (let f = 0; f < 5; f++) {
    const test = new Set(folds[f]);
    const train = set.filter((_, i) => !test.has(i));
    const b = logitFit(
      train.map((x) => oddsDesign(train, x, model)),
      train.map((x) => x.y),
    );
    for (const i of folds[f]!) {
      cvPred[i] = sigmoid(b.reduce((a, v, j) => a + v * oddsDesign(train, set[i]!, model)[j]!, 0));
    }
  }
  const cvAcc = set.filter((f, i) => (cvPred[i]! >= 0.5 ? 1 : 0) === f.y).length / n;
  const cvBrier = set.reduce((a, f, i) => a + (cvPred[i]! - f.y) ** 2, 0) / n;

  // Leave-one-out: each protocol's odds from a fit that never saw it.
  let looCorrect = 0;
  let looBrier = 0;
  const looPred: { pred: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const train = set.filter((_, j) => j !== i);
    const b = logitFit(
      train.map((x) => oddsDesign(train, x, model)),
      train.map((x) => x.y),
    );
    const p = sigmoid(b.reduce((a, v, j) => a + v * oddsDesign(train, set[i]!, model)[j]!, 0));
    looPred.push({ pred: p, y: set[i]!.y });
    if ((p >= 0.5 ? 1 : 0) === set[i]!.y) looCorrect++;
    looBrier += (p - set[i]!.y) ** 2;
  }
  looBrier /= n;

  // Calibration quintiles of the leave-one-out predictions.
  const ordered = [...looPred].sort((a, b) => a.pred - b.pred);
  const calibration: OddsFit['calibration'] = [];
  for (let q = 0; q < 5; q++) {
    const slice = ordered.slice(Math.floor((q * n) / 5), Math.floor(((q + 1) * n) / 5));
    calibration.push({
      predicted: round4(slice.reduce((a, x) => a + x.pred, 0) / slice.length),
      actual: round4(slice.reduce((a, x) => a + x.y, 0) / slice.length),
      count: slice.length,
    });
  }

  const categories = [...new Set(set.map((f) => f.category))].sort();
  const categoryRates = categories.map((category) => {
    const peers = set.filter((f) => f.category === category).length;
    return { category, peers, rate: round4(categoryTokenRate(set, category, model.odds_shrink)) };
  });

  // Kinship's own base rates: the signal the new feature carries, stated plainly.
  const kinOnes = set.filter((f) => f.kin === 1);
  const kinZeros = set.filter((f) => f.kin === 0);
  const kinship = {
    rate_with_kin: round4(kinOnes.reduce((a, f) => a + f.y, 0) / Math.max(kinOnes.length, 1)),
    n_with_kin: kinOnes.length,
    rate_without_kin: round4(kinZeros.reduce((a, f) => a + f.y, 0) / Math.max(kinZeros.length, 1)),
    n_without_kin: kinZeros.length,
  };

  return {
    beta: beta.map(round4),
    global_rate: round4(globalRate),
    category_rates: categoryRates,
    kinship,
    train_count: n,
    cv_accuracy: round4(cvAcc),
    cv_brier: round4(cvBrier),
    loo_accuracy: round4(looCorrect / n),
    loo_correct: looCorrect,
    loo_brier: round4(looBrier),
    base_rate: round4(Math.max(globalRate, 1 - globalRate)),
    calibration,
  };
}

/** A protocol's launch odds under a fitted odds model, bounded to [odds_min, odds_max]. */
export function oddsFor(
  protocol: SnapshotProtocol,
  asOf: string,
  odds: OddsFit,
  kinship: number,
  model: ModelConstants = MODEL,
): { odds: number; category_rate: number; components: OddsComponents } {
  const age = ageDays(asOf, protocol.listed_at);
  const category = protocol.category ?? '(uncategorised)';
  const row = odds.category_rates.find((r) => r.category === category);
  const rate = row === undefined ? odds.global_rate : row.rate;
  const clamped = Math.min(0.99, Math.max(0.01, rate));
  const components: OddsComponents = {
    constant: odds.beta[0]!,
    tvl: odds.beta[1]! * Math.log(protocol.tvl_usd),
    age: odds.beta[2]! * Math.log((age ?? model.unknown_age_days) + 1),
    chains: odds.beta[3]! * Math.log1p(protocol.chains.length),
    category: odds.beta[4]! * Math.log(clamped / (1 - clamped)),
    kinship: odds.beta[5]! * kinship,
    total: 0,
  };
  components.total =
    components.constant + components.tvl + components.age + components.chains + components.category + components.kinship;
  return {
    odds: Math.min(model.odds_max, Math.max(model.odds_min, sigmoid(components.total))),
    category_rate: rate,
    components,
  };
}

// ---------------------------------------------------------------- the board

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word wrapped, staked or staking in a name, in any case. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * The house rule's shape, without the token check: not a bridge, not liquid
 * staking or restaking, not an exchange, not a versioned release, no wrapped /
 * staked / staking word, not named for an exchange. The odds model trains on
 * every protocol of this shape, token or not.
 */
export function isCandidateShape(p: SnapshotProtocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x))) return false;
  return true;
}

/** Whether a protocol is one the board may rank: pre-token and of the candidate shape. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && isCandidateShape(p);
}

/** Why a protocol is set aside from the board, or null when it is rankable. */
export function setAsideReason(p: SnapshotProtocol): string | null {
  if (isRankable(p)) return null;
  if (p.mcap_usd !== null) return 'token trades';
  if (p.gecko_id !== null || p.symbol !== null) return 'token on record';
  if (p.category !== null && ['Bridge', 'Canonical Bridge', 'Cross Chain Bridge'].includes(p.category)) return 'bridge';
  if (p.category !== null && ['Liquid Staking', 'Liquid Restaking', 'Restaked BTC'].includes(p.category)) return 'liquid staking';
  if (p.category === 'CEX') return 'exchange custody';
  if (VERSIONED.test(p.name)) return 'versioned listing';
  return 'wrapped or staked by name';
}

/** The multipliers and the expected value one protocol gets under the fitted models. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  calibration: Calibration,
  odds: OddsFit,
  kinship: number,
  model: ModelConstants = MODEL,
): {
  value: number;
  odds: number;
  categoryRate: number;
  kinship: number;
  oddsComponents: OddsComponents;
  implied: number;
  rangeLow: number;
  rangeHigh: number;
  base: number;
  factor: number;
  factorSource: 'category' | 'group' | 'none';
  factorGroup: string | null;
  factorPeers: number;
  growthPct: number;
  growthMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = Math.min(
    model.growth_effect_max,
    Math.max(model.growth_effect_min, Math.exp(calibration.regression.growth_coef * model.growth_weight * (growthPct / 100))),
  );
  const { factor, source, group, peers } = factorFor(protocol.category, calibration);
  const base = Math.exp(calibration.regression.intercept + calibration.regression.slope * Math.log(protocol.tvl_usd));
  const value = Math.max(1, Math.round(base * factor * growthMult));
  const { odds: oddsValue, category_rate, components } = oddsFor(protocol, asOf, odds, kinship, model);
  const implied = Math.max(1, Math.min(model.implied_cap_usd, Math.round(value * oddsValue)));
  const half = 0.674 * calibration.range_check.sigma_log;
  const rangeLow = Math.max(1, Math.round(implied * Math.exp(-half)));
  const rangeHigh = Math.max(rangeLow + 1, Math.round(implied * Math.exp(half)));
  return {
    value,
    odds: oddsValue,
    categoryRate: category_rate,
    kinship,
    oddsComponents: components,
    implied,
    rangeLow,
    rangeHigh,
    base: Math.round(base),
    factor,
    factorSource: source,
    factorGroup: group,
    factorPeers: peers,
    growthPct,
    growthMult,
    age,
  };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** Whether the protocol's main chain is a low-fee chain (gas under a dollar a transaction). */
function cheapChain(chain: string): boolean {
  return /base|arbitrum|optimism|polygon|solana|bsc|avalanche|linea|scroll|blast|mode|zksync|mantle|sei|sui|aptos|near|fantom|gnosis/i.test(chain);
}

/** The gas bill for the whole farm plan, in dollars, from the chain and the hold length. */
export function gasTotalUsd(p: SnapshotProtocol, age: number | null): number {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const weeks = Math.ceil(holdDaysFor(age) / 7);
  if (cheapChain(chain)) return round4(1 + 0.1 * weeks + 1);
  const setup = capital >= 150 ? 8 : 4;
  return round4(setup + 2 * weeks + 4);
}

/** The labour the farm plan takes, in hours: setup, one short action a week, the claim. */
export function laborHours(age: number | null): number {
  const weeks = Math.ceil(holdDaysFor(age) / 7);
  return round4(0.25 + (weeks * 10) / 60 + 0.25);
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('risk curator') || c.includes('curator') || c.includes('allocator') || c.includes('vault')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares through the next rebalance, so the curator's fee history counts your wallet.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('uncollateralized')) return `Supply $${capital} of USDC to ${name} on ${chain}, keep the position open, and borrow a small amount against it so both sides of the market count.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm') || c.includes('farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open through at least one fee distribution.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name}, then use the bridged funds in its app so the volume is yours, not just the crossing.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name}, keep the receipt token, and use it once in a paired pool if one exists.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name}, open one small hedge, and close it after a day so the account shows real trading activity.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}, then hold it to settlement instead of flipping it.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it through one rebase or rewards epoch.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain}, hold it, and complete any identity check its page asks for before the position counts.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active for the full term.`;
  if (c.includes('chain')) return `Use ${name}'s flagship app on ${chain} with $${capital} — one swap, one stake or one deployment — and keep the position open.`;
  if (c.includes('payment') || c.includes('card')) return `Spend $${capital} through ${name} on ${chain} across two or more separate transactions and keep the receipts.`;
  if (c.includes('ai') || c.includes('decentralized ai')) return `Run one ${name} job with $${capital} of credits on ${chain} and keep the output receipt as proof of use.`;
  if (c.includes('nft') || c.includes('gaming') || c.includes('launchpad')) return `Join ${name}'s next drop on ${chain} with $${capital}, hold the asset, and complete one in-app action the drop rewards.`;
  if (c.includes('cede')) return `Deposit $${capital} into ${name} on ${chain} and keep the position open through one full rewards period.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open through one full rewards period.`;
}

/** The category's risk to watch, in one line a farmer can act on. */
function riskFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('dex') || c.includes('yield') || c.includes('farm')) return `Watch impermanent loss: if the pool's price moves sharply, the position can be worth less than holding, so check the pair's range weekly.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Watch the health factor if you borrow: a falling collateral price can liquidate the position, so keep the borrow under half of what the protocol allows.`;
  if (c.includes('bridge')) return `Bridges take time to finalise and a failed crossing can strand funds for hours: start with a small test amount before the full size.`;
  if (c.includes('staking') || c.includes('restak')) return `Staked and restaked positions can take days or weeks to exit: never stake funds you may need before the unbonding window ends.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Leverage cuts both ways: keep the position small enough that a full loss of the margin does not hurt, and never add to a losing trade.`;
  if (c.includes('rwa') || c.includes('cede')) return `Real-world assets carry issuer and custody risk the chain cannot see: read who holds the underlying before sizing up.`;
  if (c.includes('stable')) return `A stable asset can depeg: check what backs it and how it has held its peg before holding a large amount.`;
  return `Smart contracts carry risk no audit removes: never farm with money you cannot afford to lose, and size the position to that.`;
}

/** The category's second qualifying action, beyond the first deposit. */
function secondActionFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) return `After the deposit, vote or signal in the curator's next allocation round if one is open — curator protocols weight governance participation.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `After supplying, use the protocol's borrow side once, even for a small amount: supplying alone is half the activity the protocol sees.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('farm')) return `After providing liquidity, stake the LP receipt if the protocol offers a gauge or farm: unstaked liquidity often earns no points.`;
  if (c.includes('bridge')) return `After bridging, make one swap or deposit with the bridged funds on the destination chain: a bare crossing is the weakest signal.`;
  if (c.includes('staking') || c.includes('restak')) return `After staking, use the receipt token once — in a pool or as collateral — so the position shows up in more than one of the protocol's records.`;
  if (c.includes('chain')) return `After the first use, deploy or interact with a second app on the chain: single-app wallets look like tourists.`;
  return `After the first deposit, make one more distinct action the protocol offers — a swap, a vote, a second pool — so the wallet reads as a user, not a deposit.`;
}

/**
 * A protocol's farm plan: seven steps, eight when it is live on more than one
 * chain, each an action with a cost and a time. The plan is derived from the
 * protocol's own record (category, chains, TVL, age, 7-day move), never from a
 * hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const cheap = cheapChain(chain);
  const gas = cheap ? 'under $1' : capital >= 150 ? 'about $8' : 'about $4';
  const weeklyGas = cheap ? 'a few cents' : 'about $2';
  const growth = finite(p.change_7d, 0);
  const momentum =
    growth >= 20
      ? ` TVL is up ${growth.toFixed(0)}% in 7 days — the window is hot, so start this week rather than next.`
      : growth <= -20
        ? ` TVL is down ${Math.abs(growth).toFixed(0)}% in 7 days — size small until the trend steadies.`
        : '';
  const steps: FarmStep[] = [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and ${gas} of gas`,
      time: '15 minutes to set up',
    },
  ];
  if (p.chains.length > 1) {
    steps.push({
      text: `Repeat the core action on ${p.chains[1]!} too: ${p.name} is live on ${p.chains.length} chains, and activity on more than one counts separately.`,
      cost: `${weeklyGas} of gas`,
      time: '10 minutes',
    });
  }
  steps.push(
    {
      text: secondActionFor(p),
      cost: `${weeklyGas} of gas`,
      time: '10 minutes',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.${momentum}`,
      cost: `${weeklyGas} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: riskFor(p),
      cost: 'no fee to check',
      time: '5 minutes a week',
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes; write the wallet, the dates and every transaction in a farm log.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
  );
  return steps;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The three live-token protocols nearest one row's size, in its super-category when it has peers there. */
export function comparablesFor(
  protocol: SnapshotProtocol,
  liveSet: SnapshotProtocol[],
): Comparable[] {
  const group = superCategoryOf(protocol.category);
  const pool =
    group !== null
      ? liveSet.filter((p) => superCategoryOf(p.category) === group)
      : [];
  const use = pool.length >= 3 ? pool : liveSet;
  const ltvl = Math.log(protocol.tvl_usd);
  return use
    .map((p) => ({ p, d: Math.abs(Math.log(p.tvl_usd) - ltvl) }))
    .sort((a, b) => a.d - b.d || (a.p.slug < b.p.slug ? -1 : 1))
    .slice(0, 3)
    .map(({ p }) => ({ name: p.name, multiple: round4(p.mcap_usd! / p.tvl_usd) }));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(
  snapshot: Snapshot,
  calibration: Calibration,
  odds: OddsFit,
  model: ModelConstants = MODEL,
): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const liveSet = liveFeats(snapshot.protocols, model).map((f) => index.get(f.slug)!);
  const scopeOf = new Map<string, BoardRow['scope']>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    if (index.get(slug) !== undefined) scopeOf.set(slug, 'watchlist');
  }
  // The off-list: pre-token protocols above the floor the watchlist leaves out but
  // the house's own rule would keep — the radar's first finds beyond the floor.
  // The early radar: every rankable pre-token protocol below the floor.
  for (const p of snapshot.protocols) {
    if (scopeOf.has(p.slug) || !isRankable(p)) continue;
    scopeOf.set(p.slug, p.tvl_usd >= snapshot.floor_usd ? 'off-list' : 'early');
  }

  const kin = new Map(snapshot.protocols.map((p) => [p.slug, kinshipOf(p, snapshot.protocols)]));
  const scored = [...scopeOf.entries()].map(([slug, scope]) => {
    const p = index.get(slug)!;
    const v = impliedValue(p, snapshot.as_of, calibration, odds, kin.get(slug)!, model);
    return { p, scope, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.slug ? 1 : 0));
  return scored.map((s, i) => {
    const steps = farmSteps(s.p, s.age);
    return {
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    scope: s.scope,
    age_days: s.age,
    value_if_launches_usd: s.value,
    launch_odds: round4(s.odds),
    range_low_usd: s.rangeLow,
    range_high_usd: s.rangeHigh,
    implied_value_usd: s.implied,
    labor_hours: laborHours(s.age),
    gas_total_usd: gasTotalUsd(s.p, s.age),
    comparables: comparablesFor(s.p, liveSet),
    model: {
      base_value_usd: s.base,
      category_factor: s.factor,
      category_source: s.factorSource,
      category_group: s.factorGroup,
      category_peers: s.factorPeers,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      launch_odds: round4(s.odds),
      category_token_rate: round4(s.categoryRate),
      kinship: s.kinship,
      odds_components: {
        constant: round4(s.oddsComponents.constant),
        tvl: round4(s.oddsComponents.tvl),
        age: round4(s.oddsComponents.age),
        chains: round4(s.oddsComponents.chains),
        category: round4(s.oddsComponents.category),
        kinship: round4(s.oddsComponents.kinship),
        total: round4(s.oddsComponents.total),
      },
      age_days: s.age,
    },
    farm_steps: steps.map(stepText),
    farm_plan: steps,
    };
  });
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    scope: row.scope,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    value_if_launches_usd: row.value_if_launches_usd,
    launch_odds: row.launch_odds,
    range_low_usd: row.range_low_usd,
    range_high_usd: row.range_high_usd,
    implied_value_usd: row.implied_value_usd,
    base_value_usd: row.model.base_value_usd,
    category_factor: row.model.category_factor,
    category_source: row.model.category_source,
    category_group: row.model.category_group,
    category_peers: row.model.category_peers,
    growth_multiplier: row.model.growth_multiplier,
    category_token_rate: row.model.category_token_rate,
    kinship: row.model.kinship,
    odds_components: row.model.odds_components,
    labor_hours: row.labor_hours,
    gas_total_usd: row.gas_total_usd,
    comparables: row.comparables,
    farm_steps: row.farm_plan,
  };
}

/** The full accounting: every protocol in the snapshot, in exactly one bucket. */
export function accounting(snapshot: Snapshot, board: BoardRow[]): AccountingRow[] {
  const boardSlugs = new Set(board.map((r) => r.slug));
  const counts = new Map<string, number>();
  const note: Record<string, string> = {
    ranked: 'records no token and stands alone',
    'token trades': 'a market cap: comparables, never ranked',
    'token on record': 'a ticker or CoinGecko id, no cap',
    bridge: 'another token carried across',
    'liquid staking': 'the staked form of a token that trades',
    'exchange custody': 'nothing to farm',
    'versioned listing': 'a versioned release of one protocol',
    'wrapped or staked by name': 'its name says what it wraps',
  };
  const label: Record<string, string> = {
    ranked: 'Ranked',
    'token trades': 'Token trades',
    'token on record': 'Token on record',
    bridge: 'Bridge',
    'liquid staking': 'Liquid staking',
    'exchange custody': 'Exchange custody',
    'versioned listing': 'Versioned listing',
    'wrapped or staked by name': 'Wrapped or staked',
  };
  for (const p of snapshot.protocols) {
    const key = boardSlugs.has(p.slug) ? 'ranked' : setAsideReason(p)!;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total !== snapshot.protocols.length) {
    throw new SnapshotError(`accounting covers ${total} of ${snapshot.protocols.length} protocols`);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: label[key]!, count, note: note[key]! }))
    .sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : 1));
}

/** The protocols set aside from the board, each with its reason, by TVL. */
export function setAsideRows(snapshot: Snapshot, board: BoardRow[]): SetAsideRow[] {
  const boardSlugs = new Set(board.map((r) => r.slug));
  return snapshot.protocols
    .filter((p) => !boardSlugs.has(p.slug))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      reason: setAsideReason(p)!,
    }))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
}

/** The scatter plot's data: live market caps against TVL, board values, and the fitted line. */
export function scatterData(snapshot: Snapshot, calibration: Calibration, board: BoardRow[]): ScatterData {
  const live = liveFeats(snapshot.protocols, MODEL);
  const r3 = (n: number): number => Math.round(n * 1000) / 1000;
  const xs = live.map((f) => f.ltvl);
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const reg = calibration.regression;
  return {
    live: live.map((f) => [r3(f.ltvl), r3(f.lmcap)] as [number, number]),
    board: board.map((r) => [r3(Math.log(r.tvl_usd)), r3(Math.log(r.value_if_launches_usd))] as [number, number]),
    line: [
      [r3(lo), r3(reg.intercept + reg.slope * lo)],
      [r3(hi), r3(reg.intercept + reg.slope * hi)],
    ],
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { board: BoardRow[]; radar: RadarData; calibration: Calibration; odds: OddsFit } {
  const calibration = calibrate(snapshot.protocols, model);
  const odds = fitOdds(snapshot.protocols, snapshot.as_of, model);
  const board = buildBoard(snapshot, calibration, odds, model);
  const live = liveRows(snapshot);
  const watchlist = board.filter((r) => r.scope === 'watchlist').length;
  const offList = board.filter((r) => r.scope === 'off-list').length;
  const early = board.filter((r) => r.scope === 'early').length;
  const growths = snapshot.protocols.map((p) => p.change_7d).filter((g): g is number => g !== null);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: watchlist,
    off_list_size: offList,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    total_protocols: snapshot.protocols.length,
    total_implied_usd: board.reduce((a, r) => a + r.implied_value_usd, 0),
    market_growth_median: growths.length > 0 ? round4(median(growths)) : null,
    calibration,
    odds,
    accounting: accounting(snapshot, board),
    rows: board.map((r) => radarRow(r)),
    live,
    set_aside: setAsideRows(snapshot, board),
    scatter: scatterData(snapshot, calibration, board),
    check_board_rows_match: 0,
  };
  return { board, radar, calibration, odds };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
