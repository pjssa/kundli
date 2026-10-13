/**
 * app.js (kundli) — the public Kundli page. Anyone signs in with their own
 * Google account, keeps their own and their family's kundlis, and chats with
 * the pandit. Self-contained (own fetch wrapper, own GIS init), same reasoning
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
const currentToken = () => getToken() || (memoryToken && (jwtPayload(memoryToken)?.exp * 1000 > Date.now() ? memoryToken : ''));

class AuthError extends Error {}
class AccessError extends Error {}

async function call(action, payload = {}) {
  const kundliIdToken = currentToken();
  if (!kundliIdToken) throw new AuthError('Please sign in with Google');
  const res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, payload, kundliIdToken }) });
  let parsed;
  try { parsed = await res.json(); } catch { throw new Error('Unexpected response from server'); }
  if (!parsed.ok) {
    if (parsed.error?.code === 'AUTH_INVALID_TOKEN') { try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } memoryToken = ''; throw new AuthError(parsed.error.message); }
    if (parsed.error?.code === 'ACCESS_DISABLED') throw new AccessError(parsed.error.message);
    throw new Error(parsed.error?.message || 'Something went wrong');
  }
  return parsed.data;
}

function showSignIn(message = '') {
  app.innerHTML = `<div class="wrap"><div class="panel"><div class="signin">
    <h1>Kundli</h1>
    <p class="muted">Enter your birth details and ask the pandit anything. Sign in with your Google account to keep your own kundli, and your family&rsquo;s. Only you can see what you save.</p>
    ${message ? `<p class="error">${esc(message)}</p>` : ''}
    <div id="gbtn"></div>
  </div></div></div>`;
  const init = () => {
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (r) => { setToken(r.credential); renderList(); },
    });
    window.google.accounts.id.renderButton(document.getElementById('gbtn'), { type: 'standard', theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with' });
  };
  if (window.google?.accounts?.id) init();
  else { const t = setInterval(() => { if (window.google?.accounts?.id) { clearInterval(t); init(); } }, 100); }
}

function showBlocked(message) {
  app.innerHTML = `<div class="wrap"><div class="panel"><div class="signin">
    <h1>Kundli</h1><p class="error">${esc(message)}</p>
    <button class="btn-secondary" id="blockedOut">Sign out</button></div></div></div>`;
  document.getElementById('blockedOut').addEventListener('click', signOut);
}

function signOut() {
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

async function renderList() {
  peopleCache = null;
  if (!currentToken()) return showSignIn();
  app.innerHTML = `<div class="wrap"><p class="muted">Loading&hellip;</p></div>`;
  let data;
  try { data = await guarded(() => call('kundliPublic_list')); } catch (err) { app.innerHTML = `<div class="wrap"><p class="error">${esc(err.message)}</p></div>`; return; }
  if (!data) return;
  const items = data.items;
  app.innerHTML = `<div class="wrap">
    <div class="top"><h1>Kundli</h1><button class="btn-secondary btn-small" id="signOut">Sign out</button></div>
    <p class="muted">Add yourself and your family members, then ask the pandit about any of them.</p>
    <div class="actions" style="margin-top:8px;"><button class="btn-primary" id="addBtn">+ Add a person</button></div>
    ${items.length ? `<div class="tiles">${items.map((k) => `<div class="tile" role="button" tabindex="0" data-open="${esc(k.kundliId)}"><b>${esc(k.name)}</b><span class="muted">Born ${esc(fmtBirth(k))}<br>${esc(k.place || '')}<br>${k.questionCount} question${k.questionCount === 1 ? '' : 's'}</span></div>`).join('')}</div>`
      : `<div class="panel"><p class="muted">No one added yet. Tap &ldquo;Add a person&rdquo; to begin.</p></div>`}
  </div>`;
  document.getElementById('signOut').addEventListener('click', signOut);
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

  app.innerHTML = `<div class="wrap">
    <button class="btn-link" id="back">&larr; Everyone</button>
    <div class="top"><h1>${esc(k.name)}</h1>
      <div style="display:flex;gap:8px;"><button class="btn-secondary btn-small" id="edit">Edit</button><button class="btn-danger btn-small" id="del">Delete</button></div></div>
    <p class="muted">Born ${esc(fmtBirth(k))} &middot; ${esc(k.place || '')}</p>

    <div class="panel chat" id="chat">
      <div class="top"><h2 style="margin:0;">Ask the pandit</h2><div class="tools"><button class="btn-secondary btn-small" id="clear" ${history.length ? '' : 'hidden'}>Clear chat</button><button class="btn-secondary btn-small" id="full" aria-pressed="false">Full screen</button></div></div>
      <div class="thread" id="thread" aria-live="polite">${history.length ? [...history].reverse().map(answerHtml).join('') : hintHtml()}</div>
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
  </div>`;

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
  toBottom();
  // CSS-driven full screen (the browser Fullscreen API is not available on iPhones).
  const chat = document.getElementById('chat');
  const fullBtn = document.getElementById('full');
  const setFull = (on) => {
    chat.classList.toggle('full', on);
    document.body.classList.toggle('locked', on);
    fullBtn.textContent = on ? 'Exit full screen' : 'Full screen';
    fullBtn.setAttribute('aria-pressed', String(on));
    toBottom();
  };
  fullBtn.addEventListener('click', () => setFull(!chat.classList.contains('full')));
  const onEsc = (e) => {
    if (!chat.isConnected) { document.removeEventListener('keydown', onEsc); document.body.classList.remove('locked'); return; }
    if (e.key === 'Escape' && chat.classList.contains('full')) setFull(false);
  };
  document.addEventListener('keydown', onEsc);
  thread.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-del]');
    if (!btn || !window.confirm('Delete this question and its answer?')) return;
    btn.disabled = true;
    try { await guarded(() => call('kundliPublic_deleteAnswers', { kundliId: k.kundliId, askedAt: btn.dataset.del })); btn.closest('.ans').remove(); syncBar(); } catch (err) { alert(err.message); btn.disabled = false; }
  });
  clearBtn.addEventListener('click', async () => {
    if (!window.confirm('Delete the whole chat for this person? This cannot be undone.')) return;
    clearBtn.disabled = true;
    try { await guarded(() => call('kundliPublic_deleteAnswers', { kundliId: k.kundliId, all: true })); thread.innerHTML = ''; syncBar(); } catch (err) { alert(err.message); }
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
      box.innerHTML = '<p class="muted">The pandit is studying the charts&hellip;</p>';
      try {
        const out = await guarded(() => call('kundliPublic_ask', { kundliId: k.kundliId, question, kundliIds: ids }));
        thread.querySelectorAll('.pending, .picker').forEach((n) => n.remove());
        if (!out) return;
        thread.insertAdjacentHTML('beforeend', answerHtml(out.entry));
        clearBtn.hidden = false;
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
    thread.insertAdjacentHTML('beforeend', `<div class="msg msg--me pending"><p>${esc(question)}</p></div><div class="msg msg--pandit typing"><p class="muted">The pandit is studying the chart&hellip;</p></div>`);
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
      const out = await guarded(() => call('kundliPublic_ask', { kundliId: k.kundliId, question }));
      dropPending();
      if (!out) return;
      thread.insertAdjacentHTML('beforeend', answerHtml(out.entry));
      clearBtn.hidden = false;
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

const hintHtml = () => '<p class="hint muted">Ask your first question below. You can follow up on any answer, the pandit remembers this conversation.</p>';

function answerHtml(e) {
  const a = e.answer || {};
  return `<div class="ans" style="display:flex;flex-direction:column;gap:8px;">
    <div class="msg msg--me"><p>${esc(e.question)}</p>${e.combinedWith?.length ? `<p class="basis" style="color:#d6e8e6;">Combined: ${esc(e.combinedWith.join(', '))}</p>` : ''}</div>
    <div class="msg msg--pandit"><h4>Why</h4><p>${esc(a.answer || a.conclusion || '')}</p>${a.basis ? `<p class="basis">${esc(a.basis)}</p>` : ''}${Array.isArray(a.perPerson) && a.perPerson.length ? `<ul class="perperson">${a.perPerson.map((p) => `<li><b>${esc(p.name)}:</b> ${esc(p.note)}</li>`).join('')}</ul>` : ''}${a.started || a.timing ? `<h4>Period</h4>${a.started ? `<p><b>Started:</b> ${esc(a.started)}</p>` : ''}${a.timing ? `<p><b>Changes:</b> ${esc(a.timing)}</p>` : ''}` : ''}${a.next ? `<h4>What next</h4><p>${esc(a.next)}</p>` : ''}${a.remedy ? `<h4>Remedy</h4><p>${esc(a.remedy)}</p>` : ''}
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

function openModal(k, done) {
  const isEdit = !!k;
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto;z-index:10;';
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

if (currentToken()) renderList(); else showSignIn();
