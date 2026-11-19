# Token Radar

![bounty](https://make.fun/badge/token-radar-01.svg)
![rank](https://make.fun/badge/token-radar-01/vickyair1/token-radar/rank.svg)
![reward](https://make.fun/badge/token-radar-01/vickyair1/token-radar/reward.svg)

Entry for [make.fun's best token launch radar bounty](https://make.fun/bounty/token-radar-01): a
dashboard that finds the protocols whose token does not exist yet, ranks them by an expected
launch value, and shows a reader how to farm each one.

## The model (radar-4)

`implied = exp(intercept + slope x ln(TVL)) x category factor x growth x launch odds` — an
**expected value, fitted from the snapshot's own protocols**, not a flat multiple:

- **Size is a power law.** Log market cap regressed on log TVL across the snapshot's live
  protocols gives a slope well below 1 (0.65 on this snapshot, R² 0.34): a protocol ten times
  larger is worth roughly four to five times as much, not ten. A flat multiple overvalues the
  biggest protocols several times over. The fit trims mcap/TVL to 0.005x–5x (tokens whose market
  cap has nothing to do with their DeFi TVL are not launch comparables) and excludes CEX.
- **Category effects are shrunk residuals.** After size, each category's factor is the median
  residual of its live peers from the size line, shrunk toward 1 by n/(n+3). A category needs at
  least 5 live peers to carry its own effect; below that it borrows its super-category's pooled
  factor (vaults & curators, money markets, trading, bridges, staking, real world); a category
  with no poolable peers gets no adjustment. Every row names which level calibrated it and how
  many peers stood behind it.
- **Growth** enters with its own fitted coefficient (0.36 on this snapshot), bounded to ±15%:
  a single week's move is real momentum signal, but noisy.
- **Launch odds** come from a logistic model fitted on the snapshot's own live/pre-token split
  (log TVL, log age, log chain count, category token rate): lenders and exchanges usually record
  a token, risk curators almost never. Growth is deliberately not an input — it would punish the
  momentum farmers want. Odds are bounded to 10%–90%.
- **Validation, all out of sample.** Leave-one-out median miss 2.79x (flat multiple 4.55x, size
  curve 3.04x, + category 2.85x); a time split (fit older, price newer) misses by 2.30x; the
  P25–P75 ranges hold 50% of held-out market caps, P10–P90 holds 90%; the odds model calls 65%
  of protocols right against a 55% base rate. That is the honest precision of a launch estimate
  from TVL alone.

The board covers the whole 40-protocol watchlist, 19 off-list protocols above the floor the
watchlist leaves out, and the entire early radar — every rankable pre-token protocol below the
floor (197 rows). Every one of the snapshot's 758 protocols is accounted for: ranked, token
already trading, token on record, or set aside with its reason. Live-token protocols are shown
apart, at the market's own values. Every row carries a farm plan with costs and times, derived
from its own record (category action, second qualifying action, weekly cadence, hold period, and
the category's risk to watch), and a verdict — FARM, THIN or SKIP — from the slice of the drop
a ticket buys against the protocol's whole TVL, net of gas.

## The dashboard

Static, no network: a sortable, filterable board with verdicts and ticket/drop-share controls, a
detail drawer per protocol (value/odds/EV breakdown, comparables, verdict math, farm plan), a
live-token view, a set-aside view, and the model's validation tables with a sandbox that
re-ranks the board under changed constants. `dashboard/MODEL.md` documents the model in full.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```
