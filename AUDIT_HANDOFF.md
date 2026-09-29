# Audit handoff — code word: **SATY-GEX-RESUME-3**

Paused mid-way through the third indicator audit round (2026-09-29, UTC ~04:00) so it can continue in a
new session with network access. **This file and `audit/` are working material: delete both before the
final merge to `main`** (unless the owner asks to keep the harness).

## The request being worked (round 3, verbatim scope)
Deep-audit all included indicators for a correct, fully native conversion. Include: Saty ATR Levels (Day
only), Saty Pivot Ribbon/EMAs, Market Structure, VWAP, Volume, RSI, MACD, ADX, GEX, any other chart
indicator. Exclude: Scanner, non-Day Saty modes. Zero Pine in production (Pine may only reference intended
behaviour). Verify formulas/inputs/defaults/timeframes/sessions/lookbacks/smoothing/realtime/state/rendering
end-to-end. Verify GEX live updates mathematically and fix. Validate SPY QQQ AAPL MSFT GOOGL AMZN NVDA META
TSLA × 5m 10m 1H 4H 1D 1W; real data wherever available, synthetic clearly labelled. Compare against
independent/reference definitions. Fix confirmed issues, remove obsolete logic, regression-test. No guesses.
Commit and merge after tests pass; verify branch/worktree clean and up to date. Do not deploy. Report:
indicator status, no-Pine status, issues/fixes, validation coverage, test results, remaining limitations.

## State of the code
- `main` = `b2f2ee2` (rounds 1–2 merged via isaiahomg/SWAGINO#1).
- Branch `claude/magical-mccarthy-8ydvz4` carries the round-3 WIP commit (this one). **Not merged.**

### Round-3 changes in the WIP commit (all in `swagino.html`)
1. **GEX live updates (confirmed bug, fixed).** Quote ticks used to add a per-contract delta onto a board whose
   other contracts stayed valued at older spots/times. Now each tick only re-solves that contract's IV
   (`gexQuoteIV`), and every throttled re-render rebuilds ALL contracts at the current spot/T (`gexRebuild`),
   for both boards. Obsolete `lastVal` delta bookkeeping removed. Evidence: real SPY 2026-09-29 chain replay —
   old net GEX off up to 4x (-488M vs -123M), top magnet/air pocket on wrong strikes; in-app end-to-end test
   (`audit/t_gexlive.js`): new board matches definition to 4.8e-7 of board, old off (net -448.7M vs -240.9M).
2. **Saty Pivot Ribbon realtime (confirmed vs published source, fixed).** Source
   (github.com/satymahajan/saty_pivot_ribbon, v5): each EMA = `request.security(..., ta.ema(src,len)[barstate.isrealtime ? 1 : 0], lookahead_off)`.
   The FORMING bar now repeats the previous bar's EMA for fast/pivot/slow/fast-conv/slow-conv (clouds and
   arrows follow); finished bars show their own EMA. Obsolete tick-stepping of ribbon lines/clouds removed
   (only Candle Bias still steps; bias is not in the public v5 source). Warp (D/W/M/Y and intraday) unchanged.
3. **`lastBarForming(tf,last)`** helper (bucket end clamped to that day's session close; D = regular close;
   W = close of the week's last trading day). Used by the ribbon AND by BOS/CHoCH's closed-bar test (which
   previously kept today's D bar "open" until midnight and the W bar open all weekend).
4. **No-Pine:** `taRma`→`wilderRma`, `taStdev`→`popStdev`; every "Pine"/"ported verbatim" comment reworded to
   reference intended behaviour only; user-visible VWAP hint and log line reworded. `grep -i pine swagino.html`
   → 0 hits. `rsiTV` is a persisted settings-migration key (TradingView, not Pine) — deliberately kept.
5. **Saty ATR Levels default `levelSize` 1 → 2** (published source `level_size = input(2, ...)`; the app comment
   claimed source-verbatim defaults). Only affects fresh configs. ATR length auto-fit (fallback 5) is a
   documented deliberate deviation from the source's fixed 14 — kept.
6. Stale comment about non-existent "EMA 8/21/34 overlays" removed.

### Verified on the WIP code so far
- Pine scan: 0 identifiers/strings/comments with "pine"; vendored LWC 4.2.3 identical to npm package (CRLF-only diff).
- Full dump + independent Python verifier (`audit/dump.js` + `audit/verify.py`), REAL Tradier daily for the 9
  symbols, synthetic intraday: **7,014,044 checks, 0 failures, 0 app errors**, incl. new checks: ribbon forming
  rule on all 6 TFs, institutional Ceiling/Floor volume profile (18/18).
- GEX live end-to-end (`audit/t_gexlive.js`): pass (numbers above).
- Tick replay trial with the clock following the tape (`audit/t_tick.js new QQQ 5 sma`): 241 ticks, 9,640
  comparisons, 0 mismatches; ribbon never moved within a forming bar (241/241).

### Still TO DO before merge
1. Full tick-replay regression (last round's matrix):
   `DRIFT=0|1 node t_tick.js new <SYM> 5,10,60,240,D,W sma,bb,rsiOff` for QQQ/TSLA/NVDA, plus
   `DRIFT=1 DSIGN=-1 node t_tick.js new <SYM> 5,60,D ema` (shard per symbol; ~1 h on 4 cores).
2. Re-run: `t_pure.js QQQ,TSLA,LOWP` (stamps/warp/Saty), `t_render.js` (60 renders), `t_prec.js`, `t_race.js new 6`,
   `t_rt.js`, `gex_real.js`, `ncdf3.js`, lint diff (`audit/lint/*.mjs`, compare vs `site/old`), `pinescan.js`, `pineid.js`.
3. If network now allows `api.tradier.com` AND a Tradier token is available: re-validate intraday (5m/10m/1H/4H)
   on REAL timesales instead of synthetic (mock.js currently synthesises intraday). Otherwise report intraday
   as synthetic-only.
4. Optional (was being considered, NOT confirmed, do not change without evidence): Pine `lookahead_off`
   historical placement for Time Warp (TradingView docs were unreachable); Saty Day `range %` source uses an
   extended-session daily series (`session=session.extended`) vs the app's regular-session Tradier daily.
5. Delete `AUDIT_HANDOFF.md` and `audit/`, commit, push, open PR to `main`, merge, then verify local/remote
   branch and worktree are clean and `main` == merged head. **Do not deploy.**

## How to run the harness
```bash
S=/tmp/audit; mkdir -p $S/site/new $S/site/old $S/real && cp -r audit/* $S/
for d in new old; do ln -sfn "$PWD/vendor" $S/site/$d/vendor; ln -sfn "$PWD/assets" $S/site/$d/assets; ln -sfn "$PWD/fonts" $S/site/$d/fonts; done
ln -sfn "$PWD/swagino.html" $S/site/new/swagino.html
git show b2f2ee2:swagino.html > $S/site/old/swagino.html   # or 58d34a0 for the pre-audit build
```
Real data (not committed): pull with the Tradier MCP connector into `$S/real/` —
`get_historical_data(<SYM>, daily, 2014-01-01, <today>)` for all 9 symbols (large results are saved to a
tool-results file; extract `historicalData` into `real/<SYM>_daily.json` as a JSON list of
`{date,open,high,low,close,volume}`), and an option chain with greeks
(`get_options_chain`) into `real/chain_<SYM>_<EXP>.json` as `calls+puts`. `mock.js` serves real daily rows
when `real/<SYM>_daily.json` exists; intraday is synthetic. Scripts that reference the chain use
SPY 2026-09-29 / TSLA 2026-10-02 — update the file names/dates to whatever chain is pulled.
Needs: node 22, python3 (+ `pip install mpmath` for `ncdf2/3`), Playwright (global), Chromium at /opt/pw-browsers.

## Rounds 1–2 (already merged) — for the final report
Bucket-start stamps; Saty Day fit on completed days; Time Warp calendar periods; plotted precision rule;
RSI live-tick (MA with line off, OB/OS fills, BB); MACD/RSI crosshair values; full-precision normCdf; symbol
guards on all async loaders (cross-symbol bar leaks); Saty length memo keyed on row content; daily row only
moved by regular-session prints + re-pull when missing; early-close sessions; calendar fixes; dead code.
