# CLV Tracker - Cloudflare Deployment (as built)

**Track:** Trading Tools & Agents · **Subdomain:** `clv.<domain>`
**Live:** https://clvtracker.catchspider2002.workers.dev · Spec: `SPEC.md` · Notes: `README.md`

## Shape (as built)

Pure **Workers + Cron + D1 + Claude** - no Container. A single 1-minute cron captures opening/rolling/closing odds per match and computes CLV on full time (the spec's three separate crons are unified into one time-aware pass). JWT cache lives in a D1 `kv` table. Dashboard served from `./public` via Workers assets.

## Component mapping

| Spec component | Cloudflare (shipped) |
|---|---|
| opening (daily) + rolling (15m) + closing (T-10..0) crons | one Worker `scheduled` cron `* * * * *` → `runCron()`, branching on time-to-kickoff |
| `oddsLogger.js` | `processMatch()` writes opening on first sighting, rolling every ~15m, closing in the final 10m |
| `clvCalculator.js` | `src/clvCalculator.js` - plain JS + JSDoc, `calculateCLV` / `calculateMatchCLV` / magnitude / verdict. **Centerpiece.** |
| `analyser.js` (Claude narrative) | `src/analyser.ts` - `claude-sonnet-4-6`, 4 sentences, deterministic fallback |
| TxLINE REST/SSE | `src/txline.ts` - auth + fixtures + `getOdds` (demargined `Pct`) + `getResult` |
| `db/*.json` | **D1** `matches` (opening/closing/CLV/narrative/outcome) + `rolling` (timeline) + `kv` |
| post-match (`full_time`) | computed in the cron when a match is first seen finished |
| dashboard | `./public` via `[assets]` - summary, leaderboard, CLV cards, odds chart, "What is CLV?" |
| `/backfill` | covered by the closing fallback (latest pre-kickoff odds) + `/api/run-now` |

## Bindings (`wrangler.toml`, as shipped)

```toml
name = "clvtracker"
main = "src/worker.ts"
compatibility_date = "2026-01-01"

[assets]
directory = "./public"
binding = "ASSETS"

[triggers]
crons = ["* * * * *"]

[[d1_databases]]
binding = "DB"
database_name = "clvtracker"
database_id = "REPLACE_WITH_D1_ID"
```

Secrets: `TXLINE_API_KEY` (required), `ANTHROPIC_API_KEY` (recommended - Claude narrative).

## Deploy

```bash
npm install && wrangler login
wrangler d1 create clvtracker          # paste id into wrangler.toml
npm run db:init:remote
wrangler secret put TXLINE_API_KEY
wrangler secret put ANTHROPIC_API_KEY
npm run deploy
```

## Notes

- Each cron pass processes the 15 fixtures closest to "now" (bounds API calls); opening is captured when a match first enters that window.
- Pre-match CLV only (open→close). If the closing capture was missed, the calculator falls back to the latest pre-kickoff odds, then opening.
