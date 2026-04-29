/**
 * auth.js — Login Authentication Module
 * Conveyor Belt Dashboard · Italianthai Hongsa
 *
 * Security improvements:
 *  - Passwords compared as SHA-256 hashes (store hashes in Sheet, not plain text)
 *  - Rate limiting: lockout after 5 failed attempts for 5 minutes
 *  - Session persistence via sessionStorage (no re-login on page refresh)
 *
 * To generate a SHA-256 hash for a password, run in browser console:
 *   await generateHash('your_password')
 */

const AUTH_SHEET_ID = '14GmKP362tbU17eAAY-dYy37T_Iqtwga4HSULdPntyQ0';
const AUTH_GID      = '361151714';

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS   = 5 * 60 * 1000; // 5 minutes
const SESSION_KEY  = 'cb_session';
const RATE_KEY     = 'cb_rate';

let authCache = null;

/** Hash a string with SHA-256, returns hex string */
async function hashPassword(pass) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pass));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Utility: call generateHash('password') in console to get hash for Google Sheet */
window.generateHash = async pass => {
  const h = await hashPassword(pass);
  console.log(`Hash for "${pass}":\n${h}`);
  return h;
};

// ── Rate limiting ──
function getRateData() {
  try { return JSON.parse(localStorage.getItem(RATE_KEY)) || { attempts: 0, lockedUntil: 0 }; }
  catch { return { attempts: 0, lockedUntil: 0 }; }
}
function setRateData(d)      { localStorage.setItem(RATE_KEY, JSON.stringify(d)); }
function resetRateData()     { localStorage.removeItem(RATE_KEY); }
function recordFailedAttempt() {
  const d = getRateData();
  d.attempts++;
  if (d.attempts >= MAX_ATTEMPTS) d.lockedUntil = Date.now() + LOCKOUT_MS;
  setRateData(d);
  return d;
}

// ── Session persistence ──
function checkSession() {
  if (sessionStorage.getItem(SESSION_KEY) === 'ok') {
    document.getElementById('loginScreen').style.display = 'none';
  }
}

/**
 * Fetch hashed credentials from Google Sheets.
 * Column A = username, Column B = SHA-256 hash of password.
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

      const lines = text.split('\n').map(l => l.trim()).filter(l => l);
      const rows  = lines.slice(1).map(line => {
        const parts = [];
        let cur = '', inQ = false;
        for (let i = 0; i < line.length; i++) {
          const c = line[i];
          if (c === '"')             { inQ = !inQ; continue; }
          if (c === ',' && !inQ)     { parts.push(cur.trim()); cur = ''; continue; }
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
 * Hashes the entered password before comparing against stored hash.
 */
async function doLogin() {
  const user = (document.getElementById('loginUser').value || '').trim();
  const pass = (document.getElementById('loginPass').value || '').trim();
  const err  = document.getElementById('loginErr');
  const load = document.getElementById('loginLoad');
  const btn  = document.getElementById('loginBtn');

  err.style.display = 'none';

  if (!user || !pass) {
    err.textContent   = 'กรุณากรอก Username และ Password';
    err.style.display = 'block';
    return;
  }

  // Check lockout before attempting
  const rate = getRateData();
  if (rate.lockedUntil > Date.now()) {
    const mins = Math.ceil((rate.lockedUntil - Date.now()) / 60000);
    err.textContent   = `พยายามเข้าสู่ระบบผิดพลาดบ่อยเกินไป กรุณารอ ${mins} นาที`;
    err.style.display = 'block';
    return;
  }

  btn.style.opacity  = '0.6';
  btn.disabled       = true;
  load.style.display = 'block';

  try {
    if (!authCache) {
      const rows = await loadAuthData();
      if (!rows) throw new Error('ไม่สามารถโหลดข้อมูล Auth — ตรวจสอบว่า Sheet เป็น Public');
      authCache = rows;
    }

    const hashedPass = await hashPassword(pass);
    load.style.display = 'none';
    btn.style.opacity  = '1';
    btn.disabled       = false;

    const ok = authCache.find(r => r.user === user && r.pass === hashedPass);
    if (ok) {
      resetRateData();
      sessionStorage.setItem(SESSION_KEY, 'ok');
      const ls = document.getElementById('loginScreen');
      ls.style.transition = 'opacity .5s';
      ls.style.opacity    = '0';
      setTimeout(() => { ls.style.display = 'none'; }, 500);
    } else {
      const d = recordFailedAttempt();
      const remaining = MAX_ATTEMPTS - d.attempts;
      if (remaining > 0) {
        err.textContent = `Username หรือ Password ไม่ถูกต้อง (เหลืออีก ${remaining} ครั้ง)`;
      } else {
        err.textContent = 'ล็อคบัญชีชั่วคราว 5 นาที เนื่องจากพยายาม Login ผิดพลาดบ่อยเกินไป';
      }
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

checkSession();
