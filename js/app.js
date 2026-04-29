/**
 * app.js — Main Dashboard Logic
 * Conveyor Belt Dashboard · Italianthai Hongsa
 *
 * Responsibilities:
 *  - Fetching data from Google Sheets (Sheet: Data PUR, gid=0)
 *  - Parsing CSV / GViz JSON
 *  - Rendering metric cards with BW breakdown
 *  - Rendering comparison bars (BW2200 & BW1800)
 *  - Rendering belt analysis charts (Bar + Cumulative Line)
 *  - Filter/sort for the data table
 *
 * Depends on: Chart.js (global), auth.js (already loaded)
 */

// ══════════════════════════════════════════════
//  CONFIG
// ══════════════════════════════════════════════
const SHEET_ID = '14GmKP362tbU17eAAY-dYy37T_Iqtwga4HSULdPntyQ0';
const GID      = '0';

/**
 * Belt type definitions for the analysis selector.
 * Add / remove entries here to update the selector buttons.
 * Each entry: { key, label, color, match(row) }
 */
const BELT_TYPES = [
  { key: 'BW2200',       label: 'BW2200',         color: '#2ecc71', match: r => getBW(r) === 'BW2200' },
  { key: 'BW1800',       label: 'BW1800',         color: '#3b9ede', match: r => getBW(r) === 'BW1800' },
  { key: 'BW2400_SPD',   label: 'BW2400 (SPD)',   color: '#9b59b6', match: r => getBW(r) === 'BW2400' && getMachine(r).includes('spreader') },
  { key: 'BW2400_CRDCV', label: 'BW2400 (CR-DCV)',color: '#e74c3c', match: r => getBW(r) === 'BW2400' && getMachine(r).includes('dcv') },
  { key: 'BW2400_CRSPL', label: 'BW2400 (CR-SPL)',color: '#f1c40f', match: r => getBW(r) === 'BW2400' && getMachine(r).includes('spl') },
  { key: 'BW1600',       label: 'BW1600',         color: '#f07c1f', match: r => getBW(r) === 'BW1600' },
];

/**
 * BW breakdown definitions used in metric cards.
 * Adjust here to add/rename BW categories.
 */
const BW_DEFS = [
  { key: 'BW2200',     label: 'BW2200',    color: '#2ecc71', test: r => getBW(r) === 'BW2200' },
  { key: 'BW1800',     label: 'BW1800',    color: '#3b9ede', test: r => getBW(r) === 'BW1800' },
  { key: 'BW1600',     label: 'BW1600',    color: '#f07c1f', test: r => getBW(r) === 'BW1600' },
  { key: 'BW2400_SPD', label: 'BW2400 SPD',color: '#9b59b6', test: r => getBW(r) === 'BW2400' && getMachine(r).includes('spreader') },
  { key: 'BW2400_CR',  label: 'BW2400 Cr', color: '#e74c3c', test: r => getBW(r) === 'BW2400' && !getMachine(r).includes('spreader') },
];

// ══════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════
let ALL          = [];   // all data rows (array of string arrays)
let HDR          = [];   // header labels
let sCol         = -1;   // active sort column index
let sAsc         = true; // sort direction
let charts       = {};   // Chart.js instances keyed by canvas id
let activeBelt   = 'BW2200';
let includeProject = true; // toggle: include 2014 (project start) or not

// ══════════════════════════════════════════════
//  CHART.JS TOOLTIP DEFAULTS
// ══════════════════════════════════════════════
const TT = {
  backgroundColor: '#1e2333',
  borderColor:     'rgba(240,124,31,.35)',
  borderWidth:     1,
  titleColor:      '#eef0f5',
  bodyColor:       '#8b90a0',
  padding:         10,
  cornerRadius:    8,
};

// ══════════════════════════════════════════════
//  UTILITIES
// ══════════════════════════════════════════════

/** Format number with Thai locale (rounded integer) */
const FMT = n => {
  const v = parseFloat(String(n).replace(/,/g, ''));
  return isNaN(v) ? (n || '') : new Intl.NumberFormat('th-TH').format(Math.round(v));
};

/** Parse a cell value to float, returning 0 on failure */
const num = v => parseFloat(String(v || '').replace(/,/g, '')) || 0;

/**
 * Find column index by keyword (case-insensitive).
 * Tries exact match first, then partial match.
 */
function ci(kw) {
  const k = kw.toLowerCase();
  let i = HDR.findIndex(h => h.toLowerCase() === k);
  return i >= 0 ? i : HDR.findIndex(h => h.toLowerCase().includes(k));
}

/** Return unique sorted values for a column index */
function uniq(arr, idx) {
  return [...new Set(arr.map(r => r[idx]).filter(v => v !== undefined && v !== ''))]
    .sort((a, b) => {
      const na = parseFloat(a), nb = parseFloat(b);
      return (!isNaN(na) && !isNaN(nb)) ? na - nb : String(a).localeCompare(String(b), 'th');
    });
}

/** Safely destroy a Chart.js instance */
function killChart(key) {
  if (charts[key]) { try { charts[key].destroy(); } catch (e) {} delete charts[key]; }
}

/** Extract BW width string (e.g. 'BW2200') from a data row */
function getBW(row) {
  const iN   = ci('รายการ');
  const iW   = ci('belt w');
  const name = String(row[iN] || '').toUpperCase();
  for (const w of [1600, 1800, 2000, 2200, 2400, 2600, 2800]) {
    if (name.includes('BW' + w)) return 'BW' + w;
  }
  const wv = num(row[iW]);
  return wv ? 'BW' + wv : 'อื่นๆ';
}

/** Return lowercase machine name for matching */
function getMachine(row) {
  const iM = ci('เครื่องจักร');
  return String(row[iM] || '').toLowerCase();
}

// ══════════════════════════════════════════════
//  DATA FETCHING
// ══════════════════════════════════════════════

/**
 * Fetch data via Google Visualization JSONP.
 * Works even when fetch() is blocked by CORS.
 */
function loadViaGViz(cb) {
  const cbName = '_gviz_' + Date.now();
  const s = document.createElement('script');
  s.src = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?gid=${GID}&tqx=out:json&callback=${cbName}`;
  let done = false;

  window[cbName] = function (data) {
    done = true;
    delete window[cbName];
    document.head.removeChild(s);
    try { cb(null, parseGViz(data)); } catch (e) { cb(e); }
  };
  s.onerror = () => { if (!done) { done = true; cb(new Error('Script load failed')); } };
  setTimeout(() => { if (!done) { done = true; cb(new Error('Timeout')); } }, 12000);
  document.head.appendChild(s);
}

/** Parse GViz JSON response into { cols, rows } */
function parseGViz(data) {
  const cols = data.table.cols.map(c => c.label || '');
  const rows = data.table.rows.map(r =>
    r.c.map((cell, i) => {
      if (!cell || cell.v === null || cell.v === undefined) return '';
      if (data.table.cols[i].type === 'date' && cell.v) {
        const m = String(cell.v).match(/Date\((\d+),/);
        return m ? String(parseInt(m[1])) : '';
      }
      return String(cell.v);
    })
  );
  return { cols, rows };
}

/** Fetch CSV from Google Sheets as fallback */
async function loadViaCSV() {
  const urls = [
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`,
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${GID}`,
  ];
  for (const url of urls) {
    try {
      const res  = await fetch(url, { mode: 'cors' });
      if (!res.ok) continue;
      const text = await res.text();
      if (!text || text.trim().startsWith('<!')) continue;
      return parseCSV(text);
    } catch (e) { /* try next */ }
  }
  return null;
}

/** Parse raw CSV text into { cols, rows } */
function parseCSV(text) {
  const rows = [];
  let cur = '', inQ = false;
  const cells = [];

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === ',' && !inQ) { cells.push(cur.trim()); cur = ''; continue; }
    if ((c === '\n' || c === '\r') && !inQ) {
      if (cur.trim() || cells.length) {
        cells.push(cur.trim());
        rows.push([...cells]);
        cells.length = 0;
        cur = '';
      }
      if (c === '\r' && text[i + 1] === '\n') i++;
      continue;
    }
    cur += c;
  }
  if (cur.trim() || cells.length) { cells.push(cur.trim()); rows.push([...cells]); }
  if (!rows.length) return null;

  // Auto-detect header row (first row with >3 non-empty cells)
  let start = 0;
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    if (rows[i].filter(c => c !== '').length > 3) { start = i; break; }
  }
  return { cols: rows[start], rows: rows.slice(start + 1).filter(r => r.some(c => c !== '')) };
}

// ══════════════════════════════════════════════
//  BOOTSTRAP
// ══════════════════════════════════════════════

/** Entry point — loads data from Google Sheets */
async function loadData() {
  const btn = document.getElementById('btnRefresh');
  btn.classList.add('spinning');
  setStatus('load');

  document.getElementById('lscreen').style.display = 'flex';
  document.getElementById('escreen').style.display = 'none';
  document.getElementById('main').style.display    = 'none';

  loadViaGViz(async (err, result) => {
    if (err || !result) result = await loadViaCSV();
    if (!result || !result.rows || result.rows.length === 0) {
      showError(err ? err.message : 'ไม่พบข้อมูล');
      btn.classList.remove('spinning');
      return;
    }

    HDR = result.cols;
    ALL = result.rows;

    buildFilters();
    buildBeltSelector();

    document.getElementById('lscreen').style.display  = 'none';
    document.getElementById('main').style.display     = 'block';
    document.getElementById('lastSync').textContent   = new Date().toLocaleString('th-TH', { hour12: false });

    setStatus('live');
    renderAll();
    btn.classList.remove('spinning');
  });
}

// ══════════════════════════════════════════════
//  STATUS / ERROR
// ══════════════════════════════════════════════

function showError(msg) {
  document.getElementById('lscreen').style.display = 'none';
  document.getElementById('escreen').style.display = 'block';
  document.getElementById('emsg').textContent =
    'Error: ' + msg +
    '\n\n1. เปิด Google Sheet\n2. Share → "Anyone with the link" → Viewer\n3. กด Done แล้วกด Refresh';
  setStatus('err');
}

function setStatus(s) {
  const d = document.getElementById('sdot');
  const t = document.getElementById('stxt');
  d.className = 'sdot';
  if (s === 'live') { d.classList.add('live'); t.textContent = 'Connected · Live data from Google Sheets'; }
  else if (s === 'err') { d.classList.add('err'); t.textContent = 'Connection error'; }
  else { t.textContent = 'กำลังเชื่อมต่อ...'; }
}

// ══════════════════════════════════════════════
//  FILTERS & SELECTORS
// ══════════════════════════════════════════════

/** Populate filter dropdowns and build table headers */
function buildFilters() {
  const iY = ci('year'), iB = ci('ยี่ห้อ'), iT = ci('type'), iM = ci('เครื่องจักร');
  [['fY', iY], ['fB', iB], ['fT', iT], ['fM', iM]].forEach(([id, idx]) => {
    const sel = document.getElementById(id);
    while (sel.options.length > 1) sel.remove(1);
    if (idx >= 0) uniq(ALL, idx).forEach(v => sel.add(new Option(v, v)));
    sel.onchange = renderAll;
  });

  document.getElementById('thead').innerHTML = HDR.map((h, i) =>
    `<th id="th${i}" onclick="sb(${i})">${h}<span class="si" id="si${i}">↕</span></th>`
  ).join('');
}

/** Build belt type selector buttons */
function buildBeltSelector() {
  const wrap = document.getElementById('beltSelector');
  [...wrap.querySelectorAll('.belt-btn')].forEach(b => b.remove());

  BELT_TYPES.forEach(bt => {
    const btn = document.createElement('button');
    btn.className = 'belt-btn' + (bt.key === activeBelt ? ' active' : '');
    btn.textContent = bt.label;
    btn.onclick = () => {
      activeBelt = bt.key;
      [...wrap.querySelectorAll('.belt-btn')].forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderBeltCharts(getFilt());
    };
    wrap.appendChild(btn);
  });
}

/** Toggle include/exclude project year 2014 */
function toggleProject() {
  includeProject = !includeProject;
  const btn = document.getElementById('btnProjToggle');
  const lbl = document.getElementById('projToggleLabel');
  if (includeProject) {
    btn.classList.add('active');
    lbl.textContent = 'รวมเริ่มโครงการ (2014)';
  } else {
    btn.classList.remove('active');
    lbl.textContent = 'ไม่รวมเริ่มโครงการ (2014)';
  }
  renderBeltCharts(getFilt());
}

/** Return filtered data based on current dropdown selections */
function getFilt() {
  const fy = document.getElementById('fY').value;
  const fb = document.getElementById('fB').value;
  const ft = document.getElementById('fT').value;
  const fm = document.getElementById('fM').value;
  const iY = ci('year'), iB = ci('ยี่ห้อ'), iT = ci('type'), iM = ci('เครื่องจักร');
  return ALL.filter(r =>
    (!fy || r[iY] == fy) &&
    (!fb || r[iB] == fb) &&
    (!ft || r[iT] == ft) &&
    (!fm || r[iM] == fm)
  );
}

/** Sort table by column */
function sb(col) {
  if (sCol === col) sAsc = !sAsc; else { sCol = col; sAsc = true; }
  renderAll();
}

// ══════════════════════════════════════════════
//  RENDER — MAIN
// ══════════════════════════════════════════════

function renderAll() {
  const data  = getFilt();
  const iQ    = ci('จำนวน');
  const iV    = ci('ราคารวม');
  const iT    = ci('type');
  const iY    = ci('year');
  const iL    = ci('link');

  // ── Metric cards ──
  _renderMetrics(data, iQ, iV);

  // ── Comparison bars ──
  _renderComparisonBars(data, iQ, iV, iY);

  // ── Belt analysis charts ──
  renderBeltCharts(data);

  // ── Data table ──
  _renderTable(data, iT, iY, iL, iQ);

  document.getElementById('rc').innerHTML = `แสดง <strong>${data.length}</strong> จาก ${ALL.length} รายการ`;
}

// ── Sub-renderer: metric cards with BW breakdown ──
function _renderMetrics(data, iQ, iV) {
  const tM = data.reduce((s, r) => s + num(r[iQ]), 0);
  const tV = data.reduce((s, r) => s + num(r[iV]), 0);

  function bwRow(b, val, unit) {
    return `<div class="mc-brow">
      <span class="mc-brow-lbl">
        <span style="display:inline-block;width:7px;height:7px;border-radius:2px;background:${b.color};margin-right:4px;vertical-align:middle;"></span>
        ${b.label}
      </span>
      <span class="mc-brow-val" style="color:${b.color}">${val} ${unit}</span>
    </div>`;
  }

  const cntHTML = BW_DEFS.map(b => { const v = data.filter(b.test).length;                                         return v > 0 ? bwRow(b, v, 'รายการ') : ''; }).join('');
  const mtrHTML = BW_DEFS.map(b => { const v = data.filter(b.test).reduce((s,r) => s + num(r[iQ]), 0);             return v > 0 ? bwRow(b, FMT(v), 'ม.') : ''; }).join('');
  const valHTML = BW_DEFS.map(b => { const v = data.filter(b.test).reduce((s,r) => s + num(r[iV]), 0) / 1e6;      return v > 0 ? bwRow(b, v.toFixed(2), 'M฿') : ''; }).join('');

  document.getElementById('mgrid').innerHTML = `
    <div class="mc a1 fi">
      <div class="mc-inner">
        <div class="mc-main">
          <div class="mico">📋</div>
          <div class="mlbl">รายการทั้งหมด</div>
          <div class="mval">${data.length}</div>
          <div class="munit">รายการ</div>
        </div>
        <div class="mc-breakdown">${cntHTML}</div>
      </div>
    </div>
    <div class="mc a2 fi">
      <div class="mc-inner">
        <div class="mc-main">
          <div class="mico">📏</div>
          <div class="mlbl">จำนวนรวม</div>
          <div class="mval">${FMT(tM)}</div>
          <div class="munit">เมตร</div>
        </div>
        <div class="mc-breakdown">${mtrHTML}</div>
      </div>
    </div>
    <div class="mc a3 fi">
      <div class="mc-inner">
        <div class="mc-main">
          <div class="mico">💰</div>
          <div class="mlbl">มูลค่ารวม</div>
          <div class="mval">${(tV / 1e6).toFixed(1)}<span style="font-size:15px;opacity:.6"> M</span></div>
          <div class="munit">ล้านบาท</div>
        </div>
        <div class="mc-breakdown">${valHTML}</div>
      </div>
    </div>`;
}

// ── Sub-renderer: BW2200 & BW1800 horizontal comparison bars ──
function _renderComparisonBars(data, iQ, iV, iY) {
  ['BW2200', 'BW1800'].forEach(bw => {
    const panel = document.getElementById('compPanel' + bw.replace('BW', ''));
    if (!panel) return;
    killChart('cComp' + bw.replace('BW', ''));

    const bwRows = data.filter(r => getBW(r) === bw);
    const proj   = bwRows.filter(r => r[iY] === '2014');
    const norm   = bwRows.filter(r => r[iY] !== '2014' && r[iY] !== '');
    const projM  = proj.reduce((s, r) => s + num(r[iQ]), 0);
    const normM  = norm.reduce((s, r) => s + num(r[iQ]), 0);
    const projV  = proj.reduce((s, r) => s + num(r[iV]), 0) / 1e6;
    const normV  = norm.reduce((s, r) => s + num(r[iV]), 0) / 1e6;
    const maxM   = Math.max(projM, normM, 1);
    const maxV   = Math.max(projV, normV, 0.01);
    const ratioM = projM > 0 ? (normM / projM).toFixed(1) + 'x' : '—';
    const ratioV = projV > 0 ? (normV / projV).toFixed(1) + 'x' : '—';

    panel.innerHTML = `
      <div class="comp-title">${bw} <span class="cbadge">HORIZONTAL BAR</span></div>
      <div class="comp-group">
        <div class="comp-group-label">ความยาวสายพาน</div>
        <div class="comp-row">
          <div class="comp-row-label">เริ่มโครงการ</div>
          <div class="comp-bar-wrap"><div class="comp-bar proj" style="width:${(projM/maxM*100).toFixed(1)}%"></div></div>
          <div class="comp-val proj">${FMT(projM)} ม.</div>
        </div>
        <div class="comp-row">
          <div class="comp-row-label">สั่งซื้อปกติ</div>
          <div class="comp-bar-wrap"><div class="comp-bar norm" style="width:${(normM/maxM*100).toFixed(1)}%"></div></div>
          <div class="comp-val norm">${FMT(normM)} ม.</div>
        </div>
      </div>
      <div class="comp-group">
        <div class="comp-group-label">มูลค่าสายพาน</div>
        <div class="comp-row">
          <div class="comp-row-label">เริ่มโครงการ</div>
          <div class="comp-bar-wrap"><div class="comp-bar proj" style="width:${(projV/maxV*100).toFixed(1)}%"></div></div>
          <div class="comp-val proj">${projV.toFixed(2)} M฿</div>
        </div>
        <div class="comp-row">
          <div class="comp-row-label">สั่งซื้อปกติ</div>
          <div class="comp-bar-wrap"><div class="comp-bar norm" style="width:${(normV/maxV*100).toFixed(1)}%"></div></div>
          <div class="comp-val norm">${normV.toFixed(2)} M฿</div>
        </div>
      </div>
      <div class="comp-legend">
        <span><span class="comp-leg-dot" style="background:#e74c3c"></span>เริ่มโครงการ (2014)</span>
        <span><span class="comp-leg-dot" style="background:#3b9ede"></span>สั่งซื้อปกติ (2015+)</span>
        <span class="comp-ratio">ปกติมากกว่า: ${ratioM} · ${ratioV}</span>
      </div>`;
  });
}

// ── Sub-renderer: data table ──
function _renderTable(data, iT, iY, iL, iQ) {
  let sorted = [...data];
  if (sCol >= 0) {
    sorted.sort((a, b) => {
      const av = a[sCol], bv = b[sCol];
      const na = parseFloat(String(av).replace(/,/g, ''));
      const nb = parseFloat(String(bv).replace(/,/g, ''));
      if (!isNaN(na) && !isNaN(nb)) return sAsc ? na - nb : nb - na;
      return sAsc
        ? String(av).localeCompare(String(bv), 'th')
        : String(bv).localeCompare(String(av), 'th');
    });
  }

  // Update sort indicators
  HDR.forEach((_, i) => {
    const el = document.getElementById('si' + i);
    const th = document.getElementById('th' + i);
    if (!el || !th) return;
    th.classList.toggle('sa', sCol === i);
    el.className   = 'si' + (sCol === i ? ' on' : '');
    el.textContent = sCol === i ? (sAsc ? '↑' : '↓') : '↕';
  });

  document.getElementById('tbody').innerHTML = sorted.map(r =>
    '<tr>' + HDR.map((_, ci2) => {
      const cell = r[ci2] || '';
      if (ci2 === iT) {
        const isS = cell.toLowerCase().includes('steel');
        return `<td><span class="badge ${isS ? 'bst' : 'bfa'}">${isS ? 'Steel Cord' : 'Fabric'}</span></td>`;
      }
      if (ci2 === iY && cell) return `<td><span class="badge byr">${cell}</span></td>`;
      if (ci2 === iL) {
        const safeUrl = cell && /^https:\/\//i.test(cell) ? cell : null;
        return `<td>${safeUrl ? `<a class="lpdf" href="${safeUrl}" target="_blank" rel="noopener noreferrer">PDF</a>` : ''}</td>`;
      }

      const isNum   = !isNaN(parseFloat(String(cell).replace(/,/g, ''))) && cell !== '';
      const isPrice = HDR[ci2] && (HDR[ci2].includes('ราคา') || HDR[ci2].includes('จำนวน'));
      if (isPrice && isNum) return `<td class="num">${FMT(cell)}</td>`;
      return `<td class="${ci2 === 0 ? 'tdim' : ''}">${cell}</td>`;
    }).join('') + '</tr>'
  ).join('');
}

// ══════════════════════════════════════════════
//  RENDER — BELT ANALYSIS CHARTS
// ══════════════════════════════════════════════

/**
 * Render the mixed Bar + Cumulative Line charts for the selected belt type.
 * Called whenever belt selector or project toggle changes.
 */
function renderBeltCharts(data) {
  const iQ   = ci('จำนวน');
  const iV   = ci('ราคารวม');
  const iY   = ci('year');
  const bt   = BELT_TYPES.find(b => b.key === activeBelt) || BELT_TYPES[0];

  // Filter by belt type and optionally exclude project year
  const bRows = data.filter(bt.match).filter(r => includeProject ? true : r[iY] !== '2014');
  const years = (includeProject ? uniq(data, iY) : uniq(data, iY).filter(y => y !== '2014')).sort();

  // Chart subtitles
  const projNote = includeProject ? ' · แดง = เริ่มโครงการ 2014' : ' · ไม่รวมเริ่มโครงการ 2014';
  const el1 = document.getElementById('beltChartSub1');
  const el2 = document.getElementById('beltChartSub2');
  if (el1) el1.textContent = bt.label + projNote;
  if (el2) el2.textContent = bt.label + projNote;

  // Per-year aggregates
  const lenData  = years.map(y => bRows.filter(r => r[iY] == y).reduce((s, r) => s + num(r[iQ]), 0));
  const valData  = years.map(y => bRows.filter(r => r[iY] == y).reduce((s, r) => s + num(r[iV]), 0) / 1e6);
  const barColors = years.map(y => (includeProject && y === '2014') ? '#e74c3c' : bt.color);

  // Cumulative sums
  const cumLen = []; let cL = 0; lenData.forEach(v => { cL += v; cumLen.push(cL); });
  const cumVal = []; let cV = 0; valData.forEach(v => { cV += v; cumVal.push(parseFloat(cV.toFixed(2))); });

  // Legend HTML
  const legendHtml = includeProject
    ? `<span><span class="lsq" style="background:#e74c3c"></span>เริ่มโครงการ (2014)</span>
       <span><span class="lsq" style="background:${bt.color}"></span>${bt.label} ปกติ (2015+)</span>
       <span><span class="lsq" style="background:rgba(255,255,255,0.7);border-radius:50%;width:8px;height:8px;"></span>เส้นสะสม</span>`
    : `<span><span class="lsq" style="background:${bt.color}"></span>${bt.label} (2015+)</span>
       <span><span class="lsq" style="background:rgba(255,255,255,0.7);border-radius:50%;width:8px;height:8px;"></span>เส้นสะสม</span>`;
  ['lBeltLen', 'lBeltVal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = legendHtml;
  });

  // Shared options factory for mixed charts
  function mixedOpts(cbLeft, cbRight, footerCb) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...TT,
          callbacks: {
            label: ctx => {
              if (ctx.dataset.type === 'line') return ` สะสม: ${cbRight(ctx.raw)}`;
              const isProj = includeProject && ctx.label === '2014';
              return ` ${isProj ? 'เริ่มโครงการ' : 'ปีนี้'}: ${cbLeft(ctx.raw)}`;
            },
            footer: items => {
              const li = items.find(i => i.dataset.type === 'line');
              return li ? footerCb(li.raw) : '';
            },
          },
        },
      },
      scales: {
        x: { ticks: { color: '#545968', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,.04)' } },
        yBar: {
          type: 'linear', position: 'left',
          ticks: { color: '#545968', font: { size: 10 }, callback: cbLeft },
          grid:  { color: 'rgba(255,255,255,.06)' },
          title: { display: false },
        },
        yCum: {
          type: 'linear', position: 'right',
          ticks: { color: 'rgba(255,255,255,0.35)', font: { size: 10 }, callback: cbRight },
          grid:  { drawOnChartArea: false },
          title: { display: false },
        },
      },
    };
  }

  // Shared cumulative line dataset style
  const lineDs = {
    type: 'line', label: 'สะสม',
    borderColor: 'rgba(255,255,255,0.75)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 2.5,
    pointRadius: 4, pointHoverRadius: 7,
    pointBackgroundColor: 'rgba(255,255,255,0.9)',
    pointBorderColor: '#181c27', pointBorderWidth: 2,
    fill: false, tension: 0.3,
    yAxisID: 'yCum', order: 1,
  };

  // Chart: Length (Bar + Cumulative Line)
  killChart('cBeltLen');
  charts['cBeltLen'] = new Chart(document.getElementById('cBeltLen'), {
    data: {
      labels: years,
      datasets: [
        { type: 'bar', label: 'ความยาว', data: lenData, backgroundColor: barColors, borderRadius: 5, borderSkipped: false, yAxisID: 'yBar', order: 2 },
        { ...lineDs, data: cumLen },
      ],
    },
    options: mixedOpts(
      v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : String(Math.round(v)),
      v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : String(Math.round(v)),
      v => `สะสมทั้งหมด: ${FMT(v)} ม.`
    ),
  });

  // Chart: Value (Bar + Cumulative Line)
  killChart('cBeltVal');
  charts['cBeltVal'] = new Chart(document.getElementById('cBeltVal'), {
    data: {
      labels: years,
      datasets: [
        { type: 'bar', label: 'มูลค่า', data: valData, backgroundColor: barColors, borderRadius: 5, borderSkipped: false, yAxisID: 'yBar', order: 2 },
        { ...lineDs, data: cumVal },
      ],
    },
    options: mixedOpts(
      v => v.toFixed(1) + ' M',
      v => v.toFixed(0) + ' M',
      v => `สะสมทั้งหมด: ${v.toFixed(2)} ล้านบาท`
    ),
  });

  // Cleanup stale standalone cumulative charts (if any)
  ['cBeltLenCum', 'cBeltValCum'].forEach(k => killChart(k));
}

// ══════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════
loadData();
