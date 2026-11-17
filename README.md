# Token Radar

![bounty](https://make.fun/badge/token-radar-01.svg)
![rank](https://make.fun/badge/token-radar-01/vickyair1/token-radar/rank.svg)
![reward](https://make.fun/badge/token-radar-01/vickyair1/token-radar/reward.svg)

Entry for [make.fun's best token launch radar bounty](https://make.fun/bounty/token-radar-01): a
dashboard that finds the protocols whose token does not exist yet, ranks them by an implied value,
and shows a reader how to farm each one.

## The model (radar-2)

`implied = TVL x multiple x growth x maturity`, where the multiple is **calibrated from the
snapshot's own live-token protocols** instead of assumed flat:

- Each category's multiple is the median mcap/TVL of its live-token peers, shrunk toward the
  global median with a prior of 4, capped at 1.0x. Categories with fewer than 3 live peers use the
  global median — one or two observations cannot calibrate a category.
- Growth is the 7-day TVL change, clamped to -60…+120%, at half weight. Maturity runs 0.6–1.0 over
  three years of running with no token.
- The snapshot's live set shows the market does not price every category alike (median mcap/TVL
  from 0.04x for Liquid Staking to 1.22x for Cross Chain Bridge, global median 0.20x), so a flat
  multiple misprices both ends by several times. Chain count and age showed no pattern against
  mcap/TVL, so the model takes no chain factor.

The board covers the whole 40-protocol watchlist plus a 160-row early radar of pre-token protocols
below the floor. Live-token protocols are shown apart, at the market's own values. Every row carries
a six-step farm plan with costs and times, derived from its own record.

## The dashboard

Static, no network: a sortable, filterable board, a detail drawer per protocol (model breakdown +
farm plan), a live-token view, and the model's calibration table with a sandbox that re-ranks the
board under changed constants.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```
