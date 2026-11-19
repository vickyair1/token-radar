# Token Radar — how the board is built (model radar-4)

The board ranks pre-token protocols by **expected launch value**: what a launch
would be worth if it launches, times the odds it launches at all, net of what
farming it costs. Every parameter is fitted from the sealed DefiLlama snapshot
itself (758 protocols, frozen 2026-11-14, floor $50M); no protocol name is ever
special-cased, and the same functions score every row.

## Who is ranked

The watchlist is the floor, never a ceiling. The board carries 197 rows:

- **40 watchlist** — every slug the snapshot's watchlist names.
- **19 off-list** — pre-token protocols above the $50M floor the watchlist leaves
  out but the house's own rule would keep (the radar's first finds beyond the floor).
- **138 early** — every rankable pre-token protocol below the floor.

The rule is the house's watchlist rule applied to the whole snapshot: no token
recorded, not a bridge, not liquid staking or restaking, not an exchange, not a
versioned release, no wrapped / staked / staking word in the name, not named for
an exchange. All 758 protocols are accounted for — ranked (197), token trading
(144), token on record (272), or set aside with its reason (bridge 44, liquid
staking 43, exchange custody 42, versioned 11, wrapped or staked 5).

## The value model

`value if it launches = exp(4.52 + 0.65 x ln(TVL)) x category factor x growth`

- **Size.** An ordinary least-squares regression of log market cap on log TVL
  across the snapshot's own live-token protocols: 107 protocols after trimming
  mcap/TVL to 0.005x–5x and excluding CEX. R² 0.34, residual RMSE 1.56 log
  points. The slope is well below 1: a protocol ten times larger is worth
  roughly four to five times as much, not ten. A flat multiple overvalues the
  biggest protocols several times over — the ablation table shows it missing by
  4.6x out of sample against the size curve's 3.0x.
- **Category.** Each category's effect is the median residual (in log terms) of
  its live peers, shrunk toward 1 by n/(n+3). A category needs at least 5 live
  peers to carry its own effect (raised from 3: the backtest shows 5 beats 3 on
  every held-out metric); below that, the model pools its super-category's
  peers, and a category with no poolable peers gets no adjustment.
- **Growth.** The 7-day TVL change enters with its own fitted coefficient
  (0.36), bounded to ±15%: a single week's move is real signal about momentum,
  but it is noisy, and no week should double or halve a launch value.

## The launch odds

`odds = logistic(log TVL, log age, log chain count, category token rate)`

Fitted on the 437 protocols of the candidate shape, token or not. It answers
"how often do protocols that look like this one already record a token":
lenders 79% and Dexs 74% usually do; risk curators 13% almost never. Growth is
deliberately **not** an input: fast growth marks the pre-token phase itself
(points programs inflate it), so it would punish exactly the momentum farmers
want. Odds are bounded to 10%–90%: no launch is certain, none is impossible.

## Ranges

Each row carries a P25–P75 range from the value model's held-out error spread
(sigma = 1.55 log points). Half of held-out market caps land inside the printed
range, nine in ten inside P10–P90. The range covers value uncertainty only —
the odds are a separate number, shown beside it.

## Verdicts

A verdict is a farmer's arithmetic, not a score:

`net = expected value x drop share x (ticket / TVL) - gas`

The slice is the ticket's share of the protocol's whole TVL — the conservative
case, as if every dollar of TVL farmed. The drop share is the one assumption
(3.5%, 7% or 14%; 7% is the default), and the page says so. Gas comes from the
plan's own chain and hold length; labour is 0.25h setup, 10 minutes a week, and
0.25h to claim. **FARM** means more than $10 after gas, **THIN** means positive
but under $10, **SKIP** means the gas costs more than the slice. Change the
ticket or the drop share and every verdict re-computes.

## Validation (all out of sample, all on the Model tab)

| Stage | Leave-one-out median miss |
|---|---|
| Flat multiple (median mcap/TVL) | 4.55x |
| Size curve (power law) | 3.04x |
| + Category premium | 2.85x |
| + 7-day momentum (the shipped model) | 2.79x |

- **Time split.** Fit on the 39 live protocols listed before 2024-02-18, price
  the 40 listed after it: median miss 2.30x, 60% within 3x.
- **Odds held out.** Leave-one-out calls 285 of 437 right (65%) against a 55%
  base rate, Brier 0.218. Protocols scored near 20% launch about 21% of the
  time; near 83%, about 76%.
- **Self-check.** The build verifies data.js against board.json row by row:
  197/197 rows agree.

## Features the backtest rejected

Chain count as a value regressor (t = −0.74, no paired held-out gain); a fitted
age effect on value (t = +0.28 — age enters the launch odds instead, where it
is fitted); per-category slopes (held-out miss worse); a piecewise size curve
(held-out miss much worse); growth in the launch odds (looks better out of
sample, but the coefficient is a young-protocol artifact).

## Limitations, stated plainly

TVL alone explains about a third of the variance in market caps; the median
launch estimate is still off by a factor of 2.8. The odds model answers "does a
protocol like this one have a token yet", not "will it launch one next month".
The drop share is an assumption, and real drops vary widely.
