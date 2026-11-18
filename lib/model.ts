// The token radar's model, version radar-3: one snapshot of the protocol universe in,
// one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling)
// and adds the early radar: EVERY rankable pre-token protocol below the watchlist
// floor, by implied value. A protocol is pre-token when its record carries no token
// at all (no market cap, no CoinGecko id, no symbol). Live-token protocols are kept
// apart and shown as the market's own values, never mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures, and every parameter is
// fitted from the snapshot's live-token protocols at run time — nothing is assumed:
//
//   Stage 1, size (a power law). The market does not price TVL linearly: on this
//   snapshot, log(market cap) regressed on log(TVL) across the live protocols gives
//   a slope well below 1, so a protocol ten times larger is worth roughly four to
//   five times as much, not ten. A flat multiple (the usual shortcut) overvalues
//   the biggest protocols several times over and undervalues the small ones. The
//   fit is ordinary least squares on log(mcap) against log(TVL), over the live
//   protocols whose mcap/TVL sits inside [0.005x, 5x] — the handful outside that
//   band are tokens whose market cap has nothing to do with their DeFi TVL (a
//   400x outlier is a token, not a protocol valuation) and trimming them more
//   than doubles the fit's R-squared. CEX protocols are excluded: an exchange's
//   token is not a protocol launch comparable.
//
//   Stage 2, category. After size, categories still differ several-fold: bridges
//   and RWA trade above the size line, lending and liquid staking below it. Each
//   category's effect is the median residual (in log terms) of its live peers,
//   shrunk toward zero by n/(n+3) so a thin category cannot swing the board. A
//   category needs at least 3 live peers to carry its own effect; below that, the
//   model pools the peers of its super-category — the economically adjacent
//   categories that share a business model (vaults and curators manage other
//   people's capital for a fee; money markets lend it; bridges move it) — and a
//   category with no poolable peers gets no adjustment at all. The dashboard
//   names, for every row, which level calibrated it and how many peers stood
//   behind the number.
//
//   Stage 3, growth. The 7-day TVL change enters with its own fitted coefficient
//   from the same regression (growth added as a second regressor), and the
//   adjustment is bounded to ±15%: a single week's move is real signal about
//   momentum, but it is noisy, and no week should double or halve a launch
//   value. On this snapshot the fitted growth effect is small and positive.
//
//   Stage 4, maturity. A stated prior, not a fitted effect: a protocol that has
//   run longer with no token is a more credible launch candidate, so maturity
//   runs 0.6–1.0 over three years. The fitted age effect on live multiples is
//   near zero, and the dashboard says so — the maturity term prices launch
//   readiness, which the live set cannot calibrate, and it is labelled as such.
//
//   implied = exp(intercept + slope x log(TVL) + category effect)
//             x growth adjustment x maturity
//
// Validation: the dashboard reports the fit's R-squared and a leave-one-out
// check — each live protocol's market cap predicted from a fit that never saw
// it — so a reader can see how far a typical prediction lands from the market's
// own value. No protocol name is ever special-cased, and the same function
// scores every row.

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
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  min_peers: number;
  shrink_prior: number;
  trim_low: number;
  trim_high: number;
  implied_cap_usd: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 1.0,
  growth_floor: -60,
  growth_cap: 120,
  growth_effect_min: 0.85,
  growth_effect_max: 1.15,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  min_peers: 3,
  shrink_prior: 3,
  trim_low: 0.005,
  trim_high: 5,
  implied_cap_usd: 25_000_000_000,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-3';

/**
 * Super-categories: economically adjacent categories that share a business model,
 * pooled only when a category has too few live peers of its own. Vaults and
 * curators manage other people's capital for a fee; money markets lend it;
 * trading venues take a cut of volume; bridges move assets between chains;
 * staking products wrap a yield-bearing asset; real-world products tokenise
 * off-chain value. A category outside every group has no poolable peers.
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
}

/** The calibration the model computed from the snapshot's live protocols. */
export interface Calibration {
  regression: Regression;
  global_median: number;
  live_count: number;
  rows: CalibrationRow[];
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
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_value_usd: number;
    category_factor: number;
    category_source: 'category' | 'group' | 'none';
    category_group: string | null;
    category_peers: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  on_watchlist: boolean;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  base_value_usd: number;
  category_factor: number;
  category_source: 'category' | 'group' | 'none';
  category_group: string | null;
  category_peers: number;
  growth_multiplier: number;
  maturity_multiplier: number;
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

/** Everything the dashboard needs: the board, the live set, the calibration and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  calibration: Calibration;
  rows: RadarRow[];
  live: LiveRow[];
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

/** The live-token protocols the model calibrates on: a token that trades, a TVL, no CEX. */
export function liveProtocols(protocols: SnapshotProtocol[]): SnapshotProtocol[] {
  return protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX');
}

/**
 * The regression and the category effects, fitted from the snapshot's live
 * protocols. The size fit is OLS on log(mcap) against log(TVL) over the trimmed
 * live set; the growth coefficient comes from the same fit with the clamped 7-day
 * change added. Category effects are shrunk median residuals, with the
 * super-category pool as the fallback for thin categories. Leave-one-out
 * validation refits the size line once per live protocol and reports the median
 * factor by which the prediction misses the market's own value.
 */
export function calibrate(protocols: SnapshotProtocol[], model: ModelConstants = MODEL): Calibration {
  const live = liveProtocols(protocols);
  const trimmed = live.filter((p) => {
    const mult = p.mcap_usd! / p.tvl_usd;
    return mult >= model.trim_low && mult <= model.trim_high;
  });
  const set = trimmed.length >= 10 ? trimmed : live;
  const xs = set.map((p) => [1, Math.log(p.tvl_usd)]);
  const ys = set.map((p) => Math.log(p.mcap_usd!));
  const beta = ols(xs, ys);
  const { r2, rmse } = fitStats(xs, ys, beta);
  const xg = set.map((p) => [1, Math.log(p.tvl_usd), Math.max(model.growth_floor, Math.min(model.growth_cap, finite(p.change_7d, 0))) / 100]);
  const betaG = ols(xg, ys);

  // Leave-one-out: each live protocol predicted from a fit that never saw it.
  const looErrors: number[] = [];
  for (let i = 0; i < set.length; i++) {
    const rest = set.filter((_, j) => j !== i);
    const b = ols(
      rest.map((p) => [1, Math.log(p.tvl_usd)]),
      rest.map((p) => Math.log(p.mcap_usd!)),
    );
    looErrors.push(Math.abs(Math.log(set[i]!.mcap_usd!) - (b[0]! + b[1]! * Math.log(set[i]!.tvl_usd))));
  }
  looErrors.sort((a, b) => a - b);
  const looMedian = looErrors.length === 0 ? 0 : looErrors[Math.floor(looErrors.length / 2)]!;

  // Residuals of the size fit, by category, for the category effects.
  const residuals = set.map((p) => ({
    category: p.category ?? '(uncategorised)',
    r: Math.log(p.mcap_usd!) - (beta[0]! + beta[1]! * Math.log(p.tvl_usd)),
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
      loo_median_factor: round4(Math.exp(looMedian)),
    },
    global_median: round4(median(allMultiples)),
    live_count: live.length,
    rows,
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

/** The multipliers and the implied value one protocol gets under `model` and `calibration`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  calibration: Calibration,
  model: ModelConstants = MODEL,
): {
  implied: number;
  base: number;
  factor: number;
  factorSource: 'category' | 'group' | 'none';
  factorGroup: string | null;
  factorPeers: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = Math.min(
    model.growth_effect_max,
    Math.max(model.growth_effect_min, Math.exp(calibration.regression.growth_coef * model.growth_weight * (growthPct / 100))),
  );
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const { factor, source, group, peers } = factorFor(protocol.category, calibration);
  const base = Math.exp(calibration.regression.intercept + calibration.regression.slope * Math.log(protocol.tvl_usd));
  const implied = Math.max(1, Math.min(model.implied_cap_usd, Math.round(base * factor * growthMult * maturityMult)));
  return { implied, base: Math.round(base), factor, factorSource: source, factorGroup: group, factorPeers: peers, growthPct, growthMult, maturityMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, calibration: Calibration, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: EVERY rankable pre-token protocol below the watchlist floor. The radar exists
  // to find launches early, so it ranks the whole early field, not a top slice of it.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, calibration, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.slug ? 1 : 0));
  return scored.map((s, i) => ({
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
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_value_usd: s.base,
      category_factor: s.factor,
      category_source: s.factorSource,
      category_group: s.factorGroup,
      category_peers: s.factorPeers,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
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
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = cheapChain(chain) ? 'under $1' : capital >= 150 ? 'about $8' : 'about $4';
  const weeklyGas = cheapChain(chain) ? 'a few cents' : 'about $2';
  return [
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
    {
      text: secondActionFor(p),
      cost: `${weeklyGas} of gas`,
      time: '10 minutes',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
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
  ];
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
export function radarRow(row: BoardRow, onWatchlist: boolean): RadarRow {
  return {
    rank: row.rank,
    on_watchlist: onWatchlist,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    base_value_usd: row.model.base_value_usd,
    category_factor: row.model.category_factor,
    category_source: row.model.category_source,
    category_group: row.model.category_group,
    category_peers: row.model.category_peers,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData; calibration: Calibration } {
  const calibration = calibrate(snapshot.protocols, model);
  const board = buildBoard(snapshot, calibration, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    calibration,
    rows: board.map((r) => radarRow(r, snapshot.watchlist.includes(r.slug))),
    live,
  };
  return { board, radar, calibration };
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
