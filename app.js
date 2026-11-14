/* Stock Analyst prototype — reads data/index.json, data/calls.json and data/s/<id>.json (written by combined/export_web.py). */
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
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
function hitStats(calls) {                      // Buy calls: target reached within 12 months
  const b = calls.filter(isBuy), hit = b.filter(c => c.outcome === 'Hit').length, miss = b.filter(c => c.outcome === 'Missed').length;
  return { hit, miss, res: hit + miss, rate: hit + miss ? hit / (hit + miss) : null,
           days: avg(b.filter(c => c.outcome === 'Hit' && c.days != null).map(c => c.days)), dd: avg(b.filter(c => c.maxdd != null).map(c => c.maxdd)),
           t6: avg(b.filter(c => c.t6m != null).map(c => c.t6m)) };
}
function cutStats(calls, stop) {                // long Buy calls with a cut loss
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
const callBadge = c => `<span class="badge ${c === 'BUY' ? 'buy' : c === 'SELL' ? 'sell' : ''}">${esc(c)}</span>`;
function status(c, stop) {
  if (!c.scored) return ['No price data', ''];
  if (c.upside > 0 && c.maxdd != null && c.maxdd <= -stop) return ['Hit cut loss', 'stop'];
  return c.outcome === 'Hit' ? ['TP reached', 'hit'] : c.outcome === 'Missed' ? ['Expired', 'exp'] : ['Open', ''];
}

/* ---------- data ---------- */
async function load() {
  const [idx, calls] = await Promise.all([fetch('data/index.json').then(r => r.json()), fetch('data/calls.json').then(r => r.json())]);
  IDX = idx;
  CALLS = calls.rows.map(r => Object.fromEntries(calls.fields.map((f, i) => [f, r[i]])));
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
  const all = hitStats(CALLS), since = '2023-01-01';
  const latest = CALLS.slice(0, 7);
  const reliable = IDX.stocks.filter(s => s.st.res >= 8).sort((a, b) => b.st.rate - a.st.rate || b.st.res - a.st.res).slice(0, 7);
  const sectors = Object.entries(IDX.stocks.reduce((m, s) => { if (s.sector && s.sector !== '(not listed)') m[s.sector] = (m[s.sector] || 0) + 1; return m; }, {}))
    .sort((a, b) => b[1] - a[1]).slice(0, 9);
  const board = IDX.brokers.map(b => [b, hitStats(CALLS.filter(c => c.broker === b && c.date >= since))]);
  view.innerHTML = `<div class="home"><div>
    <h1>Welcome</h1>
    <div class="glass hero"><small>Analyst target prices, checked</small>
      <div class="big">How often do broker target prices actually get reached?</div>
      <div class="pills"><span class="pill">${IDX.reports.toLocaleString()} reports</span><span class="pill">${IDX.stocks.length} stocks</span>
        <span class="pill">${IDX.brokers.map(esc).join(' · ')}</span><span class="pill">Buy calls reaching target: ${pct(all.rate)}</span>
        <span class="pill">Prices to ${fdate(IDX.asof)}</span></div></div>
    <div class="actions">
      <a class="action" href="#/stocks"><span>🔍</span>Stocks</a><a class="action" href="#/latest"><span>🗓️</span>Latest</a>
      <a class="action" href="#/brokers"><span>📊</span>Accuracy</a><a class="action" href="#/method"><span>ℹ️</span>Method</a></div>
    <div class="two">
      <div><h2>Latest reports</h2><div class="glass card">${latest.map(c => `<div class="row-item"><span>${stockLink(c.id)}<br><small>${esc(c.broker)} · ${fdate(c.date)}</small></span>
        <span style="text-align:right">${callBadge(c.call)}<br><small>TP ${num(c.tp)} (${c.upside == null ? '–' : (c.upside > 0 ? '+' : '') + (c.upside * 100).toFixed(0) + '%'})</small></span></div>`).join('')}</div></div>
      <div><h2>Most reliable Buy calls</h2><div class="glass card">${reliable.map(s => `<div class="row-item"><span>${stockLink(s.id)}<br><small>${esc(s.sector || '')}</small></span>
        <span style="text-align:right"><b>${pct(s.st.rate)}</b><br><small>${s.st.hit} of ${s.st.res} reached target</small></span></div>`).join('')}</div></div>
    </div></div>
    <div class="glass right"><h2 style="margin:0">Find a stock</h2>${searchBox('q-home', 'Search here…')}
      <div class="tiles">${sectors.map(([s, n]) => `<a class="tile" href="#/stocks?sector=${encodeURIComponent(s)}"><b>${n}</b>${esc(s)}</a>`).join('')}</div>
      <h2 style="margin:10px 0 0">Broker scoreboard</h2><div class="sub">Buy calls since 2023 that reached their target</div>
      ${board.map(([b, st]) => `<div class="stat"><small>${esc(b)} · ${st.res.toLocaleString()} resolved calls</small><b>${pct(st.rate)}</b></div>`).join('')}
      <a class="btn" style="text-align:center" href="#/brokers">Compare brokers</a></div></div>`;
  wireSearch('q-home');
}

function stocks(params) {
  const sectors = [...new Set(IDX.stocks.map(s => s.sector).filter(Boolean))].sort();
  view.innerHTML = `<div class="head"><h1>Stocks</h1></div>
    <div class="filters"><label>Search<input id="f-q" placeholder="Name or code"></label>
      <label>Sector<select id="f-sec"><option value="">All sectors</option>${sectors.map(s => `<option>${esc(s)}</option>`).join('')}</select></label>
      <label>Sort by<select id="f-sort"><option value="t">Name</option><option value="rate">Buy hit rate</option><option value="n">Number of reports</option><option value="up">Upside to latest target</option></select></label></div>
    <div class="glass card"><div class="tablewrap"><table><thead><tr><th>Stock</th><th>Company</th><th>Sector</th><th class="num">Last price</th><th class="num">Latest target</th>
      <th class="num">Upside</th><th class="num">Reports</th><th class="num">Buy calls reached target</th><th>Accuracy</th></tr></thead><tbody id="rows"></tbody></table></div>
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

async function stock(id) {
  const s = BYID[id];
  if (!s) { view.innerHTML = '<h1>Stock not found</h1><a class="btn" href="#/stocks">Back to stocks</a>'; return; }
  const calls = CALLS_BY[id] || [];
  const rows = IDX.brokers.filter(b => s.latest[b]).map(b => {
    const l = s.latest[b], st = hitStats(calls.filter(c => c.broker === b)), bst = hitStats(CALLS.filter(c => c.broker === b));
    const ast = l.an ? hitStats(CALLS.filter(c => c.analyst === l.an)) : null;
    return `<tr><td><b>${esc(b)}</b></td><td>${fdate(l.d)}</td><td>${callBadge(l.call)}${l.orig && l.orig !== l.call ? ` <small class="sub">${esc(l.orig)}</small>` : ''}</td>
      <td class="num">${num(l.tp)}</td><td class="num">${l.tp && s.last ? spct(l.tp / s.last - 1, 0) : '–'}</td><td>${esc((l.an || 'Not shown').replace(/ \((Kenanga|RHB|MIDF)\)$/, ''))}</td>
      <td class="num">${st.res ? `${pct(st.rate)} <small class="sub">(${st.hit}/${st.res})</small>` : '–'}</td><td>${accBadge(st)}</td>
      <td class="num">${st.days == null ? '–' : Math.round(st.days)}</td><td class="num">${spct(st.dd)}</td><td class="num">${pct(bst.rate)}</td><td class="num">${ast && ast.res >= 5 ? pct(ast.rate) : '–'}</td></tr>`;
  }).join('');
  const all = hitStats(calls);
  view.innerHTML = `<div class="crumb"><a href="#/stocks">Stocks</a> › ${esc(s.t)}</div>
    <div class="head"><h1>${esc(s.name)} <small class="sub" style="font-size:15px">${esc(s.t)}${s.code ? ' · ' + esc(s.code) : ''}</small></h1><div style="width:280px">${searchBox('q-stock', 'Search another stock…')}</div></div>
    <div class="stats">
      <div class="stat"><small>Last price</small><b>${num(s.last)}</b></div>
      <div class="stat"><small>52-week low / high</small><b>${num(s.lo52)} / ${num(s.hi52)}</b></div>
      <div class="stat"><small>Up from 52-week low</small><b>${s.last && s.lo52 ? spct(s.last / s.lo52 - 1) : '–'}</b></div>
      <div class="stat"><small>Off 52-week high</small><b>${s.last && s.hi52 ? spct(s.last / s.hi52 - 1) : '–'}</b></div>
      <div class="stat"><small>Sector · board</small><b style="font-size:14px">${esc(s.sector || '–')} · ${esc(s.board || '–')}</b></div>
      <div class="stat"><small>Buy calls that reached target (all brokers)</small><b>${pct(all.rate)}</b> ${accBadge(all)}</div></div>
    <div class="stack">
    <div class="glass card"><h2>Latest call and accuracy by broker</h2><div class="tablewrap"><table><thead><tr><th>Broker</th><th>Latest report</th><th>Call</th><th class="num">Target price</th>
      <th class="num">Upside vs last</th><th>Analyst</th><th class="num">Buy calls reached target (this stock)</th><th>Accuracy</th><th class="num">Avg days to target</th>
      <th class="num">Avg worst drop</th><th class="num">Broker, all stocks</th><th class="num">Analyst, all stocks</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="note">Accuracy = share of resolved Buy calls whose target price was reached within 12 months. High 60%+, Medium 40–60%, Low under 40%; under 5 resolved calls is too few to judge.</p></div>
    <div class="glass card"><div class="head"><h2>Price chart</h2><div class="seg" id="range"><button data-n="252">1Y</button><button data-n="504">2Y</button><button data-n="0" class="on">All</button></div></div>
      <canvas id="chart"></canvas>
      <div class="legend"><span><i style="background:#34326b"></i>Close</span><span><i style="background:#7c6fd6"></i>50-day average</span><span><i style="background:#e0913a"></i>200-day average</span>
        <span><i style="background:#9aa0b4"></i>52-week high / low</span><span>▲ Buy call</span><span style="color:#c0392b">▼ Sell call</span><span>● Neutral</span><span style="color:#c99a1c">◆ Target price</span></div></div>
    <div class="glass card"><h2>All reports on this stock</h2><div class="tablewrap" style="max-height:520px"><table><thead><tr><th>Date</th><th>Broker</th><th>Call</th><th class="num">Price</th><th class="num">Target</th>
      <th class="num">Upside</th><th class="num">Up from 52w low</th><th class="num">Off 52w high</th><th>Result</th><th class="num">Days to target</th><th class="num">Worst drop</th><th class="num">6m return</th><th>Analyst</th></tr></thead>
      <tbody>${calls.map(c => { const [t, k] = status(c, 9); return `<tr><td>${fdate(c.date)}</td><td>${esc(c.broker)}</td><td>${callBadge(c.call)}</td><td class="num">${num(c.price)}</td><td class="num">${num(c.tp)}</td>
        <td class="num">${spct(c.upside, 0)}</td><td class="num">${spct(c.fromLow, 0)}</td><td class="num">${spct(c.fromHigh, 0)}</td><td><span class="badge ${k}">${t}</span></td>
        <td class="num">${c.days ?? '–'}</td><td class="num">${spct(c.maxdd)}</td><td class="num">${spct(c.t6m)}</td><td>${esc((c.analyst || '–').replace(/ \((Kenanga|RHB|MIDF)\)$/, ''))}</td></tr>`; }).join('')}</tbody></table></div>
      <p class="note">Prices and targets are adjusted for later share splits and bonus issues. 6m return includes dividends.</p></div></div>`;
  wireSearch('q-stock');
  let px = null;
  try { px = await fetch(`data/s/${encodeURIComponent(id)}.json`).then(r => r.ok ? r.json() : null); } catch (e) { px = null; }
  const cv = $('#chart'); if (!cv) return;
  let n = 0; const draw = () => drawChart(cv, px, calls, n);
  $('#range').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; n = +b.dataset.n; [...$('#range').children].forEach(x => x.classList.toggle('on', x === b)); draw(); });
  draw(); window.onresize = draw;
}

function drawChart(cv, px, calls, lastN) {
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr; const g = cv.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, W, H);
  g.font = '11px Segoe UI, sans-serif';
  if (!px || !px.c.length) { g.fillStyle = '#6f7687'; g.fillText('No price history for this stock.', 16, 30); cv.onmousemove = null; return; }
  const N = px.c.length, ma = k => px.c.map((_, i) => i + 1 < k ? null : avg(px.c.slice(i + 1 - k, i + 1)));
  const m50 = ma(50), m200 = ma(200);
  const hi = px.c.map((_, i) => i < 119 ? null : Math.max(...px.c.slice(Math.max(0, i - 251), i + 1)));
  const lo = px.c.map((_, i) => i < 119 ? null : Math.min(...px.c.slice(Math.max(0, i - 251), i + 1)));
  const i0 = lastN ? Math.max(0, N - lastN) : 0, pos = Object.fromEntries(px.d.map((d, i) => [d, i]));
  const marks = calls.filter(c => c.scored && pos[c.date] >= i0);
  let mn = Infinity, mx = -Infinity;
  for (let i = i0; i < N; i++) for (const v of [px.c[i], hi[i], lo[i]]) if (v != null) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
  marks.forEach(c => { if (c.tp) { mn = Math.min(mn, c.tp); mx = Math.max(mx, c.tp); } });
  const pad = (mx - mn) * .06 || 1; mn -= pad; mx += pad;
  const L = 46, R = 12, T = 10, B = 26, X = i => L + (i - i0) / Math.max(1, N - 1 - i0) * (W - L - R), Y = v => T + (mx - v) / (mx - mn) * (H - T - B);
  g.strokeStyle = 'rgba(120,128,160,.18)'; g.fillStyle = '#6f7687'; g.lineWidth = 1;
  for (let k = 0; k <= 4; k++) { const v = mn + (mx - mn) * k / 4, y = Y(v); g.beginPath(); g.moveTo(L, y); g.lineTo(W - R, y); g.stroke(); g.fillText(v.toFixed(2), 6, y + 4); }
  let lastLab = '';
  for (let i = i0; i < N; i++) { const lab = px.d[i].slice(0, 7); if (lab !== lastLab && (+px.d[i].slice(5, 7)) % (N - i0 > 600 ? 6 : 3) === 1) { g.fillText(new Date(px.d[i] + 'T00:00:00').toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }), X(i) - 14, H - 8); } lastLab = lab; }
  const line = (arr, col, w, dash) => { g.beginPath(); g.setLineDash(dash || []); g.strokeStyle = col; g.lineWidth = w; let pen = false;
    for (let i = i0; i < N; i++) { if (arr[i] == null) { pen = false; continue; } pen ? g.lineTo(X(i), Y(arr[i])) : g.moveTo(X(i), Y(arr[i])); pen = true; } g.stroke(); g.setLineDash([]); };
  line(hi, '#9aa0b4', 1, [4, 4]); line(lo, '#9aa0b4', 1, [4, 4]); line(m200, '#e0913a', 1.3); line(m50, '#7c6fd6', 1.3); line(px.c, '#34326b', 1.8);
  marks.forEach(c => {
    const i = pos[c.date], x = X(i), y = Y(px.c[i]);
    if (c.tp) { const ty = Y(c.tp); g.fillStyle = '#d9a520'; g.beginPath(); g.moveTo(x, ty - 4); g.lineTo(x + 4, ty); g.lineTo(x, ty + 4); g.lineTo(x - 4, ty); g.fill(); }
    if (c.call === 'BUY') { g.fillStyle = '#1f8a4c'; g.beginPath(); g.moveTo(x, y + 4); g.lineTo(x + 5, y + 13); g.lineTo(x - 5, y + 13); g.fill(); }
    else if (c.call === 'SELL') { g.fillStyle = '#c0392b'; g.beginPath(); g.moveTo(x, y - 4); g.lineTo(x + 5, y - 13); g.lineTo(x - 5, y - 13); g.fill(); }
    else { g.fillStyle = '#8a90a2'; g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); }
  });
  const tip = $('#tip');
  cv.onmousemove = e => {
    const r = cv.getBoundingClientRect(), i = Math.round(i0 + (e.clientX - r.left - L) / (W - L - R) * (N - 1 - i0));
    if (i < i0 || i >= N) { tip.hidden = true; return; }
    const on = calls.filter(c => c.date === px.d[i]).map(c => `${c.broker}: ${c.call}, TP ${num(c.tp)}`).join('<br>');
    tip.innerHTML = `<b>${fdate(px.d[i])}</b> · close ${num(px.c[i])}${on ? '<br>' + esc(on).replace(/&lt;br&gt;/g, '<br>') : ''}`;
    tip.style.left = Math.min(e.clientX + 14, window.innerWidth - 220) + 'px'; tip.style.top = (e.clientY + 14) + 'px'; tip.hidden = false;
  };
  cv.onmouseleave = () => { tip.hidden = true; };
}

function latest() {
  view.innerHTML = `<h1>Latest reports</h1>
    <div class="filters"><label>Broker<select id="l-b"><option value="">All brokers</option>${IDX.brokers.map(b => `<option>${esc(b)}</option>`).join('')}</select></label>
      <label>Call<select id="l-c"><option value="">All calls</option><option>BUY</option><option>NEUTRAL</option><option>SELL</option><option>NOT RATED</option></select></label>
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
    const from = $('#b-p').value, stop = (+$('#b-stop').value || 0) / 100 || 9, list = CALLS.filter(c => !from || c.date >= from);
    const row = (name, l) => { const st = hitStats(l), cs = cutStats(l, stop); return `<tr><td><b>${esc(name)}</b></td><td class="num">${l.length.toLocaleString()}</td><td class="num">${st.res.toLocaleString()}</td>
      <td class="num"><b>${pct(st.rate)}</b></td><td class="num">${pct(cs.rate)}</td><td class="num">${pct(cs.stopped)}</td><td class="num">${st.days == null ? '–' : Math.round(st.days)}</td><td class="num">${spct(st.dd)}</td><td class="num">${spct(st.t6)}</td></tr>`; };
    $('#out').innerHTML = `<div class="glass card"><h2>Buy calls by broker</h2><div class="tablewrap"><table><thead><tr><th>Broker</th><th class="num">Reports</th><th class="num">Buy calls resolved</th><th class="num">Reached target</th>
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
      <li><b>Accuracy rating:</b> share of resolved Buy calls that reached target. High is 60% or more, Medium 40–60%, Low under 40%. Fewer than 5 resolved calls is too few to judge.</li>
      <li><b>Worst drop:</b> the lowest price between the report and the day the target was reached (or the end of the 12 months).</li>
      <li><b>Cut loss:</b> a call counts as stopped out if the price fell that far below the report price before reaching the target.</li>
      <li><b>Up from 52-week low / off 52-week high:</b> where the report price stood against the previous 12 months' lowest and highest prices.</li>
      <li><b>Calls:</b> shown as Buy, Neutral, Sell or Not Rated. Kenanga's Outperform, Market Perform and Underperform are mapped to Buy, Neutral and Sell.</li></ul>
    <h3>Data</h3><ul><li>${IDX.reports.toLocaleString()} company reports from ${IDX.brokers.map(esc).join(', ')}, ${fdate(IDX.first)} to ${fdate(IDX.last)}.</li>
      <li>Prices and dividends to ${fdate(IDX.asof)}; data refreshed ${esc(IDX.generated)}.</li>
      <li>Reports whose printed price does not match the market price, or whose stock has no price history, are left out of the accuracy figures.</li></ul>
    <h3>Important</h3><p>This site is independent research based on publicly available broker reports and market prices. It is not investment advice or a recommendation to buy or sell any security, and past accuracy does not predict future results. Figures are read automatically from reports and may contain errors.</p></div>`;
}

/* ---------- router ---------- */
function route() {
  const [path, qs] = (location.hash.slice(1) || '/').split('?'), parts = path.split('/').filter(Boolean), params = new URLSearchParams(qs || '');
  const page = parts[0] || 'home';
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.r === (page === 'stock' ? 'stocks' : page)));
  window.onresize = null; $('#tip').hidden = true; window.scrollTo(0, 0);
  ({ home, stocks: () => stocks(params), stock: () => stock(decodeURIComponent(parts[1] || '')), latest, brokers, method }[page] || home)();
}
$('#signin').onclick = () => { $('#modal').hidden = false; };
$('#modal-close').onclick = () => { $('#modal').hidden = true; };
window.addEventListener('hashchange', route);
load().then(route).catch(e => { view.innerHTML = `<p class="loading">Could not load the data files (${esc(e.message)}). Run research/combined/combine.py first.</p>`; });
