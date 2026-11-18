# Token Radar

![bounty](https://make.fun/badge/token-radar-01.svg)
![rank](https://make.fun/badge/token-radar-01/vickyair1/token-radar/rank.svg)
![reward](https://make.fun/badge/token-radar-01/vickyair1/token-radar/reward.svg)

Entry for [make.fun's best token launch radar bounty](https://make.fun/bounty/token-radar-01): a
dashboard that finds the protocols whose token does not exist yet, ranks them by an implied value,
and shows a reader how to farm each one.

## The model (radar-3)

`implied = exp(intercept + slope x ln(TVL)) x category factor x growth x maturity` — a
**regression fitted from the snapshot's own live-token protocols**, not a flat multiple:

- **Size is a power law.** Log market cap regressed on log TVL across the snapshot's live
  protocols gives a slope well below 1 (0.65 on this snapshot, R² 0.34): a protocol ten times
  larger is worth roughly four to five times as much, not ten. A flat multiple overvalues the
  biggest protocols several times over. The fit trims mcap/TVL to 0.005x–5x (tokens whose market
  cap has nothing to do with their DeFi TVL are not launch comparables) and excludes CEX.
- **Category effects are shrunk residuals.** After size, each category's factor is the median
  residual of its live peers from the size line, shrunk toward 1 by n/(n+3). A category with
  fewer than 3 live peers borrows its super-category's pooled factor (vaults & curators, money
  markets, trading, bridges, staking, real world); a category with no poolable peers gets no
  adjustment. Every row names which level calibrated it and how many peers stood behind it.
- **Growth** enters with its own fitted coefficient (0.36 on this snapshot), bounded to ±15%:
  a single week's move is real momentum signal, but noisy. **Maturity** (0.6–1.0 over three years
  running with no token) is a stated prior about launch readiness, not a fitted effect — the live
  set shows almost no age pattern, and the model says so.
- **Validation.** Leave-one-out: each live protocol predicted from a fit that never saw it lands
  within 3.0x of its actual market cap at the median. That is the honest precision of a launch
  estimate from TVL alone.

The board covers the whole 40-protocol watchlist plus the entire early radar — every rankable
pre-token protocol below the floor (226 rows). Live-token protocols are shown apart, at the
market's own values. Every row carries a seven-step farm plan with costs and times, derived from
its own record (category action, second qualifying action, weekly cadence, hold period, and the
category's risk to watch).

## The dashboard

Static, no network: a sortable, filterable board, a detail drawer per protocol (regression
breakdown + farm plan), a live-token view, and the model's calibration table with a sandbox that
re-ranks the board under changed constants.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```
