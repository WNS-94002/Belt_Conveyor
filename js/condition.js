/**
 * condition.js — Belt Condition Dashboard (per-line Belt Map)
 * Lines: S1, S2A, S2B, S2C — each fetched from a separate Sheet tab
 */

const COND_SHEET_ID = '1r71wJW-eyhUrDeU-xPS1LApdbfNf7ROb0u4sTeJX_S8';
// topCapacity: max joints shown on carry (top) track; remaining joints go to return (bottom)
// — null = single-track linear layout
const LINES = [
  { name: 'S1',  gid: '2113959175', color: '#2ecc71', topCapacity: null },
  { name: 'S2A', gid: '636893050',  color: '#3b9ede', topCapacity: null },
  { name: 'S2B', gid: '293227926',  color: '#f07c1f', topCapacity: 10   },
  { name: 'S2C', gid: '298583837',  color: '#9b59b6', topCapacity: null },
];

// SMU Belt → card color (green / yellow / red / dark)
function smuColor(smu) {
  if (!smu || smu <= 0) return '#141414';
  if (smu <= 15000)     return '#27ae60';
  if (smu <= 35000)     return '#f39c12';
  return '#c0392b';
}

// Joint Condition → track background color
function condColor(cond) {
  const c = String(cond || '').trim().toLowerCase();
  if (c === 'normal')                          return '#27ae60';
  if (c === 'monitor')                         return '#f39c12';
  if (c.includes('alarm') || c === 'critical') return '#c0392b';
  return '#3a3f52';
}

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
//  AUTO-DETECT HEADER ROW
//  Scans GViz cols/rows to find the actual data header
//  (needed when the sheet has title/decoration rows above the real header)
// ══════════════════════════════════════════════

function _findHeaderRow(cols, rows) {
  const KWS = ['no', 'length', 'smu', 'brand', 'condition', 'joint'];
  const score = arr => KWS.filter(kw => arr.join(' ').toLowerCase().includes(kw)).length;
  if (score(cols) >= 3) return { hdr: cols, dataRows: rows };
  for (let i = 0; i < Math.min(25, rows.length); i++) {
    if (score(rows[i]) >= 3) return { hdr: rows[i], dataRows: rows.slice(i + 1) };
  }
  return { hdr: cols, dataRows: rows };
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
      // Auto-detect which row is the real column header (skips title/decoration rows)
      const { hdr, dataRows } = _findHeaderRow(r.value.cols, r.value.rows);
      const cols = detectCols(hdr);
      // Filter out sub-header rows, empty-length rows, and summary rows
      const rows = dataRows.filter(row => {
        if (cols.length >= 0 && num(row[cols.length]) <= 0) return false;
        if (cols.joint >= 0) {
          const jv = String(row[cols.joint] || '').toLowerCase();
          if (jv.includes('total') || jv.includes('รวม') || jv.includes('sum')) return false;
        }
        return true;
      });
      lineData[line.name] = { hdr, cols, rows };
      loaded++;
    } else {
      lineData[line.name] = { hdr: [], cols: {}, rows: [] };
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
    const { cols, rows } = lineData[name];
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
//  BELT MAP  — SVG schematic (SMU-based coloring)
//  S2B: two-track loop layout (carry + return)
//  Others: single-track linear layout
// ══════════════════════════════════════════════

// Build per-row segment data (SMU color + damage info)
function _buildSegData(rows, cols) {
  const dmgCols = [cols.hole, cols.cut, cols.tear, cols.crack].filter(i => i >= 0);
  return rows.map((r, idx) => {
    const joint  = String(r[cols.joint]  || `J${idx + 1}`);
    const len    = num(r[cols.length])   || 0;
    const brand  = r[cols.brand]  || '';
    const type   = r[cols.type]   || '';
    const thickL = num(r[cols.thickL]);
    const thickR = num(r[cols.thickR]);
    const thick  = thickL && thickR ? (thickL + thickR) / 2 : thickL || thickR;
    const hardT  = num(r[cols.hardTop]);
    const smu    = num(r[cols.smu]);
    const dmg    = dmgCols.reduce((s, i) => s + num(r[i]), 0);
    const cond       = r[cols.cond] || '';
    const trackColor = condColor(cond);  // track bg = Condition (Column BL)
    const cardColor  = smuColor(smu);   // card fill = SMU Belt (Column AC)
    const dmgList = [
      cols.hole  >= 0 && num(r[cols.hole])  > 0 ? `หลุม ${num(r[cols.hole])}` : '',
      cols.cut   >= 0 && num(r[cols.cut])   > 0 ? `รอยบาด ${num(r[cols.cut])}` : '',
      cols.tear  >= 0 && num(r[cols.tear])  > 0 ? `รอยฉีก ${num(r[cols.tear])}` : '',
      cols.crack >= 0 && num(r[cols.crack]) > 0 ? `รอยแตก ${num(r[cols.crack])}` : '',
    ].filter(Boolean).join(' · ') || 'ไม่มีความเสียหาย';
    return { joint, len, brand, type, thick, hardT, smu, dmg, cond, trackColor, cardColor, dmgList };
  });
}

// Render one belt track as SVG elements
// Track background = Condition color  |  Card inside = SMU Belt color + length value
// labsAbove  : labels above track (carry) or below (return)
// capacity   : slot count — both tracks divide same PW
// rightAlign : data fills from the RIGHT (return track — empty slots on left)
//
// Variable slot widths (when capacity set):
//   Middle slots (non-edge) → 20% narrower than uniform
//   Edge slots (first/last) → absorb freed space so total PW is unchanged
function _svgTrack(segs, x0, pw, ty, th, labsAbove, capacity, rightAlign) {
  const slots = capacity || segs.length;
  if (!slots) return '';

  // Compute variable slot widths
  const baseW = pw / slots;
  const isVar = capacity != null && slots >= 3;
  const midW  = isVar ? baseW * 0.80 : baseW;
  const edgeW = isVar ? (pw - midW * (slots - 2)) / 2 : baseW;
  const getW  = i => (i === 0 || i === slots - 1) ? edgeW : midW;

  // Cumulative x-start per slot
  const slotX = [];
  let cx = x0;
  for (let i = 0; i < slots; i++) { slotX.push(cx); cx += getW(i); }

  const cardH = Math.round(th * 0.75);
  const cardY = ty + Math.round((th - cardH) / 2);
  const PAD   = 5;

  const offset  = (rightAlign && capacity) ? capacity - segs.length : 0;
  const slotArr = Array(slots).fill(null);
  segs.forEach((s, i) => { if (offset + i < slots) slotArr[offset + i] = s; });

  let out = '';

  slotArr.forEach((s, slotIdx) => {
    const x1    = slotX[slotIdx];
    const slotW = getW(slotIdx);
    const x2    = x1 + slotW;
    const mx    = (x1 + x2) / 2;

    if (!s) {
      out += `<rect x="${x1.toFixed(1)}" y="${ty}" width="${(slotW - 1).toFixed(1)}" height="${th}"
                  fill="#0c0e14" fill-opacity="0.6"/>`;
      out += `<line x1="${x1.toFixed(1)}" y1="${ty}" x2="${x1.toFixed(1)}" y2="${ty + th}"
                    stroke="rgba(255,255,255,0.05)" stroke-width="1"/>`;
      return;
    }

    // Edge slots (near pulleys) get a white stroke border so the card is visible
    // even when the pulley drum partially overlaps the segment
    const isPulley = slotIdx === 0 || slotIdx === slots - 1;
    const cW = Math.max(slotW - PAD * 2 - 1, 2);
    const cX = x1 + PAD;

    const tipData = [
      `${s.joint}  |  ${s.len} m`,
      `สภาพ: ${s.cond || '—'}`,
      `SMU Belt: ${s.smu > 0 ? FMT(Math.round(s.smu)) : 'N/A'}`,
      `${s.brand} ${s.type}`.trim() || null,
      `ความหนา: ${s.thick > 0 ? s.thick.toFixed(1) : '—'} mm  |  ความแข็ง: ${s.hardT > 0 ? s.hardT.toFixed(1) : '—'} A`,
      s.dmgList,
    ].filter(Boolean).join('||');

    // Track background (condition tint)
    out += `<rect x="${x1.toFixed(1)}" y="${ty}" width="${(slotW - 1).toFixed(1)}" height="${th}"
                fill="${s.trackColor}" fill-opacity="0.28"
                data-tip="${tipData}"><title>${tipData.replace(/\|\|/g, '\n')}</title></rect>`;

    // SMU card
    const strokeAttr = isPulley ? `stroke="rgba(255,255,255,0.7)" stroke-width="2"` : '';
    out += `<rect class="bseg" x="${cX.toFixed(1)}" y="${cardY}" width="${cW.toFixed(1)}" height="${cardH}"
                fill="${s.cardColor}" fill-opacity="0.9" rx="3" ${strokeAttr}
                data-tip="${tipData}"><title>${tipData.replace(/\|\|/g, '\n')}</title></rect>`;

    // Length text
    if (slotW > 24 && s.len > 0) {
      out += `<text x="${mx.toFixed(1)}" y="${(cardY + cardH / 2 + 4).toFixed(1)}"
                  text-anchor="middle" font-size="8" fill="rgba(0,0,0,0.85)"
                  font-family="Arial,sans-serif" font-weight="bold">${s.len}m</text>`;
    }

    // Damage marker
    if (s.dmg > 0) {
      const dy  = labsAbove ? ty - 2 : ty + th + 2;
      const dir = labsAbove ? -1 : 1;
      out += `<polygon points="${mx},${dy} ${mx-5},${dy+dir*9} ${mx+5},${dy+dir*9}"
                fill="#e74c3c" opacity="0.9"><title>ความเสียหาย: ${s.dmg} จุด</title></polygon>`;
    }

    // Vertical separator
    out += `<line x1="${x1.toFixed(1)}" y1="${ty}" x2="${x1.toFixed(1)}" y2="${ty + th}"
                  stroke="rgba(0,0,0,0.4)" stroke-width="1"/>`;

    // Joint label
    const lY = labsAbove ? ty - 8 : ty + th + 14;
    out += `<text x="${mx.toFixed(1)}" y="${lY}" text-anchor="middle"
                  font-size="9" fill="#cdd0db" font-family="Arial,sans-serif">${s.joint}</text>`;
  });

  // End separator
  const endX = (x0 + pw).toFixed(1);
  out += `<line x1="${endX}" y1="${ty}" x2="${endX}" y2="${ty + th}"
                stroke="rgba(0,0,0,0.4)" stroke-width="1"/>`;
  return out;
}

// Shared legend HTML — two sections: Condition (track bg) + SMU Belt (card)
const _SMU_LEGEND = `
  <div class="bmap-legend">
    <span class="bmap-leg-title">สภาพ Belt (พื้นหลัง):</span>
    <span><span class="bmap-dot" style="background:#27ae60;opacity:.55"></span>Normal</span>
    <span><span class="bmap-dot" style="background:#f39c12;opacity:.55"></span>Monitor</span>
    <span><span class="bmap-dot" style="background:#c0392b;opacity:.55"></span>Alarm</span>
    <span class="bmap-leg-sep"></span>
    <span class="bmap-leg-title">SMU Belt (Card):</span>
    <span><span class="bmap-dot" style="background:#27ae60"></span>≤ 15,000</span>
    <span><span class="bmap-dot" style="background:#f39c12"></span>15,001–35,000</span>
    <span><span class="bmap-dot" style="background:#c0392b"></span>> 35,000</span>
    <span><span class="bmap-dot" style="background:#141414;border:1px solid #333"></span>ไม่มีข้อมูล</span>
    <span class="bmap-leg-sep"></span>
    <span><span class="bmap-dot" style="background:#e74c3c"></span>มีความเสียหาย ▲</span>
  </div>`;

function renderBeltMap(name, rows, cols) {
  const line = LINES.find(l => l.name === name);

  // Two-track loop: first topCapacity rows → carry (top), remainder → return (bottom)
  const isTwoTrack = line?.topCapacity != null;
  const splitAt    = isTwoTrack ? Math.min(line.topCapacity, rows.length) : null;

  const totalLen = rows.reduce((s, r) => s + num(r[cols.length]), 0);
  const tipId   = `bmapTip-${name}`;

  if (!totalLen) {
    document.getElementById(`bmap-${name}`).innerHTML =
      '<p style="color:#545968;padding:20px;text-align:center">ไม่มีข้อมูลความยาว Belt</p>';
    return;
  }

  let svgContent;

  if (isTwoTrack) {
    // ══ TWO-TRACK LOOP MAP (S2B style) ═══════════════════════════
    const W = 940, H = 235;
    const PL = 70, PR = 70, PW = W - PL - PR;  // smaller margins → pulleys further out
    const TH = 26;              // track height close to card height (rail lines tight)
    const TOP_Y = 75;           // carry track top
    const BOT_Y = 165;          // return track top (moved up → rounder pulley)

    const cap = line.topCapacity;   // slots per track (e.g. 10)

    // Carry: first cap rows (left=HEAD, right=TAIL)
    const topSegs = _buildSegData(rows.slice(0, splitAt), cols);
    // Return: remaining rows reversed (screen left→right = physically TAIL→HEAD)
    const botSegs = _buildSegData([...rows.slice(splitAt)].reverse(), cols);

    const topTotal = topSegs.reduce((s, seg) => s + seg.len, 0);
    const botTotal = botSegs.reduce((s, seg) => s + seg.len, 0);

    let el = '';

    // Track backgrounds
    el += `<rect x="${PL}" y="${TOP_Y}" width="${PW}" height="${TH}" fill="#0c0e14" rx="2"/>`;
    el += `<rect x="${PL}" y="${BOT_Y}" width="${PW}" height="${TH}" fill="#0c0e14" rx="2"/>`;

    // Carry: left-aligned (J7 at left, closest to HEAD)
    el += _svgTrack(topSegs, PL, PW, TOP_Y, TH, true,  cap, false);
    // Return: right-aligned (J17 at right, closest to TAIL; empty slots on left)
    el += _svgTrack(botSegs, PL, PW, BOT_Y, TH, false, cap, true);

    // Rail lines (on top of segments)
    [[TOP_Y, TH], [BOT_Y, TH]].forEach(([ty, th]) => {
      el += `<line x1="${PL}" y1="${ty}" x2="${PL + PW}" y2="${ty}" stroke="#6b7080" stroke-width="1.8"/>`;
      el += `<line x1="${PL}" y1="${ty + th}" x2="${PL + PW}" y2="${ty + th}" stroke="#6b7080" stroke-width="1.8"/>`;
    });

    // HEAD / TAIL pulleys
    // pRY = half the vertical span (carry-top → return-bottom)
    // pRX = 55 → ratio pRY/pRX ≈ 1.05:1 (near-circle)
    const pCY = (TOP_Y + BOT_Y + TH) / 2;
    const pRY = (BOT_Y + TH - TOP_Y) / 2;
    const pRX = 55;
    [{ cx: PL, lbl: 'HEAD' }, { cx: PL + PW, lbl: 'TAIL' }].forEach(p => {
      el += `<ellipse cx="${p.cx}" cy="${pCY}" rx="${pRX}" ry="${pRY}"
                      fill="#181c27" stroke="#8b90a0" stroke-width="2.5"/>`;
      el += `<ellipse cx="${p.cx}" cy="${pCY}" rx="${Math.round(pRX * 0.42)}" ry="${Math.round(pRY * 0.42)}"
                      fill="#3a3f52"/>`;
      el += `<text x="${p.cx}" y="${pCY + 4}" text-anchor="middle"
                   font-size="10" fill="#c8ccdb" font-family="Arial,sans-serif"
                   font-weight="bold">${p.lbl}</text>`;
    });

    // Summary
    el += `<text x="${W / 2}" y="${H - 6}" text-anchor="middle" font-size="9" fill="#8b90a0" font-family="Arial,sans-serif">ความยาวรวม ${FMT(Math.round(topTotal + botTotal))} ม. · ${rows.length} Joints</text>`;

    svgContent = `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg"
                       style="display:block;overflow:visible">
      <style>.bseg{cursor:pointer;transition:fill-opacity .15s}.bseg:hover{fill-opacity:1;stroke:#fff;stroke-width:1.5}</style>
      ${el}</svg>`;

  } else {
    // ══ SINGLE-TRACK LINEAR MAP (S1, S2A, S2C) ═══════════════════
    const W = 920, H = 230;
    const PL = 72, PR = 72, PW = W - PL - PR;
    const CY = 118, BH = 24, pR = 22;
    const TOP_Y = CY - BH, BOT_Y = CY + BH;
    const segs = _buildSegData(rows, cols);
    const tot  = segs.reduce((s, seg) => s + seg.len, 0);

    let el = '';
    el += `<defs><marker id="aR_${name}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,1 L9,5 L0,9 Z" fill="#f07c1f"/></marker></defs>`;
    el += `<rect x="${PL}" y="${TOP_Y}" width="${PW}" height="${2 * BH}" fill="#0c0e14" rx="2"/>`;
    el += _svgTrack(segs, PL, PW, TOP_Y, 2 * BH, true);
    el += `<line x1="${PL}" y1="${TOP_Y}" x2="${PL + PW}" y2="${TOP_Y}" stroke="#8b90a0" stroke-width="2"/>`;
    el += `<line x1="${PL}" y1="${BOT_Y}" x2="${PL + PW}" y2="${BOT_Y}" stroke="#8b90a0" stroke-width="2"/>`;

    // Pulleys
    [{ cx: PL, lbl: 'HEAD' }, { cx: PL + PW, lbl: 'TAIL' }].forEach(p => {
      el += `<circle cx="${p.cx}" cy="${CY}" r="${pR}" fill="#181c27" stroke="#8b90a0" stroke-width="2.5"/>`;
      el += `<circle cx="${p.cx}" cy="${CY}" r="${pR * 0.4}" fill="#3a3f52"/>`;
      el += `<text x="${p.cx}" y="${BOT_Y + 34}" text-anchor="middle" font-size="10" fill="#8b90a0" font-family="Arial,sans-serif" font-weight="bold">${p.lbl}</text>`;
    });

    const midX = PL + PW / 2;
    el += `<line x1="${midX - 55}" y1="${CY}" x2="${midX + 55}" y2="${CY}"
                 stroke="#f07c1f" stroke-width="1.8" stroke-opacity="0.5"
                 marker-end="url(#aR_${name})"/>`;
    el += `<text x="${midX}" y="${H - 8}" text-anchor="middle" font-size="9" fill="#8b90a0" font-family="Arial,sans-serif">ความยาวรวม ${FMT(Math.round(tot))} ม. · ${rows.length} Joints</text>`;

    svgContent = `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg"
                       style="display:block;overflow:visible">
      <style>.bseg{cursor:pointer;transition:fill-opacity .15s}.bseg:hover{fill-opacity:1;stroke:#fff;stroke-width:1.5}</style>
      ${el}</svg>`;
  }

  // Render HTML
  document.getElementById(`bmap-${name}`).innerHTML =
    `${_SMU_LEGEND}
     <div style="overflow-x:auto;margin-top:8px">${svgContent}</div>
     <div id="${tipId}" class="bmap-tip" style="display:none"></div>`;

  // Hover tooltip
  document.getElementById(`bmap-${name}`).querySelectorAll('.bseg').forEach(elem => {
    elem.addEventListener('mouseenter', function() {
      const tip = document.getElementById(tipId);
      tip.style.display = 'block';
      tip.innerHTML = (this.dataset.tip || '').split('||').join('<br>');
    });
    elem.addEventListener('mouseleave', () => {
      document.getElementById(tipId).style.display = 'none';
    });
  });
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
