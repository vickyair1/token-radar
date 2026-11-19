# Token Radar — how the board is built (model radar-5)

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
  peers to carry its own effect; below that, the model pools its super-category's
  peers, and a category with no poolable peers gets no adjustment.
- **Growth.** The 7-day TVL change enters with its own fitted coefficient
  (0.36), bounded to ±15%: a single week's move is real signal about momentum,
  but it is noisy, and no week should double or halve a launch value.
- **Age.** Tested in every form — a fitted log(age) term, a young-protocol
  indicator, an exponential decay, a log age capped at two years, an
  age-by-size interaction — and every form comes out at zero or makes the
  held-out miss worse, so the value fit carries no age term. The time a
  protocol has run with no token enters the implied value through the launch
  odds, where it is fitted.

## The launch odds

`odds = logistic(log TVL, log age, log chain count, category token rate, kinship)`

Fitted on the 437 protocols of the candidate shape, token or not. It answers
"how often do protocols that look like this one already record a token":
lenders 69% and Dexs 64% usually do; risk curators 27% rarely do. **Kinship**
is new in radar-5: a protocol whose name shares a stem with a protocol that
already records a token — a spin-off, a second product, a renamed sibling —
records one 75% of the time (141 protocols), against 45% without a kin. The
category token rate is shrunk toward the base rate with a prior of 20 (raised
from 10: the backtest shows 20 calls one more protocol right out of sample).
Growth is deliberately **not** an input: fast growth marks the pre-token phase
itself (protocols growing over 5% a week record a token 18% of the time,
against 68% for those shrinking 5–20%), so it would punish exactly the
momentum farmers want. Odds are bounded to 10%–90%: no launch is certain, none
is impossible.

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
ticket or the drop share and every verdict re-computes; the detail view also
shows the net per hour, the 4% T-bill the ticket forgoes over the hold, and the
ticket at which the slice just covers the gas.

## Validation (all out of sample, all on the Model tab)

| Stage | Leave-one-out median miss |
|---|---|
| Flat multiple (median mcap/TVL) | 4.55x |
| Size curve (power law) | 3.04x |
| + Category premium | 2.85x |
| + 7-day momentum (the shipped model) | 2.79x |

- **Time split.** Fit on the 39 live protocols listed before 2024-02-18, price
  the 40 listed after it: median miss 2.30x, 60% within 3x.
- **Odds held out.** Leave-one-out calls 295 of 437 right (68%) against a 55%
  base rate, Brier 0.204; five-fold cross-validation agrees (69%, Brier 0.198).
  Protocols scored near 18% launch about 21% of the time; near 86%, about 83%.
- **Self-check.** The build verifies data.js against board.json row by row:
  197/197 rows agree.

## Features the backtest rejected

Chain count as a value regressor (t = −0.74; the median miss improves a little
but the RMSE and the time split both get worse); a fitted age effect on value
(every form tested, all at zero or worse — see above); kinship in the value fit
(coefficient +0.06, no held-out gain: kinship predicts whether a token exists,
not what it is worth); per-category slopes (held-out miss worse); a piecewise
size curve (held-out miss much worse); growth in the launch odds (real signal,
wrong target — see above).

## Limitations, stated plainly

TVL alone explains about a third of the variance in market caps; the median
launch estimate is still off by a factor of 2.8. The odds model answers "does a
protocol like this one have a token yet", not "will it launch one next month".
The drop share is an assumption, and real drops vary widely.
