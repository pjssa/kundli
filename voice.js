// Free voice layer for the Kundli Ask tab: the browser listens (SpeechRecognition) and reads answers aloud (speechSynthesis).
// No server, no paid API. Copied verbatim to kundli-public/voice.js because the public site cannot import from frontend/src/.

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canListen = !!SR;
export const canSpeak = 'speechSynthesis' in window;

// Reading language code -> BCP-47. Hinglish is Latin script, so an Indian English voice reads it best.
const BCP = { en: 'en-IN', hinglish: 'en-IN', hi: 'hi-IN', gu: 'gu-IN', mr: 'mr-IN', bn: 'bn-IN', ta: 'ta-IN', te: 'te-IN', kn: 'kn-IN', ml: 'ml-IN', pa: 'pa-IN', ur: 'ur-PK' };
export const bcp = (code) => BCP[code] || 'en-IN';

// Browsers expose no gender, so the female voices are recognised by name (Android/Google ones are female by default).
const FEMALE = /female|samantha|veena|lekha|heera|zira|neerja|swara|aditi|raveena|karen|moira|tessa|fiona|kalpana|google (हिन्दी|hindi|uk english female|us english)/i;
const MALE = /\bmale\b|rishi|ravi|hemant|prabhat|david|mark|daniel|alex|fred/i;
let voices = [];
if (canSpeak) { voices = speechSynthesis.getVoices(); speechSynthesis.addEventListener('voiceschanged', () => { voices = speechSynthesis.getVoices(); }); }

function pickVoice(lang) {
  const base = lang.split('-')[0];
  const sameLang = voices.filter((v) => v.lang.replace('_', '-') === lang || v.lang.split(/[-_]/)[0] === base);
  const pool = sameLang.length ? sameLang : voices.filter((v) => v.lang.startsWith('en'));
  return pool.find((v) => FEMALE.test(v.name) && !MALE.test(v.name)) || pool.find((v) => !MALE.test(v.name)) || pool[0] || null;
}

// iOS only lets speech start from a tap; speaking a silent utterance during the tap unlocks later replies.
export function unlockSpeech() {
  if (!canSpeak) return;
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  speechSynthesis.speak(u);
}
// Own flag, not speechSynthesis.speaking: the silent unlock utterance also counts as speaking, which made the first Listen tap read as Stop.
let talking = false;
export const stopSpeech = () => { talking = false; if (canSpeak) speechSynthesis.cancel(); };
export const isSpeaking = () => talking;

// Remembered per device; on by default so every new answer is read out.
const AUTO_KEY = 'kundliVoiceReplies';
export const autoRead = () => { try { return localStorage.getItem(AUTO_KEY) !== '0'; } catch { return true; } };
export const setAutoRead = (on) => { try { localStorage.setItem(AUTO_KEY, on ? '1' : '0'); } catch { /* ignore */ } };

// Chrome cuts a long utterance off after ~15 s, so the answer is spoken a sentence group at a time.
function chunks(text, max = 160) {
  const parts = text.match(/[^.!?।\n]+[.!?।]*/g) || [text];
  const out = [];
  let cur = '';
  for (const p of parts) { if ((cur + p).length > max && cur) { out.push(cur.trim()); cur = p; } else cur += p; }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Reads text aloud in the reading language; resolves when finished or stopped. */
export function speak(text, langCode) {
  return new Promise((resolve) => {
    if (!canSpeak || !text) return resolve();
    speechSynthesis.cancel();
    talking = true;
    const lang = bcp(langCode);
    const voice = pickVoice(lang);
    const list = chunks(text);
    let i = 0;
    const next = () => {
      if (!talking) return resolve();
      if (i >= list.length) { talking = false; return resolve(); }
      const t = list[i++];
      const u = new SpeechSynthesisUtterance(t);
      u.lang = voice ? voice.lang : lang;
      if (voice) u.voice = voice;
      u.rate = 0.98;
      // Chrome sometimes never fires onend; without this the reply would stay "speaking" for ever.
      const dog = setTimeout(() => { speechSynthesis.cancel(); next(); }, 4000 + t.length * 120);
      u.onend = () => { clearTimeout(dog); next(); };
      u.onerror = () => { clearTimeout(dog); talking = false; resolve(); };
      speechSynthesis.speak(u);
    };
    // Chrome drops a speak() issued in the same tick as cancel(), so the first sentence waits a moment.
    setTimeout(next, 120);
  });
}

/** The words of an answer worth reading out: the answer itself plus the year view and timing lines when present. */
export function speechText(entry) {
  const a = entry && entry.answer && typeof entry.answer === 'object' ? entry.answer : {};
  return [a.answer || a.conclusion, a.yearView, a.started, a.timing, a.remedy].filter(Boolean).join(' ');
}

/**
 * One-shot microphone. onText(text, isFinal) streams what is heard; onEnd(finalText) fires once listening stops
 * (finalText is '' if nothing was heard). Returns { start, stop, active }.
 */
export function createMic({ getLang, onText, onEnd, onError }) {
  let rec = null, heard = '';
  const api = {
    get active() { return !!rec; },
    start() {
      if (!SR || rec) return;
      heard = '';
      rec = new SR();
      rec.lang = bcp(getLang());
      rec.interimResults = true;
      rec.continuous = false;
      rec.onresult = (e) => {
        let text = '', fin = false;
        for (let i = 0; i < e.results.length; i++) { text += e.results[i][0].transcript; if (e.results[i].isFinal) fin = true; }
        heard = text.trim();
        onText(heard, fin);
      };
      rec.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted' && onError) onError(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'Microphone access is blocked. Allow it in the browser settings to talk.' : 'Could not hear that. Please try again.'); };
      rec.onend = () => { rec = null; onEnd(heard); };
      try { rec.start(); } catch { rec = null; onEnd(''); }
    },
    stop() { if (rec) rec.stop(); },
  };
  return api;
}
