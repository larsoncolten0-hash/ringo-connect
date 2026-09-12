// Premium, dependency-free UI sound effects, synthesized on the fly with
// the Web Audio API instead of shipping audio files — every "tone" here is
// just a couple of oscillators and a short gain envelope, so there is
// nothing to host, license, or preload, and the whole set weighs 0 bytes.
// Every sound is deliberately tiny (well under 300ms) and quiet by
// default: this is a status chime for a save or a scan result, not a game
// jingle. Nothing in this file ever plays on its own — every export here
// is only ever invoked from a user-triggered action via useSound()'s
// play(), never on mount, so a page that never calls play() (a public
// profile, for instance) stays completely silent.

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || (window as any).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  return ctx;
}

// Most mobile browsers create an AudioContext in a "suspended" state until
// a real user gesture resumes it. SoundProvider calls this once on the
// page's first pointerdown/keydown so every later play() — including ones
// fired from an async callback like a scan result, not directly inside a
// click handler — actually produces sound.
export function unlock() {
  const c = getCtx();
  if (c && c.state === "suspended") c.resume().catch(() => {});
}

type Note = {
  freq: number;
  // Seconds from the start of this tone.
  start: number;
  duration: number;
  gain?: number;
  type?: OscillatorType;
};

// Plays a short sequence of notes with a soft attack/decay envelope on
// each — the envelope is what keeps these sounding like a soft "premium"
// chime instead of a harsh beep: a quick fade in, a slightly slower fade
// out, never a hard on/off click.
function playNotes(notes: Note[]) {
  const c = getCtx();
  if (!c) return;
  if (c.state === "suspended") c.resume().catch(() => {});
  const now = c.currentTime;

  for (const n of notes) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = n.type ?? "sine";
    osc.frequency.value = n.freq;

    const peak = n.gain ?? 0.16;
    const t0 = now + n.start;
    const attack = Math.min(0.012, n.duration * 0.25);
    const release = n.duration - attack;

    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + Math.max(release, 0.02));

    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + n.duration + 0.02);
  }
}

// Successful save / completed action — a soft two-note upward chime.
export function playSuccess() {
  playNotes([
    { freq: 740, start: 0, duration: 0.09, gain: 0.14 },
    { freq: 988, start: 0.07, duration: 0.16, gain: 0.16 },
  ]);
}

// New order / booking arrival — a single gentle pluck, easy to tell apart
// from a save confirmation without being an alarm.
export function playNotification() {
  playNotes([
    { freq: 660, start: 0, duration: 0.1, gain: 0.13, type: "triangle" },
    { freq: 880, start: 0.05, duration: 0.14, gain: 0.11, type: "triangle" },
  ]);
}

// A soft, non-alarming heads-up — used for recoverable/expected warnings.
export function playWarning() {
  playNotes([
    { freq: 494, start: 0, duration: 0.09, gain: 0.14, type: "triangle" },
    { freq: 494, start: 0.12, duration: 0.09, gain: 0.14, type: "triangle" },
  ]);
}

// Important errors only — still short and controlled, just lower and
// descending so it reads as "something needs attention" without being
// jarring or game-like.
export function playError() {
  playNotes([
    { freq: 392, start: 0, duration: 0.11, gain: 0.15, type: "sine" },
    { freq: 293, start: 0.09, duration: 0.16, gain: 0.15, type: "sine" },
  ]);
}

// --- Gate scanner: three sounds that must be unmistakable from each
// other at a glance-free glance, since a guard is looking at a phone
// screen in low light, not reading it. ---

// VALID — bright, confident, quick double-rise. Distinct from the generic
// success chime so the scanner has its own unmistakable identity.
export function playScanValid() {
  playNotes([
    { freq: 880, start: 0, duration: 0.08, gain: 0.17 },
    { freq: 1174, start: 0.06, duration: 0.08, gain: 0.17 },
    { freq: 1568, start: 0.12, duration: 0.14, gain: 0.16 },
  ]);
}

// INVALID — a single firm, low tone. Deliberately flat and short rather
// than harsh — a clear "no" without sounding like a siren.
export function playScanInvalid() {
  playNotes([{ freq: 220, start: 0, duration: 0.22, gain: 0.18, type: "square" }]);
}

// ALREADY USED — two flat, level beeps at a middle pitch: rhythmically and
// tonally distinct from both VALID (rising, bright) and INVALID (one low
// tone), so it reads as its own third category instead of "another kind
// of no."
export function playScanAlreadyUsed() {
  playNotes([
    { freq: 523, start: 0, duration: 0.09, gain: 0.16, type: "triangle" },
    { freq: 523, start: 0.14, duration: 0.09, gain: 0.16, type: "triangle" },
  ]);
}
