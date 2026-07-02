# CLV Tracker - Closing Line Value Analyser

An autonomous agent that logs opening odds for every World Cup match, tracks the move to close, and computes **Closing Line Value (CLV)** - the gold-standard metric pros use to measure edge - with a Claude narrative and a biggest-movers leaderboard. Submitted to the Superteam × TxODDS World Cup Hackathon - Trading Tools & Agents track.

**Stack:** Cloudflare Workers + Cron + D1 + DeepInfra LLM. No Container.

- **Live:** https://clvtracker.catchspider2002.workers.dev
- **GitHub:** https://github.com/catchspider2002/clvtracker
- **Demo video:** _add link_
- **TxLINE endpoints used:** `POST /auth/guest/start`, `GET /api/fixtures/snapshot`, `GET /api/odds/snapshot/{fixtureId}`, `GET /api/scores/snapshot/{fixtureId}`

## What is CLV

If a team opens at 2.10 (47.6% implied) and closes at 1.75 (57.1%), the line shortened 9.5pp - anyone who took the open had **positive CLV** (a better price than the closing consensus). Over a large sample, consistently beating the closing line is the strongest indicator of edge. This tool applies that to every match automatically. **Pre-match only** (open→close); in-play is a different, noisier market.

## How it works

- **Capture** (`src/worker.ts` cron, every minute): on first sighting it records the **opening** line; every ~15 min it appends a **rolling** snapshot; in the final 10 min before kickoff it records the **closing** line.
- **Compute** (`src/clvCalculator.js` - the judging centerpiece, plain JS + JSDoc): on full time, CLV per market, magnitude buckets, total movement, and a verdict.
- **Narrate** (`src/analyser.ts`): DeepInfra LLM writes a 4-sentence analysis; deterministic fallback if no key.
- **Dashboard**: tournament summary, biggest-movers leaderboard, per-match CLV cards (open→close→CLV→outcome + narrative + odds timeline chart).

## Setup & deploy

```bash
npm install
wrangler login
wrangler d1 create clvtracker           # paste id into wrangler.toml
npm run db:init:remote
wrangler secret put TXLINE_API_KEY
wrangler secret put DEEPINFRA_API_KEY    # optional (LLM narrative)
npm run deploy
```

> **Deploy day one.** The opening line is captured the first time the agent sees a fixture (up to ~48h before kickoff). If you deploy late, early matches won't have a clean opening baseline.

## Demo

- `POST /api/run-now` triggers a capture cycle immediately (admin-gated - see Notes). The **Run capture now** button appears when you open the dashboard with `?admin=YOUR_ADMIN_KEY`.
- Completed matches show as CLV cards; click one for the full per-market breakdown, LLM narrative, and odds timeline; the biggest-movers leaderboard ranks the largest CLV shifts.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/summary` | tournament aggregates |
| GET | `/api/matches` | completed matches (sorted by total movement) |
| GET | `/api/clv/:matchId` | full CLV breakdown + narrative + opening/closing |
| GET | `/api/leaderboard` | biggest CLV movers |
| GET | `/api/odds-history/:matchId` | rolling snapshots (chart) |
| POST | `/api/run-now` | trigger a capture now - **requires `X-Admin-Key: $ADMIN_KEY`** (403 otherwise) |

## Notes / limitations (hackathon scope)

- Implied probabilities come from the TxODDS demargined `Pct`; decimals derived as `1/implied`.
- If the closing line was missed, the agent falls back to the latest available pre-kickoff odds (or opening).
- `/api/run-now` is **gated behind `ADMIN_KEY`** (403 without the `X-Admin-Key` header). The "Run capture now" button is hidden for normal visitors and appears only when you open the page with `?admin=YOUR_ADMIN_KEY` (stored locally thereafter). The scheduled cron needs no key. Set it with `wrangler secret put ADMIN_KEY`.
