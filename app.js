/**
 * app.js (kundli) — the public Kundli page. Anyone signs in with their own
 * Google account, keeps their own and their family's kundlis, and chats with
 * CosmicMath. Self-contained (own fetch wrapper, own GIS init), same reasoning
 * as frontend/form/. The server scopes every call to the verified email, so
 * nothing here can reach another person's data.
 */
const API_URL = 'https://jxybttdluexpbwsjzney.supabase.co/functions/v1/api';
const GOOGLE_CLIENT_ID = '741282599231-qcp7doaqr32vd44eue2lrp6utijpa3s2.apps.googleusercontent.com';
const TOKEN_KEY = 'ssa_kundli_idtoken';
const app = document.getElementById('app');

const ABBR = { Sun: 'Su', Moon: 'Mo', Mars: 'Ma', Mercury: 'Me', Jupiter: 'Ju', Venus: 'Ve', Saturn: 'Sa', Rahu: 'Ra', Ketu: 'Ke' };
const SIGNS = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];
const SOUTH_GRID = [[11, 0, 1, 2], [10, null, null, 3], [9, null, null, 4], [8, 7, 6, 5]];

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const fmtBirth = (k) => `${fmtDate(k.birthDate + 'T12:00:00')} · ${k.birthTime}`;

// ---------------------------------------------------------------- auth

function jwtPayload(t) { try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return null; } }
function getToken() {
  try {
    const t = sessionStorage.getItem(TOKEN_KEY);
    const p = t && jwtPayload(t);
    if (p && p.exp * 1000 > Date.now() + 30000) return t;
    sessionStorage.removeItem(TOKEN_KEY);
  } catch { /* storage blocked: the user simply signs in again */ }
  return '';
}
function setToken(t) { try { sessionStorage.setItem(TOKEN_KEY, t); } catch { memoryToken = t; } }
let memoryToken = '';
// After one Google sign-in the device is handed a long-lived session (90 days, sliding) that is sent instead of
// the Google token, which expires in about an hour; so a device that has signed in once stays signed in.
const SESSION_KEY = 'ssa_kundli_session';
function getSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (s && s.token && new Date(s.expiresAt).getTime() > Date.now() + 60000) return s.token;
    localStorage.removeItem(SESSION_KEY);
  } catch { /* storage blocked: the person signs in again next visit */ }
  return '';
}
// Who is signed in, for the avatar on the Sign out button. The picture only comes with a fresh Google sign-in, so it is kept on the device.
const PROFILE_KEY = 'ssa_kundli_profile';
function getProfile() { try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null') || {}; } catch { return {}; } }
const setProfile = (p) => { try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch { /* ignore */ } };
const clearProfile = () => { try { localStorage.removeItem(PROFILE_KEY); } catch { /* ignore */ } };
const setSession = (token, expiresAt) => { try { localStorage.setItem(SESSION_KEY, JSON.stringify({ token, expiresAt })); } catch { /* ignore */ } };
const clearSession = () => { try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } };
function deviceLabelGuess() {
  const ua = navigator.userAgent || '';
  const os = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Device';
  return `${/CriOS|Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'Browser'} on ${os}`;
}
const currentToken = () => getToken() || (memoryToken && (jwtPayload(memoryToken)?.exp * 1000 > Date.now() ? memoryToken : ''));

class AuthError extends Error {}
class AccessError extends Error {}

async function call(action, payload = {}) {
  const sessionToken = getSession();
  const kundliIdToken = sessionToken ? '' : currentToken();
  if (!sessionToken && !kundliIdToken) throw new AuthError('Please sign in with Google');
  const res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, payload, ...(sessionToken ? { kundliSessionToken: sessionToken } : { kundliIdToken }) }) });
  let parsed;
  try { parsed = await res.json(); } catch { throw new Error('Unexpected response from server'); }
  if (!parsed.ok) {
    if (parsed.error?.code === 'AUTH_INVALID_TOKEN') { clearSession(); try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } memoryToken = ''; throw new AuthError(parsed.error.message); }
    if (parsed.error?.code === 'ACCESS_DISABLED') throw new AccessError(parsed.error.message);
    throw new Error(parsed.error?.message || 'Something went wrong');
  }
  return parsed.data;
}

function showSignIn(message = '') {
  app.innerHTML = `<div class="wrap"><div class="panel"><div class="signin">
    <h1>Cosmic Math</h1>
    <p class="muted">Enter your birth details and ask CosmicMath anything. Sign in with your Google account to keep your own kundli, and your family&rsquo;s. Only you can see what you save. You only need to sign in once on this device.</p>
    ${message ? `<p class="error">${esc(message)}</p>` : ''}
    <div id="gbtn"></div>
  </div></div></div>`;
  const init = () => {
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: async (r) => {
        // A fresh Google sign-in replaces any remembered session on this device, or the old account's session would answer the next call.
        clearSession();
        setToken(r.credential);
        const gp = jwtPayload(r.credential);
        if (gp) setProfile({ name: gp.name || '', email: String(gp.email || '').toLowerCase(), picture: gp.picture || '' });
        // Trade the Google token for a long-lived device session; if that fails this visit simply keeps using Google's.
        // The first call after a quiet spell can fail while the server wakes up; call() drops the token on that failure, so it is put back for a second try instead of bouncing a good sign-in to this screen.
        for (let attempt = 0; attempt < 2; attempt++) {
          try { const out = await call('kundliPublic_remember', { deviceLabel: deviceLabelGuess() }); setSession(out.sessionToken, out.expiresAt); break; } catch { setToken(r.credential); }
        }
        renderList();
      },
    });
    window.google.accounts.id.renderButton(document.getElementById('gbtn'), { type: 'standard', theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with' });
  };
  if (window.google?.accounts?.id) init();
  else { const t = setInterval(() => { if (window.google?.accounts?.id) { clearInterval(t); init(); } }, 100); }
}

function showBlocked(message) {
  app.innerHTML = `<div class="wrap"><div class="panel"><div class="signin">
    <h1>Cosmic Math</h1><p class="error">${esc(message)}</p>
    <button class="btn-secondary" id="blockedOut">Sign out</button></div></div></div>`;
  document.getElementById('blockedOut').addEventListener('click', signOut);
}

async function signOut() {
  const session = getSession();
  if (session) { try { await call('kundliPublic_logout', { sessionToken: session }); } catch { /* the device is signed out here either way */ } }
  clearSession();
  clearProfile();
  try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  memoryToken = '';
  window.google?.accounts?.id?.disableAutoSelect();
  showSignIn();
}

// Any call may find the sign-in expired (Google tokens last about an hour).
async function guarded(fn) {
  try { return await fn(); } catch (err) {
    if (err instanceof AuthError) { showSignIn('Your sign-in expired. Please sign in again.'); return undefined; }
    if (err instanceof AccessError) { showBlocked(err.message); return undefined; }
    throw err;
  }
}

// ---------------------------------------------------------------- list

const initialOf = (w) => (String(w.name || w.email || '?').trim()[0] || '?').toUpperCase();
function avatarHtml(w) {
  return w.picture
    ? `<img class="avatar" src="${esc(w.picture)}" alt="" width="24" height="24" referrerpolicy="no-referrer" />`
    : `<span class="avatar avatar--initial" aria-hidden="true">${esc(initialOf(w))}</span>`;
}

async function renderList() {
  peopleCache = null;
  if (!getSession() && !currentToken()) return showSignIn();
  app.innerHTML = `<div class="wrap"><p class="muted">Loading&hellip;</p></div>`;
  let data;
  try { data = await guarded(() => call('kundliPublic_list')); } catch (err) { app.innerHTML = `<div class="wrap"><p class="error">${esc(err.message)}</p></div>`; return; }
  if (!data) return;
  const items = data.items;
  const prof = getProfile();
  const me = data.me || {};
  const who = { email: me.email || prof.email || '', name: me.name || prof.name || '', picture: prof.email && me.email && prof.email !== me.email ? '' : (prof.picture || '') };
  app.innerHTML = `<div class="wrap">
    <div class="top"><h1>Cosmic Math</h1><button class="btn-secondary btn-small signout" id="signOut" title="${esc(who.email ? `Signed in as ${who.email}` : 'Sign out')}">${avatarHtml(who)}Sign out</button></div>
    <p class="muted">Add yourself and your family members, then ask CosmicMath about any of them.</p>
    <div class="actions" style="margin-top:8px;"><button class="btn-primary" id="addBtn">+ Add a person</button></div>
    ${items.length ? `<div class="tiles">${items.map((k) => `<div class="tile" role="button" tabindex="0" data-open="${esc(k.kundliId)}"><b>${esc(k.name)}</b><span class="muted">Born ${esc(fmtBirth(k))}<br>${esc(k.place || '')}<br>${k.questionCount} question${k.questionCount === 1 ? '' : 's'}</span></div>`).join('')}</div>`
      : `<div class="panel"><p class="muted">No one added yet. Tap &ldquo;Add a person&rdquo; to begin.</p></div>`}
    ${footerHtml()}
  </div>`;
  document.getElementById('signOut').addEventListener('click', signOut);
  // A picture that fails to load (blocked, expired link) falls back to the letter.
  document.querySelector('#signOut img.avatar')?.addEventListener('error', (e) => { e.target.replaceWith(Object.assign(document.createElement('span'), { className: 'avatar avatar--initial', textContent: initialOf(who) })); });
  onLangChange = null;
  wireFooter();
  document.getElementById('addBtn').addEventListener('click', () => openModal(null, renderList));
  app.querySelectorAll('[data-open]').forEach((el) => {
    const go = () => renderDetail(el.dataset.open);
    el.addEventListener('click', go);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  });
}

// ---------------------------------------------------------------- person + chat

async function renderDetail(kundliId) {
  app.innerHTML = `<div class="wrap"><p class="muted">Calculating chart&hellip;</p></div>`;
  let data;
  try { data = await guarded(() => call('kundliPublic_get', { kundliId })); } catch (err) { app.innerHTML = `<div class="wrap"><p class="error">${esc(err.message)}</p><button class="btn-secondary" id="back">Back</button></div>`; document.getElementById('back').addEventListener('click', renderList); return; }
  if (!data) return;
  const { kundli: k, chart, history } = data;
  let hist = [...history];
  onLangChange = null;

  app.innerHTML = `<div class="wrap">
    <button class="btn-link" id="back">&larr; Everyone</button>
    <div class="top"><h1>${esc(k.name)}</h1>
      <div style="display:flex;gap:8px;"><button class="btn-secondary btn-small" id="edit">Edit</button><button class="btn-danger btn-small" id="del">Delete</button></div></div>
    <p class="muted">Born ${esc(fmtBirth(k))} &middot; ${esc(k.place || '')}</p>

    <div class="panel chat" id="chat">
      <div class="top"><h2 style="margin:0;">Ask CosmicMath</h2><div class="tools"><button class="btn-secondary btn-small" id="langTop">Language</button><button class="btn-secondary btn-small" id="clear" ${hist.length ? '' : 'hidden'}>Clear chat</button><button class="btn-secondary btn-small" id="full" aria-pressed="false">Full<span class="lg"> screen</span></button></div></div>
      <div class="thread" id="thread" aria-live="polite">${hist.length ? [...hist].reverse().map(answerHtml).join('') : hintHtml()}</div>
      <p class="muted" id="langStatus" hidden></p>
      <p class="error" id="askErr" hidden></p>
      <form class="composer" id="askForm">
        <textarea id="q" rows="1" placeholder="Ask anything, e.g. Will I get a promotion this year?"></textarea>
        <div class="send-col">
          <label class="combine-tick" title="Combine family members&rsquo; kundlis for this question"><input type="checkbox" id="combineTick" /> Combine family</label>
          <button class="btn-primary" id="send" type="submit">Send</button>
        </div>
      </form>
    </div>

    <div class="panel"><details><summary>Birth chart</summary>${southChartHtml(chart)}<div class="table-scroll">${planetTableHtml(chart)}</div></details></div>
    ${footerHtml()}
  </div>`;
  wireFooter();
  document.getElementById('langTop').addEventListener('click', openLanguage);

  document.getElementById('back').addEventListener('click', renderList);
  document.getElementById('edit').addEventListener('click', () => openModal(k, () => renderDetail(k.kundliId)));
  document.getElementById('del').addEventListener('click', async (e) => {
    if (!window.confirm(`Delete ${k.name} and the saved chat? This cannot be undone.`)) return;
    e.target.disabled = true;
    try { await guarded(() => call('kundliPublic_delete', { kundliId: k.kundliId })); renderList(); } catch (err) { alert(err.message); e.target.disabled = false; }
  });

  const thread = document.getElementById('thread');
  const clearBtn = document.getElementById('clear');
  const qBox = document.getElementById('q');
  const sendBtn = document.getElementById('send');
  const toBottom = () => { thread.scrollTop = thread.scrollHeight; };
  const syncBar = () => {
    const has = !!thread.querySelector('.ans');
    clearBtn.hidden = !has;
    if (!has && !thread.querySelector('.hint')) thread.innerHTML = hintHtml();
  };
  // Answers are written by CosmicMath in the chosen language, so only the headings of a non-English answer need fetching (cached server-side per language).
  const needLabels = () => [...new Set(hist.map((x) => x.lang).filter((c) => c && c !== 'en' && !labelCache.has(c)))];
  const fetchLabels = async (codes) => {
    const status = document.getElementById('langStatus');
    if (status) { status.textContent = 'Preparing\u2026'; status.hidden = false; }
    try {
      for (const c of codes) {
        const out = await guarded(() => call('kundliPublic_labels', { language: c }));
        if (out) labelCache.set(c, out.labels);
      }
    } catch (err) {
      const errEl = document.getElementById('askErr');
      if (errEl) { errEl.textContent = err.message; errEl.hidden = false; }
    } finally { if (status) status.hidden = true; }
  };
  const refreshLanguage = async () => {
    const codes = needLabels();
    if (codes.length) await fetchLabels(codes);
    thread.innerHTML = hist.length ? [...hist].reverse().map(answerHtml).join('') : hintHtml();
    clearBtn.hidden = !hist.length;
    toBottom();
  };
  // Picking a language only affects new questions; fetch its headings now so the next answer shows at once.
  onLangChange = () => { if (lang && lang !== 'en' && !labelCache.has(lang)) fetchLabels([lang]); };
  if (needLabels().length) refreshLanguage(); else toBottom();
  // CSS-driven full screen (the browser Fullscreen API is not available on iPhones).
  const chat = document.getElementById('chat');
  const fullBtn = document.getElementById('full');
  const setFull = (on) => {
    chat.classList.toggle('full', on);
    document.body.classList.toggle('locked', on);
    fullBtn.innerHTML = on ? 'Exit<span class="lg"> full screen</span>' : 'Full<span class="lg"> screen</span>';
    fullBtn.setAttribute('aria-pressed', String(on));
    toBottom();
  };
  // Opening a person starts in full screen; leaving it is remembered on this device until the person goes full screen again.
  const FULL_KEY = 'ssa_kundli_chatfull';
  const choose = (on) => { setFull(on); try { localStorage.setItem(FULL_KEY, on ? '1' : '0'); } catch { /* ignore */ } };
  fullBtn.addEventListener('click', () => choose(!chat.classList.contains('full')));
  const onEsc = (e) => {
    if (!chat.isConnected) { document.removeEventListener('keydown', onEsc); document.body.classList.remove('locked'); return; }
    if (e.key === 'Escape' && chat.classList.contains('full')) choose(false);
  };
  let startFull = true;
  try { startFull = localStorage.getItem(FULL_KEY) !== '0'; } catch { /* default to full screen */ }
  if (startFull) setFull(true);
  document.addEventListener('keydown', onEsc);
  thread.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-del]');
    if (!btn || !window.confirm('Delete this question and its answer?')) return;
    btn.disabled = true;
    try { await guarded(() => call('kundliPublic_deleteAnswers', { kundliId: k.kundliId, askedAt: btn.dataset.del })); btn.closest('.ans').remove(); hist = hist.filter((x) => x.askedAt !== btn.dataset.del); syncBar(); } catch (err) { alert(err.message); btn.disabled = false; }
  });
  clearBtn.addEventListener('click', async () => {
    if (!window.confirm('Delete the whole chat for this person? This cannot be undone.')) return;
    clearBtn.disabled = true;
    try { await guarded(() => call('kundliPublic_deleteAnswers', { kundliId: k.kundliId, all: true })); thread.innerHTML = ''; hist = []; syncBar(); } catch (err) { alert(err.message); }
    clearBtn.disabled = false;
  });
  const grow = () => { qBox.style.height = 'auto'; qBox.style.height = `${Math.min(qBox.scrollHeight, 140)}px`; };
  qBox.addEventListener('input', grow);
  qBox.addEventListener('keydown', (e) => {
    // Touch keyboards keep Enter as a new line; the Send button sends.
    if (e.key === 'Enter' && !e.shiftKey && !window.matchMedia('(pointer: coarse)').matches) { e.preventDefault(); document.getElementById('askForm').requestSubmit(); }
  });
  const combineTick = document.getElementById('combineTick');
  // Picker bubble: tick whose kundlis to read together, or answer for this person alone.
  const showPicker = (question, people) => {
    const box = document.createElement('div');
    box.className = 'msg msg--pandit picker';
    box.innerHTML = people.length > 1
      ? `<p>Whose kundlis should I read together for this?</p>
      ${people.map((p) => `<label class="pick"><input type="checkbox" value="${esc(p.kundliId)}" ${p.kundliId === k.kundliId ? 'checked' : ''} /> ${esc(p.name)}</label>`).join('')}
      <p class="error" hidden></p>
      <div class="actions"><button type="button" class="btn-primary btn-small" data-go>Combine and answer</button><button type="button" class="btn-secondary btn-small" data-solo>Just ${esc(k.name)}</button></div>`
      : `<p>For a family reading I need the other family members&rsquo; kundlis. Go back to Everyone, add them with Add a person, then ask again.</p>
      <div class="actions"><button type="button" class="btn-secondary btn-small" data-solo>Answer for ${esc(k.name)} only</button></div>`;
    thread.appendChild(box);
    toBottom();
    const run = async (ids) => {
      box.querySelectorAll('button, input').forEach((n) => { n.disabled = true; });
      box.innerHTML = '<p class="muted">CosmicMath is studying the charts&hellip;</p>';
      try {
        const out = await guarded(() => call('kundliPublic_ask', { kundliId: k.kundliId, question, kundliIds: ids, language: lang || undefined }));
        thread.querySelectorAll('.pending, .picker').forEach((n) => n.remove());
        if (!out) return;
        hist.unshift(out.entry);
        await refreshLanguage();
      } catch (err) {
        thread.querySelectorAll('.pending, .picker').forEach((n) => n.remove());
        qBox.value = question; grow();
        const errEl = document.getElementById('askErr');
        errEl.textContent = err.message; errEl.hidden = false;
        syncBar();
      } finally { sendBtn.disabled = false; toBottom(); }
    };
    box.querySelector('[data-solo]').addEventListener('click', () => run(undefined));
    box.querySelector('[data-go]')?.addEventListener('click', () => {
      const ids = [...box.querySelectorAll('input:checked')].map((i) => i.value);
      if (ids.length < 2) { const e = box.querySelector('.error'); e.textContent = 'Tick at least two people.'; e.hidden = false; return; }
      run(ids);
    });
  };
  document.getElementById('askForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const question = qBox.value.trim();
    const errEl = document.getElementById('askErr');
    errEl.hidden = true;
    if (!question || sendBtn.disabled) return;
    sendBtn.disabled = true;
    thread.querySelector('.hint')?.remove();
    thread.insertAdjacentHTML('beforeend', `<div class="msg msg--me pending"><p>${esc(question)}</p></div><div class="msg msg--pandit typing"><p class="muted">CosmicMath is studying the chart&hellip;</p></div>`);
    qBox.value = ''; grow(); toBottom();
    const dropPending = () => thread.querySelectorAll('.pending, .typing').forEach((n) => n.remove());
    try {
      if (combineTick.checked || COMBINE_RE.test(question)) {
        const people = await guarded(loadPeople);
        if (people) {
          thread.querySelector('.typing')?.remove();
          showPicker(question, people);
          return;
        }
      }
      const out = await guarded(() => call('kundliPublic_ask', { kundliId: k.kundliId, question, language: lang || undefined }));
      dropPending();
      if (!out) return;
      hist.unshift(out.entry);
      await refreshLanguage();
    } catch (err) {
      dropPending();
      qBox.value = question; grow();
      errEl.textContent = err.message; errEl.hidden = false;
      syncBar();
    } finally {
      combineTick.checked = false;
      // The picker keeps the send button locked until a choice is made.
      if (!thread.querySelector('.picker')) sendBtn.disabled = false;
      toBottom();
    }
  });
}

// A question about the family as a whole offers a picker of whose kundlis to read
// together; the server only ever sees the ids the person ticked.
const COMBINE_RE = /\b(family|families|household|together|combined?|joint(ly)?|all of us|each of us|everyone|me and my|my (wife|husband|spouse|partner|parents|mother|father|children|kids|son|daughter|brother|sister)s?\s+(and|&)|all (of )?(my|the) (family|members))\b/i;
let peopleCache = null;
async function loadPeople() {
  if (!peopleCache) peopleCache = (await call('kundliPublic_list')).items.map((p) => ({ kundliId: p.kundliId, name: p.name }));
  return peopleCache;
}

// ---------------------------------------------------------------- reading language
// '' means automatic: CosmicMath answers in the language the question is written in.
const LANGS = [['hi', 'हिन्दी'], ['gu', 'ગુજરાતી'], ['mr', 'मराठी'], ['bn', 'বাংলা'], ['ta', 'தமிழ்'], ['te', 'తెలుగు'], ['kn', 'ಕನ್ನಡ'], ['ml', 'മലയാളം'], ['pa', 'ਪੰਜਾਬੀ'], ['ur', 'اردو'], ['en', 'English']];
const L_EN = {
  why: 'Why', period: 'Current period', started: 'Started', changes: 'Changes', bestTimings: 'Favourable window', highestChances: 'The highest chances for this matter are from {from} to {to}.', goodChances: 'There are also good chances from {from} to {to}.',
  approxNote: 'Approximate windows. They depend on the exact birth time and are not a guarantee.', remedy: 'Remedy',
};
let lang = (() => { try { return localStorage.getItem('kundliLang') || ''; } catch { return ''; } })();
const setLang = (c) => { lang = c; try { if (c) localStorage.setItem('kundliLang', c); else localStorage.removeItem('kundliLang'); } catch { /* ignore */ } };
const langName = (c) => (LANGS.find((l) => l[0] === c) || [c, c])[1];
const labelCache = new Map();
let onLangChange = null;

const hintHtml = () => '<p class="hint muted">Ask your first question below. You can follow up on any answer, CosmicMath remembers this conversation.</p>';

// Best timings sit in their own section, never merged into Period, and carry a caution so they are not read as a promise.
function bestTimingsHtml(bt, L = L_EN, loc = '', next = '') {
  const wins = bt && Array.isArray(bt.windows) ? bt.windows : [];
  if (!wins.length && !next) return '';
  const mon = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(`${loc || 'en'}-IN`, { month: 'short', year: 'numeric', timeZone: 'UTC' });
  // KP supports the topic: dated sentences for the window(s). Otherwise the AI's line on the next favourable stretch.
  const sentence = (w) => {
    const key = w.strength === 'highest' ? 'highestChances' : 'goodChances';
    const tpl = L[key] && L[key].includes('{from}') && L[key].includes('{to}') ? L[key] : L_EN[key];
    return tpl.replace('{from}', mon(w.from)).replace('{to}', mon(w.to));
  };
  return `<h4 class="h--main">${esc(L.bestTimings)}</h4>${wins.length ? `${wins.map((w) => `<p>${esc(sentence(w))}</p>`).join('')}<p class="bt-note">${esc(L.approxNote)}</p>` : `<p>${esc(next)}</p>`}`;
}

function answerHtml(e) {
  const L = (e.lang && labelCache.get(e.lang)) || L_EN;
  const a = e.answer || {};
  return `<div class="ans" style="display:flex;flex-direction:column;gap:8px;">
    <div class="msg msg--me"><p>${esc(e.question)}</p>${e.combinedWith?.length ? `<p class="basis" style="color:#d6e8e6;">Combined: ${esc(e.combinedWith.join(', '))}</p>` : ''}</div>
    <div class="msg msg--pandit"><h4 class="h--main">${esc(L.why)}</h4><p>${esc(a.answer || a.conclusion || '')}</p>${a.basis ? `<p class="basis">${esc(a.basis)}</p>` : ''}${Array.isArray(a.perPerson) && a.perPerson.length ? `<ul class="perperson">${a.perPerson.map((p) => `<li><b>${esc(p.name)}:</b> ${esc(p.note)}</li>`).join('')}</ul>` : ''}${a.started || a.timing ? `<h4 class="h--main">${esc(L.period)}</h4>${a.started ? `<p class="pline"><b>${esc(L.started)}:</b> ${esc(a.started)}</p>` : ''}${a.timing ? `<p class="pline"><b>${esc(L.changes)}:</b> ${esc(a.timing)}</p>` : ''}` : ''}${bestTimingsHtml(a.bestTimings, L, e.lang, a.next)}${a.remedy ? `<h4 class="h--main">${esc(L.remedy)}</h4><p>${esc(a.remedy)}</p>` : ''}
      <button type="button" class="btn-link del" data-del="${esc(e.askedAt)}">Delete</button></div>
  </div>`;
}

function southChartHtml(chart) {
  const inSign = Array.from({ length: 12 }, () => []);
  chart.planets.forEach((p) => inSign[p.signIndex].push(`${ABBR[p.name]}${p.retrograde && p.name !== 'Rahu' && p.name !== 'Ketu' ? '℞' : ''}`));
  const lagna = chart.lagna.signIndex;
  const cell = (s) => `<div class="cell ${s === lagna ? 'lagna' : ''}"><small>${SIGNS[s].slice(0, 3)}${s === lagna ? ' · Asc' : ''}</small>${inSign[s].join(' ')}</div>`;
  const cells = SOUTH_GRID.flat().filter((s) => s !== null).map(cell).join('');
  return `<div class="chart">${cells}<div class="center">Rashi<br>${esc(chart.input.name || '')}</div></div>`;
}

function planetTableHtml(chart) {
  return `<table><thead><tr><th>Planet</th><th>Sign</th><th>House</th><th>Nakshatra</th></tr></thead><tbody>${chart.planets.map((p) => `<tr><td>${p.name}</td><td>${p.sign}</td><td>${p.house}</td><td>${p.nakshatra} ${p.nakshatraPada}</td></tr>`).join('')}</tbody></table>`;
}

// ---------------------------------------------------------------- add / edit

// ---------------------------------------------------------------- footer: feedback and language
function footerHtml() {
  return `<div class="footer-actions"><button type="button" class="btn-secondary" id="fbBtn">Feedback or complaint</button><button type="button" class="btn-secondary" id="langBtn">Answer in your language${lang ? ` (${esc(langName(lang))})` : ''}</button></div>`;
}
function wireFooter() {
  document.getElementById('fbBtn')?.addEventListener('click', openFeedback);
  document.getElementById('langBtn')?.addEventListener('click', openLanguage);
}
function overlayPanel(html) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto;z-index:30;';
  overlay.innerHTML = `<div class="panel" style="max-width:480px;width:100%;margin-top:24px;">${html}</div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  return overlay;
}
function openFeedback() {
  const o = overlayPanel(`<h2>Tell us</h2>
    <form id="fb">
      <label>What is this about?<select name="kind"><option value="feedback">Feedback</option><option value="complaint">Complaint</option><option value="feature">Feature request</option></select></label>
      <label>Your message<textarea name="message" rows="5" maxlength="2000" required placeholder="Write in any language"></textarea></label>
      <p class="error" id="fbErr" hidden></p>
      <p class="muted" id="fbOk" hidden>Thank you. Your message has reached us.</p>
      <div class="actions"><button type="button" class="btn-secondary" id="fbCancel">Close</button><button type="submit" class="btn-primary">Send</button></div>
    </form>`);
  o.querySelector('#fbCancel').addEventListener('click', () => o.remove());
  o.querySelector('#fb').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const err = o.querySelector('#fbErr');
    err.hidden = true;
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const out = await guarded(() => call('kundliPublic_feedback', { kind: fd.get('kind'), message: fd.get('message') }));
      if (!out) { o.remove(); return; }
      e.target.querySelector('textarea').value = '';
      o.querySelector('#fbOk').hidden = false;
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    btn.disabled = false;
  });
}
function openLanguage() {
  const o = overlayPanel(`<h2>Answer in your language</h2>
    <p class="muted">CosmicMath answers your new questions in the language you pick. With no choice, it answers in the language you write the question in.</p>
    <div class="actions" style="flex-wrap:wrap;">
      <button type="button" class="btn-secondary btn-small" data-lang="">${lang ? '' : '&#10003; '}Same as my question</button>
      ${LANGS.map(([c, n]) => `<button type="button" class="btn-secondary btn-small" data-lang="${c}">${lang === c ? '&#10003; ' : ''}${esc(n)}</button>`).join('')}
    </div>
    <div class="actions"><button type="button" class="btn-secondary" id="langCancel">Close</button></div>`);
  o.querySelector('#langCancel').addEventListener('click', () => o.remove());
  o.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => {
    setLang(b.dataset.lang);
    o.remove();
    const lb = document.getElementById('langBtn');
    if (lb) lb.textContent = `Answer in your language${lang ? ` (${langName(lang)})` : ''}`;
    onLangChange?.();
  }));
}

function openModal(k, done) {
  const isEdit = !!k;
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto;z-index:30;';
  overlay.innerHTML = `<div class="panel" style="max-width:480px;width:100%;margin-top:24px;">
    <h2>${isEdit ? 'Edit' : 'Add a'} person</h2>
    <form id="f">
      <label>Name <input type="text" name="name" required value="${esc(k?.name || '')}" /></label>
      <div class="row">
        <label>Date of birth <input type="date" name="birthDate" required value="${esc(k?.birthDate?.slice(0, 10) || '')}" /></label>
        <label>Time of birth <input type="time" name="birthTime" required value="${esc(k?.birthTime || '')}" /></label>
      </div>
      <label>Place of birth <input type="text" name="place" required placeholder="e.g. Jaipur, Rajasthan" value="${esc(k?.place || '')}" /></label>
      <p class="muted">The exact birth time matters: the ascendant changes about every two hours.</p>
      <label>Gender (optional)<select name="gender">${['', 'Male', 'Female', 'Other'].map((g) => `<option value="${g}" ${k?.gender === g ? 'selected' : ''}>${g || 'Prefer not to say'}</option>`).join('')}</select></label>
      <p class="error" id="ferr" hidden></p>
      <div class="actions"><button type="button" class="btn-secondary" id="cancel">Cancel</button><button type="submit" class="btn-primary">${isEdit ? 'Save changes' : 'Create'}</button></div>
    </form></div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('#cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const errEl = overlay.querySelector('#ferr');
    errEl.hidden = true;
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Finding place…';
    try {
      // Coordinates and time zone are worked out server-side from the place.
      const out = await guarded(() => call('kundliPublic_save', { kundliId: k?.kundliId, name: fd.get('name'), gender: fd.get('gender'), birthDate: fd.get('birthDate'), birthTime: fd.get('birthTime'), place: fd.get('place') }));
      if (!out) { close(); return; }
      close();
      if (isEdit) done(); else renderDetail(out.kundliId);
    } catch (err) {
      errEl.textContent = err.message; errEl.hidden = false;
      btn.disabled = false; btn.textContent = isEdit ? 'Save changes' : 'Create';
    }
  });
}

if (getSession() || currentToken()) renderList(); else showSignIn();

// ---------------------------------------------------------------- add to home screen
// Phones are asked on every visit until the page is running as an installed app. Chrome and Edge offer a real
// install button; iPhone Safari and other browsers have no such API, so they get the manual steps instead.
let installEvent = null;
function installBanner() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (standalone || !window.matchMedia('(max-width: 600px)').matches) return;
  try { if (sessionStorage.getItem('kundliInstallDismissed')) return; } catch { /* ask again */ }
  let bar = document.getElementById('installBar');
  if (!bar) { bar = document.createElement('div'); bar.id = 'installBar'; bar.className = 'installbar'; app.before(bar); }
  const ua = navigator.userAgent || '';
  const ios = /iPhone|iPad|iPod/.test(ua);
  const how = installEvent ? '' : ios
    ? '<span class="muted">Tap the Share button, then <b>Add to Home Screen</b>.</span>'
    : '<span class="muted">Open the browser menu, then choose <b>Add to Home screen</b>.</span>';
  bar.innerHTML = `<div class="installbar-text"><b>Add Cosmic Math to your home screen</b>${how ? `<br>${how}` : ''}</div>${installEvent ? '<button type="button" class="btn-primary btn-small" id="installGo">Add</button>' : ''}<button type="button" class="installbar-x" id="installX" aria-label="Not now">&times;</button>`;
  document.getElementById('installX').addEventListener('click', () => { try { sessionStorage.setItem('kundliInstallDismissed', '1'); } catch { /* ignore */ } bar.remove(); });
  document.getElementById('installGo')?.addEventListener('click', async () => {
    const ev = installEvent; installEvent = null; bar.remove();
    try { await ev.prompt(); } catch { /* the browser declined to show it */ }
  });
}
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; installBanner(); });
window.addEventListener('appinstalled', () => document.getElementById('installBar')?.remove());
installBanner();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { /* installing still works from the browser menu */ });
