// CLV Tracker - TxLINE client: auth + fixtures + odds (implied + decimal) + result.
const BASE = 'https://txline.txodds.com';
export interface TxEnv { DB: D1Database; TXLINE_API_KEY?: string }

async function metaGet(env: TxEnv, k: string) { const r = await env.DB.prepare('SELECT value FROM kv WHERE key=?').bind(k).first<{ value: string }>(); return r?.value ?? null; }
async function metaSet(env: TxEnv, k: string, v: string) { await env.DB.prepare('INSERT OR REPLACE INTO kv (key,value) VALUES (?,?)').bind(k, v).run(); }
async function getJwt(env: TxEnv, force = false): Promise<string> {
  if (!force) { const v = await metaGet(env, 'jwt'); const at = await metaGet(env, 'jwt_at'); if (v && at && Date.now() - Number(at) < 25 * 864e5) return v; }
  const r = await fetch(`${BASE}/auth/guest/start`, { method: 'POST' });
  if (!r.ok) throw new Error('guest start ' + r.status);
  const token = (await r.json() as { token: string }).token;
  await metaSet(env, 'jwt', token); await metaSet(env, 'jwt_at', String(Date.now())); return token;
}
async function authedGet(env: TxEnv, path: string): Promise<Response> {
  if (!env.TXLINE_API_KEY) throw new Error('TXLINE_API_KEY not set');
  let jwt = await getJwt(env);
  const h = () => ({ Authorization: `Bearer ${jwt}`, 'X-Api-Token': env.TXLINE_API_KEY! });
  let res = await fetch(BASE + path, { headers: h() });
  if (res.status === 401) { jwt = await getJwt(env, true); res = await fetch(BASE + path, { headers: h() }); }
  return res;
}

export interface TxFixture { fixtureId: number; competition: string; startTime: number; home: string; away: string; }

// Keep ONLY the senior men's FIFA World Cup 2026 - excludes qualifiers, youth (U-17/U-20),
// women's, Club World Cup, beach/futsal/esports, and any other edition/year.
function isMainWorldCup(name: string): boolean {
  const s = (name || '').toLowerCase();
  if (!/world cup/.test(s)) return false;
  if (/qualif|wom(e|a)n|u-?\d{1,2}|under[\s-]?\d{1,2}|youth|club|beach|futsal|esoccer|e-?sports|e[\s-]?world/.test(s)) return false;
  const year = s.match(/\b(19|20)\d{2}\b/);
  if (year && year[0] !== '2026') return false;
  return true;
}

export async function listFixtures(env: TxEnv): Promise<TxFixture[]> {
  const res = await authedGet(env, '/api/fixtures/snapshot');
  if (!res.ok) throw new Error('fixtures ' + res.status);
  const arr = await res.json() as any[];
  return arr.map((f) => { const p1 = !!f.Participant1IsHome; return { fixtureId: f.FixtureId, competition: f.Competition, startTime: f.StartTime, home: p1 ? f.Participant1 : f.Participant2, away: p1 ? f.Participant2 : f.Participant1 }; })
    .filter((f) => isMainWorldCup(f.competition || ''));
}

export interface Odds { implied: { home: number; draw: number; away: number }; decimal: { home: number; draw: number; away: number }; }
export async function getOdds(env: TxEnv, fixtureId: string | number): Promise<Odds | null> {
  const res = await authedGet(env, `/api/odds/snapshot/${fixtureId}`);
  if (!res.ok) return null;
  const arr = await res.json() as any[];
  if (!Array.isArray(arr)) return null;
  const cands = arr.filter((o) => Array.isArray(o.PriceNames) && o.PriceNames.length === 3 && Array.isArray(o.Pct));
  const pick = cands.find((o) => /stable/i.test(o.Bookmaker || '') || /stable/i.test(o.SuperOddsType || '')) || cands[0];
  if (!pick) return null;
  const pct = (pick.Pct as string[]).map((x) => (x === 'NA' ? NaN : Number(x)));
  if (pct.some((x) => !Number.isFinite(x))) return null;
  const names = (pick.PriceNames as string[]).map((s) => String(s).toLowerCase());
  const hi = idx(names, ['1', 'home'], 0), di = idx(names, ['x', 'draw'], 1), ai = idx(names, ['2', 'away'], 2);
  const s = pct[hi] + pct[di] + pct[ai];
  const implied = { home: pct[hi] / s, draw: pct[di] / s, away: pct[ai] / s };
  return { implied, decimal: { home: r2(1 / implied.home), draw: r2(1 / implied.draw), away: r2(1 / implied.away) } };
}
function idx(n: string[], keys: string[], fb: number) { const i = n.findIndex((x) => keys.some((k) => x === k || x.includes(k))); return i >= 0 ? i : fb; }

export interface Result { phase: string; started: boolean; finished: boolean; outcome: 'home_win' | 'draw' | 'away_win' | null; homeGoals: number; awayGoals: number; }
const FIN = new Set(['F', 'FET', 'FPE']);
export async function getResult(env: TxEnv, fixtureId: string | number): Promise<Result> {
  const empty: Result = { phase: 'NS', started: false, finished: false, outcome: null, homeGoals: 0, awayGoals: 0 };
  const res = await authedGet(env, `/api/scores/snapshot/${fixtureId}`);
  if (!res.ok) return empty;
  const arr = await res.json() as any[];
  if (!Array.isArray(arr) || arr.length === 0) return empty;
  const latest = arr.reduce((a, b) => ((b?.seq ?? b?.ts ?? 0) > (a?.seq ?? a?.ts ?? 0) ? b : a));
  const phase = phaseOf(latest); const st = latest?.stats || {}; const sc = latest?.scoreSoccer;
  const n = (k: string, fb?: number) => (st[k] != null ? num(st[k]) : (fb ?? 0));
  const g1 = n('1', num(sc?.Participant1?.Total?.Goals)), g2 = n('2', num(sc?.Participant2?.Total?.Goals));
  const p1Home = latest?.participant1IsHome !== false;
  const homeGoals = p1Home ? g1 : g2, awayGoals = p1Home ? g2 : g1;
  const finished = FIN.has(phase);
  let outcome: Result['outcome'] = null;
  if (finished) outcome = homeGoals > awayGoals ? 'home_win' : awayGoals > homeGoals ? 'away_win' : 'draw';
  return { phase, started: phase !== 'NS', finished, outcome, homeGoals, awayGoals };
}
function phaseOf(u: any): string { if (typeof u?.gameState === 'string' && u.gameState) return u.gameState; const s = u?.statusSoccerId; if (typeof s === 'string') return s; if (s && typeof s === 'object') return Object.keys(s)[0] || 'NS'; return 'NS'; }
const num = (x: any) => (Number.isFinite(Number(x)) ? Number(x) : 0);
const r2 = (x: number) => Math.round(x * 100) / 100;
