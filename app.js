/* ============================================================
   Progress Tracker — configuration
   ============================================================ */
const CONFIG = {
  startWeight: 104,
  goalWeight: 73,
  startDate: '2026-06-22',   // Jun 22 2026
  durationMonths: 10,
  stepsGoal: 10000,          // combined daily goal: morning + evening steps
};

// Habit definitions. `good:true` means the toggle ON = good.
// Breakfast goal is to SKIP it, so toggle ON means "skipped breakfast" = good.
const HABITS = [
  { key: 'protein',   name: 'Protein',   hint: 'Had enough protein' },
  { key: 'gym',       name: 'Gym',       hint: 'Went to the gym' },
  { key: 'breakfast', name: 'Breakfast', hint: 'Skipped breakfast' },
  { key: 'lunch',     name: 'Lunch',     hint: 'Proper lunch' },
  { key: 'dinner',    name: 'Dinner',    hint: 'Proper dinner' },
  { key: 'sleep',     name: 'Sleep',     hint: 'Slept 7+ hours' },
];

const STORE_KEY = 'fittrack_v1';

/* ============================================================
   Helpers
   ============================================================ */
const $ = (s) => document.querySelector(s);
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const dayName = (d) => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
const fmtDate = (d) => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const todayMidnight = () => { const t = new Date(); t.setHours(0,0,0,0); return t; };

let DATA = {};   // in-memory only; Supabase is the single source of truth

/* ============================================================
   Supabase backend (with localStorage fallback)
   ============================================================ */
const HABIT_KEYS = HABITS.map(h => h.key);
let sb = null;
let currentUser = null;
try {
  if (window.supabase && typeof SUPABASE_URL === 'string') {
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  }
} catch (e) { console.warn('Supabase init failed:', e); }

function setSync(state, label) {
  const el = $('#syncStatus');
  if (!el) return;
  el.className = 'sync sync-' + state;
  el.textContent = '● ' + label;
}

// Convert a stored entry to a Supabase row.
function entryToRow(ds, e) {
  const row = { date: ds, weight: e.weight ?? null, steps: e.steps ?? null, steps2: e.steps2 ?? null };
  if (currentUser) row.user_id = currentUser.id;
  HABIT_KEYS.forEach(k => { row[k] = !!e[k]; });
  return row;
}
// Convert a Supabase row to a stored entry.
function rowToEntry(r) {
  const e = { weight: r.weight, steps: r.steps, steps2: r.steps2 };
  HABIT_KEYS.forEach(k => { e[k] = !!r[k]; });
  return e;
}

// Load all rows for the logged-in user from Supabase (the only source of truth).
async function pullAll() {
  if (!sb || !currentUser) return;
  setSync('syncing', 'syncing…');
  try {
    const { data, error } = await sb.from('entries').select('*');
    if (error) throw error;
    DATA = {};
    (data || []).forEach(r => { DATA[r.date] = rowToEntry(r); });
    render();
    setSync('ok', 'synced');
  } catch (e) {
    console.warn('Supabase load failed:', e.message || e);
    setSync('off', 'offline');
  }
}

// Push a single entry to Supabase. Returns true on success.
async function pushEntry(ds, entry, quiet) {
  if (!sb || !currentUser) return false;
  if (!quiet) setSync('syncing', 'saving…');
  try {
    const { error } = await sb.from('entries').upsert(entryToRow(ds, entry), { onConflict: 'user_id,date' });
    if (error) throw error;
    if (!quiet) setSync('ok', 'synced');
    return true;
  } catch (e) {
    console.warn('Supabase save failed:', e.message || e);
    if (!quiet) setSync('off', 'save failed');
    return false;
  }
}

// One-time recovery: older versions cached entries in localStorage. On login,
// push any leftovers to Supabase once, then delete the local copy for good.
async function migrateLocalToCloud() {
  let local = null;
  try { local = JSON.parse(localStorage.getItem(STORE_KEY)); } catch { local = null; }
  if (!local || typeof local !== 'object') return;
  for (const ds of Object.keys(local)) await pushEntry(ds, local[ds], true);
  localStorage.removeItem(STORE_KEY);
}

/* ---- Authentication ---- */
function authMsg(text, kind) {
  const el = $('#authMsg');
  el.textContent = text || '';
  el.className = 'auth-msg' + (kind ? ' ' + kind : '');
}

async function initAuth() {
  if (!sb) {                       // backend required for cloud-only mode
    authMsg('Backend not configured — cannot reach the server.', 'error');
    setSync('off', 'offline');
    return;
  }
  const { data } = await sb.auth.getSession();
  await handleSession(data.session);
  sb.auth.onAuthStateChange((_event, session) => handleSession(session));
}

async function handleSession(session) {
  currentUser = session?.user || null;
  if (currentUser) {
    document.body.classList.add('signed-in');
    $('#authSub').textContent = 'Sign in to continue';
    await migrateLocalToCloud();   // one-time recovery of any old local data
    await pullAll();               // load everything from Supabase
  } else {
    DATA = {};
    document.body.classList.remove('signed-in');
  }
}

async function signIn() {
  const email = $('#authEmail').value.trim();
  const password = $('#authPass').value;
  if (!email || !password) { authMsg('Enter your email and password.', 'error'); return; }
  authMsg('Signing in…');
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) authMsg(error.message, 'error');
}

async function signOut() {
  if (sb) await sb.auth.signOut();
  currentUser = null;
  DATA = {};
  localStorage.removeItem(STORE_KEY);
  document.body.classList.remove('signed-in');
  $('#authEmail').value = '';
  $('#authPass').value = '';
  authMsg('');
}

// Combined daily steps (morning + evening) and whether the goal is met.
const totalSteps = (e) => (Number(e?.steps) || 0) + (Number(e?.steps2) || 0);
const stepsDone = (e) => totalSteps(e) >= CONFIG.stepsGoal;

// Score for a single entry: % of the 7 daily targets met
// (6 habits + 1 combined steps target of 10,000/day).
function dailyScore(e) {
  if (!e) return 0;
  let met = 0;
  HABITS.forEach(h => { if (e[h.key]) met++; });
  if (stepsDone(e)) met++;
  return Math.round((met / 7) * 100);
}

/* ============================================================
   Derived metrics
   ============================================================ */
function computeMetrics() {
  const start = parseISO(CONFIG.startDate);
  const goalD = new Date(start);
  goalD.setMonth(goalD.getMonth() + CONFIG.durationMonths);
  const today = todayMidnight();

  const totalDays = Math.round((goalD - start) / 86400000);
  const elapsed = clamp(Math.round((today - start) / 86400000), 0, totalDays);
  const daysLeft = Math.max(0, Math.round((goalD - today) / 86400000));

  // Latest logged weight
  const dates = Object.keys(DATA).sort();
  let currentWeight = CONFIG.startWeight;
  for (let i = dates.length - 1; i >= 0; i--) {
    if (DATA[dates[i]].weight != null && DATA[dates[i]].weight !== '') {
      currentWeight = Number(DATA[dates[i]].weight); break;
    }
  }

  const totalToLose = CONFIG.startWeight - CONFIG.goalWeight;
  const lost = +(CONFIG.startWeight - currentWeight).toFixed(1);
  const remaining = +(currentWeight - CONFIG.goalWeight).toFixed(1);
  const pct = clamp(Math.round((lost / totalToLose) * 100), 0, 100);

  // Target weight for today (linear) & pace
  const targetNow = CONFIG.startWeight - (totalToLose * (elapsed / totalDays));
  const aheadKg = +(targetNow - currentWeight).toFixed(1); // positive = ahead of plan

  // Streak: consecutive days up to today (or yesterday) with a logged entry scoring >= 50%
  let streak = 0;
  let cursor = new Date(today);
  if (!DATA[iso(cursor)]) cursor.setDate(cursor.getDate() - 1); // allow today not yet logged
  while (true) {
    const e = DATA[iso(cursor)];
    if (e && dailyScore(e) >= 50) { streak++; cursor.setDate(cursor.getDate() - 1); }
    else break;
  }

  // Best streak across all logged days
  let best = 0, run = 0, prev = null;
  dates.forEach(ds => {
    const e = DATA[ds];
    const ok = dailyScore(e) >= 50;
    if (!ok) { run = 0; prev = ds; return; }
    if (prev && (parseISO(ds) - parseISO(prev)) === 86400000) run++; else run = 1;
    best = Math.max(best, run);
    prev = ds;
  });

  // Average completion across logged days
  const logged = dates.length;
  const avg = logged ? Math.round(dates.reduce((s, ds) => s + dailyScore(DATA[ds]), 0) / logged) : 0;

  return { start, goalD, today, totalDays, elapsed, daysLeft, currentWeight,
           lost, remaining, pct, totalToLose, aheadKg, streak, best, logged, avg };
}

/* ============================================================
   Render dashboard
   ============================================================ */
function render() {
  const m = computeMetrics();

  $('#todayLabel').textContent = fmtDate(m.today);
  $('#goalDate').textContent = fmtDate(m.goalD);
  $('#startDateLabel').textContent = fmtDate(m.start);

  // Ring
  const C = 2 * Math.PI * 84;
  $('#ringFg').style.strokeDashoffset = C * (1 - m.pct / 100);
  $('#ringPct').textContent = m.pct + '%';

  // Hero
  $('#currentWeight').textContent = m.currentWeight;
  $('#lostKg').textContent = m.lost;
  $('#lostFoot').textContent = `of ${m.totalToLose} kg target`;
  $('#remainKg').textContent = Math.max(0, m.remaining);
  $('#weightDelta').textContent = m.lost >= 0
    ? `▼ ${m.lost} kg from start` : `▲ ${Math.abs(m.lost)} kg from start`;
  $('#weightDelta').style.color = m.lost >= 0 ? 'var(--good)' : 'var(--bad)';

  // Tiles
  $('#daysLeft').textContent = m.daysLeft;
  $('#streak').textContent = m.streak;
  $('#bestStreak').textContent = m.best;
  $('#completion').textContent = m.avg + '%';
  $('#daysLogged').textContent = m.logged;
  if (m.aheadKg >= 0) {
    $('#paceLabel').textContent = `+${m.aheadKg}kg`;
    $('#paceLabel').style.color = 'var(--good)';
  } else {
    $('#paceLabel').textContent = `${m.aheadKg}kg`;
    $('#paceLabel').style.color = 'var(--bad)';
  }

  renderTodayHabits(m);
  renderChart(m);
  renderHistory();
}

function renderTodayHabits(m) {
  const e = DATA[iso(m.today)];
  const list = $('#habitList');
  list.innerHTML = '';

  const rows = [
    ...HABITS.map(h => ({ name: h.name, done: !!(e && e[h.key]), val: '' })),
    { name: 'Steps (10,000/day)', done: !!(e && stepsDone(e)), val: e ? totalSteps(e) : '' },
  ];

  rows.forEach(r => {
    const li = document.createElement('li');
    li.className = 'habit';
    li.innerHTML = `
      <span class="h-ico ${r.done ? 'h-done' : 'h-miss'}">${r.done ? '✓' : '✕'}</span>
      <span class="h-name">${r.name}</span>
      <span class="h-val">${r.val !== '' ? r.val : ''}</span>`;
    list.appendChild(li);
  });

  const score = dailyScore(e);
  $('#todayBar').style.width = score + '%';
  $('#todayScore').textContent = e
    ? `Today's completion: ${score}%`
    : 'No data for today yet — tap “Log today’s data”.';
}

/* ============================================================
   Weight trend chart (SVG)
   ============================================================ */
function renderChart(m) {
  const svg = $('#chart');
  const W = 720, H = 280, padL = 44, padR = 16, padT = 16, padB = 28;
  const innerW = W - padL - padR, innerH = H - padT - padB;

  // y scale based on goal..start (+a little headroom)
  const yMax = CONFIG.startWeight + 2;
  const yMin = CONFIG.goalWeight - 2;
  const yToPx = (w) => padT + innerH * (1 - (w - yMin) / (yMax - yMin));
  const xToPx = (i, n) => padL + (n <= 1 ? 0 : innerW * (i / (n - 1)));

  // gather actual weights in date order
  const pts = Object.keys(DATA).sort()
    .filter(ds => DATA[ds].weight != null && DATA[ds].weight !== '')
    .map(ds => ({ ds, w: Number(DATA[ds].weight) }));

  // always anchor with start point
  const series = [{ ds: CONFIG.startDate, w: CONFIG.startWeight }, ...pts.filter(p => p.ds !== CONFIG.startDate)];
  const n = series.length;

  let g = '';

  // grid + y labels
  for (let i = 0; i <= 4; i++) {
    const val = yMin + (yMax - yMin) * (i / 4);
    const y = yToPx(val);
    g += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#2a3550" stroke-width="1"/>`;
    g += `<text x="${padL - 8}" y="${y + 4}" fill="#8a96b2" font-size="11" text-anchor="end">${val.toFixed(0)}</text>`;
  }

  // target line (start -> goal across full duration, mapped to chart width)
  const tg1 = yToPx(CONFIG.startWeight), tg2 = yToPx(CONFIG.goalWeight);
  g += `<line x1="${padL}" y1="${tg1}" x2="${W - padR}" y2="${tg2}"
        stroke="#6366f1" stroke-width="2" stroke-dasharray="6 6" opacity="0.8"/>`;

  // actual line + area
  if (n >= 1) {
    const coords = series.map((p, i) => [xToPx(i, n), yToPx(p.w)]);
    const line = coords.map((c, i) => `${i ? 'L' : 'M'}${c[0].toFixed(1)} ${c[1].toFixed(1)}`).join(' ');
    const area = `${line} L${coords[coords.length - 1][0].toFixed(1)} ${padT + innerH} L${coords[0][0].toFixed(1)} ${padT + innerH} Z`;

    g += `<path d="${area}" fill="rgba(45,212,191,0.12)"/>`;
    g += `<path d="${line}" fill="none" stroke="#2dd4bf" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`;
    coords.forEach(c => {
      g += `<circle cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" r="4" fill="#0f1422" stroke="#2dd4bf" stroke-width="2.5"/>`;
    });
  }

  svg.innerHTML = g;
}

/* ============================================================
   History table
   ============================================================ */
function renderHistory() {
  const body = $('#historyBody');
  body.innerHTML = '';
  const dates = Object.keys(DATA).sort().reverse().slice(0, 14);

  if (!dates.length) {
    body.innerHTML = `<tr><td colspan="12" style="text-align:center;color:var(--muted);padding:24px">No entries yet.</td></tr>`;
    return;
  }

  const badge = (on) => on
    ? '<span class="badge b-done">Completed</span>'
    : '<span class="badge b-skip">Skipped</span>';

  dates.forEach(ds => {
    const e = DATA[ds];
    const d = parseISO(ds);
    const score = dailyScore(e);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${fmtDate(d)}</td>
      <td>${dayName(d)}</td>
      <td>${e.weight ?? '—'}</td>
      <td>${badge(e.protein)}</td>
      <td>${e.steps ?? '—'}</td>
      <td>${badge(e.gym)}</td>
      <td>${badge(e.breakfast)}</td>
      <td>${badge(e.lunch)}</td>
      <td>${badge(e.dinner)}</td>
      <td>${e.steps2 ?? '—'}</td>
      <td>${badge(e.sleep)}</td>
      <td class="score-pill" style="color:${score >= 70 ? 'var(--good)' : score >= 40 ? '#eab308' : 'var(--bad)'}">${score}%</td>`;
    body.appendChild(tr);
  });
}

/* ============================================================
   Modal / entry form
   ============================================================ */
const LOG_PASSWORD = 'Hadhiz654*';   // gate for opening the daily-entry form

function openPwGate() {
  $('#pwInput').value = '';
  $('#pwMsg').textContent = '';
  $('#pwOverlay').classList.add('show');
  setTimeout(() => $('#pwInput').focus(), 50);
}
function closePwGate() { $('#pwOverlay').classList.remove('show'); }
function checkPw() {
  if ($('#pwInput').value === LOG_PASSWORD) {
    closePwGate();
    openModal();
  } else {
    const m = $('#pwMsg');
    m.textContent = 'Incorrect password.';
    m.className = 'auth-msg error';
    $('#pwInput').select();
  }
}

let selectedISO = null;   // currently selected date 'YYYY-MM-DD'
let calView = null;       // first-of-month currently shown in calendar

function buildToggles() {
  const wrap = $('#toggleWrap');
  wrap.innerHTML = '';
  HABITS.forEach(h => {
    const div = document.createElement('div');
    div.className = 'toggle';
    div.dataset.key = h.key;
    div.innerHTML = `
      <div><div class="t-name">${h.name}</div><div class="t-hint">${h.hint}</div></div>
      <div class="switch"></div>`;
    div.addEventListener('click', () => div.classList.toggle('on'));
    wrap.appendChild(div);
  });
}

function setSelectedDate(ds) {
  selectedISO = ds;
  const d = parseISO(ds);
  $('#fDateText').textContent = fmtDate(d);
  $('#fDay').textContent = dayName(d);
  calView = new Date(d.getFullYear(), d.getMonth(), 1);
  loadIntoForm(ds);
  renderCalendar();
}

function openModal(dateStr) {
  const ds = dateStr || iso(todayMidnight());
  setSelectedDate(ds);
  closeCalendar();
  $('#overlay').classList.add('show');
}
function closeModal() { closeCalendar(); $('#overlay').classList.remove('show'); }

/* ---- calendar popup ---- */
function openCalendar() { $('#calendar').classList.add('show'); $('#dateInput').classList.add('open'); renderCalendar(); }
function closeCalendar() { $('#calendar').classList.remove('show'); $('#dateInput').classList.remove('open'); }
function toggleCalendar() { $('#calendar').classList.contains('show') ? closeCalendar() : openCalendar(); }

function renderCalendar() {
  if (!calView) calView = new Date();
  $('#calTitle').textContent = calView.toLocaleString('en-US', { month: 'long', year: 'numeric' });

  const grid = $('#calGrid');
  grid.innerHTML = '';
  const year = calView.getFullYear(), month = calView.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayISO = iso(todayMidnight());

  // leading blanks from previous month
  const prevDays = new Date(year, month, 0).getDate();
  for (let i = firstDow - 1; i >= 0; i--) {
    addCell(grid, new Date(year, month - 1, prevDays - i), true, todayISO);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    addCell(grid, new Date(year, month, d), false, todayISO);
  }
  // trailing blanks to fill 6 rows
  const cells = grid.children.length;
  const trail = (Math.ceil(cells / 7) * 7) - cells;
  for (let d = 1; d <= trail; d++) {
    addCell(grid, new Date(year, month + 1, d), true, todayISO);
  }
}

function addCell(grid, date, muted, todayISO) {
  const ds = iso(date);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cal-cell' + (muted ? ' muted-day' : '');
  if (ds === todayISO) btn.classList.add('today');
  if (ds === selectedISO) btn.classList.add('selected');
  if (DATA[ds]) btn.classList.add('has-data');
  btn.textContent = date.getDate();
  btn.addEventListener('click', () => {
    setSelectedDate(ds);
    closeCalendar();
  });
  grid.appendChild(btn);
}

function loadIntoForm(ds) {
  const e = DATA[ds] || {};
  $('#fWeight').value = e.weight ?? '';
  $('#fSteps').value = e.steps ?? '';
  $('#fSteps2').value = e.steps2 ?? '';
  document.querySelectorAll('.toggle').forEach(t => {
    t.classList.toggle('on', !!e[t.dataset.key]);
  });
}

async function submitEntry() {
  const ds = selectedISO;
  if (!ds) { alert('Please choose a date.'); return; }

  const weight = $('#fWeight').value;
  if (weight !== '') {
    const w = Number(weight);
    if (isNaN(w) || w < 0 || w > 200) { alert('Weight must be between 0 and 200.'); return; }
  }
  const steps = $('#fSteps').value, steps2 = $('#fSteps2').value;
  for (const [label, val] of [['Steps', steps], ['Steps2', steps2]]) {
    if (val !== '') {
      const s = Number(val);
      if (isNaN(s) || s < 0 || s > 15000 || !Number.isInteger(s)) {
        alert(`${label} must be a whole number between 0 and 15000.`); return;
      }
    }
  }

  const entry = {
    weight: weight === '' ? null : Number(weight),
    steps: steps === '' ? null : Number(steps),
    steps2: steps2 === '' ? null : Number(steps2),
  };
  document.querySelectorAll('.toggle').forEach(t => { entry[t.dataset.key] = t.classList.contains('on'); });

  // Save to Supabase first; only update the UI if it succeeds.
  const ok = await pushEntry(ds, entry);
  if (!ok) { alert('Could not save to the server. Check your connection and try again.'); return; }
  DATA[ds] = entry;
  render();
  closeModal();
}

/* ============================================================
   Export CSV
   ============================================================ */
function exportCSV() {
  const cols = ['Date','Day','Weight','Protein','Steps','Gym','Breakfast','Lunch','Dinner','Steps2','Sleep','Score'];
  const stat = (b) => b ? 'Completed' : 'Skipped';
  const rows = Object.keys(DATA).sort().map(ds => {
    const e = DATA[ds], d = parseISO(ds);
    return [fmtDate(d), dayName(d), e.weight ?? '', stat(e.protein), e.steps ?? '',
            stat(e.gym), stat(e.breakfast), stat(e.lunch), stat(e.dinner),
            e.steps2 ?? '', stat(e.sleep), dailyScore(e) + '%'].join(',');
  });
  const csv = [cols.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'progress.csv';
  a.click();
}

/* ============================================================
   Wire up
   ============================================================ */
buildToggles();
$('#openLog').addEventListener('click', openPwGate);
$('#closeModal').addEventListener('click', closeModal);
$('#cancelBtn').addEventListener('click', closeModal);
$('#submitBtn').addEventListener('click', submitEntry);
$('#exportBtn').addEventListener('click', exportCSV);

// Password gate for logging
$('#pwUnlock').addEventListener('click', checkPw);
$('#pwClose').addEventListener('click', closePwGate);
$('#pwCancel').addEventListener('click', closePwGate);
$('#pwInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') checkPw(); });
$('#pwOverlay').addEventListener('click', (e) => { if (e.target === $('#pwOverlay')) closePwGate(); });

// Calendar popup
$('#dateInput').addEventListener('click', toggleCalendar);
$('#dateInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCalendar(); } });
$('#calPrev').addEventListener('click', () => { calView.setMonth(calView.getMonth() - 1); renderCalendar(); });
$('#calNext').addEventListener('click', () => { calView.setMonth(calView.getMonth() + 1); renderCalendar(); });
$('#calToday').addEventListener('click', () => { setSelectedDate(iso(todayMidnight())); closeCalendar(); });
// close calendar when clicking elsewhere inside the modal
document.addEventListener('click', (e) => {
  if (!e.target.closest('#calendar') && !e.target.closest('#dateInput')) closeCalendar();
});

$('#overlay').addEventListener('click', (e) => { if (e.target === $('#overlay')) closeModal(); });

// Auth controls
$('#authSignIn').addEventListener('click', signIn);
$('#logoutBtn').addEventListener('click', signOut);
$('#authPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') signIn(); });

initAuth();    // gate the app behind login, then sync from Supabase
