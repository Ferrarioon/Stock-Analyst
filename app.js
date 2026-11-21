/* Stock Analyst prototype — reads data/index.json, data/calls.json and data/s/<id>.json (written by combined/export_web.py). */
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (v, d = 0) => v == null || isNaN(v) ? '–' : (v * 100).toFixed(d) + '%';
const spct = (v, d = 1) => v == null || isNaN(v) ? '–' : `<span class="${v > 0 ? 'pos' : v < 0 ? 'neg' : ''}">${v > 0 ? '+' : ''}${(v * 100).toFixed(d)}%</span>`;
const num = (v, d = 2) => v == null || isNaN(v) ? '–' : Number(v).toFixed(d);
const fdate = s => new Date(s + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const daysAgo = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };   // local date, not UTC

let IDX, CALLS, BYID = {}, CALLS_BY = {};

/* ---------- measures ---------- */
const isBuy = c => c.call === 'BUY' && c.scored;
function hitStats(calls) {                      // Bullish calls: target reached within 12 months
  const b = calls.filter(isBuy), hit = b.filter(c => c.outcome === 'Hit').length, miss = b.filter(c => c.outcome === 'Missed').length;
  return { hit, miss, res: hit + miss, rate: hit + miss ? hit / (hit + miss) : null,
           days: avg(b.filter(c => c.outcome === 'Hit' && c.days != null).map(c => c.days)), dd: avg(b.filter(c => c.maxdd != null).map(c => c.maxdd)),
           t6: avg(b.filter(c => c.t6m != null).map(c => c.t6m)) };
}
function cutStats(calls, stop) {                // long Bullish calls with a cut loss
  const b = calls.filter(c => isBuy(c) && c.upside > 0 && c.maxdd != null);
  const stopped = b.filter(c => c.maxdd <= -stop).length;
  const ok = b.filter(c => c.maxdd > -stop), hit = ok.filter(c => c.outcome === 'Hit').length, miss = ok.filter(c => c.outcome === 'Missed').length;
  const res = hit + miss + stopped;
  return { res, rate: res ? hit / res : null, stopped: res ? stopped / res : null };
}
function accuracy(st) {
  if (st.res < 5) return ['Too few calls', ''];
  return st.rate >= .6 ? ['High', 'high'] : st.rate >= .4 ? ['Medium', 'medium'] : ['Low', 'low'];
}
const accBadge = st => { const [t, k] = accuracy(st); return `<span class="badge ${k}">${t}</span>`; };
const CALL_WORD = { BUY: 'Bullish', SELL: 'Bearish', NEUTRAL: 'Neutral', 'NOT RATED': 'Not rated' };   // shown wording; data keeps the broker codes
const callWord = c => CALL_WORD[c] || c;
const callBadge = c => `<span class="badge ${c === 'BUY' ? 'buy' : c === 'SELL' ? 'sell' : ''}">${esc(callWord(c))}</span>`;
function status(c, stop) {
  if (!c.scored) return ['No price data', ''];
  if (c.upside > 0 && c.maxdd != null && c.maxdd <= -stop) return ['Hit cut loss', 'stop'];
  return c.outcome === 'Hit' ? ['TP reached', 'hit'] : c.outcome === 'Missed' ? ['Expired', 'exp'] : ['Open', ''];
}

/* ---------- data ---------- */
/* Stocks filed under an old or wrong code: their calls belong to the listed stock on the right. */
const ALIAS = { '8236': '5236', '2615': '7052', '5625': '5657', '5861': '5681', '6384': '6084', '9509': '9059', '5235': '5235SS',
  xAMSKenanga: '0399', xBFIELDMKRHB: '0470', xECOSYSKenanga: '0477', xIHHMKRHB: '5225', xSENFONGMKRHB: '5308', xMMHEMKRHB: '5186' };
const STILL_LISTED = new Set(['5235SS']);   // KLCCP stapled securities: listed, but not in the equities price list
let CALLS_ALL, DELISTED = [];
async function load() {
  const get = u => fetch(u, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null);
  const [idx, calls, master] = await Promise.all([fetch('data/index.json', { cache: 'no-cache' }).then(r => r.json()), fetch('data/calls.json', { cache: 'no-cache' }).then(r => r.json()), get('data/stock_master.json')]);
  IDX = idx;
  const M = {}; (master?.stocks || []).forEach(m => { M[m.code] = m; });
  CALLS_ALL = calls.rows.map(r => Object.fromEntries(calls.fields.map((f, i) => [f, r[i]])));
  const ids = new Set(IDX.stocks.map(s => s.id));
  IDX.stocks.forEach(s => {                                  // a duplicate whose real stock has no page of its own takes the real code
    const to = ALIAS[s.id];
    if (to && !ids.has(to)) { s.code = to; s.board = M[to]?.market || s.board; s.sector = M[to]?.sector || s.sector; if (M[to]) s.name = M[to].long; }
  });
  CALLS_ALL.forEach(c => { const to = ALIAS[c.id]; if (to && ids.has(to)) c.id = to; });
  const merged = s => ALIAS[s.id] && ids.has(ALIAS[s.id]);
  const delisted = s => !merged(s) && ['Not listed now', 'Unmapped'].includes(s.board) && !(master && M[s.code]) && !STILL_LISTED.has(s.code);
  DELISTED = IDX.stocks.filter(delisted);
  const gone = new Set([...DELISTED, ...IDX.stocks.filter(merged)].map(s => s.id));
  IDX.stocks = IDX.stocks.filter(s => !gone.has(s.id));
  IDX.stocks.forEach(s => { if (STILL_LISTED.has(s.code)) { s.board = 'Main'; if (s.sector === '(not listed)') s.sector = 'Real Estate Investment Trusts'; } });
  CALLS = CALLS_ALL.filter(c => !gone.has(c.id));             // lists show listed stocks only; broker accuracy still counts every past call
  IDX.stocks.forEach(s => { BYID[s.id] = s; CALLS_BY[s.id] = []; });
  CALLS.forEach(c => (CALLS_BY[c.id] ||= []).push(c));
  IDX.stocks.forEach(s => { s.st = hitStats(CALLS_BY[s.id]); });
  IDX.stocks.sort((a, b) => a.t.localeCompare(b.t));
}

/* ---------- shared bits ---------- */
function searchBox(id, placeholder = 'Search a stock, e.g. Maybank') {
  return `<div class="search"><input id="${id}" placeholder="${placeholder}" autocomplete="off"><div class="suggest glass" hidden></div></div>`;
}
function wireSearch(id) {
  const inp = $('#' + id), box = inp.nextElementSibling;
  inp.addEventListener('input', () => {
    const q = inp.value.trim().toLowerCase();
    if (!q) { box.hidden = true; return; }
    const m = IDX.stocks.filter(s => s.t.toLowerCase().includes(q) || s.name.toLowerCase().includes(q) || (s.code || '').includes(q))
      .sort((a, b) => (b.t.toLowerCase().startsWith(q) - a.t.toLowerCase().startsWith(q)) || b.n - a.n).slice(0, 12);
    box.innerHTML = m.map(s => `<a href="#/stock/${esc(s.id)}"><span><b>${esc(s.t)}</b> <small class="sub">${esc(s.name)}</small></span><small class="sub">${esc(s.code || '')}</small></a>`).join('')
      || '<div class="sub" style="padding:8px">No stock found</div>';
    box.hidden = false;
  });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { const a = $('a', box); if (a) location.hash = a.getAttribute('href'); } });
  inp.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 180));
}
const stockLink = id => BYID[id] ? `<a href="#/stock/${esc(id)}"><b>${esc(BYID[id].t)}</b></a>` : esc(id);

/* ---------- pages ---------- */
function home() {
  const all = hitStats(CALLS_ALL), since = '2023-01-01';
  const latest = CALLS.slice(0, 7);
  const reliable = IDX.stocks.filter(s => s.st.res >= 8).sort((a, b) => b.st.rate - a.st.rate || b.st.res - a.st.res).slice(0, 7);
  const sectors = Object.entries(IDX.stocks.reduce((m, s) => { if (s.sector && s.sector !== '(not listed)') m[s.sector] = (m[s.sector] || 0) + 1; return m; }, {}))
    .sort((a, b) => b[1] - a[1]).slice(0, 9);
  const board = IDX.brokers.map(b => [b, hitStats(CALLS_ALL.filter(c => c.broker === b && c.date >= since))]);
  view.innerHTML = `<div class="home"><div>
    <h1>Welcome</h1>
    <div class="glass hero"><small>Analyst target prices, checked</small>
      <div class="big">How often do broker target prices actually get reached?</div>
      <div class="pills"><span class="pill">${IDX.reports.toLocaleString()} reports</span><span class="pill">${IDX.stocks.length} stocks</span>
        <span class="pill">${IDX.brokers.map(esc).join(' · ')}</span><span class="pill">Bullish calls reaching target: ${pct(all.rate)}</span>
        <span class="pill">Prices to ${fdate(IDX.asof)}</span></div></div>
    <div class="actions">
      <a class="action" href="#/stocks"><span>🔍</span>Stocks</a><a class="action" href="#/latest"><span>🗓️</span>Latest</a>
      <a class="action" href="#/brokers"><span>📊</span>Accuracy</a><a class="action" href="#/method"><span>ℹ️</span>Method</a></div>
    <div class="two">
      <div><h2>Latest reports</h2><div class="glass card">${latest.map(c => `<div class="row-item"><span>${stockLink(c.id)}<br><small>${esc(c.broker)} · ${fdate(c.date)}</small></span>
        <span style="text-align:right">${callBadge(c.call)}<br><small>TP ${num(c.tp)} (${c.upside == null ? '–' : (c.upside > 0 ? '+' : '') + (c.upside * 100).toFixed(0) + '%'})</small></span></div>`).join('')}</div></div>
      <div><h2>Most reliable Bullish calls</h2><div class="glass card">${reliable.map(s => `<div class="row-item"><span>${stockLink(s.id)}<br><small>${esc(s.sector || '')}</small></span>
        <span style="text-align:right"><b>${pct(s.st.rate)}</b><br><small>${s.st.hit} of ${s.st.res} reached target</small></span></div>`).join('')}</div></div>
    </div></div>
    <div class="glass right"><h2 style="margin:0">Find a stock</h2>${searchBox('q-home', 'Search here…')}
      <div class="tiles">${sectors.map(([s, n]) => `<a class="tile" href="#/stocks?sector=${encodeURIComponent(s)}"><b>${n}</b>${esc(s)}</a>`).join('')}</div>
      <h2 style="margin:10px 0 0">Broker scoreboard</h2><div class="sub">Bullish calls since 2023 that reached their target</div>
      ${board.map(([b, st]) => `<div class="stat"><small>${esc(b)} · ${st.res.toLocaleString()} resolved calls</small><b>${pct(st.rate)}</b></div>`).join('')}
      <a class="btn" style="text-align:center" href="#/brokers">Compare brokers</a></div></div>`;
  wireSearch('q-home');
}

function stocks(params) {
  const sectors = [...new Set(IDX.stocks.map(s => s.sector).filter(Boolean))].sort();
  view.innerHTML = `<div class="head"><h1>Stocks</h1></div>
    <div class="filters"><label>Search<input id="f-q" placeholder="Name or code"></label>
      <label>Sector<select id="f-sec"><option value="">All sectors</option>${sectors.map(s => `<option>${esc(s)}</option>`).join('')}</select></label>
      <label>Sort by<select id="f-sort"><option value="t">Name</option><option value="rate">Bullish hit rate</option><option value="n">Number of reports</option><option value="up">Upside to latest target</option></select></label></div>
    <div class="glass card"><div class="tablewrap"><table><thead><tr><th>Stock</th><th>Company</th><th>Sector</th><th class="num">Last price</th><th class="num">Latest target</th>
      <th class="num">Upside</th><th class="num">Reports</th><th class="num">Bullish calls reached target</th><th>Accuracy</th></tr></thead><tbody id="rows"></tbody></table></div>
      <p class="note" id="count"></p></div>`;
  $('#f-sec').value = params.get('sector') || '';
  const lastTp = s => { const l = Object.values(s.latest).sort((a, b) => b.d.localeCompare(a.d))[0]; return l && l.tp; };
  const draw = () => {
    const q = $('#f-q').value.trim().toLowerCase(), sec = $('#f-sec').value, sort = $('#f-sort').value;
    let list = IDX.stocks.filter(s => (!sec || s.sector === sec) && (!q || s.t.toLowerCase().includes(q) || s.name.toLowerCase().includes(q) || (s.code || '').includes(q)));
    const up = s => (lastTp(s) && s.last) ? lastTp(s) / s.last - 1 : -9;
    if (sort === 'rate') list.sort((a, b) => (b.st.res >= 5) - (a.st.res >= 5) || (b.st.rate ?? -1) - (a.st.rate ?? -1));
    if (sort === 'n') list.sort((a, b) => b.n - a.n);
    if (sort === 'up') list.sort((a, b) => up(b) - up(a));
    $('#rows').innerHTML = list.map(s => `<tr class="link" data-id="${esc(s.id)}"><td><b>${esc(s.t)}</b></td><td>${esc(s.name)}</td><td>${esc(s.sector || '–')}</td>
      <td class="num">${num(s.last)}</td><td class="num">${num(lastTp(s))}</td><td class="num">${up(s) === -9 ? '–' : spct(up(s), 0)}</td><td class="num">${s.n}</td>
      <td class="num">${s.st.res ? `${pct(s.st.rate)} <small class="sub">(${s.st.hit}/${s.st.res})</small>` : '–'}</td><td>${accBadge(s.st)}</td></tr>`).join('');
    $('#count').textContent = `${list.length} stocks`;
  };
  ['f-q', 'f-sec', 'f-sort'].forEach(id => $('#' + id).addEventListener('input', draw));
  $('#rows').addEventListener('click', e => { const tr = e.target.closest('tr[data-id]'); if (tr) location.hash = '#/stock/' + tr.dataset.id; });
  draw();
}

const BROKER_COLORS = { Kenanga: '#d6336c', RHB: '#1c7ed6', MIDF: '#e8890c' };
const EXTRA_COLORS = ['#2b9a66', '#7048e8', '#0c8599', '#a61e4d'];
const bcolor = b => BROKER_COLORS[b] || EXTRA_COLORS[Math.abs([...b].reduce((h, c) => h * 31 + c.charCodeAt(0), 7)) % EXTRA_COLORS.length];
const bdot = b => `<span class="bdot" style="background:${bcolor(b)}"></span>`;
const plainAnalyst = a => (a || '').replace(/ \((Kenanga|RHB|MIDF)\)$/, '');

/* price performance from daily closes (price only, no dividends) */
function perfStats(px) {
  if (!px || !px.c.length) return null;
  const N = px.c.length, last = px.c[N - 1], lastD = px.d[N - 1];
  const back = days => { const t = daysAgo(lastD, days); let i = N - 1; while (i > 0 && px.d[i] > t) i--; return px.d[i] <= t ? px.c[i] : null; };
  const ytdBase = (() => { const y = lastD.slice(0, 4); let i = N - 1; while (i > 0 && px.d[i].slice(0, 4) === y) i--; return px.d[i].slice(0, 4) < y ? px.c[i] : null; })();
  const r = v => v ? last / v - 1 : null;
  const years = [];
  for (let y = +px.d[0].slice(0, 4) + 1; y <= +lastD.slice(0, 4); y++) {
    let a = null, b = null;
    for (let i = 0; i < N; i++) { const yy = +px.d[i].slice(0, 4); if (yy === y - 1) a = px.c[i]; if (yy === y) b = px.c[i]; }
    if (a && b) years.push([y === +lastD.slice(0, 4) ? `${y} so far` : String(y), b / a - 1]);
  }
  return { periods: [['1 month', r(back(30))], ['3 months', r(back(91))], ['6 months', r(back(182))], ['Year to date', r(ytdBase)],
                     ['1 year', r(back(365))], ['3 years', r(back(1095))], ['5 years', r(back(1825))]],
           hi5: Math.max(...px.h), lo5: Math.min(...px.l), years, first: px.d[0] };
}

/* ---------- interactive price chart: candles or line, volume, broker markers, target lines, zoom and pan ---------- */
function setupChart(cv, px, calls) {
  const st = { type: 'candle', layers: { ma50: true, ma200: true, band: false, tp: true }, hide: new Set(), a: 0, b: px && px.c.length ? px.c.length - 1 : 0 };
  if (!px || !px.c.length) { drawChart(cv, null, calls, st); return; }
  const N = px.c.length, MIN = 15;
  const pre = { ma50: maArr(px.c, 50), ma200: maArr(px.c, 200), hi: rollArr(px.h, Math.max), lo: rollArr(px.l, Math.min) };
  const redraw = () => drawChart(cv, px, calls, st, pre);
  const setWin = (a, b) => { if (!isFinite(a) || !isFinite(b)) return; const span = Math.round(Math.max(MIN, Math.min(N - 1, b - a))); a = Math.round(a); a = Math.max(0, Math.min(a, N - 1 - span)); st.a = a; st.b = a + span; redraw(); };
  const setRange = days => { [...$('#range').children].forEach(x => x.classList.toggle('on', +x.dataset.d === days));
    if (!days) return setWin(0, N - 1); const t = daysAgo(px.d[N - 1], days); let i = N - 1; while (i > 0 && px.d[i - 1] >= t) i--; setWin(i, N - 1); };
  const zoomAt = (f, centre) => { const span = st.b - st.a, c = centre ?? (st.a + st.b) / 2, ns = span * f; setWin(c - (c - st.a) / span * ns, c - (c - st.a) / span * ns + ns);
    [...$('#range').children].forEach(x => x.classList.remove('on')); };
  $('#range').onclick = e => { const b = e.target.closest('button'); if (b) setRange(+b.dataset.d); };
  $('#ctype').onclick = e => { const b = e.target.closest('button'); if (!b) return; st.type = b.dataset.t; [...$('#ctype').children].forEach(x => x.classList.toggle('on', x === b)); redraw(); };
  $('#zoom').onclick = e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.z === 'reset') return setRange(0); zoomAt(b.dataset.z === 'in' ? .6 : 1 / .6); };
  $('#layers').onchange = e => { const c = e.target; if (c.dataset.b) { c.checked ? st.hide.delete(c.dataset.b) : st.hide.add(c.dataset.b); } else st.layers[c.dataset.l] = c.checked; redraw(); };
  const idxAt = clientX => { const r = cv.getBoundingClientRect(), L = 52, R = 12; return st.a + (clientX - r.left - L) / Math.max(1, r.width - L - R) * (st.b - st.a); };
  cv.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.deltaY > 0 ? 1.18 : 1 / 1.18, idxAt(e.clientX)); }, { passive: false });
  let drag = null;
  cv.onmousedown = e => { drag = { x: e.clientX, a: st.a, b: st.b }; cv.classList.add('grab'); };
  window.onmouseup = () => { drag = null; cv.classList.remove('grab'); };
  cv.ondblclick = () => setRange(0);
  cv.onmousemove = e => {
    if (drag) { const r = cv.getBoundingClientRect(), per = (drag.b - drag.a) / Math.max(1, r.width - 64), d = (drag.x - e.clientX) * per; setWin(drag.a + d, drag.b + d); $('#tip').hidden = true; return; }
    showTip(e, cv, px, calls, st);
  };
  cv.onmouseleave = () => { $('#tip').hidden = true; };
  let t0 = null;                                   // touch: one finger pans
  cv.ontouchstart = e => { if (e.touches.length === 1) t0 = { x: e.touches[0].clientX, a: st.a, b: st.b }; };
  cv.ontouchmove = e => { if (!t0 || e.touches.length !== 1) return; e.preventDefault(); const r = cv.getBoundingClientRect(), per = (t0.b - t0.a) / Math.max(1, r.width - 64), d = (t0.x - e.touches[0].clientX) * per; setWin(t0.a + d, t0.b + d); };
  window.onresize = redraw;
  setRange(0);
}
const maArr = (c, k) => { const out = new Array(c.length).fill(null); let s = 0; for (let i = 0; i < c.length; i++) { s += c[i]; if (i >= k) s -= c[i - k]; if (i >= k - 1) out[i] = s / k; } return out; };
const rollArr = (a, fn) => a.map((_, i) => i < 119 ? null : fn(...a.slice(Math.max(0, i - 251), i + 1)));

function chartGeom(cv, st) {
  const W = cv.clientWidth, H = cv.clientHeight, L = 52, R = 12, T = 12, B = 24, VH = Math.round((H - T - B) * .17), PH = H - T - B - VH - 8;
  return { W, H, L, R, T, B, VH, PH, X: i => L + (i - st.a) / Math.max(1, st.b - st.a) * (W - L - R) };
}

function drawChart(cv, px, calls, st, pre) {
  const dpr = window.devicePixelRatio || 1, G = chartGeom(cv, st), { W, H, L, R, T, B, VH, PH, X } = G;
  cv.width = W * dpr; cv.height = H * dpr; const g = cv.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, W, H);
  g.font = '11px Segoe UI, sans-serif';
  if (!px || !px.c.length) { g.fillStyle = cssv('--muted'); g.fillText('No price history for this stock.', 16, 30); return; }
  const a = st.a, b = st.b, pos = Object.fromEntries(px.d.map((d, i) => [d, i])), N = px.c.length;
  const vis = calls.filter(c => c.scored && pos[c.date] != null && !st.hide.has(c.broker));
  // target steps: each broker's target holds from its report until that broker's next report on this stock
  const steps = [];
  for (const br of new Set(vis.map(c => c.broker))) {
    const cs = vis.filter(c => c.broker === br && c.tp).sort((x, y) => x.date.localeCompare(y.date));
    cs.forEach((c, k) => { const i0 = pos[c.date], i1 = k + 1 < cs.length ? pos[cs[k + 1].date] : Math.min(N - 1, i0 + 252); steps.push({ br, tp: c.tp, i0, i1 }); });
  }
  let mn = Infinity, mx = -Infinity;
  for (let i = a; i <= b; i++) { mn = Math.min(mn, px.l[i]); mx = Math.max(mx, px.h[i]);
    if (st.layers.band) { if (pre.hi[i]) mx = Math.max(mx, pre.hi[i]); if (pre.lo[i]) mn = Math.min(mn, pre.lo[i]); } }
  if (st.layers.tp) steps.forEach(s => { if (s.i1 >= a && s.i0 <= b) { mn = Math.min(mn, s.tp); mx = Math.max(mx, s.tp); } });
  const pad = (mx - mn) * .07 || mx * .05 || 1; mn -= pad; mx += pad;
  const Y = v => T + (mx - v) / (mx - mn) * PH;
  // grid + axes
  g.strokeStyle = cssv('--line'); g.fillStyle = cssv('--muted'); g.lineWidth = 1;
  const stepV = niceStep((mx - mn) / 5);
  for (let v = Math.ceil(mn / stepV) * stepV; v <= mx; v += stepV) { const y = Y(v); g.beginPath(); g.moveTo(L, y); g.lineTo(W - R, y); g.stroke(); g.fillText(v.toFixed(stepV < .1 ? 3 : 2), 4, y + 4); }
  const span = b - a, every = span > 900 ? 12 : span > 450 ? 6 : span > 200 ? 3 : span > 70 ? 1 : 0;
  let lastLab = '', lastX = -99;
  for (let i = a; i <= b; i++) {
    const d = px.d[i], lab = every ? d.slice(0, 7) : d;
    if (lab === lastLab) continue; lastLab = lab;
    const m = +d.slice(5, 7);
    if (every ? (m - 1) % every === 0 : (i - a) % Math.max(1, Math.round(span / 8)) === 0) {
      const x = X(i); if (x - lastX < 46 || x < L + 8) continue; lastX = x; g.strokeStyle = 'rgba(120,128,160,.10)'; g.beginPath(); g.moveTo(x, T); g.lineTo(x, T + PH + 8 + VH); g.stroke();
      g.fillText(new Date(d + 'T00:00:00').toLocaleDateString('en-GB', every ? { month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' }), x - 16, H - 7);
    }
  }
  g.save(); g.beginPath(); g.rect(L, T - 2, W - L - R, PH + 4); g.clip();
  const line = (arr, col, w, dash) => { g.beginPath(); g.setLineDash(dash || []); g.strokeStyle = col; g.lineWidth = w; let pen = false;
    for (let i = Math.max(0, a - 1); i <= Math.min(N - 1, b + 1); i++) { if (arr[i] == null) { pen = false; continue; } pen ? g.lineTo(X(i), Y(arr[i])) : g.moveTo(X(i), Y(arr[i])); pen = true; } g.stroke(); g.setLineDash([]); };
  if (st.layers.band) { line(pre.hi, '#9aa0b4', 1, [4, 4]); line(pre.lo, '#9aa0b4', 1, [4, 4]); }
  // target lines
  if (st.layers.tp) steps.forEach(s => { if (s.i1 < a || s.i0 > b) return; const y = Y(s.tp); g.strokeStyle = bcolor(s.br); g.globalAlpha = .75; g.lineWidth = 1.4; g.setLineDash([5, 4]);
    g.beginPath(); g.moveTo(X(s.i0), y); g.lineTo(X(s.i1), y); g.stroke(); g.setLineDash([]); g.globalAlpha = 1; });
  // price
  const bw = (W - L - R) / Math.max(1, span + 1);
  if (st.type === 'candle' && bw >= 2.2) {
    const body = Math.max(1, Math.min(14, bw * .68));
    for (let i = a; i <= b; i++) {
      const up = px.c[i] >= px.o[i], col = up ? '#1f8a4c' : '#c0392b', x = X(i);
      g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, Y(px.h[i])); g.lineTo(x, Y(px.l[i])); g.stroke();
      const y1 = Y(Math.max(px.o[i], px.c[i])), y2 = Y(Math.min(px.o[i], px.c[i]));
      g.fillRect(x - body / 2, y1, body, Math.max(1, y2 - y1));
    }
  } else line(px.c, cssv('--ink'), 1.7);
  if (st.layers.ma200) line(pre.ma200, '#e0913a', 1.3);
  if (st.layers.ma50) line(pre.ma50, '#c9a24a', 1.3);
  // call markers and target diamonds in broker colours
  vis.forEach(c => {
    const i = pos[c.date]; if (i < a || i > b) return;
    const x = X(i), col = bcolor(c.broker);
    if (st.layers.tp && c.tp) { const ty = Y(c.tp); g.fillStyle = col; g.strokeStyle = '#fff'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, ty - 5); g.lineTo(x + 5, ty); g.lineTo(x, ty + 5); g.lineTo(x - 5, ty); g.closePath(); g.fill(); g.stroke(); }
    g.fillStyle = col; g.strokeStyle = '#fff'; g.lineWidth = 1.2; g.beginPath();
    if (c.call === 'BUY') { const y = Y(px.l[i]) + 5; g.moveTo(x, y); g.lineTo(x + 6, y + 10); g.lineTo(x - 6, y + 10); }
    else if (c.call === 'SELL') { const y = Y(px.h[i]) - 5; g.moveTo(x, y); g.lineTo(x + 6, y - 10); g.lineTo(x - 6, y - 10); }
    else g.arc(x, Y(px.c[i]), 4.5, 0, 7);
    g.closePath(); g.fill(); g.stroke();
  });
  g.restore();
  // volume
  const vy = T + PH + 8; let vmax = 0; for (let i = a; i <= b; i++) vmax = Math.max(vmax, px.v[i] || 0);
  if (vmax > 0) {
    for (let i = a; i <= b; i++) { const h = (px.v[i] || 0) / vmax * VH; g.fillStyle = px.c[i] >= px.o[i] ? 'rgba(31,138,76,.35)' : 'rgba(192,57,43,.35)'; g.fillRect(X(i) - Math.max(.6, bw * .34), vy + VH - h, Math.max(1.2, bw * .68), h); }
    g.fillStyle = cssv('--muted'); g.fillText('Volume', 4, vy + 10);
  }
  g.strokeStyle = 'rgba(120,128,160,.25)'; g.beginPath(); g.moveTo(L, vy - 4); g.lineTo(W - R, vy - 4); g.stroke();
}
function niceStep(x) { const p = Math.pow(10, Math.floor(Math.log10(x || 1))), m = x / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; }

function showTip(e, cv, px, calls, st) {
  const tip = $('#tip'); if (!px) return;
  const G = chartGeom(cv, st), r = cv.getBoundingClientRect(), i = Math.round(st.a + (e.clientX - r.left - G.L) / Math.max(1, G.W - G.L - G.R) * (st.b - st.a));
  if (i < st.a || i > st.b) { tip.hidden = true; return; }
  const on = calls.filter(c => c.date === px.d[i] && !st.hide.has(c.broker));
  const prev = i > 0 ? px.c[i - 1] : null, chg = prev ? px.c[i] / prev - 1 : null;
  tip.innerHTML = `<b>${fdate(px.d[i])}</b><br>Open ${num(px.o[i])} · High ${num(px.h[i])} · Low ${num(px.l[i])} · Close <b>${num(px.c[i])}</b>${chg != null ? ` (${chg >= 0 ? '+' : ''}${(chg * 100).toFixed(1)}%)` : ''}
    ${px.v[i] ? `<br>Volume ${Number(px.v[i]).toLocaleString()}` : ''}${on.map(c => `<br><span class="tdot" style="background:${bcolor(c.broker)}"></span>${esc(c.broker)}: ${esc(c.call)}, target ${num(c.tp)}`).join('')}`;
  tip.style.left = Math.min(e.clientX + 14, window.innerWidth - 300) + 'px'; tip.style.top = (e.clientY + 14) + 'px'; tip.hidden = false;
}

/* ---------- detailed financials (data/f/<id>.json, built by fundamentals/financials/fin_<code>.py) ---------- */
const fmtM = v => v == null ? '–' : Math.round(v).toLocaleString();
const dirBadge = d => { const k = /^Positive/.test(d) ? 'high' : /^Negative/.test(d) ? 'low' : 'medium'; const a = /^Positive/.test(d) ? '▲ ' : /^Negative/.test(d) ? '▼ ' : '● '; return `<span class="badge ${k}">${a}${esc(d)}</span>`; };
/* ---------- stock page: tabs, story cards and interactive infographics ---------- */
const TABS = [['overview', 'Overview'], ['business', 'Business'], ['financial', 'Financial'], ['health', 'Health'], ['valuation', 'Valuation'], ['drivers', 'What moves it'], ['analysts', 'Analysts'], ['price', 'Price chart']];
const LAYMAN = {   // plain-English meaning of each metric, keyed by the start of its label
  'Market value': v => `What the whole company costs at today's share price: ${v}.`,
  'P/E': v => `You pay about RM${parseFloat(v)} for every RM1 of profit the company makes in a year. A high number means investors expect strong growth.`,
  'EPS': v => `Profit earned for each share you own over the last year: ${v}.`,
  'Dividend yield': v => `For every RM100 of shares, you would get about RM${(parseFloat(v)).toFixed(1)} a year back as cash dividends.`,
  'Payout ratio': v => `Of every RM100 profit, about RM${parseFloat(v)} is paid out to shareholders; the rest is kept to grow.`,
  'Price to book': v => `The share price is ${v} the accounting value of what shareholders own. Shop chains earn from their network, not their buildings, so this is often high.`,
  'EV / EBITDA': v => `Another price tag that includes debt and rent obligations: about ${v} its yearly cash earnings.`,
  'Return on equity': v => `For every RM100 shareholders have put in, the company earned about RM${parseFloat(v)} profit last year.`,
  'Gross margin': v => `After paying for the goods it sells, RM${parseFloat(v)} of every RM100 is left to cover running costs and profit.`,
  'Net margin': v => `What is finally left as profit from every RM100 of sales: RM${parseFloat(v)}.`,
  'Net cash': v => `Cash and investments minus bank borrowings: ${v}. Positive means no net debt.`,
  'Free cash flow after rent': v => `Cash left after running the shops, investing in new ones and paying rent: ${v}.`,
  'Free cash flow yield': v => `That spare cash as a share of the company's value: ${v}.`,
  'Revenue growth': v => `Sales compared with the same period last year: ${v}.`,
  'Profit growth': v => `Profit compared with the same period last year: ${v}.`,
  'Inventory days': v => `Goods sit on shelves and in warehouses for about ${v} days before being sold.`,
  'Payable days': v => `It pays suppliers about ${v} days after buying, so suppliers fund much of the stock.`,
};
const plainOf = m => m.plain || laymanFor(m);
const laymanFor = m => { const k = Object.keys(LAYMAN).find(k => m.label.startsWith(k)); return k ? LAYMAN[k](m.value) : ''; };
const RM100_TIPS = {   // what each cost means in everyday words
  'Cost of goods sold': 'Buying the rice, noodles, drinks and toiletries it sells, after discounts from suppliers.',
  'Staff costs': 'Salaries and EPF for cashiers, warehouse staff, drivers and head office.',
  'Shop and warehouse rent (depreciation of leases)': 'Rent for the shop lots and warehouses, spread over the lease period.',
  'Depreciation of equipment and buildings': 'The wear-and-tear cost of shelves, chillers, lorries and buildings it owns.',
  'Utilities, repairs, logistics and other costs': 'Electricity, repairs, transport and everything else needed to keep shops open.',
  'Finance costs': 'Interest, mostly on its long-term shop rental agreements.',
  'Tax': 'Corporate income tax paid to the government.',
  'Profit after tax': 'What is left for shareholders: paid as dividends or used to open new shops.',
};
/* shared picture library: generic AI-generated objects in data/lib, matched to a topic by keywords */
const LIBPIC = n => `data/lib/${n}.jpg`;
const PIC_RULES = [[/valuation|share price/i, 'pricetag'], [/outlet|shop|store|branch/i, 'shop'], [/transaction|basket|customer/i, 'basket'], [/hour|opening/i, 'clock'],
  [/e-?commerce|online|bulksales|digital|app\b/i, 'ecommerce'], [/consumer|spending|demand|income/i, 'wallet'], [/competi|rival/i, 'chess'],
  [/supplier|rebate|buying power|partner/i, 'puzzle'], [/wage|staff|labour|salar|people/i, 'badge'], [/utilit|energy|electric|green|power/i, 'bulb'],
  [/depreciation|ageing|time/i, 'hourglass'], [/distribution|logistic|warehouse|centre/i, 'warehouse'], [/china|overseas|international|export|abroad|pilot/i, 'globe'],
  [/net cash|balance sheet|debt|borrow/i, 'safe'], [/risk|regulat|policy/i, 'shield'], [/growth|expan/i, 'growth'], [/delivery|transport|fleet/i, 'truck']];
const picFor = t => (PIC_RULES.find(([r]) => r.test(t)) || [0, 'magnifier'])[1];
const bgPic = src => `style="background-image:url('${esc(src)}')"`;
const PIE_COLS = ['#c9a24a', '#6b6f76', '#d97757', '#a3a5aa', '#e6c983', '#46494f', '#b07a52', '#d6d0c2'];

function countUps(root) {                 // animate numbers marked data-count="1234.5" data-dec="1" data-pre="RM" data-suf=" m"
  root.querySelectorAll('[data-count]').forEach(el => {
    if (el.dataset.done) return; el.dataset.done = 1;
    const to = +el.dataset.count, dec = +(el.dataset.dec || 0), pre = el.dataset.pre || '', suf = el.dataset.suf || '', t0 = performance.now(), dur = 900;
    const step = t => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = pre + (to * e).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec }) + suf; if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
  root.querySelectorAll('[data-w]').forEach(el => { requestAnimationFrame(() => { el.style.width = el.dataset.w; }); });
}
const cnt = (v, dec = 0, pre = '', suf = '') => `<span data-count="${v}" data-dec="${dec}" data-pre="${pre}" data-suf="${suf}">${pre}0${suf}</span>`;

function donut(parts, id, big = 'RM100', small = 'of revenue') {               // SVG donut; each slice is clickable
  const R = 80, r = 52, C = 100; let a0 = -Math.PI / 2; const tot = parts.reduce((t, p) => t + p.v, 0);
  const arc = (a1, a2) => { const big = a2 - a1 > Math.PI ? 1 : 0, p = (rad, a) => [C + rad * Math.cos(a), C + rad * Math.sin(a)];
    const [x1, y1] = p(R, a1), [x2, y2] = p(R, a2), [x3, y3] = p(r, a2), [x4, y4] = p(r, a1);
    return `M${x1} ${y1}A${R} ${R} 0 ${big} 1 ${x2} ${y2}L${x3} ${y3}A${r} ${r} 0 ${big} 0 ${x4} ${y4}Z`; };
  return `<svg viewBox="0 0 200 200" class="donut" id="${id}">${parts.map((p, i) => { const a1 = a0, a2 = a0 + p.v / tot * 2 * Math.PI * 0.9999; a0 = a2;
    return `<path d="${arc(a1, a2)}" fill="${p.c}" data-i="${i}" tabindex="0"><title>${esc(p.l)}: RM${p.v.toFixed(2)}</title></path>`; }).join('')}
    <text x="100" y="94" text-anchor="middle" class="d-big" id="${id}-v">${big}</text><text x="100" y="114" text-anchor="middle" class="d-small" id="${id}-l">${small}</text></svg>`;
}

function overviewPanel(s, b, f, calls, all, avgTp) {
  const cards = [], ai = (b && b.aiImages) || [], sp = (f && f.story && f.story.pics) || {};
  const spic = (k, lib) => sp[k] || LIBPIC(lib);
  const story = (tag, pic, body, opts = {}) => `<div class="story${opts.cls ? ' ' + opts.cls : ''}"><div class="s-pic" ${bgPic(pic)}></div><div class="s-shade"></div>
    <span class="s-tag">${tag}</span>${opts.ai ? '<span class="s-aib">AI illustration</span>' : ''}<div class="s-body">${body}</div></div>`;
  if (b) cards.push(story('What it does', ai[0] ? ai[0].src : LIBPIC('shop'), `<b class="s-head">${esc(b.oneLine)}</b>`, { ai: 1, cls: 'photo' }));
  if (f) {
    const it = f.pnl.items, rev = it[0].value, pat = it[it.length - 1].value, st = f.story || {}, c1 = it.find(x => x.kind === 'cost');
    const big = ai[2] || ai[1];
    cards.push(story('How big', big ? big.src : LIBPIC('warehouse'), `<div class="s-num">RM${cnt(rev / 1000, 1)} bn</div><b>revenue in ${esc(f.pnl.period)}</b>
      <div class="s-num sm">${esc(st.scale_value || '')}</div><b>${esc(st.scale_label || '')}</b>`, { ai: 1, cls: big ? 'photo' : '' }));
    cards.push(story('Out of every RM100', spic('rm100', 'coins'), (pat < 0 ? `<div class="s-num dn">−RM${cnt(-pat / rev * 100, 2)}</div><b>lost, before one-off gains</b>` : `<div class="s-num">RM${cnt(pat / rev * 100, 2)}</div><b>ends up as profit</b>`) + `
      <small>RM${(Math.abs(c1.value) / rev * 100).toFixed(0)} goes to ${esc(c1.label.toLowerCase())}</small>`, { ai: 1, cls: 'photo' }));
    const gr = f.growth;
    cards.push(story('Still growing?', spic('growth', 'growth'), `<div class="s-num ${gr.revenue >= 0 ? 'up' : 'dn'}">${gr.revenue >= 0 ? '▲' : '▼'} ${cnt(Math.abs(gr.revenue), 1, '', '%')}</div><b>revenue, ${esc(gr.period)}</b>
      ${gr.profit == null ? `<small>${esc(gr.profitNote || '')}</small>` : `<div class="s-num sm ${gr.profit >= 0 ? 'up' : 'dn'}">${gr.profit >= 0 ? '▲' : '▼'} ${Math.abs(gr.profit).toFixed(1)}%</div><b>profit, same period</b>`}`, { ai: 1, cls: 'photo' }));
    if (f.debt && f.debt.value) cards.push(story(f.debt.netCash ? 'Any debt?' : 'How much debt?', spic('debt', 'safe'), `<div class="s-num">${esc(f.debt.value)}</div><b>${esc(f.debt.label)}</b>
      ${(() => { const g = f.metrics.find(m => m.label.startsWith('Net gearing')); return g ? `<small>Net gearing ${esc(g.value)} of shareholders' funds</small>` : ''; })()}`, { ai: 1, cls: 'photo' }));
    const pe = f.metrics.find(m => m.label.startsWith('P/E'));
    cards.push(story('Price tag', spic('pricetag', 'pricetag'), `<div class="s-num">${pe ? esc(pe.value) : '–'}</div><b>times its yearly profit</b><small>${pe ? esc(plainOf(pe)) : ''}</small>`, { ai: 1, cls: 'photo' }));
  }
  cards.push(story('What analysts say', spic('analysts', 'binoculars'), `<div class="s-num">${avgTp ? 'RM' + num(avgTp) : '–'}</div><b>average target${avgTp && s.last ? ` (${(avgTp / s.last - 1) >= 0 ? '+' : ''}${((avgTp / s.last - 1) * 100).toFixed(0)}% from today)` : ''}</b>
    <small>${all.res ? `Past Bullish calls on this stock reached target ${pct(all.rate)} of the time (${all.hit} of ${all.res})` : 'Not enough past calls to judge accuracy'}</small>`, { ai: 1, cls: 'photo' }));
  const chips = [];
  if (f) {
    chips.push([f.growth.revenue >= 0 ? 'Growing revenue' : 'Revenue falling', f.growth.revenue >= 0 ? 'high' : 'low']);
    if (f.debt && f.debt.value) { const g = parseFloat((f.metrics.find(m => m.label.startsWith('Net gearing')) || {}).value); chips.push(f.debt.netCash ? ['Net cash', 'high'] : [g > 100 ? 'High debt' : 'Has net debt', g > 100 ? 'low' : 'medium']); }
    const pe = parseFloat((f.metrics.find(m => m.label.startsWith('P/E')) || {}).value);
    if (pe) chips.push([pe > 25 ? 'Priced for growth' : pe < 12 ? 'Low price tag' : 'Middle price tag', pe > 25 ? 'medium' : 'high']);
  }
  if (all.res >= 5) { const [t, k] = accuracy(all); chips.push([`Analyst accuracy: ${t}`, k]); }
  return `<div class="chips">${chips.map(([t, k]) => `<span class="badge ${k}">${esc(t)}</span>`).join('')}</div>
    <div class="stories" id="stories">${cards.join('')}</div>
    <div class="story-nav"><button class="btn ghost sm" data-dir="-1">‹</button><span class="sub">Swipe or use the arrows</span><button class="btn ghost sm" data-dir="1">›</button></div>
    ${f || b ? `<div class="next-hint">Want the details? ${[b && ['business', 'How the business works'], f && ['financial', 'The financials'], f && ['drivers', 'What moves the share price']].filter(Boolean).map(([k, t]) => `<a href="#" data-goto="${k}">${t} →</a>`).join('')}</div>` : ''}`;
}

function moneyPanel(f) {
  const it = f.pnl.items, rev = it[0].value, costs = it.filter(x => x.kind === 'cost'), pat = it[it.length - 1], incs = it.filter(x => x.kind === 'income');
  const loss = pat.value < 0, costParts = costs.map((c, i) => ({ l: c.label, v: Math.abs(c.value) / rev * 100, c: PIE_COLS[i % PIE_COLS.length], tip: c.tip }));
  const parts = [...costParts, { l: pat.label, v: pat.value / rev * 100, c: loss ? '#e0675a' : '#3fbf85', tip: pat.tip }];
  const spent = costParts.reduce((t, p) => t + p.v, 0);
  const T = f.trend, yoy = (a, i) => i % 2 === 1 && a[i - 1] ? `<br><small class="${a[i] >= a[i - 1] ? 'pos' : 'neg'}">${a[i] >= a[i - 1] ? '+' : ''}${((a[i] / Math.abs(a[i - 1]) - 1) * 100).toFixed(1)}%</small>` : '';
  const fy = f.fiveYear, fyMax = Math.max(...fy.revenue), pMax = Math.max(...fy.pat), seg = f.segments, h = f.how;
  const segTot = seg ? seg.rows.reduce((t, r) => t + r.revenue, 0) : 0, segP = seg ? seg.rows.reduce((t, r) => t + Math.max(0, r.profit), 0) : 0, gTot = seg && seg.geo ? seg.geo.reduce((t, r) => t + r.value, 0) : 0;
  return `<div class="glass card"><h2>Where every RM100 of revenue goes <small class="sub">${esc(f.pnl.period)}</small></h2>
    <div class="rm100-wrap">${loss ? donut(costParts, 'pie', 'RM' + spent.toFixed(0), 'spent per RM100') : donut(parts, 'pie')}
      <div class="rm100-list">${parts.map((p, i) => `<button class="rm-item" data-i="${i}"><i style="background:${p.c}"></i><span>${esc(p.l.replace(' (depreciation of leases)', ''))}</span><b class="${p.v < 0 ? 'neg' : ''}">${p.v < 0 ? '−' : ''}RM${Math.abs(p.v).toFixed(2)}</b></button>`).join('')}
        <div class="rm-tip" id="rm-tip"><b>Tap a slice or a line</b><br>to see what each cost means in everyday words.</div></div></div>
    <p class="note">${esc(f.pnl.incomeNote || (incs.length ? `Plus RM${(incs.reduce((t, x) => t + x.value, 0) / rev * 100).toFixed(2)} of other income per RM100.` : ''))}</p></div>
  ${seg ? `<div class="glass card"><h2>Its businesses <small class="sub">${esc(seg.period)}</small></h2>
    <div class="segs">${seg.rows.map((r, i) => `<div class="seg-card"><div class="seg-top"><i style="background:${PIE_COLS[i % PIE_COLS.length]}"></i><b>${esc(r.name)}</b></div>
      <div class="seg-bars"><span>Revenue</span><div class="sb"><i style="width:0;background:${PIE_COLS[i % PIE_COLS.length]}" data-w="${(r.revenue / segTot * 100).toFixed(1)}%"></i></div><b>RM${fmtM(r.revenue)} m · ${(r.revenue / segTot * 100).toFixed(0)}%</b>
        <span>Profit</span><div class="sb"><i style="width:0;background:#3fbf85" data-w="${(Math.max(0, r.profit) / segP * 100).toFixed(1)}%"></i></div><b class="${r.profit < 0 ? 'neg' : ''}">RM${fmtM(r.profit)} m · ${segP ? (r.profit / segP * 100).toFixed(0) : 0}%</b></div>
      ${r.tip ? `<p>${esc(r.tip)}</p>` : ''}</div>`).join('')}</div>
    ${seg.geo && seg.geo.length ? `<h3 style="margin-top:16px">Where revenue comes from</h3>${seg.geo.map(g => `<div class="geo-row"><span>${esc(g.name)}</span><div class="geo-bar"><i style="width:0" data-w="${(g.value / gTot * 100).toFixed(1)}%"></i></div><b>${(g.value / gTot * 100).toFixed(0)}%</b></div>`).join('')}` : ''}
    ${seg.note ? `<p class="note">${esc(seg.note)}</p>` : ''}</div>` : ''}
  <div class="glass card"><div class="head"><h2>Revenue and profit over time</h2><div class="seg" id="pl-mode"><button data-m="simple" class="on">Simple</button><button data-m="detail">Detailed</button></div></div>
    <div id="pl-simple">${fy.cols.map((y, i) => `<div class="fy big"><span>${y}</span><div class="fy-bars"><i class="r" data-w="${(fy.revenue[i] / fyMax * 100).toFixed(1)}%" style="width:0"></i><i class="p" data-w="${(Math.max(0, fy.pat[i]) / pMax * 100).toFixed(1)}%" style="width:0"></i></div>
      <div class="fy-n"><b>RM${(fy.revenue[i] / 1000).toFixed(2)} bn</b><b class="${fy.pat[i] < 0 ? 'neg' : 'pos'}">RM${Math.round(fy.pat[i]).toLocaleString()} m profit</b></div></div>`).join('')}
      <div class="legend"><span><i style="background:#c9a24a"></i>Revenue</span><span><i style="background:#3fbf85"></i>Profit (own scale)</span></div>
      ${fy.note ? `<p class="note">${esc(fy.note)}</p>` : ''}</div>
    <div id="pl-detail" hidden><div class="tablewrap"><table class="fin-t"><thead><tr><th>RM million</th>${T.cols.map(c => `<th class="num">${esc(c)}</th>`).join('')}</tr></thead><tbody>
      ${T.lines.map(l => `<tr class="${l.bold ? 'tot' : ''}"><td>${esc(l.label)}</td>${l.values.map((v, i) => `<td class="num">${v < 0 ? '(' + fmtM(-v) + ')' : fmtM(v)}${l.bold ? yoy(l.values, i) : ''}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <p class="note">Growth under each total compares with the period a year earlier.${f.fyNote ? ' ' + esc(f.fyNote) : ''}</p></div></div>
  <div class="glass card"><h2>${esc(h.title)}</h2><div class="fin-formula">
      <div class="wide"><small>The formula</small><b>${esc(h.text)}</b></div>
      ${h.facts.map(([k, v]) => `<div><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join('')}</div>
    ${f.segmentNote ? `<p class="note">${esc(f.segmentNote)}</p>` : ''}</div>`;
}

function waterfall(steps) {               // horizontal cash waterfall: totals, ups and downs (handles negative values)
  let run = 0; const pts = steps.map(s => { const from = s.total ? 0 : run; run = s.total ? s.v : run + s.v; return { ...s, from, to: s.total ? s.v : run }; });
  const mx = Math.max(0, ...pts.map(p => Math.max(p.from, p.to))), mn = Math.min(0, ...pts.map(p => Math.min(p.from, p.to))), W = mx - mn || 1, X = v => (v - mn) / W * 100;
  return `<div class="wf">${pts.map(p => { const a = X(Math.min(p.from, p.to)), w = Math.abs(p.to - p.from) / W * 100;
    return `<div class="wf-row"><span class="wf-l">${esc(p.l)}</span><div class="wf-track">${mn < 0 ? `<em style="left:${X(0).toFixed(2)}%"></em>` : ''}<i class="${p.total ? 'tot' : p.v >= 0 ? 'up' : 'dn'}" style="left:${a.toFixed(2)}%;width:0" data-w="${Math.max(.6, w).toFixed(2)}%"></i></div>
      <b class="${p.total ? '' : p.v >= 0 ? 'pos' : 'neg'}">${p.v >= 0 && !p.total ? '+' : ''}${Math.round(p.v).toLocaleString()}</b></div>`; }).join('')}</div>`;
}

function healthPanel(f) {
  const bs = f.balance, aTot = bs.assets.reduce((t, x) => t + x.value, 0), liabs = [...bs.liabilities, { label: "Shareholders' equity", value: bs.equity }];
  const ACOL = ['#c9a24a', '#e2c27a', '#8a8f98', '#5f6670', '#b38a3a', '#d8d2c2', '#3fbf85', '#9bd6b6'], LCOL = ['#c8503f', '#e0675a', '#8a8f98', '#d6336c', '#f0a3b5', '#3fbf85'];
  const stack = (arr, cols) => `<div class="bsbar">${arr.map((x, i) => x.value ? `<span style="width:0;background:${cols[i % cols.length]}" data-w="${(x.value / aTot * 100).toFixed(2)}%" title="${esc(x.label)}: RM${fmtM(x.value)} m"></span>` : '').join('')}</div>
    <div class="bs-legend">${arr.map((x, i) => `<div><i style="background:${cols[i % cols.length]}"></i>${esc(x.label)}<b>${fmtM(x.value)}</b></div>`).join('')}</div>`;
  const cf = f.cash;
  if (!cf) return `<div class="glass card"><h2>${esc(f.safetyTitle || 'How safe is the bank?')}</h2><p class="sub">${esc(f.safetyIntro || 'Banks are judged on their capital cushion and the quality of their loans, not on free cash flow. Tap a card to see what it means.')}</p>
    <div class="mcards">${(f.safety || []).map(m => `<button class="mcard"><small>${esc(m.label)}</small><b>${esc(m.value)}</b><span class="m-plain">${esc(m.plain)}</span></button>`).join('')}</div></div>
  <div class="glass card"><h2>What it owns vs. what it owes <small class="sub">${esc(bs.date)}, RM million</small></h2>
    <div class="owe-grid"><div><div class="owe-h">Owns <b>RM${cnt(aTot / 1000, 1)} bn</b></div>${stack(bs.assets, ACOL)}</div>
      <div><div class="owe-h">Funded by</div>${stack(liabs, LCOL)}</div></div>
    <div class="biz-note">${esc(bs.note)}</div></div>`;
  const end = cf.waterfall[cf.waterfall.length - 1];
  return `<div class="glass card"><h2>Where the cash came from and went <small class="sub">${esc(cf.wfPeriod)}, RM million</small></h2>
    ${waterfall(cf.waterfall)}
    <p class="note">${esc(cf.wfNote || `${end.l}: RM${Math.round(end.v)} m.`)}</p>
    <details class="more"><summary>See the full cash flow table</summary><div class="tablewrap"><table class="fin-t"><thead><tr><th>RM million</th>${cf.cols.map(c => `<th class="num">${esc(c)}</th>`).join('')}</tr></thead><tbody>
      ${cf.table.map(r => `<tr class="${r.bold ? 'tot' : ''}"><td>${esc(r.label)}</td>${r.values.map(v => `<td class="num">${v < 0 ? '(' + fmtM(-v) + ')' : fmtM(v)}</td>`).join('')}</tr>`).join('')}
    </tbody></table></div></details></div>
  <div class="glass card"><h2>What it owns vs. what it owes <small class="sub">${esc(bs.date)}, RM million</small></h2>
    <div class="owe-grid"><div><div class="owe-h">Owns <b>RM${cnt(aTot / 1000, 2)} bn</b></div>${stack(bs.assets, ACOL)}</div>
      <div><div class="owe-h">Funded by</div>${stack(liabs, LCOL)}</div></div>
    <div class="biz-note">${esc(bs.note)}</div></div>`;
}

function gauge(v, max, zones) {          // semicircle gauge; zones = [[upTo, label, cls], ...]
  const R = 70, C = [90, 86], ang = x => Math.PI * (1 - Math.min(Math.max(x, 0), max) / max), pt = (a, r = R) => [C[0] + r * Math.cos(a), C[1] - r * Math.sin(a)];
  let lo = 0; const arcs = zones.map(([hi, , cls]) => { const [x1, y1] = pt(ang(lo)), [x2, y2] = pt(ang(Math.min(hi, max))); lo = hi;
    return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)}A${R} ${R} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" class="gz ${cls}"/>`; }).join('');
  const deg = Math.min(Math.max(v, 0), max) / max * 180, zone = zones.find(([hi]) => v <= hi) || zones[zones.length - 1];
  return { svg: `<svg viewBox="0 0 180 100" class="gauge">${arcs}<g class="gneedle" style="--deg:${deg.toFixed(1)}deg"><line x1="${C[0]}" y1="${C[1]}" x2="${C[0] - R + 18}" y2="${C[1]}"/></g><circle cx="${C[0]}" cy="${C[1]}" r="6" class="ghub"/></svg>`, zone };
}
const VAL_GROUPS = [
  ['Price tag', 'Is the share cheap or expensive?', 'pricetag', /^(Market value|P\/E|EPS|Price to book|EV|Free cash flow yield)/],
  ['Business quality', 'Does it make good money?', 'growth', /^(Return on equity|Gross margin|Net margin|Revenue growth|Profit growth|Core profit|Net interest margin|Cost to income)/],
  ['Safety', 'Could it get into trouble?', 'safe', /^(Net cash|Net debt|Net gearing|Free cash flow(?! yield)|Inventory|Payable|Debt|Gearing|Current ratio|CET1|Capital|Loan|Gross impaired|CASA)/],
  ['Cash back to you', 'What do shareholders receive?', 'coins', /^(Dividend|Payout)/],
];
function valuationPanel(f) {
  const M = k => f.metrics.find(m => m.label.startsWith(k)), n = m => m ? parseFloat(String(m.value).replace(/[^0-9.\-]/g, '')) : NaN;
  const heroes = [
    ['01', 'Is the price high?', M('P/E'), 'pricetag', 50, [[12, 'Low price tag', 'good'], [20, 'Middle', 'mid'], [999, 'High price tag', 'warn']]],
    ['02', 'Is it a good business?', M('Return on equity'), 'growth', 50, [[10, 'Weak', 'warn'], [15, 'Fair', 'mid'], [999, 'Strong', 'good']]],
    ['03', 'What do I get paid?', M('Dividend yield'), 'coins', 8, [[2, 'Low payout', 'warn'], [5, 'Middle', 'mid'], [999, 'High payout', 'good']]],
  ].filter(h => h[2] && !isNaN(n(h[2])));
  const used = new Set(), groups = VAL_GROUPS.map(([t, q, pic, re]) => { const ms = f.metrics.filter(m => re.test(m.label) && !used.has(m)); ms.forEach(m => used.add(m)); return [t, q, pic, ms]; }).filter(g => g[3].length);
  const rest = f.metrics.filter(m => !used.has(m)); if (rest.length) groups.push(['Other', 'More numbers', 'magnifier', rest]);
  return `<div class="glass card"><div class="biz-tag">Start here</div><h2 style="margin-top:4px">Three questions, three numbers</h2>
    <div class="heroes">${heroes.map(([no, q, m, pic, max, zones]) => { const g = gauge(n(m), max, zones);
      return `<div class="hero-m"><div class="hm-top"><div class="hm-pic" ${bgPic(LIBPIC(pic))}></div><span class="hm-no">${no}</span><div class="hm-q">${q}</div></div>
        <div class="hm-g">${g.svg}<div class="hm-v">${esc(m.value)}</div></div><span class="badge ${g.zone[2] === 'good' ? 'high' : g.zone[2] === 'warn' ? 'medium' : ''}">${g.zone[1]}</span>
        <small class="hm-l">${esc(m.label)}</small><p>${esc(plainOf(m))}</p></div>`; }).join('')}</div>
    <p class="note">Gauge zones are general rules of thumb for reading these numbers, not official benchmarks; a fast-growing company often carries a high price tag.</p></div>
  <div class="glass card"><div class="biz-tag">Dig deeper</div><h2 style="margin-top:4px">Every number, grouped by the question it answers</h2><p class="sub">Tap a line to see what it means.</p>
    <div class="vgroups">${groups.map(([t, q, pic, ms]) => `<div class="vgroup"><div class="vg-head"><div class="vg-pic" ${bgPic(LIBPIC(pic))}></div><div><b>${t}</b><small>${q}</small></div></div>
      ${ms.map(m => `<button class="mrow"><span class="mr-l">${esc(m.label)}</span><b>${esc(m.value)}</b><span class="m-plain">${esc(plainOf(m))}</span></button>`).join('')}</div>`).join('')}</div>
    <p class="note">Valuation uses the share price of RM${f.price} on ${fdate(f.priceDate)}. "Last 12 months" = July 2025 to June 2026. These describe the company; they are not a recommendation.</p></div>`;
}

function outlookBlock(f) {
  const items = f.outlook.map(o => typeof o === 'string' ? { tone: 'Neutral', text: o } : o), ov = f.outlookOverall;
  const cls = t => /^Pos/.test(t) ? 'pos' : /^Neg/.test(t) ? 'neg' : 'neu', ic = t => /^Pos/.test(t) ? '▲' : /^Neg/.test(t) ? '▼' : '●';
  return `${ov ? `<div class="tone-meter ${cls(ov.tone)}"><small>Overall, management sounds</small><div class="tm-scale">${['Negative', 'Neutral', 'Positive'].map(t => `<span class="${t === ov.tone ? 'on' : ''}">${t}</span>`).join('')}</div><p>${esc(ov.text)}</p></div>` : ''}
    <div class="ol-list">${items.map(o => `<div class="ol-item ${cls(o.tone)}"><span class="ol-tone">${ic(o.tone)} ${esc(o.tone)}</span><p>${esc(o.text)}</p></div>`).join('')}</div>
    <p class="note">Tone is our plain reading of management's own words in its reports, not a forecast.</p>`;
}

function supplyBlock(sc) {                // who the company buys from and sells to (from its reports)
  const col = (title, icon, rows) => `<div class="sc-col"><div class="sc-h"><span class="ring ${icon === 'in' ? 'gold' : 'teal'}"><svg viewBox="0 0 24 24">${icon === 'in'
      ? '<path d="M3 12h13M11 6l6 6-6 6"/><path d="M21 4v16"/>' : '<path d="M3 4v16"/><path d="M8 12h13M15 6l6 6-6 6"/>'}</svg></span><div><b>${title}</b>
      <small>${icon === 'in' ? 'What it needs to run the business' : 'Who pays the company'}</small></div></div>
    ${rows.map(([who, what, src]) => `<div class="sc-row"><b>${esc(who)}</b><span>${esc(what)}</span><small>${esc(src)}</small></div>`).join('')}</div>`;
  return `<div class="glass card"><div class="biz-tag">Supply chain</div><h2 style="margin-top:4px">Who it buys from, and who it sells to</h2>
    <div class="sc-flow">${col('Suppliers', 'in', sc.suppliers)}<div class="sc-mid"><span>${'→'}</span></div>${col('Customers', 'out', sc.customers)}</div>
    ${sc.note ? `<p class="note">${esc(sc.note)}</p>` : ''}</div>`;
}

function driversPanel(f) {
  const kind = d => /^Positive/.test(d) ? 'pos' : /^Negative/.test(d) ? 'neg' : 'watch';
  return `<div class="glass card"><h2>What moves sales, profit and the share price</h2>
    <div class="filters chipsel" id="drv-f"><button class="on" data-k="all">All ${f.drivers.length}</button><button data-k="pos">▲ Helping ${f.drivers.filter(d => kind(d.direction) === 'pos').length}</button>
      <button data-k="neg">▼ Hurting ${f.drivers.filter(d => kind(d.direction) === 'neg').length}</button><button data-k="watch">● To watch ${f.drivers.filter(d => kind(d.direction) === 'watch').length}</button></div>
    <p class="sub">Tap a card to flip it.</p>
    <div class="flips">${f.drivers.map(d => `<div class="flip ${kind(d.direction)}" data-k="${kind(d.direction)}" tabindex="0"><div class="flip-in">
      <div class="flip-f"><div class="flip-pic" ${bgPic(d.pic || LIBPIC(picFor(d.factor)))}>${dirBadge(d.direction)}</div><div class="flip-t"><b>${esc(d.factor)}</b><span class="sub">Affects: ${esc(d.affects)}</span><small class="flip-hint">Tap to flip ↻</small></div></div>
      <div class="flip-b"><b>Why it matters</b><p>${esc(d.why)}</p><small>${esc(d.evidence)}</small></div></div></div>`).join('')}</div>
    <p class="note">"Helping" or "hurting" is a plain reading of each factor from the company's reports, not a forecast or a recommendation.</p></div>
  <div class="two"><div class="glass card"><h2>Competitors</h2>${f.competitors.map(c => `<div class="row-item"><span><b>${esc(c.name)}</b><br><small>${esc(c.how)}</small></span><small class="sub" style="max-width:40%;text-align:right">${esc(c.source)}</small></div>`).join('')}</div>
    <div class="glass card"><h2>Management's outlook</h2>${outlookBlock(f)}
      <p class="note">From ${f.sources.map(x => `<a href="${esc(x.url)}" target="_blank" rel="noopener" style="text-decoration:underline">${esc(x.title)}</a>`).join(' and ')}.</p></div></div>`;
}

async function stock(id, tab) {
  const s = BYID[id];
  if (!s) { view.innerHTML = '<h1>Stock not found</h1><a class="btn" href="#/stocks">Back to stocks</a>'; return; }
  const calls = CALLS_BY[id] || [];
  const get = u => fetch(u, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null);
  const [b, f] = await Promise.all([get(`data/b/${encodeURIComponent(id)}.json`), get(`data/f/${encodeURIComponent(id)}.json`)]);
  const latestCall = br => calls.find(c => c.broker === br);
  const rows = IDX.brokers.filter(br => s.latest[br]).map(br => {
    const l = s.latest[br], lc = latestCall(br), st = hitStats(calls.filter(c => c.broker === br)), bst = hitStats(CALLS_ALL.filter(c => c.broker === br));
    const ast = l.an ? hitStats(CALLS_ALL.filter(c => c.analyst === l.an)) : null, p0 = lc && lc.price;
    return `<tr><td><b>${bdot(br)}${esc(br)}</b></td><td>${fdate(l.d)}</td><td>${callBadge(l.call)}${l.orig && l.orig !== l.call ? ` <small class="sub">${esc(l.orig)}</small>` : ''}</td>
      <td class="num">${num(p0)}</td><td class="num">${num(l.tp)}</td><td class="num">${num(s.last)}</td>
      <td class="num">${p0 && s.last ? spct(s.last / p0 - 1) : '–'}</td><td class="num"><b>${l.tp && s.last ? spct(l.tp / s.last - 1) : '–'}</b></td>
      <td>${esc(plainAnalyst(l.an) || 'Not shown')}</td>
      <td class="num">${st.res ? `${pct(st.rate)} <small class="sub">(${st.hit}/${st.res})</small>` : '–'}</td><td>${accBadge(st)}</td>
      <td class="num">${st.days == null ? '–' : Math.round(st.days)}</td><td class="num">${spct(st.dd)}</td><td class="num">${pct(bst.rate)}</td><td class="num">${ast && ast.res >= 5 ? pct(ast.rate) : '–'}</td></tr>`;
  }).join('');
  const all = hitStats(calls);
  const tps = IDX.brokers.map(br => s.latest[br] && s.latest[br].tp).filter(Boolean), avgTp = tps.length ? avg(tps) : null;
  const has = { business: !!b, financial: !!(f && f.how), health: !!(f && f.balance && (f.cash || f.safety)), valuation: !!f, drivers: !!f };
  const tabs = TABS.filter(([k]) => has[k] !== false);
  if (tab === 'money') tab = 'financial';                 // old links
  tab = tabs.some(([k]) => k === tab) ? tab : 'overview';
  const panels = {
    overview: overviewPanel(s, b, f, calls, all, avgTp),
    business: b ? businessCard(b) + (f && f.supply ? supplyBlock(f.supply) : '') : '', financial: f ? moneyPanel(f) : '', health: f ? healthPanel(f) : '', valuation: f ? valuationPanel(f) : '', drivers: f ? driversPanel(f) : '',
    analysts: `<div class="glass card"><h2>Latest call and accuracy by broker</h2><div class="tablewrap"><table><thead><tr><th>Broker</th><th>Latest report</th><th>Call</th>
      <th class="num">Price at call</th><th class="num">Target price</th><th class="num">Latest price</th><th class="num">Change since call</th><th class="num">Latest price to target</th><th>Analyst</th>
      <th class="num">Bullish calls reached target (this stock)</th><th>Accuracy</th><th class="num">Avg days to target</th>
      <th class="num">Avg worst drop</th><th class="num">Broker, all stocks</th><th class="num">Analyst, all stocks</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="note">Change since call = latest price vs the price on the report. Latest price to target = how far the price still has to move to reach the target.
        Accuracy = share of resolved Bullish calls whose target was reached within 12 months: High 60%+, Medium 40–60%, Low under 40%; under 5 resolved calls is too few to judge.</p></div>
    <div class="glass card"><h2>All reports on this stock</h2><div class="tablewrap" style="max-height:520px"><table><thead><tr><th>Date</th><th>Broker</th><th>Call</th><th class="num">Price at call</th><th class="num">Target</th>
      <th class="num">Upside at call</th><th class="num">Change since call</th><th class="num">Latest price to target</th><th class="num">Up from 52w low</th><th class="num">Off 52w high</th><th>Result</th><th class="num">Days to target</th><th class="num">Worst drop</th><th class="num">6m return</th><th>Analyst</th></tr></thead>
      <tbody>${calls.map(c => { const [t, k] = status(c, 9); return `<tr><td>${fdate(c.date)}</td><td>${bdot(c.broker)}${esc(c.broker)}</td><td>${callBadge(c.call)}</td><td class="num">${num(c.price)}</td><td class="num">${num(c.tp)}</td>
        <td class="num">${spct(c.upside, 0)}</td><td class="num">${c.price && s.last ? spct(s.last / c.price - 1) : '–'}</td><td class="num">${c.tp && s.last ? spct(c.tp / s.last - 1) : '–'}</td>
        <td class="num">${spct(c.fromLow, 0)}</td><td class="num">${spct(c.fromHigh, 0)}</td><td><span class="badge ${k}">${t}</span></td>
        <td class="num">${c.days ?? '–'}</td><td class="num">${spct(c.maxdd)}</td><td class="num">${spct(c.t6m)}</td><td>${esc(plainAnalyst(c.analyst) || '–')}</td></tr>`; }).join('')}</tbody></table></div>
      <p class="note">Prices and targets are adjusted for later share splits and bonus issues. 6m return includes dividends.</p></div>`,
    price: `<div class="glass card"><div class="head"><h2>Price chart</h2>
        <div class="chart-tools"><div class="seg" id="range"><button data-d="91">3M</button><button data-d="182">6M</button><button data-d="365">1Y</button><button data-d="730">2Y</button><button data-d="0" class="on">5Y</button></div>
          <div class="seg" id="ctype"><button data-t="candle" class="on">Candles</button><button data-t="line">Line</button></div>
          <div class="seg" id="zoom"><button data-z="in" title="Zoom in">＋</button><button data-z="out" title="Zoom out">－</button><button data-z="reset" title="Show all">Reset</button></div></div></div>
      <div class="chart-layers" id="layers">${IDX.brokers.filter(br => calls.some(c => c.broker === br)).map(br => `<label><input type="checkbox" data-b="${esc(br)}" checked>${bdot(br)}${esc(br)}</label>`).join('')}
        <label><input type="checkbox" data-l="ma50" checked><i class="ln" style="background:#c9a24a"></i>50-day avg</label><label><input type="checkbox" data-l="ma200" checked><i class="ln" style="background:#e0913a"></i>200-day avg</label>
        <label><input type="checkbox" data-l="band"><i class="ln dash"></i>52-week high / low</label><label><input type="checkbox" data-l="tp" checked>Target lines</label></div>
      <canvas id="chart" class="chart"></canvas>
      <p class="note">Scroll on the chart to zoom, drag to move, double-click to show everything. Markers sit at the report date in each broker's colour: ▲ Bullish, ▼ Bearish, ● Neutral.
        Dashed lines show each broker's target until its next report. Prices are adjusted for splits and bonus issues, not for dividends.</p></div>
    <div class="glass card" id="perf"></div>`,
  };
  const chg = s.last && s.lo52 ? s.last / s.lo52 - 1 : null;
  view.innerHTML = `<div class="crumb"><a href="#/stocks">Stocks</a> › ${esc(s.t)}</div>
    <div class="stock-head"><h1>${esc(s.name)} <small class="sub" style="font-size:15px;letter-spacing:0">${esc(s.t)}${s.code ? ' · ' + esc(s.code) : ''}</small></h1>${searchBox('q-stock', 'Search another stock…')}</div>
    <div class="pricebar">
      <div class="c-blue"><span class="ring blue"><svg viewBox="0 0 24 24"><path d="M3 17l5-5 4 3 8-8"/><path d="M15 7h5v5"/></svg></span><div class="pb-body"><small>Last price</small><b>RM${num(s.last)}</b></div></div>
      <div class="c-pink"><span class="ring pink"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".6"/></svg></span><div class="pb-body"><small>Average analyst target</small><b>${avgTp ? 'RM' + num(avgTp) : '–'}</b> ${avgTp && s.last ? spct(avgTp / s.last - 1, 0) : ''}</div></div>
      <div class="c-gold"><span class="ring gold"><svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg></span><div class="pb-body"><small>52-week range</small><div class="range52"><span>${num(s.lo52)}</span><div class="r-track"><i style="left:${s.lo52 && s.hi52 && s.hi52 > s.lo52 ? ((s.last - s.lo52) / (s.hi52 - s.lo52) * 100).toFixed(0) : 50}%"></i></div><span>${num(s.hi52)}</span></div></div></div>
      <div class="c-teal"><span class="ring teal"><svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1M11 21v-3h2v3"/></svg></span><div class="pb-body"><small>Sector</small><b style="font-size:14px">${esc(s.sector || '–')}</b></div></div></div>
    <nav class="tabs" id="tabs">${tabs.map(([k, t]) => `<button data-t="${k}" class="${k === tab ? 'on' : ''}">${t}</button>`).join('')}</nav>
    <div id="panels">${tabs.map(([k]) => `<section class="panel stack" data-p="${k}" ${k === tab ? '' : 'hidden'}>${panels[k]}</section>`).join('')}</div>`;
  wireSearch('q-stock');
  let chartReady = false, px = null;
  const pxP = get(`data/s/${encodeURIComponent(id)}.json`).then(p => { if (p && !p.o) p = { ...p, o: p.c, h: p.c, l: p.c, v: p.c.map(() => 0) }; px = p; return p; });
  const show = async k => {
    document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x.dataset.t === k));
    document.querySelectorAll('#panels .panel').forEach(p => { p.hidden = p.dataset.p !== k; });
    history.replaceState(null, '', `#/stock/${encodeURIComponent(id)}${k === 'overview' ? '' : '/' + k}`);
    const p = document.querySelector(`.panel[data-p="${k}"]`); p.classList.remove('enter'); void p.offsetWidth; p.classList.add('enter'); countUps(p);
    $('#tabs').scrollIntoView({ block: 'nearest' });
    if (k === 'price' && !chartReady) { chartReady = true; await pxP; renderPerf(px); setupChart($('#chart'), px, calls); }
  };
  $('#tabs').onclick = e => { const t = e.target.closest('button'); if (t) show(t.dataset.t); };
  view.querySelectorAll('[data-goto]').forEach(a => a.onclick = e => { e.preventDefault(); show(a.dataset.goto); window.scrollTo({ top: $('#tabs').offsetTop - 10, behavior: 'smooth' }); });
  const st = $('#stories'); if (st) view.querySelectorAll('.story-nav button').forEach(bt => bt.onclick = () => st.scrollBy({ left: +bt.dataset.dir * st.clientWidth * .8, behavior: 'smooth' }));
  if (f) wireMoney(f); wireFlips();
  show(tab);
}

function renderPerf(px) {
  const pf = perfStats(px), perfEl = $('#perf'); if (!perfEl) return;
  perfEl.innerHTML = pf ? `<h2>Price performance <small class="sub" style="font-size:12px">(price only, excluding dividends, to ${fdate(px.d[px.d.length - 1])})</small></h2>
    <div class="perf">${pf.periods.map(([k, v]) => `<div class="perf-cell"><small>${k}</small><b>${spct(v)}</b></div>`).join('')}
      <div class="perf-cell"><small>5-year high / low</small><b>${num(pf.hi5)} / ${num(pf.lo5)}</b></div></div>
    ${pf.years.length ? `<h3 style="margin-top:16px">By calendar year</h3><div class="yearbars">${(() => { const m = Math.max(...pf.years.map(y => Math.abs(y[1])), .01);
      return pf.years.map(([y, v]) => `<div class="yb"><span class="yb-l">${esc(y)}</span><div class="yb-track"><i class="${v >= 0 ? 'up' : 'dn'}" style="width:${(Math.abs(v) / m * 50).toFixed(1)}%;${v >= 0 ? 'left:50%' : 'right:50%'}"></i></div><b>${spct(v)}</b></div>`).join(''); })()}</div>` : ''}` : '<h2>Price performance</h2><p class="sub">No price history for this stock.</p>';
}

function wireMoney(f) {
  const pie = $('#pie'); if (!pie) return;
  const it = f.pnl.items, rev = it[0].value, costs = it.filter(x => x.kind === 'cost'), pat = it[it.length - 1];
  const parts = [...costs, pat].map(x => ({ l: x.label, v: Math.abs(x.value) / rev * 100, m: Math.abs(x.value), tip: x.tip }));
  const pick = i => {
    pie.querySelectorAll('path').forEach((p, j) => p.classList.toggle('dim', j !== i));
    document.querySelectorAll('.rm-item').forEach((b, j) => b.classList.toggle('on', j === i));
    $('#pie-v').textContent = 'RM' + parts[i].v.toFixed(2); $('#pie-l').textContent = 'of every RM100';
    $('#rm-tip').innerHTML = `<b>${esc(parts[i].l)}</b><br>${esc(parts[i].tip || RM100_TIPS[parts[i].l] || '')}<br><small class="sub">RM${Math.round(parts[i].m).toLocaleString()} million in ${esc(f.pnl.period)}</small>`;
  };
  pie.querySelectorAll('path').forEach(p => { p.onclick = () => pick(+p.dataset.i); p.onmouseenter = () => pick(+p.dataset.i); });
  document.querySelectorAll('.rm-item').forEach(b => { b.onclick = () => pick(+b.dataset.i); b.onmouseenter = () => pick(+b.dataset.i); });
  const mode = $('#pl-mode');
  if (mode) mode.onclick = e => { const b = e.target.closest('button'); if (!b) return; [...mode.children].forEach(x => x.classList.toggle('on', x === b));
    $('#pl-simple').hidden = b.dataset.m !== 'simple'; $('#pl-detail').hidden = b.dataset.m === 'simple'; };
}

function wireFlips() {
  document.querySelectorAll('.flip').forEach(c => { c.onclick = () => c.classList.toggle('flipped'); c.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); c.classList.toggle('flipped'); } }; });
  const fl = $('#drv-f');
  if (fl) fl.onclick = e => { const b = e.target.closest('button'); if (!b) return; [...fl.children].forEach(x => x.classList.toggle('on', x === b));
    document.querySelectorAll('.flip').forEach(c => { c.hidden = b.dataset.k !== 'all' && c.dataset.k !== b.dataset.k; }); };
  document.querySelectorAll('.mcard, .mrow').forEach(c => c.onclick = () => c.classList.toggle('open'));
}

/* ---------- business profile (data/b/<id>.json, summarised from the company's annual report) ---------- */
const BIZ_COLORS = ['#c9a24a', '#6b6f76', '#d97757', '#a3a5aa', '#e6c983', '#46494f'];
function shareBar(items, key) {
  const tot = items.reduce((t, x) => t + (x[key] || 0), 0);
  if (!tot) return '';
  return `<div class="sharebar">${items.map((x, i) => x[key] ? `<span style="width:${(x[key] / tot * 100).toFixed(1)}%;background:${BIZ_COLORS[i % BIZ_COLORS.length]}" title="${esc(x.name)}: ${(x[key] / tot * 100).toFixed(0)}%"></span>` : '').join('')}</div>`;
}
/* simple line icons for the "how it makes money" flow, chosen from the step's wording */
const ICON_PATHS = {
  shop: '<path d="M4 10l1.5-5h13L20 10"/><path d="M4 10h16v9H4z"/><path d="M9 19v-5h6v5"/><path d="M4 10c0 1.5 1.3 2.5 2.7 2.5S9.3 11.5 9.3 10c0 1.5 1.2 2.5 2.7 2.5s2.7-1 2.7-2.5c0 1.5 1.3 2.5 2.6 2.5S20 11.5 20 10"/>',
  truck: '<path d="M3 7h11v9H3z"/><path d="M14 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="17" cy="9" r="2.4"/><path d="M15.5 14.2c2.6-.5 4.6 1.2 5 4.3"/>',
  factory: '<path d="M3 20V10l5 3V10l5 3V6h3v14z"/><path d="M16 20h5V4h-3"/><path d="M7 17h2M11 17h2"/>',
  ship: '<path d="M3 15l2 4h14l2-4z"/><path d="M6 15V9h12v6"/><path d="M10 9V5h4v4"/><path d="M2 21c2 0 2-1 4-1s2 1 4 1 2-1 4-1 2 1 4 1 2-1 4-1"/>',
  plane: '<path d="M2 13l8-1 6-8h2l-3 8 5 1 2-2h1l-1 4 1 4h-1l-2-2-5 1 3 8h-2l-6-8-8-1z" transform="scale(.85) translate(2 0)"/>',
  hospital: '<path d="M4 20V7h16v13"/><path d="M2 20h20"/><path d="M12 9v5M9.5 11.5h5"/><path d="M10 20v-3h4v3"/>',
  bank: '<path d="M3 9l9-5 9 5"/><path d="M4 9h16"/><path d="M6 10v7M10 10v7M14 10v7M18 10v7"/><path d="M3 20h18"/>',
  crane: '<path d="M5 21V4h2v17"/><path d="M7 5h13"/><path d="M7 5l4 4"/><path d="M17 5v5"/><path d="M15.5 10h3v2h-3z"/><path d="M3 21h8"/>',
  power: '<path d="M13 2L5 14h6l-1 8 8-12h-6z"/>',
  water: '<path d="M12 3c3.5 4.5 6 7.6 6 10.5A6 6 0 0 1 6 13.5C6 10.6 8.5 7.5 12 3z"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>',
  coins: '<ellipse cx="12" cy="6" rx="7" ry="2.5"/><path d="M5 6v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6"/><path d="M5 10v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-4"/><path d="M5 14v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-4"/>',
  contract: '<path d="M6 2.5h9l4 4v15H6z"/><path d="M15 2.5v4h4"/><path d="M9 11h7M9 14.5h7M9 18h4"/>',
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>',
  lab: '<path d="M9 3h6"/><path d="M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3"/><path d="M7.5 15h9"/>',
  box: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
  app: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
};
const ICON_RULES = [[/hospital|patient|clinic|healthcare/, 'hospital'], [/laborator|lab test|diagnos/, 'lab'], [/ship|vessel|tanker|offshore|maritime|cargo customers/, 'ship'],
  [/aircraft|flight|airline|passeng|aviation/, 'plane'], [/distribution|warehouse|lorr|logistic|freight|deliver/, 'truck'], [/mini-?mart|shop|outlet|store|retail/, 'shop'],
  [/water|sewer/, 'water'], [/power|electric|energy/, 'power'], [/mobile|network|telecom|data plan/, 'phone'], [/deposit|bank|lend|borrow|loan/, 'bank'],
  [/build|construct|contractor|tunnel|rail|infrastructure|project/, 'crane'], [/land|township|home|propert/, 'home'], [/contract|award|wins|bid/, 'contract'],
  [/factory|precast|plant|yard|engineering/, 'factory'], [/supplier|goods|stock|product/, 'box'], [/app|platform|digital|brand/, 'app'],
  [/shopper|customer|people|user/, 'people'], [/profit|fee|bill|paid|pay|income|money|rent/, 'coins']];
function flowIcon(f) {
  const t = `${f.label} ${f.detail}`.toLowerCase(), hit = ICON_RULES.find(([rx]) => rx.test(f.label.toLowerCase())) || ICON_RULES.find(([rx]) => rx.test(t));
  const k = f.icon || (hit ? hit[1] : 'coins');
  return `<svg class="ficon" viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[k] || ICON_PATHS.coins}</svg>`;
}
function mediaBlock(b) {
  const ph = (b.photos || []).map(p => `<figure class="photo"><a href="${esc(p.page)}" target="_blank" rel="noopener"><img src="${esc(p.src)}" alt="${esc(p.caption)}" loading="lazy"></a>
    <figcaption>${esc(p.caption)}<br><small>Photo: ${esc(p.author)}, <a href="${esc(p.licenseUrl || p.page)}" target="_blank" rel="noopener">${esc(p.license)}</a>, via <a href="${esc(p.page)}" target="_blank" rel="noopener">Wikimedia Commons</a></small></figcaption></figure>`).join('');
  const v = b.video ? `<figure class="video"><div class="vframe"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(b.video.id)}" title="${esc(b.video.title)}" loading="lazy"
      allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>
    <figcaption>${esc(b.video.title)}<br><small>Video from the company's own YouTube channel: <a href="${esc(b.video.channelUrl)}" target="_blank" rel="noopener">${esc(b.video.channel)}</a></small></figcaption></figure>` : '';
  return ph || v ? `<h3 style="margin-top:18px">See the business</h3><div class="media">${v}${ph}</div>` : '';
}

function businessCard(b) {
  const segTot = b.segments.reduce((t, x) => t + (x.revenue || 0), 0), hasProfit = b.segments.some(x => x.profit != null);
  const profTot = b.segments.reduce((t, x) => t + (x.profit || 0), 0), geoMax = Math.max(...(b.geography || []).map(g => g.value), 1);
  const fmt = v => v >= 100 ? Math.round(v).toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return `<div class="glass card biz">
    <div class="biz-tag">The business in plain words</div>
    <div class="biz-one">${esc(b.oneLine)}</div>
    <ul class="biz-plain">${b.inPlainWords.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
    ${(b.aiImages || []).length ? `<div class="aigal">${b.aiImages.map(x => `<figure><div class="aiwrap"><img src="${esc(x.src)}" alt="${esc(x.caption)}" loading="lazy"><span class="aibadge">AI-generated illustration</span></div><figcaption>${esc(x.caption)}</figcaption></figure>`).join('')}</div>
      <p class="note" style="margin-top:4px">These pictures were created with AI to help explain the business. They are not photos of the company, its premises or its people.</p>` : b.illustration ? `<figure class="illus"><img src="${esc(b.illustration.src)}" alt="${esc(b.illustration.alt)}"><figcaption>Illustration, not a photo. Drawn to explain the business model; figures are from the company's annual report.</figcaption></figure>` : ''}
    <h3>${esc(b.flowTitle || 'How it makes money')}</h3>
    <div class="flow">${b.flow.map((f, i) => `${i ? '<div class="arrow">→</div>' : ''}<div class="flow-step">${flowIcon(f)}<b>${esc(f.label)}</b><span>${esc(f.detail)}</span></div>`).join('')}</div>
    ${b.moneyNote ? `<p class="biz-note">${esc(b.moneyNote)}</p>` : ''}
    ${mediaBlock(b)}
    <div class="two" style="margin-top:18px">
      <div><h3>${esc(b.segmentsTitle)}</h3>
        <div class="sub">Share of revenue</div>${shareBar(b.segments, 'revenue')}
        ${hasProfit ? `<div class="sub" style="margin-top:8px">Share of profit</div>${shareBar(b.segments, 'profit')}` : ''}
        ${b.segments.map((x, i) => `<div class="seg-row"><i style="background:${BIZ_COLORS[i % BIZ_COLORS.length]}"></i><div><b>${esc(x.name)}</b><br><small class="sub">${esc(x.desc || '')}</small></div>
          <div class="seg-num"><b>${fmt(x.revenue)}</b> <small class="sub">${segTot ? (x.revenue / segTot * 100 < 1 ? 'under 1' : (x.revenue / segTot * 100).toFixed(0)) + '% of revenue' : ''}</small>
          ${x.profit != null ? `<br><small class="sub">profit ${fmt(x.profit)} · ${(x.profit / profTot * 100).toFixed(0)}%</small>` : ''}</div></div>`).join('')}
        ${b.segmentNote ? `<p class="note">${esc(b.segmentNote)}</p>` : ''}</div>
      <div><h3>${esc(b.geographyTitle || 'Where it operates')}</h3>
        ${(b.geography || []).map(g => `<div class="geo-row"><span>${esc(g.name)}</span><div class="geo-bar"><i style="width:${(g.value / geoMax * 100).toFixed(1)}%"></i></div><b>${fmt(g.value)}</b></div>`).join('')}</div>
    </div>
    <div class="stats" style="margin:18px 0 0">${b.keyFacts.map(k => `<div class="stat"><small>${esc(k.label)}</small><b style="font-size:15px">${esc(k.value)}</b></div>`).join('')}</div>
    <p class="note">Summarised from the company's own report: <a href="${esc(b.source.url)}" target="_blank" rel="noopener" style="text-decoration:underline">${esc(b.source.title)}</a> · ${esc(b.period)}.
      Figures marked "calculated" are worked out from the reported numbers.</p></div>`;
}

function latest() {
  view.innerHTML = `<h1>Latest reports</h1>
    <div class="filters"><label>Broker<select id="l-b"><option value="">All brokers</option>${IDX.brokers.map(b => `<option>${esc(b)}</option>`).join('')}</select></label>
      <label>Call<select id="l-c"><option value="">All calls</option><option value="BUY">Bullish</option><option value="NEUTRAL">Neutral</option><option value="SELL">Bearish</option><option value="NOT RATED">Not rated</option></select></label>
      <label>Reports from<input type="date" id="l-from" value="${daysAgo(IDX.last, 6)}"></label><label>Reports to<input type="date" id="l-to" value="${IDX.last}"></label>
      <label>Cut loss %<input type="number" id="l-stop" value="10" min="0" max="100" step="1"></label></div>
    <div class="glass card"><div class="tablewrap"><table><thead><tr><th>Date</th><th>Broker</th><th>Stock</th><th>Call</th><th class="num">Price on report</th><th class="num">Target</th><th class="num">Upside</th>
      <th class="num">Up from 52w low</th><th class="num">Off 52w high</th><th class="num">Cut-loss price</th><th class="num">Worst drop so far</th><th>Status now</th><th>Analyst</th></tr></thead><tbody id="rows"></tbody></table></div>
      <p class="note" id="count"></p></div>`;
  const draw = () => {
    const b = $('#l-b').value, c = $('#l-c').value, f = $('#l-from').value, t = $('#l-to').value, stop = (+$('#l-stop').value || 0) / 100 || 9;
    const list = CALLS.filter(x => (!b || x.broker === b) && (!c || x.call === c) && (!f || x.date >= f) && (!t || x.date <= t));
    $('#rows').innerHTML = list.slice(0, 600).map(x => { const [s, k] = status(x, stop); return `<tr><td>${fdate(x.date)}</td><td>${esc(x.broker)}</td><td>${stockLink(x.id)}</td><td>${callBadge(x.call)}</td>
      <td class="num">${num(x.price)}</td><td class="num">${num(x.tp)}</td><td class="num">${spct(x.upside, 0)}</td><td class="num">${spct(x.fromLow, 0)}</td><td class="num">${spct(x.fromHigh, 0)}</td>
      <td class="num">${x.upside > 0 && stop < 1 && x.price ? num(x.price * (1 - stop)) : '–'}</td><td class="num">${spct(x.maxdd)}</td><td><span class="badge ${k}">${s}</span></td>
      <td>${esc((x.analyst || '–').replace(/ \((Kenanga|RHB|MIDF)\)$/, ''))}</td></tr>`; }).join('');
    $('#count').textContent = `${list.length.toLocaleString()} reports${list.length > 600 ? ' (showing the newest 600)' : ''}. The cut loss applies only to calls with the target above the price.`;
  };
  ['l-b', 'l-c', 'l-from', 'l-to', 'l-stop'].forEach(id => $('#' + id).addEventListener('input', draw));
  draw();
}

function brokers() {
  view.innerHTML = `<h1>Broker accuracy</h1>
    <div class="filters"><label>Period<select id="b-p"><option value="2023-01-01">Since 2023 (same period for all)</option><option value="${daysAgo(IDX.last, 730)}">Last 2 years</option><option value="">All history</option></select></label>
      <label>Cut loss %<input type="number" id="b-stop" value="10" min="0" max="100" step="1"></label></div><div class="stack" id="out"></div>`;
  const bucket = (list, field, defs) => defs.map(([lab, a, b]) => { const st = hitStats(list.filter(c => c.upside > 0 && c[field] != null && c[field] >= a && c[field] < b)); return `<tr><td>${lab}</td><td class="num">${st.res.toLocaleString()}</td><td class="num"><b>${pct(st.rate)}</b></td><td class="num">${spct(st.t6)}</td></tr>`; }).join('');
  const draw = () => {
    const from = $('#b-p').value, stop = (+$('#b-stop').value || 0) / 100 || 9, list = CALLS_ALL.filter(c => !from || c.date >= from);
    const row = (name, l) => { const st = hitStats(l), cs = cutStats(l, stop); return `<tr><td><b>${esc(name)}</b></td><td class="num">${l.length.toLocaleString()}</td><td class="num">${st.res.toLocaleString()}</td>
      <td class="num"><b>${pct(st.rate)}</b></td><td class="num">${pct(cs.rate)}</td><td class="num">${pct(cs.stopped)}</td><td class="num">${st.days == null ? '–' : Math.round(st.days)}</td><td class="num">${spct(st.dd)}</td><td class="num">${spct(st.t6)}</td></tr>`; };
    $('#out').innerHTML = `<div class="glass card"><h2>Bullish calls by broker</h2><div class="tablewrap"><table><thead><tr><th>Broker</th><th class="num">Reports</th><th class="num">Bullish calls resolved</th><th class="num">Reached target</th>
      <th class="num">Reached target with cut loss</th><th class="num">Stopped out</th><th class="num">Avg days to target</th><th class="num">Avg worst drop</th><th class="num">Avg 6m return</th></tr></thead>
      <tbody>${IDX.brokers.map(b => row(b, list.filter(c => c.broker === b))).join('')}${row('All brokers', list)}</tbody></table></div>
      <p class="note">Reached target = the daily high touched the target price within 12 months. With a cut loss, a call counts as stopped out if the price first fell that far below the report price.</p></div>
      <div class="two"><div class="glass card"><h2>Price vs 52-week low when the call was made</h2><table><thead><tr><th>Where the price was</th><th class="num">Calls resolved</th><th class="num">Reached target</th><th class="num">Avg 6m return</th></tr></thead>
        <tbody>${bucket(list, 'fromLow', [['0–10% above the low', 0, .1], ['10–25% above', .1, .25], ['25–50% above', .25, .5], ['50–100% above', .5, 1], ['More than 100% above', 1, 99]])}</tbody></table></div>
      <div class="glass card"><h2>Price vs 52-week high when the call was made</h2><table><thead><tr><th>Where the price was</th><th class="num">Calls resolved</th><th class="num">Reached target</th><th class="num">Avg 6m return</th></tr></thead>
        <tbody>${bucket(list, 'fromHigh', [['Within 5% of the high', -.05, 9], ['5–15% below', -.15, -.05], ['15–30% below', -.3, -.15], ['More than 30% below', -9, -.3]])}</tbody></table></div></div>`;
  };
  ['b-p', 'b-stop'].forEach(id => $('#' + id).addEventListener('input', draw));
  draw();
}

function method() {
  view.innerHTML = `<h1>How it works</h1><div class="glass card prose">
    <h3>What this measures</h3><ul>
      <li><b>Reached target:</b> the share price's daily high touched the analyst's target price within 12 months of the report.</li>
      <li><b>Accuracy rating:</b> share of resolved Bullish calls that reached target. High is 60% or more, Medium 40–60%, Low under 40%. Fewer than 5 resolved calls is too few to judge.</li>
      <li><b>Worst drop:</b> the lowest price between the report and the day the target was reached (or the end of the 12 months).</li>
      <li><b>Cut loss:</b> a call counts as stopped out if the price fell that far below the report price before reaching the target.</li>
      <li><b>Up from 52-week low / off 52-week high:</b> where the report price stood against the previous 12 months' lowest and highest prices.</li>
      <li><b>Calls:</b> shown as Bullish, Neutral, Bearish or Not Rated, not as buy or sell advice. A broker's Buy or Outperform is shown as Bullish, Hold or Market Perform as Neutral, and Sell or Underperform as Bearish.</li></ul>
    <h3>Data</h3><ul><li>${IDX.reports.toLocaleString()} company reports from ${IDX.brokers.map(esc).join(', ')}, ${fdate(IDX.first)} to ${fdate(IDX.last)}.</li>
      <li>Prices and dividends to ${fdate(IDX.asof)}; data refreshed ${esc(IDX.generated)}.</li>
      <li>Stocks no longer listed on Bursa are left out of the stock lists, but their past calls still count in the broker accuracy figures.</li>
      <li>Reports whose printed price does not match the market price, or whose stock has no price history, are left out of the accuracy figures.</li>
      <li>Kenanga, RHB and MIDF calls are read from their full reports. Calls from other brokers (for example CGS International, Malacca Securities and Maybank IB) are read from the brokers' own research summaries posted in public market channels; when a post gives no share price, the previous day's close is used. These newer sources have few resolved calls so far.</li></ul>
    <h3>Important</h3><p>This site is independent research based on publicly available broker reports and market prices. It is not investment advice or a recommendation to buy or sell any security, and past accuracy does not predict future results. Figures are read automatically from reports and may contain errors.</p></div>`;
}

/* ---------- financial sector (data/sector/financials.json, written by fundamentals/database/export_sector_web.py) ---------- */
let SECTOR = null;
const fpct = (v, d = 1) => v == null || isNaN(v) ? '–' : (v * 100).toFixed(d) + '%';
const coLink = r => r.id && BYID[r.id] ? `<a href="#/stock/${esc(r.id)}" style="text-decoration:underline">${esc(r.name)}</a>` : esc(r.name);
function spark(pts, w = 120, h = 34) {
  const p = (pts || []).filter(x => x[1] != null); if (p.length < 2) return '<small class="sub">–</small>';
  const v = p.map(x => x[1]), lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
  const xy = p.map((x, i) => [i / (p.length - 1) * (w - 6) + 3, h - 3 - (x[1] - lo) / span * (h - 6)]);
  const [lx, ly] = xy[xy.length - 1];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="trend ${esc(p[0][0])} to ${esc(p[p.length - 1][0])}">`
    + `<polyline points="${xy.map(a => a[0].toFixed(1) + ',' + a[1].toFixed(1)).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>`
    + `<circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2.6" fill="var(--accent)"/></svg>`;
}
const scoreBar = (v, max = 100, label) => v == null ? '–' : `<div class="sbar"><i style="width:${Math.max(3, Math.min(100, v / max * 100)).toFixed(0)}%"></i><span>${label ?? Number(v).toFixed(0)}</span></div>`;
const monthName = m => new Date(m + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
const bankPriceDate = S => { const d = S.banks.map(b => b.valuation['Price date']).filter(Boolean).sort().pop(); return d ? fdate(d) : '–'; };

/* multi-line chart: series = [{name, pts:[[label, value]], color}], months on the x axis */
const LC_COLS = ['#c9a24a', '#6c63d9', '#2e8b6e', '#d97757', '#6b6f76', '#4a90c9'];
function lineChart(series, { w = 760, h = 260, unit = '%', dec = 2, step = false } = {}) {
  const all = series.flatMap(s => s.pts.filter(p => p[1] != null));
  if (!all.length) return '<p class="sub">No data.</p>';
  const xs = [...new Set(all.map(p => p[0]))].sort(), xi = Object.fromEntries(xs.map((x, i) => [x, i]));
  let lo = Math.min(...all.map(p => p[1])), hi = Math.max(...all.map(p => p[1])); const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
  const L = 44, R = 10, T = 10, B = 26, X = i => L + i / Math.max(1, xs.length - 1) * (w - L - R), Y = v => T + (hi - v) / (hi - lo) * (h - T - B);
  const ticks = 5, grid = [...Array(ticks + 1)].map((_, i) => lo + (hi - lo) * i / ticks);
  const years = xs.filter((x, i) => x.endsWith('-01') || i === 0);
  const path = s => { const p = s.pts.filter(q => q[1] != null && q[0] in xi); if (!p.length) return '';
    let d = ''; p.forEach((q, i) => { const x = X(xi[q[0]]), y = Y(q[1]); if (!i) d += `M${x.toFixed(1)},${y.toFixed(1)}`; else if (step) d += `H${x.toFixed(1)}V${y.toFixed(1)}`; else d += `L${x.toFixed(1)},${y.toFixed(1)}`; });
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.thick ? 2.6 : 1.8}" stroke-linejoin="round"/>`; };
  const lastv = s => { const p = s.pts.filter(q => q[1] != null); return p.length ? p[p.length - 1][1] : null; };
  return `<div class="lchart"><svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(series.map(s => s.name).join(', '))}">
    ${grid.map(g => `<line x1="${L}" x2="${w - R}" y1="${Y(g).toFixed(1)}" y2="${Y(g).toFixed(1)}" stroke="var(--line)"/><text x="${L - 6}" y="${(Y(g) + 4).toFixed(1)}" text-anchor="end" class="ax">${g.toFixed(dec > 1 ? 1 : dec)}${unit}</text>`).join('')}
    ${years.map(x => `<text x="${X(xi[x]).toFixed(1)}" y="${h - 6}" text-anchor="middle" class="ax">${x.slice(0, 4)}</text>`).join('')}
    ${series.map(path).join('')}</svg>
    <div class="legend">${series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)} <b>${lastv(s) == null ? '' : Number(lastv(s)).toFixed(dec) + unit}</b></span>`).join('')}</div></div>`;
}
const corrCell = v => v == null ? '<td class="num">–</td>' : `<td class="num"><span class="corr" style="--c:${v >= 0 ? 'var(--green)' : 'var(--red)'};--a:${Math.min(1, Math.abs(v)).toFixed(2)}">${v > 0 ? '+' : ''}${v.toFixed(2)}</span></td>`;
const corrWord = v => v == null ? '' : Math.abs(v) >= 0.6 ? 'strong' : Math.abs(v) >= 0.3 ? 'moderate' : Math.abs(v) >= 0.15 ? 'weak' : 'no clear link';
let SECTOR_NEWS = null;

async function sector(tab) {
  if (!SECTOR) {
    view.innerHTML = '<p class="loading">Loading the financial sector…</p>';
    SECTOR = await fetch('data/sector/financials.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null);
  }
  const S = SECTOR;
  if (!S) { view.innerHTML = '<h1>Financial sector</h1><p>The sector data file is not available yet.</p>'; return; }
  const I = S.industry, K = I.kpis;
  const TABS_S = [['overview', 'Industry'], ['drivers', 'What drives banks'], ['rates', 'Interest rates'], ['share', 'Market share'], ['banks', 'Banks'], ['nonbanks', 'Insurers & other financials'], ['news', 'News'], ['season', 'Results season'], ['method', 'How it works']];
  tab = TABS_S.some(([k]) => k === tab) ? tab : 'overview';
  const sname = { 'Loans growth (y/y)': 'Loan growth (y/y)', 'Deposits growth (y/y)': 'Deposit growth (y/y)', 'Gross impaired loans ratio': 'Gross impaired loans ratio',
    'CASA ratio': 'CASA ratio (current + savings deposits)', 'CET1 ratio': 'CET1 capital ratio', 'Liquidity coverage ratio': 'Liquidity coverage ratio' };
  const dec = k => /impaired|CET1/.test(k) ? 2 : /Liquidity/.test(k) ? 0 : 1;

  const overview = `<div class="pricebar">
      <div><small>System loans</small><b>RM${K['System loans (RM bn)'] ? Number(K['System loans (RM bn)']).toLocaleString('en-GB', { maximumFractionDigits: 0 }) : '–'} bn</b></div>
      <div><small>Loan growth y/y</small><b>${fpct(K['Loan growth (y/y)'])}</b></div>
      <div><small>Gross impaired loans</small><b>${fpct(K['Gross impaired loans ratio'], 2)}</b></div>
      <div><small>CASA ratio</small><b>${fpct(K['CASA ratio'])}</b></div>
      <div><small>CET1 ratio</small><b>${fpct(K['CET1 ratio'], 2)}</b></div>
      <div><small>Liquidity coverage</small><b>${fpct(K['Liquidity coverage ratio'], 0)}</b></div>
      <div><small>OPR</small><b>${fpct(K.OPR, 2)}</b></div></div>
    <div class="glass card"><h2>Malaysian banking system, ${monthName(I.month)}</h2>
      <div class="sgrid">${Object.entries(I.series).map(([k, s]) => `<div class="sbox"><small>${esc(sname[k] || k)}</small><b>${fpct(s.length ? s[s.length - 1][1] : null, dec(k))}</b>${spark(s, 220, 54)}<small class="sub">${s.length ? monthName(s[0][0]) + ' – ' + monthName(s[s.length - 1][0]) : ''}</small></div>`).join('')}</div>
      <p class="note">${esc(I.source)}</p></div>
    <div class="two"><div class="glass card"><h2>What the system lends for</h2>${Object.entries(I.loan_mix).filter(e => e[1] != null).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="row-item"><span>${esc(k[0].toUpperCase() + k.slice(1))}</span><span style="min-width:45%">${scoreBar(v * 100, 50, fpct(v))}</span></div>`).join('')}
        <p class="note">Share of total banking-system loans for the main household loan types.</p></div>
      <div class="glass card"><h2>Interest-rate decisions (OPR)</h2>${I.opr_moves.length ? I.opr_moves.slice().reverse().map(o => `<div class="row-item"><span>${fdate(o.date)}</span><span><b>${Number(o.level).toFixed(2)}%</b> <small class="${o.change > 0 ? 'neg' : 'pos'}">${o.change > 0 ? '+' : ''}${Number(o.change).toFixed(2)} pts</small></span></div>`).join('') : '<p>No changes in the period.</p>'}
        <p class="note">Bank Negara's Overnight Policy Rate. Changes move what banks earn on loans and pay on deposits.</p></div></div>
    <div class="two"><div class="glass card"><h2>Bank ranking at a glance</h2>${S.banks.map(b => `<div class="row-item"><span><b>${b.rank}.</b> ${coLink(b)}<br><small>${fpct(b.market_share)} of system loans</small></span><span style="min-width:40%">${scoreBar(b.score)}</span></div>`).join('')}
        <a class="btn" style="margin-top:10px;display:inline-block" href="#/sector/banks">Full bank scorecard</a></div>
      <div class="glass card"><h2>Results season — quarter to ${fdate(S.season_quarter)}</h2>
        <div class="sub" style="margin-bottom:8px">${S.season.filter(x => x.reported).length} of ${S.season.length} companies up to date</div>
        ${S.season.filter(x => x.reported).map(x => `<div class="row-item"><span>${coLink(x)}<br><small>${esc(x.latest_label)} · ${esc(x.group)}</small></span><span class="badge high">Reported</span></div>`).join('')}
        <a class="btn" style="margin-top:10px;display:inline-block" href="#/sector/season">Who is still due</a></div></div>`;

  const bm = (b, k, d = 1) => fpct(b.metrics[k], d);
  const cats = Object.keys(S.banks[0].categories);
  const banks = `<div class="glass card"><h2>Bank scorecard — 12 months to ${fdate(S.peer_date)}</h2>
      <div class="tablewrap"><table><thead><tr><th>#</th><th>Bank</th><th>Overall</th>${cats.map(c => `<th class="num">${esc(c)}</th>`).join('')}
        <th class="num">ROE</th><th class="num">Cost-to-income</th><th class="num">Credit cost</th><th class="num">Gross impaired loans</th><th class="num">CET1</th><th class="num">CASA</th>
        <th class="num">Loan growth</th><th class="num">Profit growth</th><th class="num">Share of system loans</th><th class="num">P/E</th><th class="num">P/B</th><th class="num">Dividend yield</th><th>Profit, last 8 quarters</th></tr></thead>
      <tbody>${S.banks.map(b => `<tr><td>${b.rank}</td><td><b>${coLink(b)}</b><br><small class="sub">latest: ${esc(b.latest_label)}</small></td><td style="min-width:110px">${scoreBar(b.score)}</td>
        ${cats.map(c => `<td class="num">${b.categories[c] == null ? '–' : Math.round(b.categories[c])}</td>`).join('')}
        <td class="num">${bm(b, 'ROE (12m)')}</td><td class="num">${bm(b, 'Cost-to-income')}</td><td class="num">${b.metrics['Credit cost'] == null ? '–' : Math.round(b.metrics['Credit cost']) + ' bp'}</td><td class="num">${bm(b, 'Gross impaired loans ratio', 2)}</td>
        <td class="num">${bm(b, 'CET1 ratio')}</td><td class="num">${bm(b, 'CASA ratio')}</td><td class="num">${spct(b.metrics['Loan growth (y/y)'])}</td><td class="num">${spct(b.metrics['Profit growth (12m)'])}</td>
        <td class="num">${fpct(b.market_share)}</td><td class="num">${num(b.valuation['P/E (x)'], 1)}</td><td class="num">${num(b.valuation['P/B (x)'], 2)}</td><td class="num">${fpct(b.valuation['Dividend yield'])}</td>
        <td>${spark(b.trend)}</td></tr>`).join('')}</tbody></table></div>
      <p class="note">${esc(S.bank_note)} Prices to ${bankPriceDate(S)}. Hong Leong Financial owns about 64% of Hong Leong Bank, so the two overlap.</p></div>`;

  const subs = [...new Set(S.nonbanks.map(r => r.subsector))];
  const extra = { 'Insurance & takaful': [['Insurance service margin (TTM)', 'Insurance service margin'], ['Investment income share of PBT (TTM)', 'Investment income / pre-tax profit']],
    'Consumer & specialist finance': [['Credit cost (TTM, % of receivables)', 'Credit cost'], ['Receivables growth y/y', 'Receivables growth']],
    'Islamic finance group': [['Credit cost (TTM, % of receivables)', 'Credit cost'], ['Receivables growth y/y', 'Financing growth']],
    'Capital markets': [['Pre-tax margin (TTM)', 'Pre-tax margin'], ['Revenue growth y/y (TTM)', 'Revenue growth']] };
  const nonbanks = subs.map(sub => {
    const rows = S.nonbanks.filter(r => r.subsector === sub), ex = extra[sub] || [];
    return `<div class="glass card"><h2>${esc(sub)}</h2><div class="tablewrap"><table><thead><tr><th>Company</th><th>Latest quarter</th>${rows.length > 1 ? '<th class="num">Score</th>' : ''}
      <th class="num">ROE</th><th class="num">Profit growth</th>${ex.map(e => `<th class="num">${esc(e[1])}</th>`).join('')}<th class="num">P/E</th><th class="num">P/B</th><th class="num">Dividend yield</th><th>Profit, last 8 quarters</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td><b>${coLink(r)}</b>${r.code === '1163' ? '<br><small class="sub">Has listed preference shares (ICPS); P/B is approximate</small>' : ''}</td><td>${esc(r.label)}<br><small class="sub">${fdate(r.quarter_end)}</small></td>
        ${rows.length > 1 ? `<td class="num">${r.score == null ? '–' : Number(r.score).toFixed(1)}</td>` : ''}<td class="num">${fpct(r.metrics['ROE (TTM)'])}</td><td class="num">${spct(r.metrics['Profit growth y/y (TTM)'])}</td>
        ${ex.map(e => `<td class="num">${fpct(r.metrics[e[0]], e[0].includes('Credit') ? 2 : 1)}</td>`).join('')}<td class="num">${num(r.metrics['P/E (TTM)'], 1)}</td><td class="num">${num(r.metrics['P/B'], 2)}</td>
        <td class="num">${fpct(r.metrics['Dividend yield (12m)'])}</td><td>${spark(r.trend)}</td></tr>`).join('')}</tbody></table></div>
      ${rows.length > 1 ? '<p class="note">Score = average rank within this subsector across its measures (1 = best). Each company is measured at its own latest quarter; figures are the last 12 months.</p>'
        : '<p class="note">MBSB is the only listed Islamic finance group of its kind, so it is shown without a peer score.</p>'}</div>`;
  }).join('');

  const season = `<div class="glass card"><h2>Results season — quarter to ${fdate(S.season_quarter)}</h2>
      <div class="tablewrap"><table><thead><tr><th>Company</th><th>Type</th><th>Latest report in the database</th><th>Status</th><th>Next report</th><th>What stood out</th></tr></thead>
      <tbody>${S.season.slice().sort((a, b) => (b.reported - a.reported) || a.group.localeCompare(b.group) || a.name.localeCompare(b.name)).map(x => `<tr><td><b>${coLink(x)}</b></td><td>${esc(x.group)}</td>
        <td>${esc(x.latest_label || '–')} <small class="sub">${x.latest ? fdate(x.latest) : ''}</small></td><td>${x.reported ? '<span class="badge high">Up to date</span>' : '<span class="badge medium">Due</span>'}</td>
        <td>${esc(x.next_label || '–')} <small class="sub">${x.next ? 'quarter to ' + fdate(x.next) : ''}</small></td><td><small>${x.reported ? (x.flags.map(esc).join('<br>') || 'No large moves') : '–'}</small></td></tr>`).join('')}</tbody></table></div>
      <p class="note">Companies file quarterly results within two months of each quarter end. New reports are picked up each evening, checked, and this page is rebuilt.</p></div>`;

  const methodP = `<div class="glass card"><h2>How this page is built</h2><ol class="biz-plain">${S.method.map(m => `<li>${esc(m)}</li>`).join('')}</ol>
      <p class="note">Last rebuilt ${fdate(S.built)}. Banks compared at ${fdate(S.peer_date)}. Banking-system data to ${monthName(I.month)}.</p></div>`;

  // ---- what drives banks: index, factors, correlation
  const D = S.drivers || {}, R = S.rates || {}, NI = S.niche || {};
  const idxPts = (D.index || []).map(r => [r[0], r[1]]), kPts = (D.index || []).map(r => [r[0], r[2]]);
  const lastI = idxPts.length ? idxPts[idxPts.length - 1][1] : null, lastK = kPts.length ? kPts[kPts.length - 1][1] : null;
  const expWord = e => e === '+' ? 'Up together' : e === '-' ? 'Opposite' : 'Either way';
  const drivers = `<div class="glass card"><h2>Malaysian banks index vs the market</h2>
      ${lineChart([{ name: 'Stock Analyst banks index (9 banks, total return)', pts: idxPts, color: LC_COLS[0], thick: 1 }, { name: 'FBM KLCI (price, rebased)', pts: kPts, color: LC_COLS[4] }], { unit: '', dec: 0 })}
      <p class="note">Both start at 100 in ${idxPts.length ? monthName(idxPts[0][0]) : ''}. Banks have returned ${lastI ? (lastI - 100).toFixed(0) + '%' : '–'} including dividends, against ${lastK ? (lastK - 100).toFixed(0) + '%' : '–'} for the KLCI's price.
        The index weights each bank by its market value: ${Object.entries(D.weights || {}).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => esc(k) + ' ' + fpct(v, 0)).join(', ')} and others. Hong Leong Financial is left out because it owns Hong Leong Bank.</p></div>
    <div class="glass card"><h2>What moves bank shares, and how closely</h2>
      <div class="tablewrap"><table><thead><tr><th>Factor</th><th>Latest</th><th>Expected link</th><th class="num">Month to month</th><th class="num">Over 12 months</th><th>Reading</th><th>Last 5 years</th><th>Why it matters</th></tr></thead>
      <tbody>${(D.correlations || []).map(c => `<tr><td><b>${esc(c.factor)}</b></td><td>${c.latest == null ? '–' : Number(c.latest).toLocaleString('en-GB', { maximumFractionDigits: 2 })}<br><small class="sub">${esc(c.latest_month || '')}</small></td>
        <td>${expWord(c.expected)}</td>${corrCell(c.monthly)}${corrCell(c.yearly)}<td><small>${esc(corrWord(c.yearly ?? c.monthly))}</small></td>
        <td>${spark((D.factor_series || {})[c.factor] || [], 110, 30)}</td><td><small>${esc(c.why)}</small></td></tr>`).join('')}</tbody></table></div>
      <p class="note">Correlation runs from −1 to +1: +1 means bank shares always rose when the factor rose, −1 always fell, 0 no link. "Month to month" compares monthly changes;
        "over 12 months" compares year-on-year changes (overlapping windows, so read it as a pattern). ${esc(D.note || '')}</p></div>
    <div class="glass card"><h2>Bank shares after each interest-rate decision</h2>
      <div class="tablewrap"><table><thead><tr><th>Decision</th><th class="num">Change</th><th class="num">New OPR</th><th class="num">Banks index, next 3 months</th></tr></thead>
      <tbody>${(D.opr_events || []).slice().reverse().map(e => `<tr><td>${fdate(e.date)}</td><td class="num">${e.change > 0 ? '+' : ''}${Number(e.change).toFixed(2)} pts</td><td class="num">${Number(e.level).toFixed(2)}%</td><td class="num">${spct(e.bank_index_3m_after == null ? null : e.bank_index_3m_after / 100)}</td></tr>`).join('')}</tbody></table></div>
      <p class="note">${(() => { const ev = D.opr_events || [], up = ev.filter(e => e.change > 0 && e.bank_index_3m_after != null).map(e => e.bank_index_3m_after), dn = ev.filter(e => e.change < 0 && e.bank_index_3m_after != null);
        return (up.length ? `After the ${up.length} rate rises shown, the banks index moved between ${Math.min(...up).toFixed(1)}% and ${Math.max(...up).toFixed(1)}% over the next three months. ` : '')
          + dn.map(e => `After the ${fdate(e.date)} cut it moved ${e.bank_index_3m_after > 0 ? '+' : ''}${e.bank_index_3m_after.toFixed(1)}%. `).join('')
          + 'Rate decisions alone have not set the direction of bank shares; growth, the ringgit and the wider market matter as much.'; })()}</p></div>`;

  // ---- interest rates: history line chart and each bank's published rates
  const sy = R.system || {}, cut = (a, s) => (a || []).filter(p => p[0] >= s);
  const rateHist = `<div class="glass card"><h2>Interest rates over time</h2>
      ${lineChart([{ name: 'OPR (Bank Negara policy rate)', pts: cut(sy['OPR (%)'], '2019-01'), color: LC_COLS[0], thick: 1 },
                   { name: 'Average lending rate, all loans', pts: cut(sy['Average lending rate, outstanding loans (%)'], '2019-01'), color: LC_COLS[1] },
                   { name: 'Base rate (weighted)', pts: cut(sy['Base rate, weighted (%)'], '2019-01'), color: LC_COLS[5] },
                   { name: '12-month fixed deposit', pts: cut(sy['Fixed deposit 12-month (%)'], '2019-01'), color: LC_COLS[2] },
                   { name: 'Savings deposit', pts: cut(sy['Savings deposit (%)'], '2019-01'), color: LC_COLS[4] },
                   { name: '10-year government bond', pts: cut(sy['10-year government bond yield (%)'], '2019-01'), color: LC_COLS[3] }], { unit: '%', dec: 2 })}
      <p class="note">Monthly averages for commercial banks. When the OPR moves, deposit rates and the base rate follow within a month or two; the average rate on all outstanding loans moves more slowly.
        ${esc((R.sources || {}).system || '')}</p></div>
    <div class="glass card"><h2>The bank's spread: what it charges minus what it pays</h2>
      ${lineChart([{ name: 'Average lending rate minus 12-month deposit rate', pts: cut(sy['Lending-deposit spread (pts)'], '2015-01'), color: LC_COLS[0], thick: 1 }], { unit: ' pts', dec: 2, h: 200 })}
      <p class="note">A rough guide to margins: the wider the gap, the more banks earn on each ringgit they lend.</p></div>`;
  const pb = (R.per_bank || []).slice().sort((a, b) => ((a.conventional || a.islamic || {}).base_rate || 9) - ((b.conventional || b.islamic || {}).base_rate || 9));
  const rateBanks = `<div class="glass card"><h2>Each bank's published lending rates today</h2>
      <div class="tablewrap"><table><thead><tr><th>Bank</th><th class="num">Base rate</th><th class="num">Base lending rate</th><th class="num">Typical new home-loan rate</th><th class="num">Islamic arm: base rate</th><th class="num">Islamic: typical financing rate</th></tr></thead>
      <tbody>${pb.map(b => { const c = b.conventional || {}, i = b.islamic || {}; const f = v => v == null ? '–' : Number(v).toFixed(2) + '%';
        return `<tr><td><b>${esc(b.bank)}</b></td><td class="num">${f(c.base_rate)}</td><td class="num">${f(c.base_lending_rate)}</td><td class="num">${f(c.effective_lending_rate)}</td><td class="num">${f(i.base_rate)}</td><td class="num">${f(i.effective_financing_rate)}</td></tr>`; }).join('')}</tbody></table></div>
      <p class="note">${esc((R.notes || {})['Base rate'] || '')} ${esc((R.notes || {})['Effective lending rate'] || '')} Source: ${esc((R.sources || {}).per_bank || '')}.
        A lower base rate usually means cheaper funding (for example Maybank's large pool of current and savings deposits).</p></div>`;

  // ---- market share and niche leaders
  const ms = NI.market_share || [];
  const share = `<div class="two"><div class="glass card"><h2>Share of all bank loans in Malaysia</h2>
      ${ms.map(m => `<div class="row-item"><span><b>${esc(m.bank)}</b><br><small class="sub">RM${Number(m.domestic_loans_rm_bn).toLocaleString('en-GB', { maximumFractionDigits: 0 })} bn of Malaysian loans</small></span><span style="min-width:45%">${scoreBar(m.share_of_system_loans * 100, 20, fpct(m.share_of_system_loans))}</span></div>`).join('')}
      <p class="note">Malaysian loans of each bank against the banking system's RM${NI.system_loans_rm_bn ? Number(NI.system_loans_rm_bn).toLocaleString('en-GB', { maximumFractionDigits: 0 }) : '–'} bn (Bank Negara, ${esc(NI.system_month || '')}). The rest is held by other local, foreign, Islamic and development banks.</p></div>
    <div class="glass card"><h2>Deposits and cheap funding</h2>
      ${(NI.deposits || []).map(d => `<div class="row-item"><span><b>${esc(d.bank)}</b><br><small class="sub">RM${d.deposits_rm_bn ?? '–'} bn deposits · ${fpct(d.casa_ratio)} in current and savings accounts</small></span><span style="min-width:40%">${scoreBar((d.casa_share || 0) * 100, 40, fpct(d.casa_share) + ' of CASA')}</span></div>`).join('')}
      <p class="note">CASA = current and savings accounts, the cheapest money a bank can lend out. Share is of the 9 listed banks combined.</p></div></div>
    <div class="glass card"><h2>Who leads which business</h2>
      <div class="niche">${(NI.niches || []).map(n => `<div class="nbox"><div class="nhead"><b>${esc(n.niche)}</b><small class="sub">${esc(n.desc)}</small></div>
        <div class="nlead">Leader: <b>${esc(n.leader || '–')}</b></div>
        ${n.banks.slice(0, 5).map(b => `<div class="nrow"><span>${esc(b.bank)}</span>${scoreBar(b.share * 100, 50, fpct(b.share, 0))}</div>`).join('')}
        <small class="sub">RM${n.total_rm_bn} bn across ${n.covered} banks${n.system_rm_bn ? ` · banking system RM${Number(n.system_rm_bn).toLocaleString('en-GB', { maximumFractionDigits: 0 })} bn` : ''}</small></div>`).join('')}</div>
      <p class="note">${esc(NI.note || '')} Measured at ${NI.asof ? fdate(NI.asof) : '–'}. Not every bank publishes every breakdown, so a niche may cover fewer than 9 banks.</p></div>`;

  // ---- news (public headlines with links; loaded on demand)
  const newsP = `<div class="glass card"><h2>Financial-sector news</h2><div class="pills" id="ntopics" style="margin:0 0 10px"></div><div id="nlist"><p class="loading">Loading headlines…</p></div>
      <p class="note">Headlines and links from public business news feeds (Bernama, New Straits Times, Free Malaysia Today, Malay Mail, Borneo Post), refreshed each evening and tagged by company and topic. Read the full story at the source.</p></div>`;

  const panels = { overview, drivers, rates: rateHist + rateBanks, share, banks, nonbanks, news: newsP, season, method: methodP };
  view.innerHTML = `<h1>Financial sector</h1>
    <div class="pills" style="margin:-8px 0 14px"><span class="pill">10 banks · 13 insurers and other financials</span><span class="pill">Banks compared at ${fdate(S.peer_date)}</span><span class="pill">Banking system: ${monthName(I.month)}</span><span class="pill">Rebuilt ${fdate(S.built)}</span></div>
    <nav class="tabs" id="stabs">${TABS_S.map(([k, t]) => `<button data-t="${k}" class="${k === tab ? 'on' : ''}">${t}</button>`).join('')}</nav>
    <section class="panel stack enter">${panels[tab]}</section>
    <p class="note">Analysis of figures the companies reported. Not investment advice.</p>`;
  $('#stabs').onclick = e => { const t = e.target.closest('button'); if (t) location.hash = '#/sector/' + t.dataset.t; };
  if (tab === 'news') {
    if (!SECTOR_NEWS) SECTOR_NEWS = await fetch('data/news/financial.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null);
    const N = SECTOR_NEWS, list = $('#nlist'), tp = $('#ntopics'); if (!list) return;
    if (!N) { list.innerHTML = '<p>No headlines yet.</p>'; return; }
    const topics = ['all', 'banks', 'rates', 'insurance', 'economy', 'ringgit', 'oil', 'markets', 'results'];
    const draw = t => { tp.innerHTML = topics.map(x => `<button class="pill ${x === t ? 'on' : ''}" data-t="${x}" style="cursor:pointer;border:0">${x === 'all' ? 'All' : x[0].toUpperCase() + x.slice(1)}</button>`).join('');
      const it = N.items.filter(i => t === 'all' || (i.topics || []).includes(t)).slice(0, 80);
      list.innerHTML = it.map(i => `<div class="row-item"><span><a href="${esc(i.url)}" target="_blank" rel="noopener" style="text-decoration:underline"><b>${esc(i.title)}</b></a><br>
        <small class="sub">${esc(i.source)} · ${i.published ? new Date(i.published).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}${(i.companies || []).length ? ' · ' + i.companies.map(c => BYID[c.id] ? `<a href="#/stock/${esc(c.id)}">${esc(BYID[c.id].t)}</a>` : esc(c.name)).join(', ') : ''}</small></span>
        <small class="sub" style="text-align:right">${(i.topics || []).map(esc).join(' · ')}</small></div>`).join('') || '<p>No headlines for this topic in the last 30 days.</p>'; };
    tp.onclick = e => { const b = e.target.closest('button'); if (b) draw(b.dataset.t); };
    draw('all');
  }
}

/* ---------- Agent HQ (data/agents.json: the agents' roles and every run they log) ---------- */
const fstamp = s => s ? esc(String(s).replace('T', ' ').slice(0, 16)) : '–';
const runBadge = s => `<span class="badge ${s === 'Success' ? 'hit' : s === 'Failed' ? 'stop' : s === 'Retrying' ? 'exp' : ''}">${esc(s || '–')}</span>`;
async function agents() {
  view.innerHTML = '<p class="loading">Loading Agent HQ…</p>';
  const hq = await fetch('data/agents.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null);
  if (!hq) { view.innerHTML = '<h1>Agent HQ</h1><p class="loading">Could not load data/agents.json.</p>'; return; }
  const runs = (hq.runs || []).slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const open = r => r.status === 'Failed' && !r.resolved;
  hq.agents.forEach(a => {                       // same rules as the Agent HQ sheet: any unresolved failure = Error
    const mine = runs.filter(r => r.agent === a.name);
    a.open = mine.filter(open).length; a.last = mine[0]?.at || null;
    a.state = a.open ? 'Error' : a.last ? 'OK' : 'Not run yet';
  });
  const openN = runs.filter(open).length, inErr = hq.agents.filter(a => a.open).length, lastRun = runs[0]?.at;
  const stateBadge = s => `<span class="badge ${s === 'Error' ? 'stop' : s === 'OK' ? 'hit' : ''}">${s}</span>`;
  const step = (n, title) => `<div class="flow-step"><b>Step ${n} – ${title}</b>${hq.agents.filter(a => a.step === n).map(a => `<span style="display:flex;justify-content:space-between;gap:8px;margin-top:6px">${esc(a.name)} ${stateBadge(a.state)}</span>`).join('')}</div>`;
  view.innerHTML = `<h1>Agent HQ</h1>
    ${openN ? `<div class="glass card" style="background:var(--red-bg);color:var(--red);margin-bottom:14px"><b>⚠ ${openN} open error${openN > 1 ? 's' : ''} across ${inErr} agent${inErr > 1 ? 's' : ''}.</b> See the run log below for what failed and the action needed.</div>` : ''}
    <div class="stats" style="margin-bottom:14px">
      <div class="stat"><small>Open errors</small><b class="${openN ? 'neg' : 'pos'}">${openN}</b></div>
      <div class="stat"><small>Agents in error</small><b class="${inErr ? 'neg' : 'pos'}">${inErr} of ${hq.agents.length}</b></div>
      <div class="stat"><small>Last run</small><b>${fstamp(lastRun)}</b></div>
      <div class="stat"><small>Page data updated</small><b>${fstamp(hq.generated)}</b></div></div>
    <div class="flow" style="margin-bottom:14px">${step(1, 'Capture')}<span class="arrow">→</span>${step(2, 'Extraction')}</div>
    <div class="stack">
    <div class="glass card"><h2>Agents</h2><div class="tablewrap"><table><thead><tr><th>Agent</th><th>Type</th><th>Status</th><th class="num">Open errors</th><th>Last run</th><th>Role</th></tr></thead>
      <tbody>${hq.agents.map((a, i) => `<tr data-i="${i}" style="cursor:pointer${a.open ? ';background:var(--red-bg)' : ''}"><td><b>${esc(a.name)}</b></td><td>${esc(a.type)}</td><td>${stateBadge(a.state)}</td>
        <td class="num">${a.open}</td><td>${fstamp(a.last)}</td><td style="white-space:normal;min-width:260px">${esc(a.role)}</td></tr>`).join('')}</tbody></table></div>
      <p class="note">Select an agent to see what it does, its checks before hand-off and what it does when it fails.</p><div id="ag-detail"></div></div>
    <div class="glass card"><h2>Run log</h2>
      <div class="filters"><label>Agent<select id="r-a"><option value="">All agents</option>${hq.agents.map(a => `<option>${esc(a.name)}</option>`).join('')}</select></label>
        <label>Status<select id="r-s"><option value="">All</option><option value="open">Open errors only</option><option>Failed</option><option>Retrying</option><option>Success</option></select></label></div>
      <div class="tablewrap"><table><thead><tr><th>Logged at</th><th>Agent</th><th>Status</th><th>Company</th><th>Stock code</th><th>Task</th><th>Error</th><th>Action needed</th><th>Resolved</th></tr></thead><tbody id="r-rows"></tbody></table></div>
      <p class="note" id="r-count"></p></div></div>`;
  const detail = i => { const a = hq.agents[i];
    $('#ag-detail').innerHTML = `<div class="biz-note" style="margin-top:12px"><h3 style="margin:0 0 6px">${esc(a.name)}</h3>
      <p><b>Trigger:</b> ${esc(a.trigger)}<br><b>Input:</b> ${esc(a.input)}<br><b>Output:</b> ${esc(a.output)}<br><b>Fills:</b> ${esc(a.fills)}</p>
      <b>Checks before hand-off</b><ul style="margin:4px 0 8px">${a.checks.map(c => `<li>${esc(c)}</li>`).join('')}</ul><b>On failure:</b> ${esc(a.onFailure)}</div>`; };
  view.querySelectorAll('tr[data-i]').forEach(tr => tr.onclick = () => detail(+tr.dataset.i));
  const draw = () => {
    const ag = $('#r-a').value, st = $('#r-s').value;
    const list = runs.filter(r => (!ag || r.agent === ag) && (!st || (st === 'open' ? open(r) : r.status === st)));
    $('#r-rows').innerHTML = list.slice(0, 500).map(r => `<tr${open(r) ? ' style="background:var(--red-bg)"' : ''}><td>${fstamp(r.at)}</td><td>${esc(r.agent)}</td><td>${runBadge(r.status)}</td><td>${esc(r.company || '–')}</td>
      <td>${esc(r.code || '–')}</td><td>${esc(r.task || '–')}</td><td style="white-space:normal;min-width:220px">${esc(r.error || '')}</td><td style="white-space:normal;min-width:200px">${esc(r.action || '')}</td><td>${r.resolved ? 'Yes' : r.status === 'Failed' ? 'No' : ''}</td></tr>`).join('')
      || '<tr><td colspan="9" class="sub">No runs logged yet.</td></tr>';
    $('#r-count').textContent = `${list.length.toLocaleString()} run${list.length === 1 ? '' : 's'}${list.length > 500 ? ' (showing the newest 500)' : ''}.`;
  };
  ['r-a', 'r-s'].forEach(id => $('#' + id).addEventListener('input', draw));
  draw();
}

/* ---------- router ---------- */
function route() {
  const [path, qs] = (location.hash.slice(1) || '/').split('?'), parts = path.split('/').filter(Boolean), params = new URLSearchParams(qs || '');
  const page = parts[0] || 'home';
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.r === (page === 'stock' ? 'stocks' : page)));
  window.onresize = null; window.onmouseup = null; $('#tip').hidden = true; window.scrollTo(0, 0);
  ({ home, stocks: () => stocks(params), stock: () => stock(decodeURIComponent(parts[1] || ''), parts[2]), sector: () => sector(parts[1]), latest, brokers, agents, method }[page] || home)();
}
/* light / dark theme: remembered per browser, defaults to the device setting */
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('sa-theme', t); } catch (e) {}
  document.querySelectorAll('#theme button').forEach(b => b.classList.toggle('on', b.dataset.th === t));
}
setTheme(document.documentElement.dataset.theme || 'light');
$('#theme').onclick = e => { const b = e.target.closest('button'); if (b && b.dataset.th !== document.documentElement.dataset.theme) { setTheme(b.dataset.th); if (IDX) { const y = window.scrollY; route(); window.scrollTo(0, y); } } };
$('#signin').onclick = () => { $('#modal').hidden = false; };
$('#modal-close').onclick = () => { $('#modal').hidden = true; };
window.addEventListener('hashchange', route);
load().then(route).catch(e => { view.innerHTML = `<p class="loading">Could not load the data files (${esc(e.message)}). Run research/combined/combine.py first.</p>`; });
