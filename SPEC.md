# CLV Tracker - Closing Line Value Analyser
## Build Spec for Claude Code

---

## What we're building

An autonomous agent that logs opening odds for every World Cup match, tracks how the line moves to close, and after each game calculates Closing Line Value (CLV) - the gold-standard metric used by professional bettors to measure edge. A public dashboard shows CLV trends across the tournament, with Claude-generated plain-English analysis of what each line movement means. Pure data, zero user interaction required.

Submitted to the **Superteam × TxODDS World Cup Hackathon** under the **Trading Agents** track.

**Hackathon deadline:** July 19, 2026 (23:59 UTC)  
**Required:** running agent (live or devnet), demo video, public GitHub repo, working dashboard link

---

## What is CLV - quick primer (put this in your README)

Closing Line Value measures whether an odds movement worked in a particular direction. If Brazil opened at 2.10 (47.6% implied) and closed at 1.75 (57.1% implied), the line shortened by 9.5 percentage points. Anyone who bet Brazil at 2.10 had positive CLV - they got better odds than the final market consensus. Professional bettors use CLV as a proxy for edge: over a large sample, consistently beating the closing line is the strongest indicator of a skilled bettor. This tool applies that framework to every World Cup match automatically.

---

## Architecture overview

```
TxLINE SSE Stream + REST API
       │
       ├── On match scheduled (T-24h): log opening odds
       ├── Every 15 minutes pre-match: snapshot current odds
       ├── T-5 minutes before kickoff: log closing odds
       ├── On full_time: calculate CLV, score signals, generate analysis
       │
       ▼
Agent Pipeline
  ├── Odds logger (opening + rolling + closing)
  ├── CLV calculator
  ├── Claude API → CLV analysis narrative
  └── Publisher → DB + dashboard
       │
       ▼
Dashboard
  ├── Per-match CLV cards
  ├── Tournament-wide CLV trend charts
  └── "Most moved lines" leaderboard
```

---

## Project structure

```
clvtracker/
├── agent/
│   ├── index.js              # Entry point - scheduler + SSE listener
│   ├── txline.js             # TxLINE REST + SSE client
│   ├── oddsLogger.js         # Captures opening, rolling, closing odds
│   ├── clvCalculator.js      # Core CLV math
│   ├── analyser.js           # Claude API → narrative analysis
│   └── publisher.js          # Write to DB + trigger dashboard refresh
├── backend/
│   ├── server.js             # Express API
│   └── routes/
│       ├── matches.js        # GET /matches - all matches with CLV status
│       ├── clv.js            # GET /clv/:matchId - full CLV breakdown
│       └── leaderboard.js    # GET /leaderboard - biggest movers
├── frontend/
│   ├── index.html            # Dashboard
│   ├── app.js
│   └── styles.css
├── db/
│   ├── matches.json          # Match registry + status
│   ├── odds-log.json         # Full odds history per match
│   └── clv-results.json      # Post-match CLV calculations + analysis
├── .env.example
├── package.json
└── README.md
```

---

## Odds logging (`oddsLogger.js`)

Three distinct capture points per match:

### Opening odds
- Captured when TxLINE first makes the match available (typically 24-48h before kickoff)
- Run a daily cron at 06:00 UTC to fetch all newly listed matches and log their initial odds
- Store as `openingOdds` - this is the baseline for all CLV calculations

### Rolling snapshots
- Every 15 minutes from T-24h to kickoff
- Builds the full pre-match odds movement curve
- Used to power the odds timeline chart on the dashboard
- Store as array: `rollingOdds: [{ timestamp, homeWin, draw, awayWin }, ...]`

### Closing odds
- Captured at T-5 minutes before kickoff (last clean pre-match line)
- Critical: this must be captured before kickoff because in-play odds are a different market
- Cron runs every minute in the T-10 to T-1 window to ensure it's not missed
- Store as `closingOdds`

```js
// Odds log entry structure
{
  matchId: string,
  homeTeam: string,
  awayTeam: string,
  kickoff: ISO timestamp,
  openingOdds: {
    capturedAt: ISO timestamp,
    homeWin: { decimal: 2.10, implied: 0.476 },
    draw:    { decimal: 3.40, implied: 0.294 },
    awayWin: { decimal: 3.20, implied: 0.313 }
  },
  rollingOdds: [ ... ],    // array of snapshots every 15 mins
  closingOdds: {
    capturedAt: ISO timestamp,
    homeWin: { decimal: 1.75, implied: 0.571 },
    draw:    { decimal: 3.60, implied: 0.278 },
    awayWin: { decimal: 4.50, implied: 0.222 }
  },
  outcome: null,           // filled post-match
  finalScore: null
}
```

---

## CLV calculation (`clvCalculator.js`)

Core math - keep this clean and well-commented. This is what judges will scrutinise.

```js
/**
 * Calculate CLV for a single market outcome
 * CLV = implied probability at closing - implied probability at opening
 * Positive CLV = line shortened (favourite direction), opening odds had value
 * Negative CLV = line drifted (outsider direction), opening odds were short
 */
function calculateCLV(openingImplied, closingImplied) {
  return Math.round((closingImplied - openingImplied) * 10000) / 100  // to 2dp %
}

/**
 * Calculate full CLV breakdown for a match
 */
function calculateMatchCLV(oddsLog) {
  const { openingOdds, closingOdds } = oddsLog

  return {
    homeWin: {
      openingImplied:  openingOdds.homeWin.implied,
      closingImplied:  closingOdds.homeWin.implied,
      clv:             calculateCLV(openingOdds.homeWin.implied, closingOdds.homeWin.implied),
      direction:       closingOdds.homeWin.implied > openingOdds.homeWin.implied ? 'shortened' : 'drifted',
      magnitude:       categorizeMagnitude(Math.abs(closingOdds.homeWin.implied - openingOdds.homeWin.implied))
    },
    draw: { ... },    // same structure
    awayWin: { ... }, // same structure

    // Summary metrics
    totalMovement:     sumOfAbsoluteCLV(homeWin, draw, awayWin),  // total market activity
    mostMovedMarket:   marketWithLargestAbsoluteCLV(),
    verdict:           generateVerdict(homeWin, draw, awayWin)     // see below
  }
}

/**
 * Magnitude labels
 */
function categorizeMagnitude(absClv) {
  if (absClv >= 0.10) return 'major'     // 10pp+
  if (absClv >= 0.05) return 'significant' // 5-10pp
  if (absClv >= 0.02) return 'minor'     // 2-5pp
  return 'negligible'                     // < 2pp
}

/**
 * Verdict: what story does the line movement tell?
 */
function generateVerdict(homeWin, draw, awayWin) {
  // If home shortened significantly: 'Money moved to home team before kickoff'
  // If away shortened significantly: 'Late money favoured the away side'
  // If draw shortened: 'Market anticipated a tighter contest than opening suggested'
  // If negligible movement across all: 'Stable market - opening line held to close'
  // ... implement verdict logic
}
```

Post-match: add `outcome` and `outcomeImpliedAtClose` to each CLV result - what probability the closing line gave to the team that actually won. Over many matches, well-calibrated markets should have closing lines that match outcome frequencies.

---

## Claude API analysis (`analyser.js`)

Called once per match after CLV is calculated. Generates a narrative analysis.

System prompt:
```
You are a quantitative sports betting analyst explaining Closing Line Value (CLV) results to a professional audience.

Given the CLV data for a World Cup match, write a structured analysis with exactly four parts:

1. LINE MOVEMENT SUMMARY: One sentence describing the most significant movement (use exact numbers)
2. MARKET INTERPRETATION: One sentence on what this movement pattern typically indicates (sharp positioning, public fading, news-driven, or efficient stable market)
3. CLV SIGNIFICANCE: One sentence on what the magnitude of this movement means in context of tournament betting markets
4. OUTCOME CONTEXT: One sentence comparing what the closing line implied vs what actually happened

Rules:
- Each sentence maximum 25 words
- Use precise numbers - implied probabilities to 1 decimal place, decimals to 2dp
- Avoid hedging language - be direct
- Do not make normative judgements about whether bets were "good" or "bad"
- Output only the four sentences separated by newlines, no labels
```

User message (JSON):
```json
{
  "match": {
    "homeTeam": "Brazil",
    "awayTeam": "France",
    "stage": "Round of 16",
    "finalScore": "2-1",
    "outcome": "home_win"
  },
  "clv": {
    "homeWin": {
      "openingDecimal": 2.10,
      "closingDecimal": 1.75,
      "openingImplied": "47.6%",
      "closingImplied": "57.1%",
      "clv": "+9.5pp",
      "direction": "shortened",
      "magnitude": "significant"
    },
    "draw": { ... },
    "awayWin": { ... },
    "verdict": "Money moved to home team before kickoff"
  }
}
```

Use `claude-sonnet-4-6`, `max_tokens: 180`.

---

## Post-match processing

Triggered by TxLINE `full_time` SSE event:

1. Fetch final score + outcome from TxLINE
2. Update `oddsLog` with `outcome` and `finalScore`
3. Calculate CLV (`clvCalculator.js`)
4. Call Claude for narrative (`analyser.js`)
5. Write to `clv-results.json`
6. Trigger dashboard refresh (via SSE to connected browsers or simple polling)

---

## Dashboard (`frontend/index.html`)

Four sections:

### 1. Tournament CLV summary (top of page)
Aggregate stats across all completed matches:
- Total matches processed: N
- Average total line movement per match: Xpp
- Matches with major movement (≥10pp on any market): N
- Home win CLV trend: are home teams shortening or drifting on average?

### 2. Per-match CLV cards
One card per completed match, sorted by total movement (most active first):

```
Brazil 2-1 France  |  Round of 16

Home win:  2.10 → 1.75  (+9.5pp)  [SHORTENED - SIGNIFICANT]
Draw:      3.40 → 3.60  (-1.8pp)  [drifted - minor]
Away win:  3.20 → 4.50  (-5.3pp)  [drifted - significant]

Brazil's win probability jumped 9.5pp from open to close,
consistent with sharp positioning on the home side...
[full 4-sentence Claude analysis]

Outcome: Brazil won ✓  (closing line gave Brazil 57.1% chance)
```

Colour coding:
- Shortened significantly: green badge
- Drifted significantly: red badge
- Minor / negligible: grey badge

### 3. Odds movement chart (per match)
- Timeline from 24h before kickoff to closing
- Three lines: home / draw / away implied probability
- Annotations at major movement points
- Chart.js line chart, same approach as SharpAlert

Match selector dropdown at top.

### 4. "Biggest movers" leaderboard
Table: top 10 largest CLV movements across the tournament

| Match | Market | Open | Close | CLV | Outcome |
|---|---|---|---|---|---|
| Brazil vs France | Home win | 47.6% | 57.1% | +9.5pp | ✓ Won |
| ... | | | | | |

Sort by absolute CLV descending. Toggle between "shortened" and "drifted" filters.

---

## Deployment

- **Agent + backend:** Railway or Fly.io - persistent process for SSE listener and cron jobs
- **Frontend:** Vercel or Netlify
- Critical: the opening odds cron (daily 06:00 UTC) must not be missed - this is the baseline for all CLV calculations. If the agent was offline when a match was first listed, you cannot backfill the opening line.

---

## Environment variables (`.env`)

```
TXLINE_API_KEY=your_txline_key
TXLINE_SSE_URL=https://txline.txodds.com/stream
TXLINE_BASE_URL=https://txline.txodds.com
DEEPINFRA_API_KEY="your_deepinfra_key"
PORT=3001
```

---

## Demo video plan (max 5 minutes)

1. **0:00-0:30** - Open dashboard. Point to the tournament summary stats at the top. "This is what 104 matches of automated odds tracking looks like."
2. **0:30-1:30** - Open a completed match CLV card. Walk through the numbers: opening → closing → CLV → outcome. Read the Claude narrative. Point out the colour coding.
3. **1:30-2:30** - Show the odds movement chart for that match. Zoom in on the big movement window. Show the timeline from 24h out to close.
4. **2:30-3:00** - Open `clvCalculator.js` in the editor. Show the core `calculateCLV` function - it's 5 lines of clean math. Emphasise that this is the industry standard metric.
5. **3:00-3:30** - Show the biggest movers leaderboard. Sort by CLV descending. Talk through what the top entry means.
6. **3:30-4:00** - Show the backend terminal: TxLINE `full_time` event fires → CLV calculated → Claude analysis → dashboard updates. Prove the full automated flow.
7. **4:00-4:30** - Pull up `db/odds-log.json` in the terminal. Show it's been growing with every match. Prove persistent autonomous operation.
8. **4:30-5:00** - Wrap: "Opening line. Closing line. Outcome. Analysis. 104 matches. Zero manual input. The complete picture of where money moved at the 2026 World Cup."

---

## Submission checklist

- [ ] Opening odds captured for all upcoming matches (daily cron working)
- [ ] Rolling 15-minute snapshots logging correctly
- [ ] Closing odds captured at T-5 mins reliably
- [ ] CLV calculated and stored after each full_time event
- [ ] Claude narratives generating correctly
- [ ] Dashboard live: CLV cards + chart + leaderboard
- [ ] GitHub repo public - clvCalculator.js especially must be clean and commented
- [ ] Demo video uploaded
- [ ] TxLINE endpoints listed in submission form
- [ ] API feedback prepared

---

## TxLINE resources

- Quickstart: https://txline.txodds.com/documentation/quickstart
- World Cup docs: https://txline.txodds.com/documentation/worldcup
- Support: Discord and Telegram
- Data fees waived until July 19, 2026

---

## Key decisions / notes for Claude Code

- **Deploy day one** - the opening odds cron runs at 06:00 UTC daily. If you deploy late, you miss the opening line for early matches and cannot calculate CLV for them. Get the agent live as soon as possible even if the dashboard isn't polished yet.
- **`clvCalculator.js` is the judging centrepiece** - keep it under 100 lines, immaculately commented, with JSDoc on every function. This is what a "professional trading team could deploy" looks like.
- **The closing odds capture is the riskiest step** - if the cron misses the T-5 minute window (e.g. server restart), you lose the closing line and can't calculate CLV. Add redundancy: capture every minute from T-10 to T-0, store all snapshots, use the T-5 one if available, otherwise the latest pre-kickoff snapshot.
- **Flat file DB is fine** - `odds-log.json` and `clv-results.json` will grow to maybe 2MB over the whole tournament. No database needed.
- **Add a `/backfill/:matchId` endpoint** - lets you manually supply opening and closing odds for a match if the automated capture missed them. Useful safety net.
- **The leaderboard is the visual hook** - sorting by largest CLV movement gives you the "biggest stories" of the tournament. Make this section visually prominent in the demo.
- **Explain CLV in the dashboard UI** - add a small "What is CLV?" tooltip or section. Judges may not know the term. A one-sentence explanation embedded in the UI shows product thinking.
- **Do not confuse pre-match CLV with in-play CLV** - this tool only tracks pre-match line movement (open to close). In-play odds are a completely different and much noisier market. Be explicit about this scope in the README.
- **Mock data for development** - create a `mockOddsLog.js` with a full synthetic match (24h of 15-minute snapshots plus opening and closing) so you can develop and test CLV calculation and dashboard rendering without waiting for real matches.
