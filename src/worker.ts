// CLV Tracker — Cloudflare Worker. Capture cron + dashboard API + static assets.
import { listFixtures, getOdds, getResult, TxEnv } from './txline';
import { calculateMatchCLV, MARKETS } from './clvCalculator.js';
import { analyse } from './analyser';

export interface Env { DB: D1Database; ASSETS: Fetcher; TXLINE_API_KEY?: string; ANTHROPIC_API_KEY?: string }

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });
const ROLLING_MS = 15 * 60e3, CLOSE_WINDOW_MS = 10 * 60e3;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url); const path = url.pathname;
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      if (path === '/api/summary' && req.method === 'GET') return json(await summary(env));
      if (path === '/api/matches' && req.method === 'GET') {
        const r = await env.DB.prepare("SELECT match_id,home_team,away_team,final_score,outcome,total_movement,clv,status FROM matches WHERE status='done' ORDER BY total_movement DESC").all<any>();
        return json({ matches: (r.results || []).map((m) => ({ ...m, verdict: safe(m.clv)?.verdict })) });
      }
      let m = path.match(/^\/api\/clv\/(\w+)$/);
      if (m && req.method === 'GET') {
        const row = await env.DB.prepare('SELECT * FROM matches WHERE match_id=?').bind(m[1]).first<any>();
        if (!row) return json({ error: 'not found' }, 404);
        return json({ match: { ...row, clv: safe(row.clv), opening: { implied: safe(row.opening_implied), decimal: safe(row.opening_decimal) }, closing: { implied: safe(row.closing_implied), decimal: safe(row.closing_decimal) } } });
      }
      m = path.match(/^\/api\/odds-history\/(\w+)$/);
      if (m && req.method === 'GET') {
        const r = await env.DB.prepare('SELECT ts,home,draw,away FROM rolling WHERE match_id=? ORDER BY ts ASC LIMIT 500').bind(m[1]).all();
        return json({ snapshots: r.results });
      }
      if (path === '/api/leaderboard' && req.method === 'GET') return json({ movers: await leaderboard(env) });
      if (path === '/api/run-now' && req.method === 'POST') return json({ ok: true, processed: await runCron(env) });
      return json({ error: 'not found' }, 404);
    } catch (e) { return json({ error: String((e as Error).message || e) }, 500); }
  },
  async scheduled(_e: ScheduledEvent, env: Env): Promise<void> { await runCron(env); },
};

async function runCron(env: Env): Promise<number> {
  if (!env.TXLINE_API_KEY) return 0;
  const txenv: TxEnv = { DB: env.DB, TXLINE_API_KEY: env.TXLINE_API_KEY };
  const now = Date.now();
  let fixtures = [] as Awaited<ReturnType<typeof listFixtures>>;
  try { fixtures = await listFixtures(txenv); } catch { return 0; }
  const cand = fixtures.filter((f) => f.startTime >= now - 48 * 3600e3 && f.startTime <= now + 3 * 3600e3)
    .sort((a, b) => Math.abs(a.startTime - now) - Math.abs(b.startTime - now)).slice(0, 15);
  await Promise.allSettled(cand.map((f) => processMatch(env, txenv, f, now)));
  return cand.length;
}

async function processMatch(env: Env, txenv: TxEnv, fx: { fixtureId: number; home: string; away: string; startTime: number }, now: number): Promise<void> {
  const matchId = String(fx.fixtureId);
  const row = await env.DB.prepare('SELECT * FROM matches WHERE match_id=?').bind(matchId).first<any>();
  const odds = await getOdds(txenv, matchId);

  if (!row) {
    if (!odds) return; // can't establish an opening line yet
    await env.DB.prepare('INSERT INTO matches (match_id,home_team,away_team,kickoff,opening_implied,opening_decimal,opening_at,last_rolling_at,status,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(matchId, fx.home, fx.away, fx.startTime, JSON.stringify(odds.implied), JSON.stringify(odds.decimal), now, now, 'open', new Date().toISOString()).run();
    await rolling(env, matchId, now, odds.implied);
    return;
  }
  if (row.status === 'done') return;

  const result = await getResult(txenv, matchId);

  if (result.finished) {
    const opening = { implied: safe(row.opening_implied), decimal: safe(row.opening_decimal) };
    const closing = row.closing_implied
      ? { implied: safe(row.closing_implied), decimal: safe(row.closing_decimal) }
      : (odds || opening);
    const clv = calculateMatchCLV(opening, closing);
    const finalScore = `${result.homeGoals}-${result.awayGoals}`;
    const narrative = await analyse(env.ANTHROPIC_API_KEY, { home: row.home_team, away: row.away_team, finalScore, outcome: result.outcome || 'draw', clv });
    await env.DB.prepare('UPDATE matches SET closing_implied=?, closing_decimal=?, closing_at=COALESCE(closing_at,?), outcome=?, final_score=?, clv=?, narrative=?, total_movement=?, status=?, updated_at=? WHERE match_id=?')
      .bind(JSON.stringify(closing.implied), JSON.stringify(closing.decimal), now, result.outcome, finalScore, JSON.stringify(clv), narrative, clv.totalMovement, 'done', new Date().toISOString(), matchId).run();
    return;
  }

  // Pre-match captures (only meaningful before kickoff).
  if (!result.started && now < fx.startTime && odds) {
    if (now - Number(row.last_rolling_at || 0) >= ROLLING_MS) {
      await rolling(env, matchId, now, odds.implied);
      await env.DB.prepare('UPDATE matches SET last_rolling_at=?, updated_at=? WHERE match_id=?').bind(now, new Date().toISOString(), matchId).run();
    }
    if (fx.startTime - now <= CLOSE_WINDOW_MS) {
      await env.DB.prepare('UPDATE matches SET closing_implied=?, closing_decimal=?, closing_at=?, updated_at=? WHERE match_id=?')
        .bind(JSON.stringify(odds.implied), JSON.stringify(odds.decimal), now, new Date().toISOString(), matchId).run();
    }
  }
}

async function rolling(env: Env, matchId: string, ts: number, implied: Record<string, number>): Promise<void> {
  await env.DB.prepare('INSERT INTO rolling (match_id,ts,home,draw,away) VALUES (?,?,?,?,?)').bind(matchId, ts, implied.home, implied.draw, implied.away).run();
}

async function summary(env: Env): Promise<object> {
  const r = await env.DB.prepare("SELECT clv, total_movement FROM matches WHERE status='done'").all<any>();
  const rows = r.results || [];
  let major = 0, homeClvSum = 0, moveSum = 0;
  for (const x of rows) {
    const c = safe(x.clv); if (!c) continue;
    moveSum += x.total_movement || 0;
    homeClvSum += c.home?.clv || 0;
    if (MARKETS.some((m: string) => c[m]?.magnitude === 'major')) major++;
  }
  const n = rows.length;
  return { matches: n, avgMovement: n ? Math.round((moveSum / n) * 100) / 100 : 0, majorMoves: major, avgHomeClv: n ? Math.round((homeClvSum / n) * 100) / 100 : 0 };
}

async function leaderboard(env: Env): Promise<any[]> {
  const r = await env.DB.prepare("SELECT match_id,home_team,away_team,outcome,clv FROM matches WHERE status='done'").all<any>();
  const out: any[] = [];
  for (const x of r.results || []) {
    const c = safe(x.clv); if (!c) continue;
    for (const m of MARKETS as readonly string[]) {
      out.push({ matchId: x.match_id, match: `${x.home_team} vs ${x.away_team}`, market: m, clv: c[m].clv, openImplied: c[m].openingImplied, closeImplied: c[m].closingImplied, direction: c[m].direction, outcome: x.outcome });
    }
  }
  return out.sort((a, b) => Math.abs(b.clv) - Math.abs(a.clv)).slice(0, 15);
}

function safe(s: any): any { try { return typeof s === 'string' ? JSON.parse(s) : (s || null); } catch { return null; } }
