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

async function stock(id) {
  const s = BYID[id];
  if (!s) { view.innerHTML = '<h1>Stock not found</h1><a class="btn" href="#/stocks">Back to stocks</a>'; return; }
  const calls = CALLS_BY[id] || [];
  const latestCall = b => calls.find(c => c.broker === b);              // calls are newest first
  const rows = IDX.brokers.filter(b => s.latest[b]).map(b => {
    const l = s.latest[b], lc = latestCall(b), st = hitStats(calls.filter(c => c.broker === b)), bst = hitStats(CALLS.filter(c => c.broker === b));
    const ast = l.an ? hitStats(CALLS.filter(c => c.analyst === l.an)) : null, p0 = lc && lc.price;
    return `<tr><td><b>${bdot(b)}${esc(b)}</b></td><td>${fdate(l.d)}</td><td>${callBadge(l.call)}${l.orig && l.orig !== l.call ? ` <small class="sub">${esc(l.orig)}</small>` : ''}</td>
      <td class="num">${num(p0)}</td><td class="num">${num(l.tp)}</td><td class="num">${num(s.last)}</td>
      <td class="num">${p0 && s.last ? spct(s.last / p0 - 1) : '–'}</td><td class="num"><b>${l.tp && s.last ? spct(l.tp / s.last - 1) : '–'}</b></td>
      <td>${esc(plainAnalyst(l.an) || 'Not shown')}</td>
      <td class="num">${st.res ? `${pct(st.rate)} <small class="sub">(${st.hit}/${st.res})</small>` : '–'}</td><td>${accBadge(st)}</td>
      <td class="num">${st.days == null ? '–' : Math.round(st.days)}</td><td class="num">${spct(st.dd)}</td><td class="num">${pct(bst.rate)}</td><td class="num">${ast && ast.res >= 5 ? pct(ast.rate) : '–'}</td></tr>`;
  }).join('');
  const all = hitStats(calls);
  const tps = IDX.brokers.map(b => s.latest[b] && s.latest[b].tp).filter(Boolean), avgTp = tps.length ? avg(tps) : null;
  view.innerHTML = `<div class="crumb"><a href="#/stocks">Stocks</a> › ${esc(s.t)}</div>
    <div class="head"><h1>${esc(s.name)} <small class="sub" style="font-size:15px">${esc(s.t)}${s.code ? ' · ' + esc(s.code) : ''}</small></h1><div style="width:280px">${searchBox('q-stock', 'Search another stock…')}</div></div>
    <div class="stats">
      <div class="stat"><small>Last price</small><b>${num(s.last)}</b></div>
      <div class="stat"><small>Average latest target (${tps.length} broker${tps.length === 1 ? '' : 's'})</small><b>${num(avgTp)}</b> ${avgTp && s.last ? spct(avgTp / s.last - 1, 0) : ''}</div>
      <div class="stat"><small>52-week low / high</small><b>${num(s.lo52)} / ${num(s.hi52)}</b></div>
      <div class="stat"><small>Up from 52-week low</small><b>${s.last && s.lo52 ? spct(s.last / s.lo52 - 1) : '–'}</b></div>
      <div class="stat"><small>Off 52-week high</small><b>${s.last && s.hi52 ? spct(s.last / s.hi52 - 1) : '–'}</b></div>
      <div class="stat"><small>Sector · board</small><b style="font-size:14px">${esc(s.sector || '–')} · ${esc(s.board || '–')}</b></div>
      <div class="stat"><small>Buy calls that reached target (all brokers)</small><b>${pct(all.rate)}</b> ${accBadge(all)}</div></div>
    <div class="stack">
    <div id="biz"></div>
    <div class="glass card"><h2>Latest call and accuracy by broker</h2><div class="tablewrap"><table><thead><tr><th>Broker</th><th>Latest report</th><th>Call</th>
      <th class="num">Price at call</th><th class="num">Target price</th><th class="num">Latest price</th><th class="num">Change since call</th><th class="num">Latest price to target</th><th>Analyst</th>
      <th class="num">Buy calls reached target (this stock)</th><th>Accuracy</th><th class="num">Avg days to target</th>
      <th class="num">Avg worst drop</th><th class="num">Broker, all stocks</th><th class="num">Analyst, all stocks</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="note">Change since call = latest price vs the price on the report. Latest price to target = how far the price still has to move to reach the target (negative means it is already above the target).
        Accuracy = share of resolved Buy calls whose target price was reached within 12 months: High 60%+, Medium 40–60%, Low under 40%; under 5 resolved calls is too few to judge.</p></div>
    <div class="glass card"><div class="head"><h2>Price chart</h2>
        <div class="chart-tools"><div class="seg" id="range"><button data-d="91">3M</button><button data-d="182">6M</button><button data-d="365">1Y</button><button data-d="730">2Y</button><button data-d="0" class="on">5Y</button></div>
          <div class="seg" id="ctype"><button data-t="candle" class="on">Candles</button><button data-t="line">Line</button></div>
          <div class="seg" id="zoom"><button data-z="in" title="Zoom in">＋</button><button data-z="out" title="Zoom out">－</button><button data-z="reset" title="Show all">Reset</button></div></div></div>
      <div class="chart-layers" id="layers">${IDX.brokers.filter(b => calls.some(c => c.broker === b)).map(b => `<label><input type="checkbox" data-b="${esc(b)}" checked>${bdot(b)}${esc(b)}</label>`).join('')}
        <label><input type="checkbox" data-l="ma50" checked><i class="ln" style="background:#7c6fd6"></i>50-day avg</label><label><input type="checkbox" data-l="ma200" checked><i class="ln" style="background:#e0913a"></i>200-day avg</label>
        <label><input type="checkbox" data-l="band"><i class="ln dash"></i>52-week high / low</label><label><input type="checkbox" data-l="tp" checked>Target lines</label></div>
      <canvas id="chart" class="chart"></canvas>
      <p class="note">Scroll on the chart to zoom, drag to move along the timeline, double-click to show everything. Markers sit at the report date in each broker's colour: ▲ Buy, ▼ Sell, ● Neutral / Not rated.
        Dashed lines show each broker's target price until its next report; ◆ marks where the target was set. Prices are adjusted for splits and bonus issues, not for dividends.</p></div>
    <div class="glass card" id="perf"></div>
    <div class="glass card"><h2>All reports on this stock</h2><div class="tablewrap" style="max-height:520px"><table><thead><tr><th>Date</th><th>Broker</th><th>Call</th><th class="num">Price at call</th><th class="num">Target</th>
      <th class="num">Upside at call</th><th class="num">Change since call</th><th class="num">Latest price to target</th><th class="num">Up from 52w low</th><th class="num">Off 52w high</th><th>Result</th><th class="num">Days to target</th><th class="num">Worst drop</th><th class="num">6m return</th><th>Analyst</th></tr></thead>
      <tbody>${calls.map(c => { const [t, k] = status(c, 9); return `<tr><td>${fdate(c.date)}</td><td>${bdot(c.broker)}${esc(c.broker)}</td><td>${callBadge(c.call)}</td><td class="num">${num(c.price)}</td><td class="num">${num(c.tp)}</td>
        <td class="num">${spct(c.upside, 0)}</td><td class="num">${c.price && s.last ? spct(s.last / c.price - 1) : '–'}</td><td class="num">${c.tp && s.last ? spct(c.tp / s.last - 1) : '–'}</td>
        <td class="num">${spct(c.fromLow, 0)}</td><td class="num">${spct(c.fromHigh, 0)}</td><td><span class="badge ${k}">${t}</span></td>
        <td class="num">${c.days ?? '–'}</td><td class="num">${spct(c.maxdd)}</td><td class="num">${spct(c.t6m)}</td><td>${esc(plainAnalyst(c.analyst) || '–')}</td></tr>`; }).join('')}</tbody></table></div>
      <p class="note">Prices and targets are adjusted for later share splits and bonus issues. Change since call and latest price to target use the latest price (${num(s.last)}). 6m return includes dividends.</p></div></div>`;
  wireSearch('q-stock');
  fetch(`data/b/${encodeURIComponent(id)}.json`).then(r => r.ok ? r.json() : null).then(b => { const el = $('#biz'); if (b && el) el.innerHTML = businessCard(b); }).catch(() => {});
  let px = null;
  try { px = await fetch(`data/s/${encodeURIComponent(id)}.json`).then(r => r.ok ? r.json() : null); } catch (e) { px = null; }
  if (px && !px.o) px = { ...px, o: px.c, h: px.c, l: px.c, v: px.c.map(() => 0) };      // older data files had closes only
  const pf = perfStats(px), perfEl = $('#perf');
  if (perfEl) perfEl.innerHTML = pf ? `<h2>Price performance <small class="sub" style="font-size:12px">(price only, excluding dividends, to ${fdate(px.d[px.d.length - 1])})</small></h2>
    <div class="perf">${pf.periods.map(([k, v]) => `<div class="perf-cell"><small>${k}</small><b>${spct(v)}</b></div>`).join('')}
      <div class="perf-cell"><small>5-year high / low</small><b>${num(pf.hi5)} / ${num(pf.lo5)}</b></div></div>
    ${pf.years.length ? `<h3 style="margin-top:16px">By calendar year</h3><div class="yearbars">${(() => { const m = Math.max(...pf.years.map(y => Math.abs(y[1])), .01);
      return pf.years.map(([y, v]) => `<div class="yb"><span class="yb-l">${esc(y)}</span><div class="yb-track"><i class="${v >= 0 ? 'up' : 'dn'}" style="width:${(Math.abs(v) / m * 50).toFixed(1)}%;${v >= 0 ? 'left:50%' : `right:50%`}"></i></div><b>${spct(v)}</b></div>`).join(''); })()}</div>` : ''}
    ${pf.first > daysAgo(px.d[px.d.length - 1], 1800) ? `<p class="note">Price history starts ${fdate(pf.first)}, so longer periods are not available.</p>` : ''}` : '<h2>Price performance</h2><p class="sub">No price history for this stock.</p>';
  const cv = $('#chart'); if (!cv) return;
  setupChart(cv, px, calls);
}

/* ---------- interactive price chart: candles or line, volume, broker markers, target lines, zoom and pan ---------- */
function setupChart(cv, px, calls) {
  const st = { type: 'candle', layers: { ma50: true, ma200: true, band: false, tp: true }, hide: new Set(), a: 0, b: px && px.c.length ? px.c.length - 1 : 0 };
  if (!px || !px.c.length) { drawChart(cv, null, calls, st); return; }
  const N = px.c.length, MIN = 15;
  const pre = { ma50: maArr(px.c, 50), ma200: maArr(px.c, 200), hi: rollArr(px.h, Math.max), lo: rollArr(px.l, Math.min) };
  const redraw = () => drawChart(cv, px, calls, st, pre);
  const setWin = (a, b) => { let span = Math.max(MIN, Math.min(N - 1, b - a)); a = Math.round(a); a = Math.max(0, Math.min(a, N - 1 - span)); st.a = a; st.b = Math.round(a + span); redraw(); };
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
  if (!px || !px.c.length) { g.fillStyle = '#6f7687'; g.fillText('No price history for this stock.', 16, 30); return; }
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
  g.strokeStyle = 'rgba(120,128,160,.16)'; g.fillStyle = '#6f7687'; g.lineWidth = 1;
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
  } else line(px.c, '#34326b', 1.7);
  if (st.layers.ma200) line(pre.ma200, '#e0913a', 1.3);
  if (st.layers.ma50) line(pre.ma50, '#7c6fd6', 1.3);
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
    g.fillStyle = '#6f7687'; g.fillText('Volume', 4, vy + 10);
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

/* ---------- business profile (data/b/<id>.json, summarised from the company's annual report) ---------- */
const BIZ_COLORS = ['#6c63d9', '#3fa58a', '#e0913a', '#d9a520', '#c08ad6', '#5b9bd5'];
function shareBar(items, key) {
  const tot = items.reduce((t, x) => t + (x[key] || 0), 0);
  if (!tot) return '';
  return `<div class="sharebar">${items.map((x, i) => x[key] ? `<span style="width:${(x[key] / tot * 100).toFixed(1)}%;background:${BIZ_COLORS[i % BIZ_COLORS.length]}" title="${esc(x.name)}: ${(x[key] / tot * 100).toFixed(0)}%"></span>` : '').join('')}</div>`;
}
function businessCard(b) {
  const segTot = b.segments.reduce((t, x) => t + (x.revenue || 0), 0), hasProfit = b.segments.some(x => x.profit != null);
  const profTot = b.segments.reduce((t, x) => t + (x.profit || 0), 0), geoMax = Math.max(...(b.geography || []).map(g => g.value), 1);
  const fmt = v => v >= 100 ? Math.round(v).toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return `<div class="glass card biz">
    <div class="biz-tag">The business in plain words</div>
    <div class="biz-one">${esc(b.oneLine)}</div>
    <ul class="biz-plain">${b.inPlainWords.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
    <h3>${esc(b.flowTitle || 'How it makes money')}</h3>
    <div class="flow">${b.flow.map((f, i) => `${i ? '<div class="arrow">→</div>' : ''}<div class="flow-step"><b>${esc(f.label)}</b><span>${esc(f.detail)}</span></div>`).join('')}</div>
    ${b.moneyNote ? `<p class="biz-note">${esc(b.moneyNote)}</p>` : ''}
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
  window.onresize = null; window.onmouseup = null; $('#tip').hidden = true; window.scrollTo(0, 0);
  ({ home, stocks: () => stocks(params), stock: () => stock(decodeURIComponent(parts[1] || '')), latest, brokers, method }[page] || home)();
}
$('#signin').onclick = () => { $('#modal').hidden = false; };
$('#modal-close').onclick = () => { $('#modal').hidden = true; };
window.addEventListener('hashchange', route);
load().then(route).catch(e => { view.innerHTML = `<p class="loading">Could not load the data files (${esc(e.message)}). Run research/combined/combine.py first.</p>`; });
