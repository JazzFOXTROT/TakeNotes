'use strict';
/* TakeNotes — web app (local-first, works offline when installed) */

/* ---------- utils ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad2 = n => String(n).padStart(2, '0');
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const startOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
const endOfToday = () => startOfDay() + 86400000 - 1;
const DAY = 86400000;
const weekdayIdx = (d = new Date()) => (d.getDay() + 6) % 7; // Mon=0
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = ts => { const d = new Date(ts); return `${DAYS[weekdayIdx(d)]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const longDate = () => new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const COLORS = ['blue', 'orange', 'green', 'purple', 'yellow'];
const PAPERS = ['lines', 'grid', 'dots', 'blank'];
const PW = 1000, PH = 1414; // page units

/* ---------- icons ---------- */
const P = {
  back: 'M15 18l-6-6 6-6', next: 'M9 6l6 6-6 6', close: 'M6 6l12 12M18 6L6 18', check: 'M5 12l5 5 9-10', plus: 'M12 6v12M6 12h12',
  pen: 'M4 20l4-1L19 8l-3-3L5 16l-1 4z', hl: 'M14 5l5 5-7 7H7v-5l7-7zM5 21h8', eraser: 'M8 20h12M5 15l8-8 5 5-7 7H9l-4-4z',
  move: 'M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3',
  q: 'M5 5h14v14H5z', photo: 'M4 5h16v14H4zM4 15l5-5 5 5 3-3 3 3', undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3', redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  trash: 'M5 7h14M10 11v6M14 11v6M7 7l1 13h8l1-13M9 7V4h6v3', more: 'M5 12h.01M12 12h.01M19 12h.01', gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'
};
const I = (d, c = '#171614', s = 22) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" style="flex:none"><path d="${P[d] || d}" stroke="${c}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/* ---------- storage (IndexedDB) ---------- */
const DB = {
  db: null,
  open() { return new Promise((res, rej) => { const r = indexedDB.open('takenotes', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => { this.db = r.result; res(); }; r.onerror = () => rej(r.error); }); },
  tx(mode) { return this.db.transaction('kv', mode).objectStore('kv'); },
  get(k) { return new Promise((res, rej) => { const q = this.tx('readonly').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },
  set(k, v) { return new Promise((res, rej) => { const q = this.tx('readwrite').put(v, k); q.onsuccess = () => res(); q.onerror = () => rej(q.error); }); },
  del(k) { return new Promise((res, rej) => { const q = this.tx('readwrite').delete(k); q.onsuccess = () => res(); q.onerror = () => rej(q.error); }); },
  clear() { return new Promise((res, rej) => { const q = this.tx('readwrite').clear(); q.onsuccess = () => res(); q.onerror = () => rej(q.error); }); }
};
const freshMeta = () => ({
  v: 1,
  profile: { name: '', study: '', daily: 5, onboarded: false, underlineQuiz: true, circleQuiz: true, fingerDraw: false, installHidden: false, tmIntro: false },
  notebooks: [], classes: [], pages: [], cards: []
});
let M = freshMeta();
const pageCache = new Map();
let saveMetaT;
const saveMeta = () => { clearTimeout(saveMetaT); saveMetaT = setTimeout(() => DB.set('meta', M), 150); };
async function loadPage(id) { if (!pageCache.has(id)) { const p = await DB.get('page:' + id); if (p) pageCache.set(id, p); } return pageCache.get(id); }
const savePageNow = p => DB.set('page:' + p.id, p);
const pageSaveTimers = {};
const savePage = p => { pageCache.set(p.id, p); clearTimeout(pageSaveTimers[p.id]); pageSaveTimers[p.id] = setTimeout(() => savePageNow(p), 350); const idx = M.pages.find(x => x.id === p.id); if (idx) { idx.updatedAt = Date.now(); idx.paper = p.paper; saveMeta(); } };

/* ---------- model helpers ---------- */
const nbById = id => M.notebooks.find(n => n.id === id);
const pagesOf = nbId => M.pages.filter(p => p.notebookId === nbId).sort((a, b) => a.createdAt - b.createdAt);
const cardsOfPage = pid => M.cards.filter(c => c.pageId === pid);
const dueCards = () => M.cards.filter(c => c.due <= endOfToday());
const suggestPaper = name => /math|calc|algebra|geometr|statist|physic|chem|econom|engineer|account|finance|матем|физ|хим|стат/i.test(name) ? 'grid' : 'lines';
function newPage(nbId) {
  const nb = nbById(nbId); const id = uid();
  const page = { id, notebookId: nbId, paper: nb.paper, strokes: [], images: [], createdAt: Date.now() };
  M.pages.push({ id, notebookId: nbId, dateKey: dayKey(), createdAt: page.createdAt, updatedAt: page.createdAt, paper: nb.paper });
  pageCache.set(id, page); savePageNow(page); saveMeta(); return id;
}
function todaysPage(nbId) { const ps = pagesOf(nbId).filter(p => p.dateKey === dayKey()); return ps.length ? ps[ps.length - 1].id : newPage(nbId); }
function classNow() { const d = weekdayIdx(), m = new Date().getHours() * 60 + new Date().getMinutes(); return M.classes.find(c => c.day === d && toMin(c.start) <= m && m < toMin(c.end) && nbById(c.notebookId)); }
function classesToday() { const d = weekdayIdx(); return M.classes.filter(c => c.day === d && nbById(c.notebookId)).sort((a, b) => toMin(a.start) - toMin(b.start)); }
function schedule(card, grade) { // grade 0 not yet, .5 almost, 1 knew
  const iv = card.interval || 0;
  if (grade >= 1) card.interval = iv ? Math.round(iv * 2.5) : 3;
  else if (grade > 0) card.interval = Math.max(1, Math.round((iv || 1) * 1.2));
  else { card.interval = 1; card.lapses = (card.lapses || 0) + 1; }
  card.reps = (card.reps || 0) + 1; card.due = startOfDay() + card.interval * DAY; card.last = Date.now(); saveMeta();
}
const daysUntil = ds => Math.round((startOfDay(new Date(ds + 'T00:00')) - startOfDay()) / DAY);

/* ---------- ui state ---------- */
let ui = { screen: 'loading', ob: 0, nbId: null, pageId: null, sheet: null, toast: null };
const app = $('#app');
let editor = null; // active editor instance
function setUI(p) { Object.assign(ui, p); render(); }
function go(screen, p = {}) { if (editor) { editor.destroy(); editor = null; } ui.sheet = null; setUI({ screen, ...p }); }
function toast(t) { ui.toast = t; renderToast(); clearTimeout(toast.t); toast.t = setTimeout(() => { ui.toast = null; renderToast(); }, 2000); }
function renderToast() { $('.toast')?.remove(); if (ui.toast) document.body.insertAdjacentHTML('beforeend', `<div class="toast">${esc(ui.toast)}</div>`); }

/* ---------- render ---------- */
function render() {
  if (ui.screen === 'editor') { if (!editor) { app.innerHTML = ''; editor = new Editor(app, ui.pageId); } renderSheet(); return; }
  const f = SCREENS[ui.screen]; app.innerHTML = f ? f() : ''; mount[ui.screen]?.(); renderSheet();
}
function renderSheet() { $('.dim')?.remove(); if (ui.sheet && SHEETS[ui.sheet]) { document.body.insertAdjacentHTML('beforeend', SHEETS[ui.sheet]()); mountSheet[ui.sheet]?.(); } }
const SCREENS = {}, SHEETS = {}, mount = {}, mountSheet = {};

/* ===== onboarding ===== */
const obTop = (i, n) => `<div class="ob-top">${i > 0 ? `<button class="icon-btn" data-ob-back>${I('back')}</button>` : '<span style="width:40px"></span>'}<div class="progress"><i style="width:${(i / n) * 100}%"></i></div><span style="width:40px"></span></div>`;
SCREENS.ob = () => {
  const s = ui.ob, pr = M.profile;
  if (s === 0) return `<div class="ob" style="justify-content:center">
    <div class="serif" style="position:absolute;left:var(--pad);top:calc(var(--pad) + var(--safe-t));font-size:24px">TakeNotes</div>
    <div class="serif" style="font-size:clamp(32px,4.4vw,48px);text-align:center;line-height:1.1">The notebook that knows<br>what you forget.</div>
    <div class="s18 sec" style="margin-top:14px;text-align:center">Take notes by hand. Turn them into questions. Remember them at the exam.</div>
    <div class="stack">${['purple', 'orange', 'green', 'blue'].map((c, i) => `<i class="c-${c}" style="left:${i * 19}%;top:${[8, 2, 5, 10][i]}%;transform:rotate(${[-10, -3, 5, 12][i]}deg)"></i>`).join('')}</div>
    <div class="ob-foot" style="margin-top:28px;width:min(420px,100%)"><button class="btn ink" data-ob-next>Get started</button></div></div>`;
  const N = 4;
  const body = {
    1: ['What should we call you?', 'We’ll use it in greetings.', `<input class="field" id="f-name" placeholder="Your name" value="${esc(pr.name)}" autocomplete="given-name">`],
    2: ['What do you study?', 'Optional — it helps us suggest the right paper.', `<input class="field" id="f-study" placeholder="e.g. Economics" value="${esc(pr.study)}">`],
    3: ['How many questions a day?', 'They come from your own notes. You can change this later.', `<div class="col g10">${[[3, 'About 2 minutes', 'Light'], [5, 'About 3 minutes', 'Regular'], [10, 'About 6 minutes', 'Serious'], [15, 'About 9 minutes', 'Intense']].map(([n, a, b]) => `<button class="option ${pr.daily === n ? 'on' : ''}" data-daily="${n}"><span class="grow">${n} a day<span class="sub">${a}</span></span><span class="s14 b5" style="opacity:.7">${b}</span></button>`).join('')}</div>`],
    4: ['Mark a line — it’s in your quiz', 'Questions come only from what you mark. No AI.', `<div class="col g10">
      ${[['Underline a line', 'The line is hidden in the quiz — you recall it.', '<span style="font-family:var(--hand);font-size:28px;border-bottom:2px solid #171614;padding:0 2px">slope of the tangent</span>'],
         ['Circle a word or formula', 'Only the circled part is hidden.', '<span style="font-family:var(--hand);font-size:28px;border:2px solid #171614;border-radius:50%;padding:0 18px">2x</span>'],
         ['Or use the Q tool', 'Drag a box around anything — a diagram, a cut-out.', `<span class="pill" style="background:var(--ink);color:#fff">Q</span>`]].map(([a, b, demo]) => `<div class="option" style="cursor:default"><span class="grow">${a}<span class="sub">${b}</span></span>${demo}</div>`).join('')}
      <div class="s15 sec" style="margin-top:4px">A <b>Q</b> appears next to each marked part. Tap it to take it out. Test myself and daily questions use the same marks.</div></div>`]
  }[s];
  return `<div class="ob">${obTop(s, N)}<div class="ob-body"><div class="s14 b6 sec">Step ${s} of ${N}</div><div class="serif h1">${body[0]}</div><div class="s17 sec">${body[1]}</div><div style="height:12px"></div>${body[2]}</div>
    <div class="ob-foot"><button class="btn ink" data-ob-next>${s === N ? 'Start' : 'Continue'}</button>${s === 4 ? `<div class="s13 sec" style="text-align:center;margin-top:12px">Your notes stay on this iPad. You can export a backup in Settings.</div>` : ''}</div></div>`;
};
mount.ob = () => { const f = $('#f-name') || $('#f-study'); if (f) setTimeout(() => f.focus(), 50); };

/* ===== home ===== */
function nbMeta(nb) { const n = pagesOf(nb.id).length; if (nb.exam) { const d = daysUntil(nb.exam); if (d >= 0) return d === 0 ? 'Exam today' : `Exam in ${d} day${d > 1 ? 's' : ''}`; } return n ? `${n} page${n > 1 ? 's' : ''}` : 'No pages yet'; }
SCREENS.home = () => {
  const pr = M.profile, nbs = M.notebooks, now = classNow(), today = classesToday(), due = dueCards();
  const later = today.filter(c => toMin(c.start) > new Date().getHours() * 60 + new Date().getMinutes());
  const exams = nbs.filter(n => n.exam && daysUntil(n.exam) >= 0).sort((a, b) => a.exam.localeCompare(b.exam));
  const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  const nowCard = now ? (() => { const nb = nbById(now.notebookId); return `<div class="c-${nb.color}"><div class="s14 b6">Now · ${now.start} – ${now.end}</div><div class="serif h2">${esc(nb.name)}</div><div class="s15 sec">${esc(now.room || 'From your week')}</div><div style="flex:1;min-height:18px"></div><button class="btn ink" style="align-self:flex-start" data-open-today="${nb.id}">Open today’s page</button></div>`; })()
    : later.length ? (() => { const c = later[0], nb = nbById(c.notebookId); return `<div class="c-${nb.color}"><div class="s14 b6">Next · ${c.start}</div><div class="serif h2">${esc(nb.name)}</div><div class="s15 sec">${esc(c.room || 'From your week')}</div><div style="flex:1;min-height:18px"></div><button class="btn ink" style="align-self:flex-start" data-open-nb="${nb.id}">Open notebook</button></div>`; })()
    : `<div class="card"><div class="s14 b6 sec">${M.classes.length ? 'No more classes today' : 'Your week'}</div><div class="serif h2">${M.classes.length ? 'Free time' : 'Add your classes'}</div><div class="s15 sec">${M.classes.length ? 'Good moment for today’s questions.' : 'Add them once — the right notebook opens during each class.'}</div><div style="flex:1;min-height:18px"></div><button class="btn ${M.classes.length ? 'muted' : 'ink'}" style="align-self:flex-start" data-go="week">${M.classes.length ? 'See your week' : 'Add my week'}</button></div>`;
  const dueCard = `<div class="card"><div class="s14 b6 sec">Due today</div><div class="serif h2">${due.length ? `${due.length} question${due.length > 1 ? 's' : ''}` : 'All caught up'}</div><div class="s15 sec">${due.length ? `From ${[...new Set(due.map(c => nbById(c.notebookId)?.name).filter(Boolean))].join(', ')} · about ${Math.max(1, Math.round(due.length * 0.4))} min` : M.cards.length ? 'Questions come back when you’re about to forget them.' : 'Underline or circle in your notes to make questions.'}</div><div style="flex:1;min-height:18px"></div><button class="btn ink" style="align-self:flex-start" data-start="due" ${due.length ? '' : 'disabled'}>Start</button></div>`;
  return `<div class="home">
    <nav class="side">
      <div class="serif" style="font-size:24px;padding-left:14px">TakeNotes</div><div style="height:18px"></div>
      <button class="side-item on">Today</button><button class="side-item" data-go="week">Week</button><button class="side-item" data-go="settings">Settings</button>
      <div style="height:20px"></div><div class="s13 b6 sec" style="padding-left:14px">Notebooks</div>
      ${nbs.map(n => `<button class="side-item" data-open-nb="${n.id}"><span class="dot c-${n.color}"></span>${esc(n.name)}</button>`).join('')}
      <button class="side-item" data-sheet="newnb">${I('plus', '#6F6B64', 18)}New notebook</button>
    </nav>
    <div class="main">
      <div class="topnav row g8" style="padding-top:4px"><span class="serif grow" style="font-size:22px">TakeNotes</span><button class="btn muted sm" data-go="week">Week</button><button class="btn muted sm" data-go="settings">Settings</button></div>
      ${!standalone && !pr.installHidden ? `<div class="banner"><span class="grow s14 b5">Install TakeNotes: tap <b>Share</b> → <b>Add to Home Screen</b>. It opens full screen and works offline.</span><button class="icon-btn" data-hide-install>${I('close', '#6F6B64', 18)}</button></div>` : ''}
      <div class="row g12" style="align-items:flex-end"><div class="grow"><div class="s15 b5 sec">${longDate()}</div><div class="serif h1">${pr.name ? `Hi, ${esc(pr.name)}` : 'Today'}</div></div><button class="btn ink" data-sheet="newnb">New notebook</button></div>
      <div class="hero">${nowCard}${dueCard}</div>
      <div class="row"><span class="s20 b7 grow">Notebooks</span></div>
      ${nbs.length ? `<div class="nb-grid">${nbs.map(n => `<div class="col g8"><button class="cover c-${n.color}" data-open-nb="${n.id}">${esc(n.name)}</button><span class="s14 sec">${nbMeta(n)}</span></div>`).join('')}<div class="col g8"><button class="cover add" data-sheet="newnb">${I('plus', '#6F6B64', 26)}</button><span class="s14 sec">&nbsp;</span></div></div>`
        : `<div class="empty-note col g8"><div class="s17 b6">No notebooks yet</div><div class="s15 sec">Make one per subject — Maths, English, History…</div><button class="btn ink" style="align-self:flex-start;margin-top:6px" data-sheet="newnb">Create your first notebook</button></div>`}
    </div>
    <aside class="right card">
      <div class="s17 b7">Classes today</div><div style="height:8px"></div>
      ${today.length ? today.map(c => { const nb = nbById(c.notebookId); return `<button class="row g12" style="padding:11px 0;width:100%;text-align:left" data-open-nb="${nb.id}"><span class="s15 b5 sec" style="width:44px">${c.start}</span><span class="c-${nb.color}" style="width:4px;height:28px;border-radius:2px"></span><span class="grow s16 b6">${esc(nb.name)}</span>${now && now.id === c.id ? '<span class="pill" style="background:var(--ink);color:#fff;font-size:12px;padding:4px 10px">Now</span>' : ''}</button>`; }).join('') : `<div class="s15 sec" style="padding:6px 0">${M.classes.length ? 'No classes today.' : 'Add your week to see classes here.'}</div>`}
      <div style="height:26px"></div><div class="s17 b7">Exams</div><div style="height:10px"></div>
      ${exams.length ? exams.map(n => { const d = new Date(n.exam + 'T00:00'); const left = daysUntil(n.exam); return `<button class="row g14" style="background:var(--canvas);border-radius:18px;padding:12px;margin-bottom:10px;width:100%;text-align:left" data-open-nb="${n.id}"><span class="date-tile c-${n.color}"><b>${d.getDate()}</b><small>${MONTHS[d.getMonth()]}</small></span><span class="grow"><div class="s16 b6">${esc(n.name)}</div><div class="s14 sec">${left === 0 ? 'today' : `in ${left} day${left > 1 ? 's' : ''}`}</div></span></button>`; }).join('') : '<div class="s15 sec">Add an exam date inside a notebook.</div>'}
    </aside>
  </div>`;
};

/* ===== week ===== */
SCREENS.week = () => {
  const cls = M.classes.filter(c => nbById(c.notebookId));
  const minH = Math.min(8, ...cls.map(c => Math.floor(toMin(c.start) / 60))), maxH = Math.max(18, ...cls.map(c => Math.ceil(toMin(c.end) / 60)));
  const hours = maxH - minH, today = weekdayIdx();
  const nowM = new Date().getHours() * 60 + new Date().getMinutes(); const nowTop = (nowM / 60 - minH) / hours;
  return `<div class="ed-top"><button class="row g6" data-go="home">${I('back')}<span class="s16 b5">Today</span></button><span class="grow"></span><button class="btn ink" data-sheet="addclass">Add class</button></div>
  <div style="padding:6px var(--pad) 0"><div class="serif h1">Your week</div><div class="s16 sec" style="margin-top:4px">Add classes once — they repeat every week, and the right notebook opens on time.</div></div>
  <div class="week-wrap"><div class="week" id="week">
    ${DAYS.map((d, i) => `<div style="position:absolute;left:calc(56px + (100% - 66px) * ${i / 7});width:calc((100% - 66px) / 7);top:14px;text-align:center"><span class="pill" style="${i === today ? 'background:var(--ink);color:#fff' : 'color:var(--text2)'}">${d}</span></div>`).join('')}
    ${Array.from({ length: hours + 1 }, (_, i) => `<div class="s12 b5 sec" style="position:absolute;left:12px;top:calc(52px + (100% - 66px) * ${i / hours} - 8px)">${pad2(minH + i)}:00</div><div style="position:absolute;left:56px;right:10px;height:1px;background:var(--muted);top:calc(52px + (100% - 66px) * ${i / hours})"></div>`).join('')}
    ${cls.map(c => { const nb = nbById(c.notebookId), t = (toMin(c.start) / 60 - minH) / hours, h = (toMin(c.end) - toMin(c.start)) / 60 / hours; return `<button class="cls c-${nb.color}" style="left:calc(56px + (100% - 66px) * ${c.day / 7} + 3px);width:calc((100% - 66px) / 7 - 6px);top:calc(52px + (100% - 66px) * ${t} + 2px);height:calc((100% - 66px) * ${h} - 4px)" data-edit-class="${c.id}"><div class="s14 b6">${esc(nb.name)}</div><div class="s12 b5 sec">${c.start}–${c.end}${c.room ? ' · ' + esc(c.room) : ''}</div></button>`; }).join('')}
    ${nowTop > 0 && nowTop < 1 ? `<div style="position:absolute;left:calc(56px + (100% - 66px) * ${today / 7});width:calc((100% - 66px) / 7);top:calc(52px + (100% - 66px) * ${nowTop});height:2px;background:var(--ink)"></div>` : ''}
    ${cls.length ? '' : `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none"><div class="s16 sec">No classes yet — tap “Add class”.</div></div>`}
  </div></div>`;
};
mount.week = () => { const w = $('#week'); if (w) w.style.setProperty('--h', w.clientHeight + 'px'); };

/* ===== notebook ===== */
SCREENS.notebook = () => {
  const nb = nbById(ui.nbId); if (!nb) return '';
  const ps = pagesOf(nb.id), cards = M.cards.filter(c => c.notebookId === nb.id), due = cards.filter(c => c.due <= endOfToday());
  const groups = {}; ps.slice().reverse().forEach(p => { (groups[p.dateKey] = groups[p.dateKey] || []).push(p); });
  return `<div class="ed-top"><button class="row g6" data-go="home">${I('back')}<span class="s16 b5">Today</span></button><span class="grow"></span><button class="icon-btn" data-sheet="nbsettings" title="Notebook settings">${I('more')}</button></div>
  <div class="scroll" style="flex:1;padding:6px var(--pad) var(--pad)"><div class="col g20">
    <div class="row g16 wrap"><span class="c-${nb.color}" style="width:56px;height:56px;border-radius:16px;flex:none"></span>
      <div class="grow" style="min-width:200px"><div class="serif h1">${esc(nb.name)}</div><div class="s15 sec">${ps.length} page${ps.length === 1 ? '' : 's'} · ${cards.length} question${cards.length === 1 ? '' : 's'}${nb.exam ? ` · ${nbMeta(nb)}` : ''}</div></div>
      <button class="btn muted sm" data-sheet="exam">${nb.exam ? 'Exam · ' + fmtDate(new Date(nb.exam + 'T00:00').getTime()) : 'Add exam date'}</button>
      <button class="btn muted sm" data-new-page="${nb.id}">New page</button>
      <button class="btn ink sm" data-sheet="quiz" ${cards.length ? '' : 'disabled'}>Quiz</button></div>
    ${due.length ? `<div class="card row g16" style="padding:18px 20px"><div class="grow"><div class="s17 b7">${due.length} question${due.length > 1 ? 's' : ''} due</div><div class="s15 sec">From this notebook — the ones you’re about to forget.</div></div><button class="btn ink sm" data-start="nbdue">Review</button></div>` : ''}
    ${!cards.length && ps.length ? `<div class="empty-note s15 sec">No questions yet. In your notes, <b>underline</b> a line or <b>circle</b> a word — or use the <b>Q</b> tool — and it goes into the quiz.</div>` : ''}
    ${ps.length ? Object.entries(groups).map(([dk, arr]) => `<div class="s18 b7">${dk === dayKey() ? 'Today' : fmtDate(new Date(dk + 'T00:00').getTime())}</div><div class="pages">${arr.map(p => `<button class="col g8" style="text-align:left" data-open-page="${p.id}"><div class="thumb"><canvas data-thumb="${p.id}"></canvas></div><span class="s14 sec">${cardsOfPage(p.id).length ? `${cardsOfPage(p.id).length} Q · ` : ''}${new Date(p.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span></button>`).join('')}</div>`).join('')
      : `<div class="col g12" style="align-items:center;padding:60px 0"><div class="thumb" style="width:180px"></div><div class="serif h2" style="margin-top:8px">Your first page is waiting</div><div class="s16 sec">Paper: ${nb.paper}. You can switch it any time in the toolbar.</div><button class="btn ink" data-new-page="${nb.id}">Start writing</button></div>`}
  </div></div>`;
};
mount.notebook = () => { $$('[data-thumb]').forEach(async cv => { const p = await loadPage(cv.dataset.thumb); if (!p) return; const r = cv.getBoundingClientRect(); const dpr = Math.min(2, devicePixelRatio || 1); cv.width = r.width * dpr; cv.height = r.height * dpr; await drawPage(cv.getContext('2d'), p, cv.width / PW, { cards: false }); }); };

/* ===== settings ===== */
SCREENS.settings = () => {
  const pr = M.profile; const tg = k => `<button class="toggle ${pr[k] ? 'on' : ''}" data-toggle="${k}"><i></i></button>`;
  const group = (t, rows) => `<div class="label" style="margin-top:8px">${t}</div><div class="card" style="border-radius:20px;padding:0 20px">${rows.map(([a, b, c], i) => `<div class="row g12" style="padding:15px 0;${i ? 'border-top:1px solid var(--muted)' : ''}"><div class="grow"><div class="s16 b6">${a}</div>${b ? `<div class="s13 sec">${b}</div>` : ''}</div>${c || ''}</div>`).join('')}</div>`;
  return `<div class="ed-top"><button class="row g6" data-go="home">${I('back')}<span class="s16 b5">Today</span></button></div>
  <div class="scroll" style="flex:1;padding:6px var(--pad) var(--pad)"><div class="col g10" style="max-width:760px;margin:0 auto">
    <div class="serif h1">Settings</div>
    ${group('You', [['Name', '', `<input class="field" style="width:220px;background:var(--canvas);font-size:16px;padding:10px 14px" value="${esc(pr.name)}" data-pf="name">`], ['What you study', '', `<input class="field" style="width:220px;background:var(--canvas);font-size:16px;padding:10px 14px" value="${esc(pr.study)}" data-pf="study">`]])}
    ${group('Questions', [['Questions a day', 'For the daily review', `<div class="seg">${[3, 5, 10, 15].map(v => `<button class="${pr.daily === v ? 'on' : ''}" data-daily="${v}">${v}</button>`).join('')}</div>`], ['Underline adds to the quiz', 'Turn off if you underline for emphasis', tg('underlineQuiz')], ['Circle adds to the quiz', 'A closed loop around a word or formula', tg('circleQuiz')]])}
    ${group('Writing', [['Draw with finger', 'Off: only Apple Pencil writes, fingers scroll (palm rejection)', tg('fingerDraw')]])}
    ${group('Your data', [['Everything stays on this iPad', 'Export a backup now and then — and after big lectures', `<button class="btn muted sm" data-export>Export</button>`], ['Restore from a backup', '', `<label class="btn muted sm">Import<input type="file" accept="application/json,.json" data-import hidden></label>`], ['Start over', 'Deletes all notebooks on this iPad', `<button class="btn muted sm" data-reset>Delete all</button>`]])}
    <div class="s13 sec" style="margin-top:12px">TakeNotes · web version 1.0</div>
  </div></div>`;
};

/* ===== quiz ===== */
let quiz = null;
async function startQuiz(kind, opts = {}) {
  let list = [];
  if (kind === 'due') list = dueCards().sort((a, b) => a.due - b.due).slice(0, Math.max(M.profile.daily, 1) * 3);
  if (kind === 'nbdue') list = dueCards().filter(c => c.notebookId === ui.nbId);
  if (kind === 'nb') { const ps = opts.today ? pagesOf(ui.nbId).filter(p => p.dateKey === dayKey()).map(p => p.id) : null; list = M.cards.filter(c => c.notebookId === ui.nbId && (!ps || ps.includes(c.pageId))).sort((a, b) => a.due - b.due).slice(0, opts.count || 10); }
  if (kind === 'page') list = cardsOfPage(opts.pageId);
  if (!list.length) return toast('No questions here yet — mark lines in your notes first');
  for (const c of list) await loadPage(c.pageId);
  quiz = { kind, list: list.map(c => c.id), i: 0, revealed: false, results: [], back: ui.screen === 'notebook' ? 'notebook' : 'home' };
  go('quiz');
}
SCREENS.quiz = () => {
  const c = M.cards.find(x => x.id === quiz.list[quiz.i]); const nb = nbById(c?.notebookId); const n = quiz.list.length;
  if (!c) return '';
  const page = M.pages.find(p => p.id === c.pageId);
  return `<div class="ed-top"><button class="s16 b5 sec" data-quiz-end>End</button><div class="progress" style="margin:0 12px"><i style="width:${quiz.i / n * 100}%"></i></div><span class="s16 b5 sec">${quiz.i + 1} of ${n}</span></div>
  <div class="qz"><div class="qz-col">
    <div class="row g10 wrap"><span class="pill c-${nb.color}">${c.kind === 'circle' ? 'Fill the gap' : c.kind === 'line' ? 'Recall the line' : 'Recall this'}</span><span class="s14 b5 sec">${esc(nb.name)} · ${page ? fmtDate(page.createdAt) : ''}${c.reps ? '' : ' · new'}</span></div>
    <div class="serif h2">${quiz.revealed ? 'How did it go?' : c.kind === 'circle' ? 'What’s hidden here?' : 'What did you write here?'}</div>
    <div class="s16 sec">${quiz.revealed ? 'Be honest — it decides when this comes back.' : 'Say it or write it down first, then show the answer.'}</div>
    <div class="qz-crop"><canvas id="qcv"></canvas></div>
  </div>
  <div class="qz-foot">${quiz.revealed ? `<button class="btn muted" data-grade="0">Not yet</button><button class="btn muted" data-grade="0.5">Almost</button><button class="btn ink" data-grade="1">Knew it</button>` : `<button class="btn ink" data-reveal>Show answer</button>`}</div></div>`;
};
mount.quiz = async () => { const c = M.cards.find(x => x.id === quiz.list[quiz.i]); const p = await loadPage(c.pageId); const cv = $('#qcv'); if (!cv || !p) return; await drawCrop(cv, p, c, !quiz.revealed); };
SCREENS.results = () => {
  const r = quiz.results, ok = r.filter(x => x >= 1).length, miss = r.length - ok;
  const missed = quiz.list.map((id, i) => [id, r[i]]).filter(([, g]) => g < 1).map(([id]) => M.cards.find(c => c.id === id)).filter(Boolean);
  const nextDue = missed.length ? Math.min(...missed.map(c => c.due)) : null;
  return `<div class="qz"><div class="qz-col" style="margin-top:clamp(40px,8vh,80px)">
    <div class="s15 b5 sec">${quiz.kind === 'due' ? 'Daily questions' : esc(nbById(ui.nbId)?.name || '')}</div>
    <div class="serif" style="font-size:72px;line-height:1">${ok} of ${r.length}</div>
    <div class="row g8">${r.map(x => `<span style="width:40px;height:8px;border-radius:4px;background:${x >= 1 ? 'var(--right)' : x > 0 ? 'var(--yellow)' : 'var(--wrong)'}"></span>`).join('')}</div>
    <div style="height:14px"></div>
    <div class="card row g14" style="padding:16px;border-radius:20px">${nextDue ? `<span class="date-tile c-blue"><b>${new Date(nextDue).getDate()}</b><small>${MONTHS[new Date(nextDue).getMonth()]}</small></span><div class="grow"><div class="s16 b6">${miss} to repeat — back on ${fmtDate(nextDue)}</div><div class="s14 sec">They’ll be in your daily questions. Nothing to plan.</div></div>` : `<div class="grow"><div class="s16 b6">Everything remembered</div><div class="s14 sec">These come back later, at a longer gap.</div></div>`}</div>
  </div><div class="qz-foot"><button class="btn ink" data-go="${quiz.back}">Done</button></div></div>`;
};

/* ---------- drawing ---------- */
const imgCache = new Map();
function getImg(src) { if (imgCache.has(src)) return imgCache.get(src); const p = new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; }); imgCache.set(src, p); return p; }
function drawPaper(ctx, paper, s, w, h) {
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  if (paper === 'lines') { ctx.strokeStyle = '#E2E7EF'; ctx.lineWidth = Math.max(1, s * 1.2); for (let y = 110; y < PH; y += 44) { ctx.beginPath(); ctx.moveTo(0, y * s); ctx.lineTo(w, y * s); ctx.stroke(); } }
  if (paper === 'grid') { ctx.strokeStyle = '#E2E7EF'; ctx.lineWidth = Math.max(1, s * 1.1); for (let x = 22; x < PW; x += 36) { ctx.beginPath(); ctx.moveTo(x * s, 0); ctx.lineTo(x * s, h); ctx.stroke(); } for (let y = 22; y < PH; y += 36) { ctx.beginPath(); ctx.moveTo(0, y * s); ctx.lineTo(w, y * s); ctx.stroke(); } }
  if (paper === 'dots') { ctx.fillStyle = '#C9CFD9'; const r = Math.max(1, s * 2); for (let x = 22; x < PW; x += 36) for (let y = 22; y < PH; y += 36) { ctx.beginPath(); ctx.arc(x * s, y * s, r, 0, 7); ctx.fill(); } }
}
function strokePath(ctx, pts, s) { ctx.beginPath(); ctx.moveTo(pts[0][0] * s, pts[0][1] * s); for (let i = 1; i < pts.length - 1; i++) { const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2; ctx.quadraticCurveTo(pts[i][0] * s, pts[i][1] * s, mx * s, my * s); } const l = pts[pts.length - 1]; ctx.lineTo(l[0] * s, l[1] * s); }
function drawStroke(ctx, st, s) {
  const pts = st.points; if (!pts.length) return;
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = st.color; ctx.fillStyle = st.color;
  if (st.tool === 'hl') { ctx.globalAlpha = .38; ctx.globalCompositeOperation = 'multiply'; ctx.lineWidth = st.size * s; if (pts.length === 1) pts.push([pts[0][0] + .1, pts[0][1]]); strokePath(ctx, pts, s); ctx.stroke(); ctx.restore(); return; }
  if (pts.length === 1) { ctx.beginPath(); ctx.arc(pts[0][0] * s, pts[0][1] * s, st.size * s * .5, 0, 7); ctx.fill(); ctx.restore(); return; }
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], pr = (a[2] + b[2]) / 2; ctx.lineWidth = Math.max(.6, st.size * s * (0.45 + pr * 0.9));
    ctx.beginPath(); if (i === 1) ctx.moveTo(a[0] * s, a[1] * s); else { const p0 = pts[i - 2]; ctx.moveTo(((p0[0] + a[0]) / 2) * s, ((p0[1] + a[1]) / 2) * s); }
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2; ctx.quadraticCurveTo(a[0] * s, a[1] * s, (i === pts.length - 1 ? b[0] : mx) * s, (i === pts.length - 1 ? b[1] : my) * s); ctx.stroke();
  }
  ctx.restore();
}
async function drawPage(ctx, p, s, opt = {}) {
  const w = ctx.canvas.width, h = ctx.canvas.height; drawPaper(ctx, p.paper, s, w, h);
  for (const im of p.images || []) { const img = await getImg(im.src); if (img) ctx.drawImage(img, im.x * s, im.y * s, im.w * s, im.h * s); }
  const ordered = [...p.strokes.filter(x => x.tool === 'hl'), ...p.strokes.filter(x => x.tool !== 'hl')];
  for (const st of ordered) drawStroke(ctx, st, s);
}
async function drawCrop(cv, p, card, hide) {
  const top = Math.max(0, card.y - 130), bottom = Math.min(PH, card.y + card.h + 90);
  const cw = cv.parentElement.clientWidth, dpr = Math.min(2, devicePixelRatio || 1); const s = cw / PW;
  cv.width = cw * dpr; cv.height = (bottom - top) * s * dpr; cv.style.height = (bottom - top) * s + 'px';
  const off = document.createElement('canvas'); off.width = PW * s * dpr; off.height = PH * s * dpr; await drawPage(off.getContext('2d'), p, s * dpr);
  const ctx = cv.getContext('2d'); ctx.drawImage(off, 0, top * s * dpr, off.width, (bottom - top) * s * dpr, 0, 0, cv.width, cv.height);
  const k = s * dpr, x = (card.x - 6) * k, y = (card.y - top - 6) * k, w = (card.w + 12) * k, h = (card.h + 12) * k;
  ctx.save(); if (hide) { ctx.fillStyle = '#F0DF96'; rr(ctx, x, y, w, h, 10 * dpr); ctx.fill(); } else { ctx.strokeStyle = 'rgba(23,22,20,.35)'; ctx.setLineDash([8 * dpr, 6 * dpr]); ctx.lineWidth = 2 * dpr; rr(ctx, x, y, w, h, 10 * dpr); ctx.stroke(); } ctx.restore();
}
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
const bboxOf = pts => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; } return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; };
const pathLen = pts => { let l = 0; for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return l; };

/* ---------- editor ---------- */
class Editor {
  constructor(root, pageId) {
    this.root = root; this.pageId = pageId; this.tool = 'pen'; this.color = '#171614'; this.size = 'm'; this.testing = false;
    this.undo = []; this.redo = []; this.scrollY = 0; this.touches = new Map(); this.revealed = {};
    this.build(); this.load();
    this.onResize = () => this.layout(); addEventListener('resize', this.onResize);
  }
  get nb() { return nbById(this.page?.notebookId || M.pages.find(p => p.id === this.pageId)?.notebookId); }
  build() {
    this.root.innerHTML = `<div class="ed">
      <div class="ed-top">
        <button class="row g6" data-ed="back">${I('back')}<span class="s16 b5" id="ed-nb"></span></button>
        <div class="grow col" style="align-items:center"><div class="s16 b6" id="ed-title"></div><div class="s13 sec" id="ed-sub"></div></div>
        <button class="icon-btn" data-ed="prev">${I('back', '#6F6B64')}</button><button class="icon-btn" data-ed="next">${I('next', '#6F6B64')}</button>
        <button class="btn sm muted" data-ed="test" id="ed-test">Test myself</button><button class="btn sm muted" data-ed="quiz">Quiz</button>
      </div>
      <div class="ed-tools" id="ed-tools"></div>
      <div class="ed-scroll" id="ed-scroll"><div class="ed-inner" id="ed-inner"><div class="page" id="ed-page"><canvas id="cv-base"></canvas><canvas id="cv-live"></canvas><div id="ed-over" style="position:absolute;inset:0"></div></div>
        <div class="next-page"><button class="btn muted" data-ed="newpage">${I('plus')} Next page</button></div></div></div>
      <input type="file" accept="image/*" id="ed-file" hidden></div>`;
    this.scroller = $('#ed-scroll'); this.inner = $('#ed-inner'); this.pageEl = $('#ed-page'); this.base = $('#cv-base'); this.live = $('#cv-live'); this.over = $('#ed-over');
    this.root.addEventListener('click', this.onClick = e => this.click(e));
    $('#ed-file').addEventListener('change', e => this.addImage(e.target.files[0]));
    const pe = this.pageEl;
    pe.addEventListener('pointerdown', e => this.down(e)); pe.addEventListener('pointermove', e => this.move(e)); pe.addEventListener('pointerup', e => this.up(e)); pe.addEventListener('pointercancel', e => this.up(e));
    this.scroller.addEventListener('pointerdown', e => { if (e.target === this.scroller || e.target === this.inner) this.down(e); });
    this.scroller.addEventListener('pointermove', e => { if (e.target === this.scroller || e.target === this.inner) this.move(e); });
    this.scroller.addEventListener('pointerup', e => { if (e.target === this.scroller || e.target === this.inner) this.up(e); });
    this.scroller.addEventListener('wheel', e => { e.preventDefault(); this.scrollBy(e.deltaY); }, { passive: false });
    this.preventGesture = e => e.preventDefault(); document.addEventListener('gesturestart', this.preventGesture);
  }
  async load() {
    this.page = await loadPage(this.pageId); if (!this.page) return go('home');
    this.revealed = {}; this.testing = false; this.sel = null; this.undo = []; this.redo = []; this.scrollY = 0;
    this.renderTools(); this.layout();
    if (!this.page.strokes.length && !(this.page.images || []).length && !M.profile.tipShown) { M.profile.tipShown = true; saveMeta(); toast('Write with Apple Pencil · two-finger tap to undo · underline or circle to make a question'); }
  }
  destroy() { removeEventListener('resize', this.onResize); this.root.removeEventListener('click', this.onClick); document.removeEventListener('gesturestart', this.preventGesture); if (this.page) savePageNow(this.page); }
  renderTools() {
    const nb = this.nb, ps = pagesOf(nb.id), idx = ps.findIndex(p => p.id === this.pageId);
    $('#ed-nb').textContent = nb.name; $('#ed-title').textContent = `Page ${idx + 1} of ${ps.length}`;
    $('#ed-sub').textContent = `${fmtDate(this.page.createdAt)} · ${cardsOfPage(this.pageId).length} Q`;
    $('#ed-test').className = 'btn sm ' + (this.testing ? 'ink' : 'muted'); $('#ed-test').textContent = this.testing ? 'Done' : 'Test myself';
    $('[data-ed="prev"]').style.opacity = idx > 0 ? 1 : .3; $('[data-ed="next"]').style.opacity = idx < ps.length - 1 ? 1 : .3;
    const t = (k, ic, title) => `<button class="icon-btn ${this.tool === k ? 'on' : ''}" data-tool="${k}" title="${title}">${I(ic)}</button>`;
    $('#ed-tools').innerHTML = `
      <div class="tool-group">${t('pen', 'pen', 'Pen')}${t('hl', 'hl', 'Highlighter')}${t('eraser', 'eraser', 'Eraser')}${t('move', 'move', 'Move pictures')}${t('q', 'q', 'Q — drag a box to make a question')}</div>
      <div class="tool-group">${['#171614', '#3B63C4', '#C2410C', '#15803D'].map(c => `<button class="sw ${this.color === c ? 'on' : ''}" data-color="${c}"><i style="background:${c}"></i></button>`).join('')}</div>
      <div class="seg">${['s', 'm', 'l'].map(z => `<button class="${this.size === z ? 'on' : ''}" data-size="${z}">${z.toUpperCase()}</button>`).join('')}</div>
      <div class="seg">${PAPERS.map(p => `<button class="${this.page.paper === p ? 'on' : ''}" data-paper="${p}">${p[0].toUpperCase() + p.slice(1)}</button>`).join('')}</div>
      <div class="tool-group"><button class="icon-btn" data-ed="photo" title="Insert photo">${I('photo')}</button>${this.sel ? `<button class="icon-btn" data-ed="delimg" title="Delete picture">${I('trash')}</button>` : ''}<button class="icon-btn" data-ed="undo" title="Undo">${I('undo')}</button><button class="icon-btn" data-ed="redo" title="Redo">${I('redo')}</button></div>`;
  }
  layout() {
    const avail = this.scroller.clientWidth - 2 * parseFloat(getComputedStyle(this.inner).paddingLeft); const w = Math.min(avail, 1100);
    this.s = w / PW; const h = PH * this.s; this.pageEl.style.width = w + 'px'; this.pageEl.style.height = h + 'px';
    this.dpr = Math.min(2.5, devicePixelRatio || 1); for (const c of [this.base, this.live]) { c.width = Math.round(w * this.dpr); c.height = Math.round(h * this.dpr); }
    this.redraw(); this.scrollBy(0);
  }
  async redraw() { if (!this.page) return; const ctx = this.base.getContext('2d'); await drawPage(ctx, this.page, this.s * this.dpr); this.renderOverlay(); }
  renderOverlay() {
    const cs = cardsOfPage(this.pageId), s = this.s;
    let html = cs.map(c => this.testing ? (this.revealed[c.id] ? `<div class="qcover revealed" style="left:${(c.x - 6) * s}px;top:${(c.y - 6) * s}px;width:${(c.w + 12) * s}px;height:${(c.h + 12) * s}px;pointer-events:none"></div>` : `<button class="qcover" data-reveal-card="${c.id}" style="left:${(c.x - 6) * s}px;top:${(c.y - 6) * s}px;width:${(c.w + 12) * s}px;height:${(c.h + 12) * s}px">Tap to reveal</button>`)
      : `<button class="qb" data-card="${c.id}" style="left:${(PW - 26) * s}px;top:${(c.y + c.h / 2) * s - 14}px">Q</button>`).join('');
    if (this.asking) { const c = cs.find(x => x.id === this.asking); if (c) { const left = Math.min((c.x + c.w + 16) * s, this.pageEl.clientWidth - 240), top = Math.max(0, (c.y - 10) * s); html += `<div class="ask" style="left:${left}px;top:${top}px"><div class="s15 b7">Did you remember it?</div><div class="row g8"><button class="btn muted sm" data-tm="0">Not yet</button><button class="btn ink sm" data-tm="1">Knew it</button></div><div class="s12 sec">“Not yet” brings it back soon.</div></div>`; } }
    if (this.sel) { const im = this.page.images.find(i => i.id === this.sel); if (im) html += `<div class="img-sel" style="left:${im.x * s}px;top:${im.y * s}px;width:${im.w * s}px;height:${im.h * s}px"><i></i></div>`; }
    if (this.box) { const b = this.box; html += `<div class="sel-box" style="left:${Math.min(b.x0, b.x1) * s}px;top:${Math.min(b.y0, b.y1) * s}px;width:${Math.abs(b.x1 - b.x0) * s}px;height:${Math.abs(b.y1 - b.y0) * s}px"></div>`; }
    this.over.innerHTML = html;
    if (this.testing && !cs.length) this.over.innerHTML += `<div class="ask" style="left:50%;top:40px;transform:translateX(-50%)"><div class="s15 b7">Nothing to test on this page</div><div class="s13 sec">Underline or circle something first.</div></div>`;
  }
  scrollBy(dy) { const max = Math.max(0, this.inner.scrollHeight - this.scroller.clientHeight); this.scrollY = Math.min(max, Math.max(0, this.scrollY + dy)); this.inner.style.transform = `translateY(${-this.scrollY}px)`; }
  pt(e) { const r = this.pageEl.getBoundingClientRect(); return [(e.clientX - r.left) / this.s, (e.clientY - r.top) / this.s, e.pointerType === 'pen' ? (e.pressure || .5) : .5]; }
  isDrawPointer(e) { return e.pointerType === 'pen' || e.pointerType === 'mouse' || (e.pointerType === 'touch' && M.profile.fingerDraw); }
  down(e) {
    if (e.target.closest('button,.ask')) return;
    if (e.pointerType === 'touch' && !M.profile.fingerDraw) { // fingers: scroll + two-finger tap undo
      this.touches.set(e.pointerId, { y: e.clientY, x: e.clientX, t: Date.now(), moved: 0 });
      if (this.touches.size === 2) this.twoStart = Date.now(); e.preventDefault(); return;
    }
    if (!this.isDrawPointer(e) || this.testing) return;
    if (this.penActive && this.penActive !== e.pointerId) return;
    e.preventDefault(); try { this.pageEl.setPointerCapture(e.pointerId); } catch { } this.penActive = e.pointerId;
    const p = this.pt(e); const tool = (e.buttons & 32) ? 'eraser' : this.tool;
    this.curTool = tool;
    if (tool === 'pen' || tool === 'hl') { const size = tool === 'hl' ? { s: 18, m: 26, l: 36 }[this.size] : { s: 2.2, m: 3.2, l: 5 }[this.size]; this.cur = { tool, color: tool === 'hl' ? '#F0DF96' : this.color, size, points: [p] }; }
    if (tool === 'eraser') { this.erased = []; this.eraseAt(p); }
    if (tool === 'q') this.box = { x0: p[0], y0: p[1], x1: p[0], y1: p[1] };
    if (tool === 'move') { const im = [...(this.page.images || [])].reverse().find(i => p[0] >= i.x && p[0] <= i.x + i.w && p[1] >= i.y && p[1] <= i.y + i.h); this.sel = im?.id || null; if (im) { const resize = p[0] > im.x + im.w - 40 && p[1] > im.y + im.h - 40; this.drag = { im, p, ox: im.x, oy: im.y, ow: im.w, oh: im.h, resize }; } this.renderTools(); this.renderOverlay(); }
  }
  move(e) {
    if (e.pointerType === 'touch' && !M.profile.fingerDraw) { const t = this.touches.get(e.pointerId); if (!t) return; const dy = e.clientY - t.y; t.moved += Math.abs(dy) + Math.abs(e.clientX - t.x); t.y = e.clientY; t.x = e.clientX; if (this.touches.size === 1) this.scrollBy(-dy); return; }
    if (e.pointerId !== this.penActive) return; e.preventDefault();
    let evs = e.getCoalescedEvents ? e.getCoalescedEvents() : []; if (!evs.length) evs = [e]; const tool = this.curTool;
    if (this.cur) { for (const ev of evs) this.cur.points.push(this.pt(ev)); this.drawLive(); }
    if (tool === 'eraser') for (const ev of evs) this.eraseAt(this.pt(ev));
    if (tool === 'q' && this.box) { const p = this.pt(e); this.box.x1 = p[0]; this.box.y1 = p[1]; this.renderOverlay(); }
    if (tool === 'move' && this.drag) { const p = this.pt(e), d = this.drag, dx = p[0] - d.p[0], dy = p[1] - d.p[1]; if (d.resize) { const r = d.oh / d.ow; d.im.w = Math.max(60, d.ow + dx); d.im.h = d.im.w * r; } else { d.im.x = d.ox + dx; d.im.y = d.oy + dy; } this.redraw(); }
  }
  up(e) {
    if (e.pointerType === 'touch' && !M.profile.fingerDraw) {
      const t = this.touches.get(e.pointerId); if (this.twoStart && Date.now() - this.twoStart < 300 && t && t.moved < 20 && this.touches.size === 2) { this.twoStart = 0; this.doUndo(); toast('Undo'); }
      this.touches.delete(e.pointerId); if (!this.touches.size) this.twoStart = 0; return;
    }
    if (e.pointerId !== this.penActive) return; this.penActive = null; const tool = this.curTool;
    if (this.cur) { const st = this.cur; this.cur = null; this.live.getContext('2d').clearRect(0, 0, this.live.width, this.live.height); if (st.points.length > 1 || st.tool === 'pen') { this.page.strokes.push(st); this.pushUndo({ type: 'add', stroke: st }); if (st.tool === 'pen') this.detectMark(st); this.redraw(); savePage(this.page); } }
    if (tool === 'eraser' && this.erased?.length) { this.pushUndo({ type: 'erase', strokes: this.erased }); this.erased = null; savePage(this.page); }
    if (tool === 'q' && this.box) { const b = this.box; this.box = null; const x = Math.min(b.x0, b.x1), y = Math.min(b.y0, b.y1), w = Math.abs(b.x1 - b.x0), h = Math.abs(b.y1 - b.y0); if (w > 20 && h > 14) this.addCard({ x, y, w, h }, 'box'); else this.renderOverlay(); }
    if (tool === 'move' && this.drag) { this.drag = null; savePage(this.page); this.renderOverlay(); }
  }
  drawLive() { const ctx = this.live.getContext('2d'); ctx.clearRect(0, 0, this.live.width, this.live.height); drawStroke(ctx, this.cur, this.s * this.dpr); }
  eraseAt(p) { const r = 14; const before = this.page.strokes.length; const keep = []; for (const st of this.page.strokes) { if (st.points.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < r + st.size / 2)) this.erased.push(st); else keep.push(st); } if (keep.length !== before) { this.page.strokes = keep; this.redraw(); } }
  pushUndo(a) { this.undo.push(a); if (this.undo.length > 100) this.undo.shift(); this.redo = []; }
  doUndo() { const a = this.undo.pop(); if (!a) return; if (a.type === 'add') { this.page.strokes = this.page.strokes.filter(s => s !== a.stroke); if (a.card) M.cards = M.cards.filter(c => c.id !== a.card); } if (a.type === 'erase') this.page.strokes.push(...a.strokes); if (a.type === 'card') M.cards = M.cards.filter(c => c.id !== a.card.id); this.redo.push(a); saveMeta(); savePage(this.page); this.redraw(); this.renderTools(); }
  doRedo() { const a = this.redo.pop(); if (!a) return; if (a.type === 'add') { this.page.strokes.push(a.stroke); if (a.cardObj) M.cards.push(a.cardObj); } if (a.type === 'erase') this.page.strokes = this.page.strokes.filter(s => !a.strokes.includes(s)); if (a.type === 'card') M.cards.push(a.card); this.undo.push(a); saveMeta(); savePage(this.page); this.redraw(); this.renderTools(); }
  detectMark(st) {
    const pr = M.profile, pts = st.points; if (pts.length < 4) return; const b = bboxOf(pts), len = pathLen(pts);
    const others = this.page.strokes.filter(x => x !== st && x.tool === 'pen').map(x => ({ x, b: bboxOf(x.points) }));
    // underline: long, flat, fairly straight, with ink right above it
    if (pr.underlineQuiz && b.w >= 110 && b.h <= Math.max(18, b.w * 0.08) && Math.hypot(pts[pts.length - 1][0] - pts[0][0], pts[pts.length - 1][1] - pts[0][1]) > 0.8 * len) {
      const lineY = b.y + b.h / 2;
      const above = others.filter(o => { const ov = Math.min(o.b.x + o.b.w, b.x + b.w + 15) - Math.max(o.b.x, b.x - 15); const bottom = o.b.y + o.b.h; return ov > Math.min(o.b.w, 40) * 0.5 && bottom <= lineY + 8 && bottom >= lineY - 70 && o.b.h < 120; });
      if (above.length) {
        const u = above.reduce((a, o) => ({ x0: Math.min(a.x0, o.b.x), y0: Math.min(a.y0, o.b.y), x1: Math.max(a.x1, o.b.x + o.b.w), y1: Math.max(a.y1, o.b.y + o.b.h) }), { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 });
        const rect = { x: u.x0, y: u.y0, w: u.x1 - u.x0, h: lineY - u.y0 + 4 };
        if (!this.overlapsCard(rect)) return this.addCard(rect, 'line', st);
        return;
      }
    }
    // circle: closed loop around something
    const gap = Math.hypot(pts[pts.length - 1][0] - pts[0][0], pts[pts.length - 1][1] - pts[0][1]);
    if (pr.circleQuiz && b.w >= 40 && b.h >= 26 && gap < 0.3 * Math.max(b.w, b.h) && len > 2.4 * Math.max(b.w, b.h)) {
      const inside = others.filter(o => o.b.x >= b.x - 6 && o.b.y >= b.y - 6 && o.b.x + o.b.w <= b.x + b.w + 6 && o.b.y + o.b.h <= b.y + b.h + 6);
      if (inside.length) { const rect = { x: b.x + 4, y: b.y + 4, w: b.w - 8, h: b.h - 8 }; if (!this.overlapsCard(rect)) this.addCard(rect, 'circle', st); }
    }
  }
  overlapsCard(r) { return cardsOfPage(this.pageId).some(c => { const ix = Math.min(c.x + c.w, r.x + r.w) - Math.max(c.x, r.x), iy = Math.min(c.y + c.h, r.y + r.h) - Math.max(c.y, r.y); return ix > 0 && iy > 0 && ix * iy > 0.5 * Math.min(c.w * c.h, r.w * r.h); }); }
  addCard(rect, kind, stroke) {
    const c = { id: uid(), pageId: this.pageId, notebookId: this.page.notebookId, ...rect, kind, due: startOfDay(), interval: 0, reps: 0, lapses: 0, createdAt: Date.now() };
    M.cards.push(c); saveMeta();
    if (stroke) { const a = this.undo[this.undo.length - 1]; if (a && a.stroke === stroke) { a.card = c.id; a.cardObj = c; } } else this.pushUndo({ type: 'card', card: c });
    this.renderTools(); this.renderOverlay(); toast(kind === 'line' ? 'Underlined line added to your quiz' : kind === 'circle' ? 'Circled part added to your quiz' : 'Added to your quiz');
  }
  async addImage(file) {
    if (!file) return; const url = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(file); });
    const img = await getImg(url); if (!img) return; const max = 1400, k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = img.width * k; c.height = img.height * k; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); const src = c.toDataURL('image/jpeg', .85);
    const w = 520, h = w * c.height / c.width; const y = Math.min(PH - h - 20, this.scrollY / this.s + 60);
    this.page.images = this.page.images || []; const im = { id: uid(), src, x: (PW - w) / 2, y, w, h }; this.page.images.push(im);
    this.tool = 'move'; this.sel = im.id; savePage(this.page); this.renderTools(); this.redraw(); toast('Picture added — drag to move, corner to resize'); $('#ed-file').value = '';
  }
  async click(e) {
    const b = e.target.closest('[data-ed],[data-tool],[data-color],[data-size],[data-paper],[data-card],[data-reveal-card],[data-tm]'); if (!b) return; const d = b.dataset;
    if (d.tool) { this.tool = d.tool; if (d.tool !== 'move') this.sel = null; this.renderTools(); this.renderOverlay(); return; }
    if (d.color) { this.color = d.color; if (this.tool !== 'pen') this.tool = 'pen'; return this.renderTools(); }
    if (d.size) { this.size = d.size; return this.renderTools(); }
    if (d.paper) { this.page.paper = d.paper; const nb = this.nb; nb.paper = d.paper; saveMeta(); savePage(this.page); this.renderTools(); return this.redraw(); }
    if (d.card) { if (confirm('Take this out of the quiz?')) { M.cards = M.cards.filter(c => c.id !== d.card); saveMeta(); this.renderTools(); this.renderOverlay(); toast('Taken out of the quiz'); } return; }
    if (d.revealCard) { this.revealed[d.revealCard] = true; this.asking = d.revealCard; return this.renderOverlay(); }
    if (d.tm !== undefined) { const c = M.cards.find(x => x.id === this.asking); if (c) schedule(c, +d.tm); this.asking = null; return this.renderOverlay(); }
    const a = d.ed, ps = pagesOf(this.nb.id), idx = ps.findIndex(p => p.id === this.pageId);
    if (a === 'back') { savePageNow(this.page); return go('notebook', { nbId: this.nb.id }); }
    if (a === 'undo') return this.doUndo(); if (a === 'redo') return this.doRedo();
    if (a === 'photo') return $('#ed-file').click();
    if (a === 'delimg') { this.page.images = this.page.images.filter(i => i.id !== this.sel); this.sel = null; savePage(this.page); this.renderTools(); return this.redraw(); }
    if (a === 'test') { if (!this.testing && !M.profile.tmIntro) { ui.sheet = 'tmintro'; return renderSheet(); } this.testing = !this.testing; this.revealed = {}; this.asking = null; this.renderTools(); return this.renderOverlay(); }
    if (a === 'quiz') { await savePageNow(this.page); ui.nbId = this.nb.id; return startQuiz('page', { pageId: this.pageId }); }
    if (a === 'prev' && idx > 0) return this.switchTo(ps[idx - 1].id);
    if (a === 'next' && idx < ps.length - 1) return this.switchTo(ps[idx + 1].id);
    if (a === 'newpage') { await savePageNow(this.page); return this.switchTo(newPage(this.nb.id)); }
  }
  async switchTo(id) { await savePageNow(this.page); this.pageId = id; ui.pageId = id; await this.load(); }
  startTesting() { this.testing = true; this.revealed = {}; this.asking = null; this.renderTools(); this.renderOverlay(); }
}

/* ===== sheets ===== */
SHEETS.newnb = () => `<div class="dim" data-dim><div class="sheet col g16">
  <div class="row"><span class="serif h2 grow">New notebook</span><button class="icon-btn" data-close>${I('close', '#6F6B64')}</button></div>
  <div class="col g8"><span class="label">Subject</span><input class="field" id="nb-name" placeholder="e.g. Mathematics"></div>
  <div class="col g8"><span class="label">Colour</span><div class="row g12" id="nb-colors">${COLORS.map((c, i) => `<button data-pick-color="${c}" style="padding:4px;border-radius:50%;${i === M.notebooks.length % 5 ? 'box-shadow:0 0 0 2px #171614' : ''}"><span class="c-${c}" style="display:block;width:34px;height:34px;border-radius:50%"></span></button>`).join('')}</div></div>
  <div class="col g8"><span class="label">Paper</span><div class="seg" id="nb-paper" style="align-self:flex-start">${PAPERS.map((p, i) => `<button class="${i === 0 ? 'on' : ''}" data-pick-paper="${p}">${p[0].toUpperCase() + p.slice(1)}</button>`).join('')}</div><span class="s13 sec" id="nb-hint">You can switch any time in the toolbar.</span></div>
  <button class="btn ink" data-create-nb>Create notebook</button></div></div>`;
mountSheet.newnb = () => {
  const st = { color: COLORS[M.notebooks.length % 5], paper: 'lines', touched: false }; const name = $('#nb-name'); setTimeout(() => name.focus(), 60);
  const paint = () => { $$('[data-pick-color]').forEach(b => b.style.boxShadow = b.dataset.pickColor === st.color ? '0 0 0 2px #171614' : ''); $$('[data-pick-paper]').forEach(b => b.classList.toggle('on', b.dataset.pickPaper === st.paper)); };
  name.addEventListener('input', () => { if (!st.touched) { st.paper = suggestPaper(name.value); paint(); $('#nb-hint').textContent = st.paper === 'grid' ? `Grid suggested for ${name.value} — switch any time.` : 'You can switch any time in the toolbar.'; } });
  $('.sheet').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.pickColor) { st.color = b.dataset.pickColor; paint(); } if (b.dataset.pickPaper) { st.paper = b.dataset.pickPaper; st.touched = true; paint(); }
    if (b.dataset.createNb !== undefined) { const n = name.value.trim(); if (!n) { name.focus(); return; } const nb = { id: uid(), name: n, color: st.color, paper: st.paper, createdAt: Date.now(), exam: '' }; M.notebooks.push(nb); saveMeta(); ui.sheet = null; toast(`${n} created`); go('notebook', { nbId: nb.id }); } });
};
SHEETS.addclass = (edit) => {
  const c = ui.editClass ? M.classes.find(x => x.id === ui.editClass) : null; const nbs = M.notebooks;
  if (!nbs.length) return `<div class="dim" data-dim><div class="sheet col g14"><div class="serif h2">Add a notebook first</div><div class="s16 sec">Classes open a notebook — make one for this subject first.</div><button class="btn ink" data-close data-then="newnb">New notebook</button></div></div>`;
  return `<div class="dim" data-dim><div class="sheet col g16">
  <div class="row"><span class="serif h2 grow">${c ? 'Edit class' : 'Add class'}</span><button class="icon-btn" data-close>${I('close', '#6F6B64')}</button></div>
  <div class="col g8"><span class="label">Notebook</span><select class="field" id="cl-nb">${nbs.map(n => `<option value="${n.id}" ${c?.notebookId === n.id ? 'selected' : ''}>${esc(n.name)}</option>`).join('')}</select></div>
  <div class="col g8"><span class="label">Day</span><div class="row g6 wrap" id="cl-day">${DAYS.map((d, i) => `<button class="pill" data-day="${i}" style="padding:9px 13px;font-size:14px;background:${(c ? c.day : weekdayIdx()) === i ? 'var(--ink)' : 'var(--canvas)'};color:${(c ? c.day : weekdayIdx()) === i ? '#fff' : 'inherit'}">${d}</button>`).join('')}</div></div>
  <div class="row g12"><div class="col g8 grow"><span class="label">Starts</span><input type="time" class="field" id="cl-s" value="${c?.start || '10:00'}"></div><div class="col g8 grow"><span class="label">Ends</span><input type="time" class="field" id="cl-e" value="${c?.end || '11:30'}"></div></div>
  <div class="col g8"><span class="label">Room (optional)</span><input class="field" id="cl-r" value="${esc(c?.room || '')}" placeholder="e.g. Room 204"></div>
  <div class="s13 sec">Repeats every week.</div>
  <div class="row g12">${c ? '<button class="btn muted grow" data-del-class>Delete</button>' : ''}<button class="btn ink grow" data-save-class>${c ? 'Save' : 'Add to my week'}</button></div></div></div>`;
};
mountSheet.addclass = () => {
  const c = ui.editClass ? M.classes.find(x => x.id === ui.editClass) : null; let day = c ? c.day : weekdayIdx();
  $('.sheet').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.day !== undefined) { day = +b.dataset.day; $$('[data-day]').forEach(x => { const on = +x.dataset.day === day; x.style.background = on ? 'var(--ink)' : 'var(--canvas)'; x.style.color = on ? '#fff' : 'inherit'; }); }
    if (b.dataset.saveClass !== undefined) { const s = $('#cl-s').value, en = $('#cl-e').value; if (!s || !en || toMin(en) <= toMin(s)) return toast('End time should be after the start'); const data = { notebookId: $('#cl-nb').value, day, start: s, end: en, room: $('#cl-r').value.trim() }; if (c) Object.assign(c, data); else M.classes.push({ id: uid(), ...data }); saveMeta(); ui.sheet = null; ui.editClass = null; render(); toast(c ? 'Saved' : 'Added — repeats every week'); }
    if (b.dataset.delClass !== undefined) { M.classes = M.classes.filter(x => x.id !== c.id); saveMeta(); ui.sheet = null; ui.editClass = null; render(); }
  });
};
SHEETS.exam = () => { const nb = nbById(ui.nbId); return `<div class="dim" data-dim><div class="sheet col g16"><div class="row"><span class="serif h2 grow">Exam date</span><button class="icon-btn" data-close>${I('close', '#6F6B64')}</button></div><div class="s15 sec">We’ll show a countdown and bring questions back before it.</div><input type="date" class="field" id="ex-d" value="${nb.exam || ''}"><div class="row g12">${nb.exam ? '<button class="btn muted grow" data-exam-clear>Remove</button>' : ''}<button class="btn ink grow" data-exam-save>Save</button></div></div></div>`; };
mountSheet.exam = () => $('.sheet').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const nb = nbById(ui.nbId); if (b.dataset.examSave !== undefined) { nb.exam = $('#ex-d').value; saveMeta(); ui.sheet = null; render(); } if (b.dataset.examClear !== undefined) { nb.exam = ''; saveMeta(); ui.sheet = null; render(); } });
SHEETS.quiz = () => { const ps = pagesOf(ui.nbId).filter(p => p.dateKey === dayKey()).map(p => p.id); const today = M.cards.filter(c => ps.includes(c.pageId)).length, all = M.cards.filter(c => c.notebookId === ui.nbId).length;
  return `<div class="dim" data-dim><div class="sheet col g12"><div class="row"><div class="grow"><div class="serif h2">Quiz on…</div><div class="s15 sec">${esc(nbById(ui.nbId).name)}</div></div><button class="icon-btn" data-close>${I('close', '#6F6B64')}</button></div>
  <button class="option" style="background:var(--canvas)" data-q-today ${today ? '' : 'disabled'}><span class="grow">Today’s pages<span class="sub">${today} question${today === 1 ? '' : 's'}</span></span></button>
  <button class="option" style="background:var(--canvas)" data-q-all><span class="grow">Whole notebook<span class="sub">${all} question${all === 1 ? '' : 's'} · up to 10, most forgotten first</span></span></button></div></div>`; };
mountSheet.quiz = () => $('.sheet').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.qToday !== undefined) startQuiz('nb', { today: true }); if (b.dataset.qAll !== undefined) startQuiz('nb', { count: 10 }); });
SHEETS.nbsettings = () => { const nb = nbById(ui.nbId); return `<div class="dim" data-dim><div class="sheet col g16"><div class="row"><span class="serif h2 grow">Notebook</span><button class="icon-btn" data-close>${I('close', '#6F6B64')}</button></div>
  <div class="col g8"><span class="label">Name</span><input class="field" id="ns-name" value="${esc(nb.name)}"></div>
  <div class="col g8"><span class="label">Colour</span><div class="row g12">${COLORS.map(c => `<button data-ns-color="${c}" style="padding:4px;border-radius:50%;${nb.color === c ? 'box-shadow:0 0 0 2px #171614' : ''}"><span class="c-${c}" style="display:block;width:34px;height:34px;border-radius:50%"></span></button>`).join('')}</div></div>
  <div class="row g12"><button class="btn muted grow" data-ns-del>Delete notebook</button><button class="btn ink grow" data-ns-save>Save</button></div></div></div>`; };
mountSheet.nbsettings = () => { const nb = nbById(ui.nbId); let color = nb.color; $('.sheet').addEventListener('click', async e => { const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.nsColor) { color = b.dataset.nsColor; $$('[data-ns-color]').forEach(x => x.style.boxShadow = x.dataset.nsColor === color ? '0 0 0 2px #171614' : ''); }
  if (b.dataset.nsSave !== undefined) { nb.name = $('#ns-name').value.trim() || nb.name; nb.color = color; saveMeta(); ui.sheet = null; render(); }
  if (b.dataset.nsDel !== undefined && confirm(`Delete “${nb.name}” and all its pages? This can’t be undone.`)) { for (const p of pagesOf(nb.id)) { await DB.del('page:' + p.id); pageCache.delete(p.id); } M.pages = M.pages.filter(p => p.notebookId !== nb.id); M.cards = M.cards.filter(c => c.notebookId !== nb.id); M.classes = M.classes.filter(c => c.notebookId !== nb.id); M.notebooks = M.notebooks.filter(n => n.id !== nb.id); saveMeta(); go('home'); } }); };
SHEETS.tmintro = () => `<div class="dim" data-dim><div class="sheet col g16" style="width:min(520px,100%)">
  <div class="row g12">${[['Your Q part', '<span style="font-family:var(--hand);font-size:22px;background:rgba(240,223,150,.75);border-radius:6px;padding:0 6px">(c)′ = 0</span>'], ['Hidden', '<span style="display:block;width:90px;height:30px;border-radius:8px;background:var(--yellow)"></span>'], ['Recalled?', '<span class="row g6"><span class="pill" style="background:var(--muted);font-size:11px;padding:4px 8px">Not yet</span><span class="pill" style="background:var(--ink);color:#fff;font-size:11px;padding:4px 8px">Knew it</span></span>']].map(([c, v]) => `<div class="grow col g8" style="background:var(--canvas);border-radius:18px;padding:12px;align-items:center"><div style="height:40px;display:flex;align-items:center">${v}</div><div class="s13 b6 sec">${c}</div></div>`).join('')}</div>
  <div class="serif h2">Test myself</div><div class="s16 sec" style="line-height:1.45">We hide everything with a Q on this page. Try to recall it, then tap to check. Whatever you don’t remember comes back in a few days.</div>
  <div class="row"><span class="grow"></span><button class="btn ink" data-tm-start>Start</button></div></div></div>`;
mountSheet.tmintro = () => $('[data-tm-start]').addEventListener('click', () => { M.profile.tmIntro = true; saveMeta(); ui.sheet = null; renderSheet(); editor?.startTesting(); });

/* ===== global events ===== */
document.addEventListener('click', async e => {
  const b = e.target.closest('button,[data-dim]'); if (!b) return; const d = b.dataset;
  if (d.dim !== undefined && e.target === b) { ui.sheet = null; ui.editClass = null; return renderSheet(); }
  if (d.close !== undefined) { ui.sheet = d.then || null; ui.editClass = null; return renderSheet(); }
  if (b.closest('.ed') && !b.closest('.dim')) return; // editor handles its own
  if (d.obNext !== undefined) {
    const pr = M.profile; if (ui.ob === 1) pr.name = ($('#f-name')?.value || '').trim(); if (ui.ob === 2) pr.study = ($('#f-study')?.value || '').trim();
    if (ui.ob >= 4) { pr.onboarded = true; saveMeta(); return go('home'); } saveMeta(); return setUI({ ob: ui.ob + 1 });
  }
  if (d.obBack !== undefined) return setUI({ ob: Math.max(0, ui.ob - 1) });
  if (d.daily) { M.profile.daily = +d.daily; saveMeta(); return render(); }
  if (d.go) return go(d.go);
  if (d.sheet) { ui.sheet = d.sheet; return renderSheet(); }
  if (d.openNb) return go('notebook', { nbId: d.openNb });
  if (d.openToday) return go('editor', { pageId: todaysPage(d.openToday), nbId: d.openToday });
  if (d.newPage) return go('editor', { pageId: newPage(d.newPage), nbId: d.newPage });
  if (d.openPage) return go('editor', { pageId: d.openPage });
  if (d.editClass) { ui.editClass = d.editClass; ui.sheet = 'addclass'; return renderSheet(); }
  if (d.start) { if (d.start === 'nbdue') return startQuiz('nbdue'); return startQuiz('due'); }
  if (d.reveal !== undefined) { quiz.revealed = true; return render(); }
  if (d.grade !== undefined) { const c = M.cards.find(x => x.id === quiz.list[quiz.i]); schedule(c, +d.grade); quiz.results.push(+d.grade); if (quiz.i + 1 < quiz.list.length) { quiz.i++; quiz.revealed = false; return render(); } return go('results'); }
  if (d.quizEnd !== undefined) { return quiz.results.length ? go('results') : go(quiz.back); }
  if (d.hideInstall !== undefined) { M.profile.installHidden = true; saveMeta(); return render(); }
  if (d.toggle) { M.profile[d.toggle] = !M.profile[d.toggle]; saveMeta(); return render(); }
  if (d.export !== undefined) return exportData();
  if (d.reset !== undefined) { if (confirm('Delete all notebooks and pages on this iPad? Export a backup first if you might need them.')) { await DB.clear(); pageCache.clear(); M = freshMeta(); await DB.set('meta', M); ui.ob = 0; go('ob'); } return; }
});
document.addEventListener('change', async e => {
  if (e.target.dataset.pf) { M.profile[e.target.dataset.pf] = e.target.value.trim(); saveMeta(); }
  if (e.target.hasAttribute('data-import')) { const f = e.target.files[0]; if (!f) return; try { const data = JSON.parse(await f.text()); if (!data.meta || !data.pages) throw 0; if (!confirm('Replace everything on this iPad with this backup?')) return; await DB.clear(); pageCache.clear(); M = data.meta; await DB.set('meta', M); for (const p of data.pages) await DB.set('page:' + p.id, p); toast('Backup restored'); go('home'); } catch { toast('That file isn’t a TakeNotes backup'); } }
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && ui.screen === 'ob' && (ui.ob === 1 || ui.ob === 2)) $('[data-ob-next]')?.click(); if ((e.metaKey || e.ctrlKey) && e.key === 'z' && editor) { e.preventDefault(); e.shiftKey ? editor.doRedo() : editor.doUndo(); } });
async function exportData() {
  const pages = []; for (const p of M.pages) { const full = await loadPage(p.id); if (full) pages.push(full); }
  const blob = new Blob([JSON.stringify({ app: 'TakeNotes', exportedAt: new Date().toISOString(), meta: M, pages })], { type: 'application/json' });
  const file = new File([blob], `TakeNotes-backup-${dayKey()}.json`, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: 'TakeNotes backup' }); return; } catch { } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
document.addEventListener('visibilitychange', () => { if (document.hidden) { DB.set('meta', M); if (editor?.page) savePageNow(editor.page); } else if (['home', 'notebook'].includes(ui.screen)) render(); });
document.addEventListener('dblclick', e => e.preventDefault(), { passive: false });

/* ===== boot ===== */
(async function boot() {
  try { await DB.open(); const m = await DB.get('meta'); if (m) M = Object.assign(freshMeta(), m, { profile: Object.assign(freshMeta().profile, m.profile) }); } catch (err) { console.error(err); }
  navigator.storage?.persist?.();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => { });
  ui.screen = M.profile.onboarded ? 'home' : 'ob'; render();
  setInterval(() => { if (ui.screen === 'home' && !ui.sheet) render(); }, 60000);
})();
