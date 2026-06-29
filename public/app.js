// CLV Tracker dashboard.
const qs = (s) => document.querySelector(s);
const api = (p, o) => fetch(p, o).then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status)); return d; });
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MKL = { home: 'Home', draw: 'Draw', away: 'Away' };
const sgn = (n) => (n > 0 ? '+' + n : String(n));
const badge = (d, mag) => (mag === 'major' || mag === 'significant') ? (d === 'shortened' ? 'b-short-sig' : 'b-drift-sig') : 'b-minor';
let modalChart = null;

init();
function init() {
  qs('#run').addEventListener('click', async () => { qs('#run').textContent = 'Capturing…'; try { await api('/api/run-now', { method: 'POST' }); } catch {} qs('#run').textContent = 'Run capture now'; refresh(); });
  qs('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  refresh(); setInterval(refresh, 20000);
}
async function refresh() { await Promise.all([loadSummary(), loadLeaderboard(), loadCards()]); }

async function loadSummary() {
  try {
    const s = await api('/api/summary');
    qs('#s-matches').textContent = s.matches; qs('#s-move').textContent = s.avgMovement;
    qs('#s-major').textContent = s.majorMoves; qs('#s-home').textContent = sgn(s.avgHomeClv);
  } catch {}
}
async function loadLeaderboard() {
  try {
    const { movers } = await api('/api/leaderboard');
    const b = qs('#lb-body');
    if (!movers.length) return;
    b.innerHTML = movers.map((m) => `<tr data-id="${m.matchId}"><td>${esc(m.match)}</td><td>${MKL[m.market]}</td>` +
      `<td>${(m.openImplied * 100).toFixed(1)}%</td><td>${(m.closeImplied * 100).toFixed(1)}%</td>` +
      `<td class="${m.clv >= 0 ? 'pos' : 'neg'}">${sgn(m.clv)}pp</td><td>${(m.outcome || '').replace('_', ' ')}</td></tr>`).join('');
    b.querySelectorAll('tr').forEach((tr) => tr.addEventListener('click', () => openMatch(tr.dataset.id)));
  } catch {}
}
async function loadCards() {
  try {
    const { matches } = await api('/api/matches');
    const host = qs('#cards');
    if (!matches.length) return;
    host.innerHTML = matches.map((m) => `<div class="card" data-id="${m.match_id}"><div class="top">` +
      `<span class="match">${esc(m.home_team)} ${esc(m.final_score || '')} ${esc(m.away_team)}</span>` +
      `<span class="mv">${m.total_movement}pp total</span></div>` +
      `<div class="mv">${esc(m.verdict || '')}</div></div>`).join('');
    host.querySelectorAll('.card').forEach((c) => c.addEventListener('click', () => openMatch(c.dataset.id)));
  } catch {}
}

async function openMatch(id) {
  try {
    const { match } = await api(`/api/clv/${id}`);
    const c = match.clv || {};
    const rows = ['home', 'draw', 'away'].map((mk) => {
      const x = c[mk]; if (!x) return '';
      return `<tr><td>${MKL[mk]} win</td><td>${x.openingDecimal} (${(x.openingImplied * 100).toFixed(1)}%)</td>` +
        `<td>${x.closingDecimal} (${(x.closingImplied * 100).toFixed(1)}%)</td>` +
        `<td class="${x.clv >= 0 ? 'pos' : 'neg'}">${sgn(x.clv)}pp</td>` +
        `<td><span class="badge ${badge(x.direction, x.magnitude)}">${x.direction} · ${x.magnitude}</span></td></tr>`;
    }).join('');
    qs('#modal-body').innerHTML =
      `<span class="close-x" onclick="document.getElementById('modal').classList.add('hidden')">✕</span>` +
      `<h3>${esc(match.home_team)} ${esc(match.final_score || '')} ${esc(match.away_team)}</h3>` +
      `<div class="muted">Outcome: ${(match.outcome || '').replace('_', ' ')} · ${match.total_movement}pp total movement</div>` +
      `<table class="clv-tbl"><thead><tr><th>Market</th><th>Open</th><th>Close</th><th>CLV</th><th></th></tr></thead><tbody>${rows}</tbody></table>` +
      `<div class="narrative">${esc(match.narrative || '')}</div>` +
      `<canvas id="mchart" height="120"></canvas>`;
    qs('#modal').classList.remove('hidden');
    const { snapshots } = await api(`/api/odds-history/${id}`);
    drawChart(snapshots);
  } catch (e) { /* ignore */ }
}
function drawChart(snaps) {
  const el = qs('#mchart'); if (!el || !snaps) return;
  const ctx = el.getContext('2d');
  if (modalChart) modalChart.destroy();
  const ds = (l, k, col) => ({ label: l, data: snaps.map((s) => s[k] * 100), borderColor: col, backgroundColor: col, tension: 0.3, pointRadius: 0, borderWidth: 2 });
  modalChart = new Chart(ctx, { type: 'line', data: { labels: snaps.map((_, i) => i), datasets: [ds('Home', 'home', '#3B6D11'), ds('Draw', 'draw', '#6F6A61'), ds('Away', 'away', '#A32D2D')] }, options: { animation: false, scales: { y: { title: { display: true, text: 'implied %' } }, x: { display: false } } } });
}
function closeModal() { qs('#modal').classList.add('hidden'); }
