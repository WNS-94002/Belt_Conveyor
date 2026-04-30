/**
 * condition.js — Belt Condition Dashboard (per-line Belt Map)
 * Lines: S1, S2A, S2B, S2C — each fetched from a separate Sheet tab
 */

const COND_SHEET_ID = '1r71wJW-eyhUrDeU-xPS1LApdbfNf7ROb0u4sTeJX_S8';
const LINES = [
  { name: 'S1',  gid: '2113959175', color: '#2ecc71' },
  { name: 'S2A', gid: '636893050',  color: '#3b9ede' },
  { name: 'S2B', gid: '293227926',  color: '#f07c1f' },
  { name: 'S2C', gid: '298583837',  color: '#9b59b6' },
];

let lineData      = {};      // { S1: {hdr, rows}, S2A: ..., ... }
let condLoaded    = false;
let condCharts    = {};
let renderedLines = new Set();
let activeLinetab = 'S1';

// ══════════════════════════════════════════════
//  COLUMN DETECTION
// ══════════════════════════════════════════════

function detectCols(hdr) {
  const find = (...kws) => {
    for (const kw of kws) {
      const k = kw.toLowerCase();
      let i = hdr.findIndex(h => h.toLowerCase() === k);
      if (i >= 0) return i;
      i = hdr.findIndex(h => h.toLowerCase().includes(k));
      if (i >= 0) return i;
    }
    return -1;
  };
  const findAll = kw => {
    const k = kw.toLowerCase();
    return hdr.reduce((a, h, i) => { if (h.toLowerCase().includes(k)) a.push(i); return a; }, []);
  };

  const hardAll = findAll('hard');
  const edgeAll = findAll('edge');

  return {
    joint:   find('no.', 'no'),
    mark:    find('mark'),
    length:  find('length'),
    brand:   find('brand'),
    type:    find('type'),
    year:    find('po year', 'year'),
    smu:     find('smu'),
    hardTop: hardAll[0] ?? -1,
    hardBot: hardAll[1] ?? -1,
    thickL:  find('l.edge', 'l edge') >= 0 ? find('l.edge', 'l edge') : (edgeAll[0] ?? -1),
    thickR:  find('r.edge', 'r edge') >= 0 ? find('r.edge', 'r edge') : (edgeAll[1] ?? -1),
    thickC:  find('center'),
    hole:    find('หลุม'),
    cut:     find('รอยบาด'),
    tear:    find('รอยฉีก'),
    crack:   find('รอยแตก'),
    cond:    find('condition'),
    group:   find('group'),
  };
}

// ══════════════════════════════════════════════
//  DATA FETCHING
// ══════════════════════════════════════════════

function fetchLine(line) {
  return new Promise((resolve, reject) => {
    const cbName = `_gviz_${line.name}_${Date.now()}`;
    const s = document.createElement('script');
    s.src = `https://docs.google.com/spreadsheets/d/${COND_SHEET_ID}/gviz/tq?gid=${line.gid}&tqx=out:json&callback=${cbName}`;
    let done = false;
    window[cbName] = d => {
      done = true; delete window[cbName]; document.head.removeChild(s);
      try { resolve(parseGViz(d)); } catch(e) { reject(e); }
    };
    s.onerror = () => { if (!done) { done = true; reject(new Error(`Load failed: ${line.name}`)); } };
    setTimeout(() => { if (!done) { done = true; reject(new Error(`Timeout: ${line.name}`)); } }, 15000);
    document.head.appendChild(s);
  });
}

async function fetchLineFallback(line) {
  const url = `https://docs.google.com/spreadsheets/d/${COND_SHEET_ID}/export?format=csv&gid=${line.gid}`;
  const res  = await fetch(url, { mode: 'cors' });
  const text = await res.text();
  if (!text.trim().startsWith('<!')) return parseCSV(text);
  return null;
}

async function loadCondData() {
  const el = id => document.getElementById(id);
  el('condLoading').style.display = 'flex';
  el('condMain').style.display    = 'none';
  el('condErr').style.display     = 'none';
  el('condDot').className         = 'sdot';
  el('condTxt').textContent       = 'กำลังโหลดข้อมูล Belt Map...';

  const results = await Promise.allSettled(LINES.map(fetchLine));

  // Fallback to CSV for failed lines
  for (let i = 0; i < LINES.length; i++) {
    if (results[i].status === 'rejected') {
      try { results[i] = { status: 'fulfilled', value: await fetchLineFallback(LINES[i]) }; }
      catch(e) { results[i] = { status: 'rejected', reason: e }; }
    }
  }

  let loaded = 0;
  results.forEach((r, i) => {
    const line = LINES[i];
    if (r.status === 'fulfilled' && r.value?.rows?.length) {
      lineData[line.name] = { hdr: r.value.cols, rows: r.value.rows };
      loaded++;
    } else {
      lineData[line.name] = { hdr: [], rows: [] };
    }
  });

  if (loaded === 0) {
    el('condLoading').style.display = 'none';
    el('condErr').style.display     = 'block';
    el('condErrMsg').textContent    = 'ไม่สามารถโหลดข้อมูลได้ — ตรวจสอบว่า Sheet เป็น Public';
    el('condDot').classList.add('err');
    el('condTxt').textContent = 'Connection error';
    return;
  }

  condLoaded = true;
  el('condLoading').style.display = 'none';
  el('condMain').style.display    = 'block';
  el('condDot').classList.add('live');
  el('condTxt').textContent = `Connected · Belt Map: ${LINES.map(l => l.name).join(', ')}`;

  renderCondition();
}

// ══════════════════════════════════════════════
//  MAIN RENDER
// ══════════════════════════════════════════════

function renderCondition() {
  // Line sub-tabs
  document.getElementById('lineTabs').innerHTML = LINES.map(l => `
    <button class="line-tab-btn" id="ltab-${l.name}" onclick="switchLinetab('${l.name}')">
      <span class="ltab-dot" style="background:${l.color}"></span>${l.name}
    </button>`).join('');

  // Content panes per line
  document.getElementById('lineContent').innerHTML = LINES.map(l => `
    <div id="lcontent-${l.name}" style="display:none">
      <!-- Cards -->
      <div class="mgrid4" id="lcards-${l.name}"></div>

      <!-- Belt Map -->
      <div class="section-label">Belt Map · สัดส่วนความยาวและสภาพ Joint</div>
      <div class="panel" id="bmap-${l.name}" style="padding:18px 20px;"></div>

      <!-- Charts -->
      <div class="section-label">ความหนา & ความแข็ง รายละเอียดแต่ละ Joint</div>
      <div class="row2">
        <div class="panel">
          <div class="ph">
            <div class="ph-left">
              <div class="ptitle">ความหนา (mm)</div>
              <div class="psub">L.Edge · R.Edge</div>
            </div>
            <div class="pbadge">BAR</div>
          </div>
          <div style="position:relative;height:250px"><canvas id="cThick-${l.name}"></canvas></div>
        </div>
        <div class="panel">
          <div class="ph">
            <div class="ph-left">
              <div class="ptitle">ความแข็ง Shore A</div>
              <div class="psub">Top · Bottom</div>
            </div>
            <div class="pbadge">BAR</div>
          </div>
          <div style="position:relative;height:250px"><canvas id="cHard-${l.name}"></canvas></div>
        </div>
      </div>

      <!-- Table -->
      <div class="section-label">รายละเอียดแต่ละ Joint</div>
      <div class="twrap"><div class="tscroll">
        <table>
          <thead><tr id="lthead-${l.name}"></tr></thead>
          <tbody id="ltbody-${l.name}"></tbody>
        </table>
      </div></div>
    </div>`).join('');

  switchLinetab(activeLinetab);
}

// ══════════════════════════════════════════════
//  LINE TAB SWITCHING
// ══════════════════════════════════════════════

function switchLinetab(name) {
  activeLinetab = name;
  const line = LINES.find(l => l.name === name);

  LINES.forEach(l => {
    const btn  = document.getElementById(`ltab-${l.name}`);
    const pane = document.getElementById(`lcontent-${l.name}`);
    const active = l.name === name;
    if (btn) {
      btn.classList.toggle('active', active);
      btn.style.borderColor = active ? l.color : '';
      btn.style.color       = active ? l.color : '';
    }
    if (pane) pane.style.display = active ? '' : 'none';
  });

  if (!renderedLines.has(name) && lineData[name]?.rows.length) {
    const { hdr, rows } = lineData[name];
    const cols = detectCols(hdr);
    renderLineCards(name, rows, cols, line.color);
    renderBeltMap(name, rows, cols);
    renderLineCharts(name, rows, cols, line.color);
    renderLineTable(name, rows, cols);
    renderedLines.add(name);
  }
}

// ══════════════════════════════════════════════
//  CARDS
// ══════════════════════════════════════════════

function renderLineCards(name, rows, cols, color) {
  const avg = col => {
    const v = rows.map(r => num(r[col])).filter(v => v > 0);
    return v.length ? v.reduce((a,b) => a+b)/v.length : 0;
  };
  const dmgCols  = [cols.hole, cols.cut, cols.tear, cols.crack].filter(i => i >= 0);
  const totalLen = rows.reduce((s, r) => s + num(r[cols.length]), 0);
  const avgL     = avg(cols.thickL), avgR = avg(cols.thickR);
  const avgThick = avgL > 0 && avgR > 0 ? (avgL + avgR) / 2 : avgL || avgR;
  const avgHard  = avg(cols.hardTop);
  const totalDmg = rows.reduce((s, r) => s + dmgCols.reduce((d, i) => d + num(r[i]), 0), 0);

  const tColor = avgThick >= 32 ? '#2ecc71' : avgThick >= 28 ? '#f1c40f' : '#e74c3c';

  document.getElementById(`lcards-${name}`).innerHTML = `
    <div class="mc a2 fi"><div class="mc-inner"><div class="mc-main">
      <div class="mico">🔗</div><div class="mlbl">จำนวน Joint</div>
      <div class="mval" style="color:${color}">${rows.length}</div>
      <div class="munit">joints</div>
    </div></div></div>
    <div class="mc a1 fi"><div class="mc-inner"><div class="mc-main">
      <div class="mico">📐</div><div class="mlbl">ความยาวรวม</div>
      <div class="mval" style="color:var(--accent)">${FMT(Math.round(totalLen))}</div>
      <div class="munit">เมตร</div>
    </div></div></div>
    <div class="mc a3 fi"><div class="mc-inner"><div class="mc-main">
      <div class="mico">📏</div><div class="mlbl">ความหนาเฉลี่ย</div>
      <div class="mval" style="color:${tColor}">${avgThick > 0 ? avgThick.toFixed(1) : '—'}</div>
      <div class="munit">มิลลิเมตร</div>
    </div></div></div>
    <div class="mc a4 fi"><div class="mc-inner"><div class="mc-main">
      <div class="mico">⚠️</div><div class="mlbl">ความเสียหายรวม</div>
      <div class="mval" style="color:${totalDmg > 0 ? 'var(--danger)' : 'var(--success)'}">${totalDmg}</div>
      <div class="munit">จุด</div>
    </div></div></div>`;
}

// ══════════════════════════════════════════════
//  BELT MAP
// ══════════════════════════════════════════════

function renderBeltMap(name, rows, cols) {
  const dmgCols  = [cols.hole, cols.cut, cols.tear, cols.crack].filter(i => i >= 0);
  const totalLen = rows.reduce((s, r) => s + num(r[cols.length]), 0);

  const segs = rows.map(r => {
    const joint  = r[cols.joint]  || '?';
    const len    = num(r[cols.length]) || 1;
    const brand  = r[cols.brand]  || '';
    const type   = r[cols.type]   || '';
    const thickL = num(r[cols.thickL]);
    const thickR = num(r[cols.thickR]);
    const thick  = thickL > 0 && thickR > 0 ? (thickL + thickR) / 2 : thickL || thickR;
    const hardT  = num(r[cols.hardTop]);
    const dmg    = dmgCols.reduce((s, i) => s + num(r[i]), 0);
    const cond   = r[cols.cond]   || '';

    const color  = dmg === 0 ? '#2ecc71' : dmg <= 2 ? '#f1c40f' : dmg <= 5 ? '#f07c1f' : '#e74c3c';
    const pctLen = totalLen > 0 ? (len / totalLen * 100).toFixed(1) : 0;

    const dmgList = [
      cols.hole  >= 0 && num(r[cols.hole])  > 0 ? `หลุม: ${num(r[cols.hole])}` : '',
      cols.cut   >= 0 && num(r[cols.cut])   > 0 ? `รอยบาด: ${num(r[cols.cut])}` : '',
      cols.tear  >= 0 && num(r[cols.tear])  > 0 ? `รอยฉีก: ${num(r[cols.tear])}` : '',
      cols.crack >= 0 && num(r[cols.crack]) > 0 ? `รอยแตก: ${num(r[cols.crack])}` : '',
    ].filter(Boolean).join(' · ') || 'ไม่มีความเสียหาย';

    const tip = `${joint} | ${len} m (${pctLen}%)\n${brand} ${type}\nหนา: ${thick > 0 ? thick.toFixed(1) : '—'} mm | แข็ง: ${hardT > 0 ? hardT.toFixed(1) : '—'} A\n${dmgList}\nสภาพ: ${cond}`;

    return `
      <div class="bmap-seg" style="flex:${len}" title="${tip}">
        <div class="bmap-fill" style="background:${color}"></div>
        <div class="bmap-label">${joint}</div>
      </div>`;
  }).join('');

  document.getElementById(`bmap-${name}`).innerHTML = `
    <div class="bmap-legend">
      <span><span class="bmap-dot" style="background:#2ecc71"></span>ไม่มีความเสียหาย</span>
      <span><span class="bmap-dot" style="background:#f1c40f"></span>1–2 จุด</span>
      <span><span class="bmap-dot" style="background:#f07c1f"></span>3–5 จุด</span>
      <span><span class="bmap-dot" style="background:#e74c3c"></span>6+ จุด</span>
    </div>
    <div class="bmap-wrap">${segs}</div>
    <div class="bmap-info">ความยาวรวม <b>${FMT(Math.round(totalLen))} ม.</b> · <b>${rows.length} Joints</b> · Hover เพื่อดูรายละเอียด</div>`;
}

// ══════════════════════════════════════════════
//  CHARTS
// ══════════════════════════════════════════════

function renderLineCharts(name, rows, cols, color) {
  const labels = rows.map(r => r[cols.joint] || '?');

  // Thickness chart
  if (condCharts[`cThick-${name}`]) { try { condCharts[`cThick-${name}`].destroy(); } catch(e) {} }
  condCharts[`cThick-${name}`] = new Chart(document.getElementById(`cThick-${name}`), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'L.Edge (mm)', data: rows.map(r => num(r[cols.thickL]) || null), backgroundColor: '#3b9edebb', borderRadius: 3 },
        { label: 'R.Edge (mm)', data: rows.map(r => num(r[cols.thickR]) || null), backgroundColor: '#f07c1fbb', borderRadius: 3 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#8b90a0', font: { size: 10 }, boxWidth: 10 } },
        tooltip: { ...TT, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.raw != null ? ctx.raw.toFixed(1) + ' mm' : '—'}` } },
      },
      scales: {
        x: { ticks: { color: '#545968', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,.04)' } },
        y: { min: 20, ticks: { color: '#545968', font: { size: 10 }, callback: v => v + ' mm' }, grid: { color: 'rgba(255,255,255,.06)' } },
      },
    },
  });

  // Hardness chart
  if (condCharts[`cHard-${name}`]) { try { condCharts[`cHard-${name}`].destroy(); } catch(e) {} }
  condCharts[`cHard-${name}`] = new Chart(document.getElementById(`cHard-${name}`), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Top (Shore A)',    data: rows.map(r => num(r[cols.hardTop]) || null), backgroundColor: '#2ecc71bb', borderRadius: 3 },
        { label: 'Bottom (Shore A)', data: rows.map(r => num(r[cols.hardBot]) || null), backgroundColor: '#9b59b6bb', borderRadius: 3 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#8b90a0', font: { size: 10 }, boxWidth: 10 } },
        tooltip: { ...TT, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.raw != null ? ctx.raw.toFixed(1) + ' A' : '—'}` } },
      },
      scales: {
        x: { ticks: { color: '#545968', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,.04)' } },
        y: { min: 50, ticks: { color: '#545968', font: { size: 10 }, callback: v => v + ' A' }, grid: { color: 'rgba(255,255,255,.06)' } },
      },
    },
  });
}

// ══════════════════════════════════════════════
//  TABLE
// ══════════════════════════════════════════════

function renderLineTable(name, rows, cols) {
  const headers = ['Joint', 'Mark Date', 'ยาว (m)', 'Brand', 'Type', 'SMU', 'หนา L', 'หนา R', 'แข็ง Top', 'แข็ง Bot', 'หลุม', 'รอยบาด', 'รอยฉีก', 'รอยแตก', 'สภาพ', 'Group'];
  const idxs    = [cols.joint, cols.mark, cols.length, cols.brand, cols.type, cols.smu, cols.thickL, cols.thickR, cols.hardTop, cols.hardBot, cols.hole, cols.cut, cols.tear, cols.crack, cols.cond, cols.group];

  document.getElementById(`lthead-${name}`).innerHTML = headers.map(h => `<th>${h}</th>`).join('');
  document.getElementById(`ltbody-${name}`).innerHTML = rows.map(r => {
    return '<tr>' + idxs.map((idx, ci) => {
      const raw = idx >= 0 ? r[idx] : '';
      const v   = raw || '—';
      const nv  = num(raw);

      // Condition badge
      if (ci === 14) {
        const ok = String(v).toLowerCase().includes('normal');
        return `<td><span class="badge" style="background:${ok?'rgba(46,204,113,.15)':'rgba(231,76,60,.12)'};color:${ok?'#2ecc71':'#e74c3c'};border-color:${ok?'rgba(46,204,113,.3)':'rgba(231,76,60,.3)'}">${v}</span></td>`;
      }
      // Thickness — color by value
      if (ci === 6 || ci === 7) {
        const c = nv >= 32 ? '#2ecc71' : nv >= 28 ? '#f1c40f' : nv > 0 ? '#e74c3c' : 'inherit';
        return `<td class="num" style="color:${c}">${nv > 0 ? nv.toFixed(1) : '—'}</td>`;
      }
      // Hardness
      if (ci === 8 || ci === 9) return `<td class="num">${nv > 0 ? nv.toFixed(1) : '—'}</td>`;
      // SMU
      if (ci === 5) return `<td class="num">${nv > 0 ? FMT(raw) : '—'}</td>`;
      // Length
      if (ci === 2) return `<td class="num">${nv > 0 ? nv.toFixed(1) : '—'}</td>`;
      // Damage columns
      if (ci >= 10 && ci <= 13) {
        return `<td class="num" style="color:${nv > 0 ? '#e74c3c' : '#545968'}">${nv > 0 ? nv : '—'}</td>`;
      }
      return `<td>${v}</td>`;
    }).join('') + '</tr>';
  }).join('');
}

// ══════════════════════════════════════════════
//  TAB SWITCHING (main procurement / condition)
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
