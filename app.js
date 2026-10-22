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
const fmtBirth = (k) => `${fmtDate(k.birthDate + 'T12:00:00')} · ${k.timeUnknown && k.rectification?.status !== 'applied' ? 'time not known' : `${k.birthTime}${k.timeUnknown ? ' (estimated)' : ''}`}`;

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

// What happens once Google has handed over a verified credential, whichever way it arrived (button pop-up or full-page return).
async function completeSignIn(credential) {
  // A fresh Google sign-in replaces any remembered session on this device, or the old account's session would answer the next call.
  clearSession();
  setToken(credential);
  const gp = jwtPayload(credential);
  if (gp) setProfile({ name: gp.name || '', email: String(gp.email || '').toLowerCase(), picture: gp.picture || '' });
  // Trade the Google token for a long-lived device session; if that fails this visit simply keeps using Google's.
  // The first call after a quiet spell can fail while the server wakes up; call() drops the token on that failure, so it is put back for a second try instead of bouncing a good sign-in to this screen.
  for (let attempt = 0; attempt < 2; attempt++) {
    try { const out = await call('kundliPublic_remember', { deviceLabel: deviceLabelGuess() }); setSession(out.sessionToken, out.expiresAt); break; } catch { setToken(credential); }
  }
  renderList();
}

// Full-page Google sign-in. The pop-up button cannot hand its result back inside an iPhone Home Screen app (the person is left on a blank
// page), so there Google is opened as an ordinary page and returns to this address with the signed ID token in the URL fragment.
// https://cosmicmath.in/ must be listed as an authorised redirect URI for the Google client.
const OAUTH_KEY = 'ssa_kundli_oauth';
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
function randomString() { return Array.from(crypto.getRandomValues(new Uint8Array(16))).map((b) => b.toString(16).padStart(2, '0')).join(''); }
function startFullPageSignIn() {
  const state = randomString(), nonce = randomString();
  try { localStorage.setItem(OAUTH_KEY, JSON.stringify({ state, nonce, at: Date.now() })); } catch { /* the return check then refuses, and the person sees the sign-in screen again */ }
  const q = new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, redirect_uri: `${location.origin}/`, response_type: 'id_token', scope: 'openid email profile', nonce, state, prompt: 'select_account' });
  location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${q}`);
}
// Returns true when this page load was Google handing a sign-in back.
function handleFullPageReturn() {
  if (!location.hash.includes('id_token=') && !location.hash.includes('error=')) return false;
  const params = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', location.pathname + location.search);
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(OAUTH_KEY) || 'null'); localStorage.removeItem(OAUTH_KEY); } catch { /* treated as no saved check */ }
  const token = params.get('id_token');
  const p = token && jwtPayload(token);
  const fresh = saved && Date.now() - saved.at < 15 * 60 * 1000;
  if (!token || !p || !fresh || params.get('state') !== saved.state || p.nonce !== saved.nonce || p.exp * 1000 < Date.now()) {
    showSignIn(params.get('error') ? 'Google sign-in was cancelled. Please try again.' : 'That sign-in could not be checked. Please try again.');
    return true;
  }
  completeSignIn(token);
  return true;
}

function showSignIn(message = '') {
  app.innerHTML = `<div class="wrap"><div class="panel"><div class="signin">
    <h1 class="sr-only">Cosmic Math</h1>
    <p class="muted s-intro">This App is made as per Global Privacy Regulations, Your Data is exclusively visible to you only.</p>
    <div class="s-act">
    ${message ? `<p class="error">${esc(message)}</p>` : ''}
    ${isStandalone() ? '<button type="button" class="btn-primary" id="gfull">Sign In</button>' : '<div id="gbtn"></div><p class="muted" id="gtrouble" hidden style="margin-top:12px;"><button type="button" class="btn-link" id="gfull">Trouble signing in? Use a full-page sign-in</button></p>'}
    </div>
    <div class="s-rest">
    <p class="muted">This is a prediction, not a guarantee.</p>
    <p class="tribute"><span class="tl">This APP is a humble tribute to our</span> <span class="tl">great Pandit Shree Viresh Jain, whose wisdom</span> <span class="tl">lights the way for all who seek the stars.</span></p>
    </div>
  </div></div></div>`;
  document.getElementById('gfull').addEventListener('click', startFullPageSignIn);
  if (isStandalone()) return;
  const init = () => {
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (r) => completeSignIn(r.credential),
    });
    window.google.accounts.id.renderButton(document.getElementById('gbtn'), { type: 'standard', theme: 'outline', size: 'large', shape: 'pill', text: 'signin' });
  };
  // The full-page fallback only matters when Google's button cannot load or render (in-app browsers, blockers), so it stays hidden otherwise.
  const showFallback = () => { const el = document.getElementById('gtrouble'); if (el) el.hidden = false; };
  const checkRendered = () => setTimeout(() => { if (!document.querySelector('#gbtn iframe, #gbtn div[role="button"]')) showFallback(); }, 2500);
  if (window.google?.accounts?.id) { init(); checkRendered(); }
  else {
    let waited = 0;
    const t = setInterval(() => {
      waited += 100;
      if (window.google?.accounts?.id) { clearInterval(t); init(); checkRendered(); }
      else if (waited >= 6000) { clearInterval(t); showFallback(); }
    }, 100);
  }
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
    ${k.timeUnknown ? `<div class="timebanner"><span>${k.rectification?.status === 'applied' ? `Birth time estimated at ${esc(k.birthTime)} from life events, so answers about houses are approximate.` : 'Birth time not known, so answers are approximate until you find it.'}</span><button type="button" class="btn-secondary btn-small" id="rectifyBtn">${k.rectification?.status === 'applied' ? 'Redo' : 'Find birth time'}</button></div>` : ''}

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

    <div class="panel" id="suitPanel">
      <h2 style="margin:0 0 6px;">Name, number &amp; company check</h2>
      <p class="muted">See whether a name, mobile number or company name suits ${esc(k.name)}, by numerology and the birth chart, with spelling corrections.</p>
      <form id="suitForm" class="suit-form">
        <select id="suitKind" aria-label="What to check"><option value="name">Name</option><option value="mobile">Mobile number</option><option value="company">Company name</option></select>
        <input id="suitVal" type="text" maxlength="80" placeholder="${SUIT_HINT.name}" aria-label="Name, number or company to check" />
        <button class="btn-primary" id="suitGo" type="submit">Check</button>
      </form>
      <p class="error" id="suitErr" hidden></p>
      <div class="suit-out msg msg--pandit" id="suitOut" hidden></div>
    </div>

    <div class="panel"><details><summary>Birth chart</summary>${southChartHtml(chart)}<div class="table-scroll">${planetTableHtml(chart)}</div></details></div>
    ${footerHtml()}
  </div>`;
  wireFooter();
  const suitKind = document.getElementById('suitKind');
  suitKind.addEventListener('change', () => { document.getElementById('suitVal').placeholder = SUIT_HINT[suitKind.value]; });
  document.getElementById('suitForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const val = document.getElementById('suitVal').value.trim();
    const err = document.getElementById('suitErr'), out = document.getElementById('suitOut'), go = document.getElementById('suitGo');
    err.hidden = true;
    if (!val) { err.textContent = 'Please type what to check.'; err.hidden = false; return; }
    go.disabled = true; go.textContent = 'Checking\u2026';
    try {
      const r = await guarded(() => call('kundliPublic_suitability', { kundliId: k.kundliId, kind: suitKind.value, value: val }));
      if (r) { out.innerHTML = suitabilityHtml(r); out.hidden = false; }
    } catch (ex) { err.textContent = ex.message; err.hidden = false; out.hidden = true; }
    go.disabled = false; go.textContent = 'Check';
  });
  document.getElementById('langTop').addEventListener('click', openLanguage);

  document.getElementById('back').addEventListener('click', renderList);
  document.getElementById('edit').addEventListener('click', () => openModal(k, () => renderDetail(k.kundliId)));
  document.getElementById('rectifyBtn')?.addEventListener('click', () => openRectify(k.kundliId));
  document.getElementById('del').addEventListener('click', async (e) => {
    if (!window.confirm(`Delete ${k.name} and the saved chat? This cannot be undone.`)) return;
    e.target.disabled = true;
    try { await guarded(() => call('kundliPublic_delete', { kundliId: k.kundliId })); renderList(); } catch (err) { alert(err.message); e.target.disabled = false; }
  });

  const thread = document.getElementById('thread');
  const clearBtn = document.getElementById('clear');
  const qBox = document.getElementById('q');
  const sendBtn = document.getElementById('send');
  // A fresh answer is brought to its top, so the person reads it from the start instead of scrolling back up from the bottom.
  let landOnAnswer = false;
  const toBottom = () => {
    const latest = landOnAnswer && [...thread.querySelectorAll('.ans')].pop();
    // scrollIntoView moves the chat box and the page together; on a phone the page itself had been left scrolled down at the composer.
    if (latest) { latest.scrollIntoView({ block: 'start' }); return; }
    thread.scrollTop = thread.scrollHeight;
  };
  const syncBar = () => {
    const has = !!thread.querySelector('.ans');
    clearBtn.hidden = !has;
    if (!has && !thread.querySelector('.hint')) { thread.innerHTML = hintHtml(); renderFollowUps(); }
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
    renderFollowUps();
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

  // Keeps the chat alive: after every answer (and on an empty chat) a teaser and three tappable next questions sit at the bottom of the thread.
  // Shown in the chat when the personal opening cannot be prepared, so a new person still has questions to tap.
  const FALLBACK = { curiosity: 'Not sure what to ask? Tap any question below, or type your own.', suggestions: ["Will I get a promotion this year?", "How will my business perform this year?", "How is my health expected to be?", "How will my married life be?", "When is a good time to change my job?", "Will I have financial gains this year?", "When will I get married?", "Is this a good time to buy a house or property?"].slice(0, 4) };
  let starter = null;
  const fuHtml = (curiosity, sugg) => `<div class="fu"><p>${esc(curiosity)}</p><div class="fu-chips">${sugg.map((t) => `<button type="button" class="fu-chip">${esc(t)}</button>`).join('')}</div></div>`;
  const renderFollowUps = async () => {
    thread.querySelectorAll('.fu').forEach((n) => n.remove());
    const a = hist[0] && hist[0].answer;
    let data = a && a.curiosity && Array.isArray(a.suggestions) && a.suggestions.length ? a : null;
    if (!hist.length) {
      if (!starter) { try { starter = await call('kundliPublic_starter', { kundliId: k.kundliId, language: lang || undefined }); } catch { starter = FALLBACK; } }
      data = starter;
    }
    if (!data || (!a && hist.length)) return;
    thread.querySelectorAll('.fu').forEach((n) => n.remove());
    thread.insertAdjacentHTML('beforeend', fuHtml(data.curiosity, data.suggestions));
    toBottom();
  };
  thread.addEventListener('click', (e) => {
    const chip = e.target.closest('.fu-chip');
    if (!chip) return;
    // The suggestion goes into the question box for the person to edit and send; it is not asked for them.
    qBox.value = chip.textContent; grow();
    qBox.focus(); qBox.setSelectionRange(qBox.value.length, qBox.value.length);
  });
  document.getElementById('askForm').addEventListener('submit', () => thread.querySelectorAll('.fu').forEach((n) => n.remove()));
  renderFollowUps();

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
        const place = (await askPlace(question)) || undefined;
        const out = await guarded(() => call('kundliPublic_ask', { kundliId: k.kundliId, question, kundliIds: ids, language: lang || undefined, place }));
        thread.querySelectorAll('.pending, .picker').forEach((n) => n.remove());
        if (!out) return;
        hist.unshift(out.entry); landOnAnswer = true;
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
    qBox.value = ''; grow(); landOnAnswer = false; toBottom();
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
      const place = (await askPlace(question)) || undefined;
      const out = await guarded(() => call('kundliPublic_ask', { kundliId: k.kundliId, question, language: lang || undefined, place }));
      dropPending();
      if (!out) return;
      hist.unshift(out.entry); landOnAnswer = true;
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
// Answers come in simple Indian English unless another language was picked on this device.
const LANGS = [['en', 'English'], ['hinglish', 'Hinglish'], ['hi', 'हिन्दी'], ['gu', 'ગુજરાતી'], ['mr', 'मराठी'], ['bn', 'বাংলা'], ['ta', 'தமிழ்'], ['te', 'తెలుగు'], ['kn', 'ಕನ್ನಡ'], ['ml', 'മലയാളം'], ['pa', 'ਪੰਜਾਬੀ'], ['ur', 'اردو']];
const L_EN = {
  why: 'Why', period: 'Current period', started: 'Started', changes: 'Changes', bestTimings: 'Favourable window', highestChances: 'The highest chances for this matter are from {from} to {to}.', goodChances: 'There are also good chances from {from} to {to}.',
  muhurtaBest: 'Best day and time', muhurtaAvoid: 'Avoid', muhurtaSkip: 'Days to skip', muhurtaToday: 'Times for the day', muhurtaPeriod: 'Your running period', muhurtaNone: 'No clean day found in these days. Ask for a longer stretch.', muhurtaNote: 'Times are for the place shown, accurate to a few minutes. Not a guarantee.', rahuKaal: 'Rahu Kaal', yamaganda: 'Yamaganda', gulika: 'Gulika', abhijit: 'Abhijit (midday)', choghadiya: 'Choghadiya', hora: 'Hora', sunrise: 'Sunrise', sunset: 'Sunset', night: 'Night', day: 'Day',
  protTitle: 'Protection from nazar and negative energy', protWhy: 'Why you are open to it', protDasha: 'Your running period', protSteps: 'What to do (one remedy is enough)', protAvoid: 'Avoid', protRelief: 'When it eases', protNote: 'This is traditional guidance for peace of mind. It does not replace medical or professional help.',
  approxNote: 'Approximate windows. They depend on the exact birth time and are not a guarantee.', remedy: 'Remedy', gemstone: 'Gemstone', gemAvoid: 'Not advised', gemGraha: 'Graha', gemHouse: 'House', gemPeriod: 'Period', gemBenefits: 'Benefits', gemHow: 'How to wear', gemWhen: 'When to wear', gemFinger: 'Finger', gemMetal: 'Metal', gemMantra: 'Mantra', gemDonation: 'Donation', gemDay: 'Day', disclaimer: 'This is a prediction, not a guarantee.',
};
let lang = (() => { try { return localStorage.getItem('kundliLang') || 'en'; } catch { return 'en'; } })();
const setLang = (c) => { lang = c || 'en'; try { localStorage.setItem('kundliLang', lang); } catch { /* ignore */ } };
const langName = (c) => (LANGS.find((l) => l[0] === c) || [c, c])[1];
const labelCache = new Map();
let onLangChange = null;

const hintHtml = () => '<p class="hint muted">Ask your first question below. You can follow up on any answer, CosmicMath remembers this conversation.</p>';

// Best timings sit in their own section, never merged into Period, and carry a caution so they are not read as a promise.

// Day-and-hour timing for an activity: computed on the server from the panchang and this chart, never written by the AI.
const MUHURTA_WORDS = /muhurat|mahurat|muhurta|chaughadiya|choghadiya|\bhora\b|rahu ?kaal|panchak|vichudo|vinchudo|abhijit|auspicious|shubh|good (day|time)|best (day|time)|right (day|time)|when (should|can|to)|which day|what time/i;
function askPlace(question) {
  let tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* no Intl zone */ }
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem('kundliGeo') || 'null'); } catch { /* ignore */ }
  if (cached && Date.now() - cached.at < 12 * 3600000) return Promise.resolve(cached.city ? { city: cached.city } : { lat: cached.lat, lon: cached.lon, tz });
  const save = (v) => { try { localStorage.setItem('kundliGeo', JSON.stringify({ ...v, at: Date.now() })); } catch { /* quota or private window */ } };
  // No coordinates (denied, unsupported, timed out): for a timing question ask the city once, so the times are never for the wrong place.
  const typed = () => {
    if (!MUHURTA_WORDS.test(question)) return null;
    const c = (window.prompt('Which city are you in right now? Times differ by place.') || '').trim();
    if (c.length < 2) return null;
    save({ city: c });
    return { city: c };
  };
  if (!navigator.geolocation) return Promise.resolve(typed());
  return new Promise((resolve) => navigator.geolocation.getCurrentPosition((pos) => {
    const loc = { lat: pos.coords.latitude, lon: pos.coords.longitude };
    save(loc);
    resolve({ ...loc, tz });
  }, () => resolve(typed()), { timeout: 8000, maximumAge: 3600000 }));
}


// Chart-specific nazar and negative-energy plan; only shown when the person asked, never part of the ordinary Remedy.
function protectionHtml(pr, L = L_EN) {
  if (!pr || !Array.isArray(pr.steps) || !pr.steps.length) return '';
  const lab = (k) => L[k] || L_EN[k];
  const steps = pr.steps.map((x) => `<li><b>${esc(x.planet)}:</b> ${esc(x.what)}<br><span class="muh-why">${esc(x.when)} · ${esc(x.why)}</span></li>`).join('');
  return `<h4 class="h--main">${esc(lab('protTitle'))}</h4><p><b>${esc(lab('protWhy'))}:</b> ${esc(pr.why)}</p><p><b>${esc(lab('protDasha'))}:</b> ${esc(pr.dashaLink)}</p><p><b>${esc(lab('protSteps'))}</b></p><ol>${steps}</ol>${pr.avoid ? `<p><b>${esc(lab('protAvoid'))}:</b> ${esc(pr.avoid)}</p>` : ''}${pr.whenRelief ? `<p><b>${esc(lab('protRelief'))}:</b> ${esc(pr.whenRelief)}</p>` : ''}<p class="muh-why">${esc(lab('protNote'))}</p>`;
}

function muhurtaHtml(m, L = L_EN, P = '') {
  if (!m || !Array.isArray(m.bestDays)) return '';
  const lab = (k) => L[k] || L_EN[k];
  const dd = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const days = m.bestDays.map((d) => `<div class="${P}muh-day"><p><b>${esc(dd(d.date))}</b> · ${esc(d.panchang.tithi)} · ${esc(d.panchang.nakshatra)}</p><ul>${d.windows.map((w) => `<li><b>${esc(w.from)} to ${esc(w.to)}</b> · ${esc(w.choghadiya)} · ${esc(w.hora)} ${esc(lab('hora'))} · ${esc(w.lagna)}<br><span class="${P}muh-why">${esc((w.why || []).join('; '))}</span></li>`).join('')}</ul><p class="${P}muh-why">${esc(lab('muhurtaAvoid'))}: ${esc(lab('rahuKaal'))} ${esc(d.avoid)}</p></div>`).join('');
  const skip = m.avoidDays.length ? `<p class="${P}muh-why"><b>${esc(lab('muhurtaSkip'))}:</b> ${m.avoidDays.map((d) => `${esc(dd(d.date))} (${esc(d.reasons[0])})`).join('; ')}</p>` : '';
  const t = m.today;
  const row = (r) => `<li class="${P}muh-${esc(r.nature || 'n')}">${esc(r.from)}-${esc(r.to)} ${esc(r.name || r.lord)}</li>`;
  const pr = t.periods;
  const table = `<details class="${P}muh-today"><summary>${esc(lab('muhurtaToday'))} (${esc(dd(t.date))})</summary><p>${esc(lab('sunrise'))} ${esc(pr.sunrise)} · ${esc(lab('sunset'))} ${esc(pr.sunset)}<br>${esc(lab('rahuKaal'))} ${esc(pr.rahuKaal)} · ${esc(lab('yamaganda'))} ${esc(pr.yamaganda)} · ${esc(lab('gulika'))} ${esc(pr.gulika)}${pr.abhijit ? ` · ${esc(lab('abhijit'))} ${esc(pr.abhijit)}` : ''}<br>${esc(t.panchang.tithi)} · ${esc(t.panchang.nakshatra)} · ${esc(t.panchang.yoga)} · ${esc(t.panchang.karana)}${t.flags.length ? `<br>${t.flags.map(esc).join('; ')}` : ''}</p><p><b>${esc(lab('choghadiya'))} · ${esc(lab('day'))}</b></p><ul class="${P}muh-grid">${t.choghadiyaDay.map(row).join('')}</ul><p><b>${esc(lab('choghadiya'))} · ${esc(lab('night'))}</b></p><ul class="${P}muh-grid">${t.choghadiyaNight.map(row).join('')}</ul><p><b>${esc(lab('hora'))}</b></p><ul class="${P}muh-grid">${t.hora.map(row).join('')}</ul></details>`;
  const per = m.period && m.period.reasons.length ? `<p class="${P}muh-why"><b>${esc(lab('muhurtaPeriod'))}:</b> ${esc(m.period.reasons.join(' '))}</p>` : '';
  return `<h4 class="h--main">${esc(lab('muhurtaBest'))} · ${esc(m.label)}</h4><p class="${P}muh-why">${esc(m.place)}</p>${per}${days || `<p>${esc(lab('muhurtaNone'))}</p>`}${skip}${table}<p class="${P}muh-why">${esc(lab('muhurtaNote'))}</p>`;
}

function bestTimingsHtml(bt, L = L_EN, loc = '', next = '') {
  const wins = bt && Array.isArray(bt.windows) ? bt.windows : [];
  if (!wins.length && !next) return '';
  // Health windows carry the day as well, other topics stay at month level.
  const mon = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(`${loc || 'en'}-IN`, { ...(bt && bt.matter === 'health' ? { day: 'numeric' } : {}), month: 'short', year: 'numeric', timeZone: 'UTC' });
  // KP supports the topic: dated sentences for the window(s). Otherwise the AI's line on the next favourable stretch.
  const sentence = (w) => {
    const key = w.strength === 'highest' ? 'highestChances' : 'goodChances';
    const tpl = L[key] && L[key].includes('{from}') && L[key].includes('{to}') ? L[key] : L_EN[key];
    return tpl.replace('{from}', mon(w.from)).replace('{to}', mon(w.to));
  };
  return `<h4 class="h--main">${esc(L.bestTimings)}</h4>${wins.length ? `${wins.map((w) => `<p>${esc(sentence(w))}</p>`).join('')}<p class="bt-note">${esc(L.approxNote)}</p>` : `<p>${esc(next)}</p>`}`;
}

// One card per stone, all stones that suit the current period. Labels come from L so they follow the answer language.
const GEM_ROWS = [['gemGraha', 'planet'], ['gemHouse', 'house'], ['gemPeriod', 'period'], ['gemBenefits', 'benefits'], ['gemHow', 'howToWear'], ['gemWhen', 'whenToWear'], ['gemFinger', 'finger'], ['gemMetal', 'metal'], ['gemMantra', 'mantra'], ['gemDonation', 'donation'], ['gemDay', 'day']];
function gemstoneHtml(a, L) {
  const gems = Array.isArray(a.gemstones) ? a.gemstones : [];
  if (!gems.length) return a.gemstone ? `<h4 class="h--main">${esc(L.gemstone || L_EN.gemstone)}</h4><p>${esc(a.gemstone)}</p>` : '';
  const lab = (k) => L[k] || L_EN[k];
  return `<h4 class="h--main">${esc(lab('gemstone'))}</h4>${a.gemstone ? `<p>${esc(a.gemstone)}</p>` : ''}${gems.map((g) => `<div class="gem"><h5 class="gem-title">${esc(g.stone || '')}${g.advice === 'caution' ? ' ⚠' : ''}</h5><dl class="gem-rows">${GEM_ROWS.map(([lk, f]) => (g[f] ? `<dt>${esc(lab(lk))}</dt><dd>${esc(g[f])}</dd>` : '')).join('')}</dl></div>`).join('')}${a.gemstoneAvoid ? `<p class="gem-avoid"><b>${esc(lab('gemAvoid'))}:</b> ${esc(a.gemstoneAvoid)}</p>` : ''}`;
}

function answerHtml(e) {
  const L = (e.lang && labelCache.get(e.lang)) || L_EN;
  const a = e.answer || {};
  return `<div class="ans" style="display:flex;flex-direction:column;gap:8px;">
    <div class="msg msg--me"><p>${esc(e.question)}</p>${e.combinedWith?.length ? `<p class="basis" style="color:#d6e8e6;">Combined: ${esc(e.combinedWith.join(', '))}</p>` : ''}</div>
    <div class="msg msg--pandit"><p>${esc(a.answer || a.conclusion || '')}</p>${a.basis ? `<p class="basis">${esc(a.basis)}</p>` : ''}${Array.isArray(a.perPerson) && a.perPerson.length ? `<ul class="perperson">${a.perPerson.map((p) => `<li><b>${esc(p.name)}:</b> ${esc(p.note)}</li>`).join('')}</ul>` : ''}${a.yearView ? `<h4 class="h--main">${esc(a.yearTitle || '')}</h4><p>${esc(a.yearView)}</p>` : ''}${a.started || a.timing ? `<h4 class="h--main">${esc(L.period)}</h4>${a.started ? `<p class="pline"><b>${esc(L.started)}:</b> ${esc(a.started)}</p>` : ''}${a.timing ? `<p class="pline"><b>${esc(L.changes)}:</b> ${esc(a.timing)}</p>` : ''}` : ''}${bestTimingsHtml(a.bestTimings, L, e.lang, a.next)}${muhurtaHtml(a.muhurta, L)}${protectionHtml(a.protection, L)}${a.remedy ? `<h4 class="h--main">${esc(L.remedy)}</h4><p>${esc(a.remedy)}</p>` : ''}${gemstoneHtml(a, L)}
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

// ---------------------------------------------------------------- name, mobile number and company check
const SUIT_HINT = { name: 'e.g. Rohit Sharma', mobile: 'e.g. 98765 43210', company: 'e.g. Sharma Trading Co' };
const SUIT_AREAS = [['health', 'Health'], ['wealth', 'Wealth'], ['relations', 'Relations']];
const suitLine = (areas) => SUIT_AREAS.map(([k, label]) => `${label}: <b>${esc(areas[k])}</b>`).join(' &middot; ');
function suitabilityHtml(r) {
  const c = r.current;
  const what = r.kind === 'mobile' ? 'Mobile number' : r.kind === 'company' ? 'Company name' : 'Name';
  const lines = [`<p>${what}: <b>${esc(r.input)}</b></p>`, `<h4 class="h--main">Result</h4>`, ...SUIT_AREAS.map(([k, label]) => `<p>${label}: <b>${esc(c.areas[k])}</b></p>`)];
  // Corrections only where they help: a name or company that is not already favourable in every area.
  if (r.kind !== 'mobile' && SUIT_AREAS.some(([k]) => c.areas[k] !== 'Favourable')) {
    lines.push(`<h4 class="h--main">Spelling corrections</h4>`);
    lines.push(r.suggestions.length
      ? r.suggestions.map((x) => `<p><b>${esc(x.text)}</b><br>${suitLine(x.areas)}</p>`).join('')
      : `<p>No spelling change that keeps the pronunciation improves it.</p>`);
  }
  lines.push(`<p class="bt-note disc">This is a prediction, not a guarantee.</p>`);
  return lines.join('');
}

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
    <p class="muted">CosmicMath answers your new questions in the language you pick. It starts in simple English.</p>
    <div class="actions" style="flex-wrap:wrap;">
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

// ------------------------------------------------------------ birth time rectification
// For people who do not know their birth time: they remember dated life events and the server tests every candidate time.
const TIME_WINDOWS = [['', 'Not sure, any time of the day'], ['00:00-06:00', 'Night or early morning (12 am to 6 am)'], ['06:00-12:00', 'Morning (6 am to 12 pm)'], ['12:00-18:00', 'Afternoon (12 pm to 6 pm)'], ['18:00-24:00', 'Evening or night (6 pm to 12 am)']];
const CONF_TEXT = { high: 'Good match', medium: 'Fair match', low: 'Weak match, add more events' };

function rectResultsHtml(r) {
  if (!r?.windows?.length) return '';
  const applied = r.status === 'applied';
  return `<p class="rect-conf rect-conf--${esc(r.confidence)}"><b>${esc(CONF_TEXT[r.confidence] || '')}.</b> These are the likely rising-sign windows. A remembered date is rarely exact, so treat the result as an estimate.</p>
    ${r.windows.map((w, i) => `<div class="gem"><h5 class="gem-title">${i === 0 ? 'Most likely: ' : ''}${esc(w.lagna)} rising &middot; ${esc(w.from)} to ${esc(w.to)} &middot; ${w.matchPercent}% fit</h5>
      ${w.events ? `<ul class="rect-events">${w.events.map((e) => `<li>${esc(e.label)} (${esc(e.date)}): ${esc(e.maha)} / ${esc(e.antar)} period, <b>${esc(e.fit)}</b> fit</li>`).join('')}</ul>` : ''}
      <div class="rect-use"><input type="time" value="${esc(w.suggested)}" data-rect-time="${i}" aria-label="Birth time inside this window" /><button type="button" class="btn-primary btn-small" data-rect-use="${i}">${applied && r.appliedTime >= w.from && r.appliedTime <= w.to ? 'Using this time' : 'Use this time'}</button></div></div>`).join('')}`;
}

async function openRectify(kundliId) {
  let k;
  try { const out = await guarded(() => call('kundliPublic_get', { kundliId })); if (!out) return; k = out.kundli; } catch (err) { window.alert(err.message); return; }
  const r0 = k.rectification;
  const kinds = k.rectifyKinds || [];
  const eventRow = (e = {}) => `<div class="rect-row"><select class="rect-kind" aria-label="Type of event"><option value="">Type of event</option>${kinds.map((x) => `<option value="${esc(x.kind)}" ${e.kind === x.kind ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select><input type="date" class="rect-date" aria-label="Date of the event" value="${esc(e.date || '')}" /><button type="button" class="btn-secondary btn-small rect-rm" aria-label="Remove this event">&times;</button></div>`;
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto;z-index:30;';
  overlay.innerHTML = `
    <div class="panel" style="max-width:560px;width:100%;margin-top:24px;">
      <div class="top"><h2 style="margin:0;">Find ${esc(k.name)}'s birth time</h2><button type="button" class="btn-link modal-close" aria-label="Close">&times;</button></div>
      <div>
        <p class="muted">Add big events from life with their dates, such as marriage, a child's birth, a first job, buying a house, moving abroad, a serious illness or losing a parent. Every possible birth time is tested against them. Three or more events with dates close to the real ones work best.</p>
        <label>Birth time, as far as anyone remembers
          <select id="rectWindow">${TIME_WINDOWS.map(([v, n]) => `<option value="${v}" ${r0 && `${r0.from}-${r0.to}` === v ? 'selected' : ''}>${n}</option>`).join('')}</select>
        </label>
        <div id="rectRows">${(r0?.events?.length ? r0.events : [{}, {}, {}]).map(eventRow).join('')}</div>
        <button type="button" class="btn-secondary btn-small" id="rectAdd">+ Add event</button>
        <p class="error" id="rectError" hidden></p>
        <div class="actions">
          <button type="button" class="btn-secondary" id="rectSkip">Skip for now</button>
          <button type="button" class="btn-primary" id="rectGo">Find likely birth time</button>
        </div>
        <div id="rectResults">${rectResultsHtml(r0)}</div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => { overlay.remove(); };
  const finish = () => { overlay.remove(); renderDetail(kundliId); };
  const err = overlay.querySelector('#rectError');
  overlay.querySelector('.modal-close').addEventListener('click', finish);
  overlay.querySelector('#rectSkip').addEventListener('click', finish);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(); });
  const rows = overlay.querySelector('#rectRows');
  overlay.querySelector('#rectAdd').addEventListener('click', () => { if (rows.children.length < 10) rows.insertAdjacentHTML('beforeend', eventRow()); });
  rows.addEventListener('click', (e) => { if (e.target.classList.contains('rect-rm') && rows.children.length > 1) e.target.closest('.rect-row').remove(); });
  let current = r0;
  overlay.querySelector('#rectGo').addEventListener('click', async (e) => {
    err.hidden = true;
    const events = [...rows.children].map((row) => ({ kind: row.querySelector('.rect-kind').value, date: row.querySelector('.rect-date').value })).filter((x) => x.kind || x.date);
    const [from, to] = (overlay.querySelector('#rectWindow').value || '').split('-');
    e.target.disabled = true; e.target.textContent = 'Testing every possible time…';
    try {
      const out = await guarded(() => call('kundliPublic_rectify', { kundliId, events, from: from || undefined, to: to || undefined }));
      if (!out) { close(); return; }
      current = out.rectification;
      overlay.querySelector('#rectResults').innerHTML = rectResultsHtml(current);
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    e.target.disabled = false; e.target.textContent = 'Find likely birth time';
  });
  overlay.querySelector('#rectResults').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-rect-use]');
    if (!b || !current) return;
    const time = overlay.querySelector(`[data-rect-time="${b.dataset.rectUse}"]`).value;
    b.disabled = true; b.textContent = 'Saving…';
    try { const done = await guarded(() => call('kundliPublic_rectifyApply', { kundliId, time })); if (!done) { close(); return; } finish(); } catch (ex) { err.textContent = ex.message; err.hidden = false; b.disabled = false; b.textContent = 'Use this time'; }
  });
}

// Live check of the place of birth while typing: found, near match with suggestions, or not found.
function wirePlaceCheck(overlay, check, P) {
  const input = overlay.querySelector('input[name="place"]');
  const box = overlay.querySelector('#placeStatus');
  let timer = null, seq = 0, lastQ = null;
  const show = (cls, html) => { box.className = `place-status place-status--${cls}`; box.innerHTML = html; };
  const chips = (list) => list.map((s, i) => `<button type="button" class="place-chip" data-pick="${i}">${esc(s.label)}</button>`).join('');
  const run = async () => {
    const q = input.value.trim();
    const mine = ++seq;
    lastQ = q;
    if (q.length < 2) { box.className = 'place-status'; box.textContent = ''; return; }
    show('wait', 'Checking the place…');
    let r;
    try { r = await check(q); } catch { if (mine === seq) show('wait', 'Could not check the place right now. You can still save, the place is checked again then.'); return; }
    if (mine !== seq || !r) return;
    if (r.status === 'ok') show('ok', `&#10003; Place found: <b>${esc(r.best.label)}</b>`);
    else if (r.status === 'check') show('check', `${r.best ? `Did you mean <b>${esc(r.best.label)}</b>? ` : ''}Tap the right one:<div class="place-chips">${chips(r.suggestions)}</div>`);
    else if (r.status === 'notfound') show('bad', '&#10007; This place was not found. Check the spelling, or add the state or country, for example Jaipur, Rajasthan.');
    else box.textContent = '';
    box._list = r.suggestions || [];
  };
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 450); });
  // Re-rendering on blur would replace the suggestion buttons before a tap on one lands, so blur only checks text not yet checked.
  input.addEventListener('blur', () => { clearTimeout(timer); if (input.value.trim() !== lastQ) run(); });
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick]');
    if (!b || !box._list) return;
    input.value = box._list[Number(b.dataset.pick)].label;
    run();
  });
  if (input.value.trim().length >= 2) run();
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
        <div>
          <label>Time of birth <input type="time" name="birthTime" ${k?.timeUnknown ? 'disabled' : 'required'} value="${esc(k?.timeUnknown ? '' : k?.birthTime || '')}" /></label>
          <label class="tu"><input type="checkbox" name="timeUnknown" ${k?.timeUnknown ? 'checked' : ''} style="width:auto;" /> (time not known)</label>
        </div>
      </div>
      <label>Place of birth <input type="text" name="place" required autocomplete="off" placeholder="e.g. Jaipur, Rajasthan" value="${esc(k?.place || '')}" /></label>
      <div id="placeStatus" class="place-status" aria-live="polite"></div>
      <p class="muted" id="timeHint">${k?.timeUnknown ? 'We will help you find the birth time from life events.' : 'The exact birth time matters: the ascendant changes about every two hours.'}</p>
      <label>Gender (optional)<select name="gender">${['', 'Male', 'Female', 'Other'].map((g) => `<option value="${g}" ${k?.gender === g ? 'selected' : ''}>${g || 'Prefer not to say'}</option>`).join('')}</select></label>
      <p class="error" id="ferr" hidden></p>
      <div class="actions"><button type="button" class="btn-secondary" id="cancel">Cancel</button><button type="submit" class="btn-primary">${isEdit ? 'Save changes' : 'Create'}</button></div>
    </form></div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('#cancel').addEventListener('click', close);
  wirePlaceCheck(overlay, (q) => guarded(() => call('kundliPublic_checkPlace', { query: q })), '');
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const tu = overlay.querySelector('input[name="timeUnknown"]');
  const timeInput = overlay.querySelector('input[name="birthTime"]');
  tu.addEventListener('change', () => {
    timeInput.disabled = tu.checked; timeInput.required = !tu.checked; if (tu.checked) timeInput.value = '';
    overlay.querySelector('#timeHint').textContent = tu.checked ? 'We will help you find the birth time from life events.' : 'The exact birth time matters: the ascendant changes about every two hours.';
  });
  overlay.querySelector('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const errEl = overlay.querySelector('#ferr');
    errEl.hidden = true;
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Finding place…';
    try {
      // Coordinates and time zone are worked out server-side from the place.
      const out = await guarded(() => call('kundliPublic_save', { kundliId: k?.kundliId, name: fd.get('name'), gender: fd.get('gender'), birthDate: fd.get('birthDate'), birthTime: fd.get('birthTime'), timeUnknown: fd.get('timeUnknown') === 'on', place: fd.get('place') }));
      if (!out) { close(); return; }
      close();
      // A new kundli without a birth time goes straight to finding it; an edit only does when no time has been settled yet.
      if (fd.get('timeUnknown') === 'on' && (!isEdit || k?.rectification?.status !== 'applied')) { openRectify(out.kundliId); return; }
      if (isEdit) done(); else renderDetail(out.kundliId);
    } catch (err) {
      errEl.textContent = err.message; errEl.hidden = false;
      btn.disabled = false; btn.textContent = isEdit ? 'Save changes' : 'Create';
    }
  });
}

if (handleFullPageReturn()) { /* signing in */ } else if (getSession() || currentToken()) renderList(); else showSignIn();

// ---------------------------------------------------------------- add to home screen
// Phones get a popup on every visit until the page runs as an installed app. Chrome and Edge install from the popup's own
// button (the browser then shows its one confirmation); iPhone Safari and other browsers cannot be installed from a page,
// so for them the popup shows the two taps to make instead.
let installEvent = null;
function installPopup() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (standalone || !window.matchMedia('(max-width: 600px)').matches) return;
  try { if (sessionStorage.getItem('kundliInstallDismissed')) return; } catch { /* ask again */ }
  let pop = document.getElementById('installPop');
  if (!pop) { pop = document.createElement('div'); pop.id = 'installPop'; pop.className = 'installpop'; document.body.appendChild(pop); }
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent || '');
  const how = ios
    ? 'Tap the <b>Share</b> button at the bottom of Safari, then choose <b>Add to Home Screen</b>.'
    : 'Open your browser menu (&#8942;), then choose <b>Add to Home screen</b> or <b>Install app</b>.';
  pop.innerHTML = `<div class="installpop-card" role="dialog" aria-modal="true" aria-labelledby="installTitle">
    <img src="icons/icon-192.png" alt="" width="64" height="64" />
    <h2 id="installTitle">Install CosmicMath</h2>
    <p class="muted">${installEvent ? 'Keep it on your home screen and open it like an app.' : how}</p>
    <div class="actions" style="justify-content:center;">
      ${installEvent ? '<button type="button" class="btn-primary" id="installGo">Install</button>' : ''}
      <button type="button" class="btn-secondary" id="installX">${installEvent ? 'Not now' : 'Got it'}</button>
    </div></div>`;
  const close = () => { try { sessionStorage.setItem('kundliInstallDismissed', '1'); } catch { /* ignore */ } pop.remove(); };
  document.getElementById('installX').addEventListener('click', close);
  document.getElementById('installGo')?.addEventListener('click', async () => {
    const ev = installEvent; installEvent = null; pop.remove();
    try { await ev.prompt(); } catch { /* the browser declined to show it */ }
  });
}
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; installPopup(); });
window.addEventListener('appinstalled', () => document.getElementById('installPop')?.remove());
installPopup();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { /* installing still works from the browser menu */ });
