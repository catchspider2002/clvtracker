# CLV Tracker — Submission Checklist

Track: **Trading Tools & Agents** (Superteam × TxODDS World Cup Hackathon)
Live: https://clvtracker.catchspider2002.workers.dev · Repo: https://github.com/catchspider2002/clvtracker

## ✅ Done

- [x] clvCalculator.js (centerpiece): CLV math, magnitude buckets, verdict — clean JS + JSDoc
- [x] TxLINE client: auth + fixtures + odds (demargined Pct) + result
- [x] Claude 4-sentence narrative with deterministic fallback
- [x] Capture cron: opening (first sighting) → rolling (~15m) → closing (T-10..0) → CLV on full time
- [x] Dashboard: tournament summary, biggest-movers leaderboard, CLV cards, odds timeline, What-is-CLV
- [x] D1 schema (matches, rolling, kv); cron + assets config
- [x] Deployed to Cloudflare; `TXLINE_API_KEY` set
- [x] Verified live: `/api/summary` responds (Worker + D1 up)

## ⏳ Before submitting

- [ ] **Add `ANTHROPIC_API_KEY`**: `wrangler secret put ANTHROPIC_API_KEY` (Claude narrative; deterministic fallback works without it)
- [ ] **Let it bank opening lines** — leave it running so upcoming matches get a clean opening baseline
- [ ] **Record demo video** (≤5 min): show a CLV card (open→close→CLV→outcome), the leaderboard, odds timeline, and `clvCalculator.js`
- [ ] **Add demo video link** to README + submission form
- [ ] **Push final code to GitHub** — confirm latest commit; verify `.dev.vars` is NOT committed
- [ ] **Gate or remove `/api/run-now`** before final submission
- [ ] **Fill submission form**: live URL, GitHub URL, video URL, TxLINE endpoints used, API feedback
- [ ] Attach custom domain `clv.<domain>` (optional)

## 💡 Optional polish / known limitations

- [ ] Solflare/Phantom/Backpack connect on the dashboard (Solana sign-up requirement)
- [ ] Raise the 15-fixtures-per-pass cap if many matches run in the same window
- [ ] Confirm odds `PriceNames`/`Pct` shape against a live match (parser has a safe fallback)
