/**
 * auth.js — Login Authentication Module
 * Conveyor Belt Dashboard · Italianthai Hongsa
 *
 * Handles:
 *  - Fetching user credentials from Google Sheets (Sheet: Password, gid=361151714)
 *  - Login validation
 *  - Login screen show/hide
 */

// ── CONFIG (shared with app.js via window.CONFIG) ──
const AUTH_SHEET_ID = '14GmKP362tbU17eAAY-dYy37T_Iqtwga4HSULdPntyQ0';
const AUTH_GID      = '361151714';

let authCache = null;

/**
 * Fetch user/password rows from Google Sheets via CSV.
 * Skips header row (row 1). Reads columns A (user) and B (password).
 * @returns {Promise<Array<{user:string, pass:string}>|null>}
 */
async function loadAuthData() {
  const urls = [
    `https://docs.google.com/spreadsheets/d/${AUTH_SHEET_ID}/export?format=csv&gid=${AUTH_GID}`,
    `https://docs.google.com/spreadsheets/d/${AUTH_SHEET_ID}/gviz/tq?tqx=out:csv&gid=${AUTH_GID}`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) continue;

      const text = await res.text();
      if (!text || text.trim().startsWith('<!')) continue;

      // Parse CSV — skip header (row 0), read col A & col B
      const lines = text.split('\n').map(l => l.trim()).filter(l => l);
      const rows  = lines.slice(1).map(line => {
        const parts = [];
        let cur = '', inQ = false;
        for (let i = 0; i < line.length; i++) {
          const c = line[i];
          if (c === '"')              { inQ = !inQ; continue; }
          if (c === ',' && !inQ)      { parts.push(cur.trim()); cur = ''; continue; }
          cur += c;
        }
        parts.push(cur.trim());
        return {
          user: (parts[0] || '').trim(),
          pass: (parts[1] || '').trim(),
        };
      }).filter(r => r.user !== '');

      return rows;
    } catch (e) { /* try next URL */ }
  }
  return null;
}

/**
 * Called when user clicks LOGIN or presses Enter.
 * Validates credentials and fades out login screen on success.
 */
async function doLogin() {
  const user = (document.getElementById('loginUser').value || '').trim();
  const pass = (document.getElementById('loginPass').value || '').trim();
  const err  = document.getElementById('loginErr');
  const load = document.getElementById('loginLoad');
  const btn  = document.getElementById('loginBtn');

  err.style.display = 'none';

  if (!user || !pass) {
    err.textContent  = 'กรุณากรอก Username และ Password';
    err.style.display = 'block';
    return;
  }

  btn.style.opacity = '0.6';
  btn.disabled      = true;
  load.style.display = 'block';

  try {
    if (!authCache) {
      const rows = await loadAuthData();
      if (!rows) throw new Error('ไม่สามารถโหลดข้อมูล Auth — ตรวจสอบว่า Sheet เป็น Public');
      authCache = rows;
    }

    load.style.display = 'none';
    btn.style.opacity  = '1';
    btn.disabled       = false;

    const ok = authCache.find(r => r.user === user && r.pass === pass);
    if (ok) {
      // Fade out login screen → reveal dashboard
      const ls = document.getElementById('loginScreen');
      ls.style.transition = 'opacity .5s';
      ls.style.opacity    = '0';
      setTimeout(() => { ls.style.display = 'none'; }, 500);
    } else {
      err.textContent  = 'Username หรือ Password ไม่ถูกต้อง';
      err.style.display = 'block';
      document.getElementById('loginPass').value = '';
      document.getElementById('loginPass').focus();
    }
  } catch (e) {
    load.style.display = 'none';
    btn.style.opacity  = '1';
    btn.disabled       = false;
    err.textContent    = e.message;
    err.style.display  = 'block';
  }
}
