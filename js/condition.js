/**
 * condition.js — Belt Condition Dashboard
 * Italianthai Hongsa
 *
 * Fetches inspection data (thickness, hardness, damage) from a separate sheet.
 * Depends on: Chart.js, app.js (parseGViz, parseCSV, num, FMT, uniq, TT)
 */

const COND_SHEET_ID = '1r71wJW-eyhUrDeU-xPS1LApdbfNf7ROb0u4sTeJX_S8';
const COND_GID      = '421967062';

let COND_ALL   = [];
let COND_HDR   = [];
let condLoaded = false;
let condCharts = {};

// ══════════════════════════════════════════════
//  COLUMN HELPERS
// ══════════════════════════════════════════════

function condCI(kw) {
  const k = kw.toLowerCase();
  let i = COND_HDR.findIndex(h => h.toLowerCase() === k);
  return i >= 0 ? i : COND_HDR.findIndex(h => h.toLowerCase().includes(k));
}
function condAllCI(kw) {
  const k = kw.toLowerCase();
  return COND_HDR.reduce((a, h, i) => { if (h.toLowerCase().includes(k)) a.push(i); return a; }, []);
}
function killCChart(key) {
  if (condCharts[key]) { try { condCharts[key].destroy(); } catch(e) {} delete condCharts[key]; }
}

// ══════════════════════════════════════════════
//  DATA FETCHING
// ══════════════════════════════════════════════

function loadCondViaGViz(cb) {
  const cbName = '_condgviz_' + Date.now();
  const s = document.createElement('script');
  s.src = `https://docs.google.com/spreadsheets/d/${COND_SHEET_ID}/gviz/tq?gid=${COND_GID}&tqx=out:json&callback=${cbName}`;
  let done = false;
  window[cbName] = d => {
    done = true; delete window[cbName]; document.head.removeChild(s);
    try { cb(null, parseGViz(d)); } catch(e) { cb(e); }
  };
  s.onerror = () => { if (!done) { done = true; cb(new Error('Script load failed')); } };
  setTimeout(() => { if (!done) { done = true; cb(new Error('Timeout')); } }, 12000);
  document.head.appendChild(s);
}

async function loadCondData() {
  const el = id => document.getElementById(id);
  el('condLoading').style.display = 'flex';
  el('condMain').style.display    = 'none';
  el('condErr').style.display     = 'none';
  el('condDot').className         = 'sdot';
  el('condTxt').textContent       = 'กำลังโหลดข้อมูล...';

  loadCondViaGViz(async (err, result) => {
    if (err || !result) {
      try {
        const res  = await fetch(`https://docs.google.com/spreadsheets/d/${COND_SHEET_ID}/export?format=csv&gid=${COND_GID}`, { mode: 'cors' });
        const text = await res.text();
        if (!text.trim().startsWith('<!')) result = parseCSV(text);
      } catch(e) {}
    }

    if (!result || !result.rows.length) {
      el('condLoading').style.display = 'none';
      el('condErr').style.display     = 'block';
      el('condErrMsg').textContent    = 'ไม่สามารถโหลดข้อมูลได้ — ตรวจสอบว่า Sheet เป็น Public';
      el('condDot').classList.add('err');
      el('condTxt').textContent = 'Connection error';
      return;
    }

    COND_HDR   = result.cols;
    COND_ALL   = result.rows;
    condLoaded = true;

    el('condLoading').style.display = 'none';
    el('condMain').style.display    = 'block';
    el('condDot').classList.add('live');
    el('condTxt').textContent = `Connected · ${COND_ALL.length} inspection records`;

    renderCondition();
  });
}

// ══════════════════════════════════════════════
//  MAIN RENDER
// ══════════════════════════════════════════════

function renderCondition() {
  const iDate   = condCI('date');
  const iLine   = condCI('line');
  const iJoint  = condCI('joint');
  const iBrand  = condCI('brand');
  const iShort  = condCI('short');
  const iSMU    = condCI('smu');
  const iActive = condCI('active');

  // AVG columns order: [HardnessTopAVG, HardnessBotAVG, ...ThicknessAVGs]
  const avgCols     = condAllCI('avg');
  const iHardTopAvg = avgCols[0]  ?? -1;
  const iHardBotAvg = avgCols[1]  ?? -1;
  const iThickAvg   = avgCols[avgCols.length - 1] ?? -1;

  const iHole  = condCI('หลุม');
  const iCut   = condCI('รอยบาด');
  const iTear  = condCI('รอยฉีก');
  const iCrack = condCI('รอยแตก');
  const iEdgeR = condCI('ขอบขวา');
  const iEdgeL = condCI('ขอบซ้าย');
  const iSling = condCI('สลิง');
  const iThru  = condCI('ทะลุ');

  const C = { iDate, iLine, iJoint, iBrand, iShort, iSMU, iActive,
               iHardTopAvg, iHardBotAvg, iThickAvg,
               iHole, iCut, iTear, iCrack, iEdgeR, iEdgeL, iSling, iThru };
  const dmgCols = [iHole, iCut, iTear, iCrack, iEdgeR, iEdgeL, iSling, iThru].filter(i => i >= 0);

  const activeRows = COND_ALL.filter(r => String(r[iActive]).toUpperCase() === 'TRUE');

  _renderCondCards(activeRows, C, dmgCols);
  _renderLineHealth(activeRows, C, dmgCols);
  _renderThicknessTrend(COND_ALL, C);
  _renderDamageChart(COND_ALL, C, dmgCols);
  _renderBrandChart(activeRows, C);
  _renderCondTable(COND_ALL, C, dmgCols);
}

// ══════════════════════════════════════════════
//  1 · OVERVIEW CARDS
// ══════════════════════════════════════════════

function _renderCondCards(rows, C, dmgCols) {
  const avg = col => {
    const vals = rows.map(r => num(r[col])).filter(v => v > 0);
    return vals.length ? vals.reduce((a,b) => a + b, 0) / vals.length : 0;
  };
  const lines    = new Set(rows.map(r => r[C.iLine]).filter(v => v));
  const hardTop  = avg(C.iHardTopAvg);
  const thick    = avg(C.iThickAvg);
  const totalDmg = rows.reduce((s, r) => s + dmgCols.reduce((d, col) => d + num(r[col]), 0), 0);

  const tColor = thick   >= 30 ? '#2ecc71' : thick   >= 25 ? '#f1c40f' : '#e74c3c';
  const hColor = hardTop >= 60 ? '#2ecc71' : hardTop >= 55 ? '#f1c40f' : '#e74c3c';

  document.getElementById('condCards').innerHTML = `
    <div class="mc a2 fi">
      <div class="mc-inner"><div class="mc-main">
        <div class="mico">🔗</div>
        <div class="mlbl">Joint Active</div>
        <div class="mval" style="color:var(--accent2)">${rows.length}</div>
        <div class="munit">${lines.size} Lines</div>
      </div></div>
    </div>
    <div class="mc a3 fi">
      <div class="mc-inner"><div class="mc-main">
        <div class="mico">📏</div>
        <div class="mlbl">ความหนาเฉลี่ย</div>
        <div class="mval" style="color:${tColor}">${thick.toFixed(1)}</div>
        <div class="munit">มิลลิเมตร</div>
      </div></div>
    </div>
    <div class="mc a1 fi">
      <div class="mc-inner"><div class="mc-main">
        <div class="mico">💪</div>
        <div class="mlbl">ความแข็งเฉลี่ย (Top)</div>
        <div class="mval" style="color:${hColor}">${hardTop.toFixed(1)}</div>
        <div class="munit">Shore A</div>
      </div></div>
    </div>
    <div class="mc a4 fi">
      <div class="mc-inner"><div class="mc-main">
        <div class="mico">⚠️</div>
        <div class="mlbl">ความเสียหายรวม</div>
        <div class="mval" style="color:${totalDmg > 0 ? 'var(--danger)' : 'var(--success)'}">${FMT(totalDmg)}</div>
        <div class="munit">จุด (Active joints)</div>
      </div></div>
    </div>`;
}

// ══════════════════════════════════════════════
//  2 · LINE HEALTH CARDS
// ══════════════════════════════════════════════

function _renderLineHealth(rows, C, dmgCols) {
  const lines = [...new Set(rows.map(r => r[C.iLine]).filter(v => v))].sort();

  const html = lines.map(line => {
    const lr      = rows.filter(r => r[C.iLine] === line);
    const thickVals = lr.map(r => num(r[C.iThickAvg])).filter(v => v > 0);
    const hardVals  = lr.map(r => num(r[C.iHardTopAvg])).filter(v => v > 0);
    const dmg       = lr.reduce((s, r) => s + dmgCols.reduce((d, col) => d + num(r[col]), 0), 0);
    const avgThick  = thickVals.length ? thickVals.reduce((a,b) => a+b)/thickVals.length : 0;
    const avgHard   = hardVals.length  ? hardVals.reduce((a,b)  => a+b)/hardVals.length  : 0;

    // Health: 0–100, based on thickness (20mm = worn, 37mm = new)
    const score = Math.max(0, Math.min(100, (avgThick - 20) / 17 * 100));
    const color = score >= 65 ? '#2ecc71' : score >= 40 ? '#f1c40f' : '#e74c3c';
    const label = score >= 65 ? 'GOOD' : score >= 40 ? 'WARNING' : 'CRITICAL';

    return `
      <div class="clc">
        <div class="clc-head">
          <span class="clc-name">${line}</span>
          <span class="clc-badge" style="background:${color}22;color:${color};border-color:${color}55">${label}</span>
        </div>
        <div class="clc-bar-wrap"><div class="clc-bar" style="width:${score.toFixed(0)}%;background:${color}"></div></div>
        <div class="clc-stats">
          <span>📏 <b>${avgThick > 0 ? avgThick.toFixed(1) : '—'}</b> mm</span>
          <span>💪 <b>${avgHard  > 0 ? avgHard.toFixed(1)  : '—'}</b> A</span>
          <span>🔗 <b>${lr.length}</b> joints</span>
          <span style="color:${dmg > 0 ? '#e74c3c' : '#545968'}">⚠ <b>${dmg}</b> dmg</span>
        </div>
      </div>`;
  }).join('');

  document.getElementById('condLineHealth').innerHTML = `<div class="clc-grid">${html}</div>`;
}

// ══════════════════════════════════════════════
//  3 · THICKNESS TREND
// ══════════════════════════════════════════════

function _renderThicknessTrend(rows, C) {
  killCChart('cThickTrend');
  const lines  = [...new Set(rows.map(r => r[C.iLine]).filter(v => v))].sort();
  const dates  = [...new Set(rows.map(r => r[C.iDate]).filter(v => v))].sort();
  const colors = ['#2ecc71','#3b9ede','#f07c1f','#e74c3c','#9b59b6','#f1c40f','#1abc9c','#e67e22','#00bcd4','#e91e63','#8bc34a','#95a5a6'];

  const datasets = lines.map((line, i) => ({
    label: line,
    data: dates.map(d => {
      const vals = rows.filter(r => r[C.iLine] === line && r[C.iDate] === d)
                       .map(r => num(r[C.iThickAvg])).filter(v => v > 0);
      return vals.length ? vals.reduce((a,b) => a+b)/vals.length : null;
    }),
    borderColor: colors[i % colors.length],
    backgroundColor: 'transparent',
    borderWidth: 2, pointRadius: 3, tension: 0.3, spanGaps: true,
  }));

  condCharts['cThickTrend'] = new Chart(document.getElementById('cThickTrend'), {
    type: 'line',
    data: { labels: dates, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#8b90a0', font: { size: 10 }, boxWidth: 10 } },
        tooltip: { ...TT, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.raw != null ? ctx.raw.toFixed(1) + ' mm' : '—'}` } },
      },
      scales: {
        x: { ticks: { color: '#545968', font: { size: 9 }, maxTicksLimit: 8 }, grid: { color: 'rgba(255,255,255,.04)' } },
        y: {
          ticks: { color: '#545968', font: { size: 10 }, callback: v => v.toFixed(0) + ' mm' },
          grid:  { color: 'rgba(255,255,255,.06)' },
        },
      },
    },
  });
}

// ══════════════════════════════════════════════
//  4 · DAMAGE SUMMARY CHART
// ══════════════════════════════════════════════

function _renderDamageChart(rows, C, dmgCols) {
  killCChart('cDamage');
  const lines    = [...new Set(rows.map(r => r[C.iLine]).filter(v => v))].sort();
  const dmgDefs  = [
    { label: 'หลุม',    col: C.iHole,  color: '#e74c3c' },
    { label: 'รอยบาด',  col: C.iCut,   color: '#f07c1f' },
    { label: 'รอยฉีก',  col: C.iTear,  color: '#f1c40f' },
    { label: 'รอยแตก',  col: C.iCrack, color: '#9b59b6' },
    { label: 'ขอบขวา',  col: C.iEdgeR, color: '#3b9ede' },
    { label: 'ขอบซ้าย', col: C.iEdgeL, color: '#2ecc71' },
    { label: 'เห็นสลิง',col: C.iSling, color: '#e91e63' },
    { label: 'ทะลุ',    col: C.iThru,  color: '#ff5722' },
  ].filter(d => d.col >= 0);

  condCharts['cDamage'] = new Chart(document.getElementById('cDamage'), {
    type: 'bar',
    data: {
      labels: lines,
      datasets: dmgDefs.map(d => ({
        label: d.label,
        data: lines.map(line => rows.filter(r => r[C.iLine] === line).reduce((s,r) => s + num(r[d.col]), 0)),
        backgroundColor: d.color + 'bb', borderRadius: 3,
      })),
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#8b90a0', font: { size: 10 }, boxWidth: 10 } },
        tooltip: { ...TT },
      },
      scales: {
        x: { stacked: true, ticks: { color: '#545968', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,.04)' } },
        y: { stacked: true, ticks: { color: '#545968', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,.06)' } },
      },
    },
  });
}

// ══════════════════════════════════════════════
//  5 · BRAND COMPARISON
// ══════════════════════════════════════════════

function _renderBrandChart(rows, C) {
  killCChart('cBrandComp');
  const getBrand = r => r[C.iShort] || r[C.iBrand] || '';
  const brands   = [...new Set(rows.map(getBrand).filter(v => v))].sort();

  const avgOf = (col, brand) => {
    const vals = rows.filter(r => getBrand(r) === brand).map(r => num(r[col])).filter(v => v > 0);
    return vals.length ? vals.reduce((a,b) => a+b)/vals.length : 0;
  };

  condCharts['cBrandComp'] = new Chart(document.getElementById('cBrandComp'), {
    type: 'bar',
    data: {
      labels: brands,
      datasets: [
        { label: 'ความหนาเฉลี่ย (mm)',      data: brands.map(b => avgOf(C.iThickAvg,   b)), backgroundColor: '#3b9ede99', yAxisID: 'yL', borderRadius: 5 },
        { label: 'ความแข็งเฉลี่ย (Shore A)', data: brands.map(b => avgOf(C.iHardTopAvg, b)), backgroundColor: '#f07c1f99', yAxisID: 'yR', borderRadius: 5 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#8b90a0', font: { size: 10 }, boxWidth: 10 } },
        tooltip: { ...TT },
      },
      scales: {
        x:  { ticks: { color: '#545968', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,.04)' } },
        yL: { type: 'linear', position: 'left',  ticks: { color: '#3b9ede', font: { size: 10 }, callback: v => v.toFixed(1) + ' mm' }, grid: { color: 'rgba(255,255,255,.06)' } },
        yR: { type: 'linear', position: 'right', ticks: { color: '#f07c1f', font: { size: 10 }, callback: v => v.toFixed(0) + ' A'  }, grid: { drawOnChartArea: false } },
      },
    },
  });
}

// ══════════════════════════════════════════════
//  6 · DATA TABLE
// ══════════════════════════════════════════════

function _renderCondTable(rows, C, dmgCols) {
  const headers = ['วันที่', 'Line', 'Joint', 'Brand', 'SMU', 'หนา (mm)', 'แข็ง Top', 'แข็ง Bot', 'ความเสียหาย', 'Active'];
  document.getElementById('condThead').innerHTML = headers.map(h => `<th>${h}</th>`).join('');

  document.getElementById('condTbody').innerHTML = rows.map(r => {
    const dmg      = dmgCols.reduce((s, col) => s + num(r[col]), 0);
    const isActive = String(r[C.iActive]).toUpperCase() === 'TRUE';
    const thick    = num(r[C.iThickAvg]);
    const hard     = num(r[C.iHardTopAvg]);
    const tColor   = thick > 0 ? (thick >= 30 ? '#2ecc71' : thick >= 25 ? '#f1c40f' : '#e74c3c') : '';
    return `<tr>
      <td>${r[C.iDate] || '—'}</td>
      <td>${r[C.iLine]  || '—'}</td>
      <td>${r[C.iJoint] || '—'}</td>
      <td>${r[C.iBrand] || '—'}</td>
      <td class="num">${num(r[C.iSMU]) > 0 ? FMT(r[C.iSMU]) : '—'}</td>
      <td class="num" style="color:${tColor}">${thick > 0 ? thick.toFixed(1) : '—'}</td>
      <td class="num">${hard  > 0 ? hard.toFixed(1)  : '—'}</td>
      <td class="num">${num(r[C.iHardBotAvg]) > 0 ? num(r[C.iHardBotAvg]).toFixed(1) : '—'}</td>
      <td class="num" style="color:${dmg > 0 ? '#e74c3c' : '#545968'}">${dmg || '—'}</td>
      <td><span class="badge" style="background:${isActive ? 'rgba(46,204,113,.15)' : 'rgba(255,255,255,.05)'};color:${isActive ? '#2ecc71' : '#545968'};border-color:${isActive ? 'rgba(46,204,113,.3)' : 'rgba(255,255,255,.08)'}">${isActive ? 'Active' : 'Inactive'}</span></td>
    </tr>`;
  }).join('');
}

// ══════════════════════════════════════════════
//  TAB SWITCHING
// ══════════════════════════════════════════════

function switchTab(tab) {
  ['Procure', 'Cond'].forEach(t => {
    const active = (tab === 'procure' && t === 'Procure') || (tab === 'cond' && t === 'Cond');
    document.getElementById('tabBtn' + t)?.classList.toggle('active', active);
    const pane = document.getElementById('tab' + t);
    if (pane) pane.style.display = active ? '' : 'none';
  });
  if (tab === 'cond' && !condLoaded) loadCondData();
}
