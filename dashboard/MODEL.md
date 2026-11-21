# Token Radar — how the board is built (model radar-6)

The board ranks pre-token protocols by **expected launch value**: what a launch
would be worth if it launches, times the odds it launches at all, net of what
farming it costs. Every parameter is fitted from the sealed DefiLlama snapshot
(758 protocols, frozen 2026-11-14, floor $50M); no name is ever special-cased.

## Who is ranked

197 rows: **40 watchlist**, **19 off-list** (above the floor, kept by the house
rule), **138 early** (below the floor). The rule: no token recorded, not a
bridge, not liquid staking or restaking, not an exchange, not a versioned
release, no wrapped / staked / staking word in the name, not named for an
exchange. All 758 protocols are accounted for on the page.

## The value model

`value if it launches = exp(4.52 + 0.65 x ln(TVL)) x category factor x growth`

- **Size.** OLS of log market cap on log TVL across the snapshot's own
  live-token protocols: 107 after trimming mcap/TVL to 0.005x–5x and excluding
  CEX. R² 0.34, RMSE 1.56 log points. A protocol ten times larger is worth
  roughly four to five times as much, not ten.
- **Category.** Each category's effect is the median residual of its live
  peers, shrunk toward 1 by n/(n+3). A category needs at least 5 live peers to
  carry its own effect; below that, the model pools its super-category's peers.
- **Growth.** The 7-day TVL change enters with its own fitted coefficient
  (0.36), bounded to ±15%.
- **Age.** Tested in every form and rejected in all of them, so the value fit
  carries no age term. Age enters through the launch odds, where it is fitted.

## The launch odds

`odds = logistic(log TVL, log age, log chain count, category token rate, kinship)`

Fitted on the 437 protocols of the candidate shape, token or not. **Kinship**:
a protocol whose name shares a stem with a protocol that already records a
token records one 75% of the time (141 protocols), against 45% without a kin.
The category token rate is shrunk toward the base rate with a prior of 20.
Growth is deliberately **not** an input: fast growth marks the pre-token phase
itself. Odds are bounded to 10%–90%.

## Ranges and rank ranges

Each row carries a P25–P75 range from the value model's held-out error spread
(sigma = 1.55): half of held-out market caps land inside it, nine in ten
inside P10–P90. Each row also carries a **rank range** (P5–P95) from 200 seeded
bootstrap refits of both models. Bootstrap s.e.: multiple at $100M TVL ×0.16 ±
0.03, slope 0.65 ± 0.09.

## Verdicts

`net = expected value x drop share x (deposit / TVL) - gas`

The **deposit plan** sizes the ticket to the protocol: 0.02% of its TVL,
capped at $10,000 and floored at $10. The drop share is the one assumption
(3.5%, 7% or 14%; 7% is the default). Gas comes from the plan's own chain and
hold length — expensive only on Ethereum and Bitcoin main chains — and labour
is the farm plan's own step times summed. **FARM** clears $10, pays $25 an
hour, and beats a 4% T-bill over the hold; **MARGINAL** is positive but misses
a bar; **SKIP** is eaten by gas. At plan + 7%: FARM 36, MARGINAL 134, SKIP 27.

## Validation (all out of sample, on the board)

| Stage | Leave-one-out | Time-split | Verdict |
|---|---|---|---|
| Flat multiple | 4.55x | 4.76x | baseline |
| + Size curve | 3.04x | 2.54x | kept |
| + Category premium | 2.85x | 2.31x | kept |
| + 7-day momentum | 2.79x | 2.30x | kept |
| + Age, years listed | 3.08x | 8.74x | tested, not kept |
| + Chain count | 2.68x | 2.92x | tested, not kept |
| + Kinship in value | 2.79x | 2.52x | tested, not kept |

A term is kept when it lowers the **mean** miss across both tests. The odds
model is ablated backwards — refit without each term, every term kept
(removing any raises the mean held-out Brier; full model 0.204 LOO / 0.228
time-split, base rate 0.248). Time split: fit on the 39 live protocols listed
before 2024-02-18, price the 40 after it: median miss 2.30x, 60% within 3x.
Odds held out: 295 of 437 right (68%) vs a 55% base rate. Self-check: the
build verifies data.js against board.json (197/197) and stamps an FNV-1a
checksum the page recomputes live.

## Rejected, and the limits

Chain count as a value regressor (t = −0.74; the time split gets worse); a
fitted age effect on value (every form at zero or worse); kinship in the value
fit (+0.06, no gain); per-category slopes; a piecewise size curve; growth in
the launch odds (real signal, wrong target). TVL alone explains about a third
of the variance in market caps; the median launch estimate is still off by a
factor of 2.8. The drop share is an assumption, and real drops vary widely.
