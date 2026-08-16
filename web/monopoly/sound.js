// Sound effects, synthesized with the Web Audio API.
//
// Nothing is downloaded — every sound is generated from oscillators and noise
// buffers, which keeps the game self-contained and instant to load.

let ctx = null;
let master = null;
let enabled = true;

const NOTES = { C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880.0, C6: 1046.5 };

function audio() {
  if (ctx) return ctx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  ctx = new Ctx();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  return ctx;
}

/** Browsers block audio until a gesture; call this from the first click. */
export function unlock() {
  const c = audio();
  if (c && c.state === 'suspended') c.resume();
}

export function setEnabled(on) {
  enabled = on;
  if (master) master.gain.value = on ? 0.5 : 0;
}

export const isEnabled = () => enabled;

function tone({ freq, start = 0, dur = 0.18, type = 'sine', gain = 0.25, slideTo = null, delay = 0 }) {
  const c = audio();
  if (!c || !enabled) return;
  const t0 = c.currentTime + start + delay;
  const osc = c.createOscillator();
  const env = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);

  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  osc.connect(env).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise({ dur = 0.12, gain = 0.2, delay = 0, filterHz = 1800, type = 'lowpass' }) {
  const c = audio();
  if (!c || !enabled) return;
  const t0 = c.currentTime + delay;
  const frames = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, frames, c.sampleRate);
  const chan = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) chan[i] = (Math.random() * 2 - 1) * (1 - i / frames);

  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = filterHz;
  const env = c.createGain();
  env.gain.setValueAtTime(gain, t0);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  src.connect(filter).connect(env).connect(master);
  src.start(t0);
}

function arpeggio(freqs, { step = 0.075, dur = 0.22, type = 'triangle', gain = 0.22 } = {}) {
  freqs.forEach((f, i) => tone({ freq: f, dur, type, gain, delay: i * step }));
}

// --- the palette ---------------------------------------------------------

export const sfx = {
  click:   () => tone({ freq: 620, dur: 0.05, type: 'square', gain: 0.09 }),

  dice:    () => {
    // Three quick clatters, like dice bouncing off a table.
    for (let i = 0; i < 3; i++) {
      noise({ dur: 0.07, gain: 0.16, delay: i * 0.085, filterHz: 2600, type: 'bandpass' });
    }
  },

  hop:     () => tone({ freq: 880, dur: 0.045, type: 'sine', gain: 0.07 }),

  passGo:  () => arpeggio([NOTES.C5, NOTES.E5, NOTES.G5, NOTES.C6], { step: 0.07, gain: 0.2 }),

  buy:     () => arpeggio([NOTES.G4, NOTES.C5], { step: 0.08, dur: 0.24, gain: 0.2 }),

  build:   () => {
    tone({ freq: 180, dur: 0.1, type: 'square', gain: 0.16 });
    noise({ dur: 0.09, gain: 0.14, delay: 0.02, filterHz: 900 });
  },

  cashUp:  () => arpeggio([NOTES.E5, NOTES.G5, NOTES.C6], { step: 0.05, dur: 0.16, gain: 0.16 }),

  cashDown: () => arpeggio([NOTES.G4, NOTES.E4, NOTES.C4], { step: 0.06, dur: 0.2, type: 'sine', gain: 0.16 }),

  rent:    () => {
    tone({ freq: 300, dur: 0.14, type: 'sawtooth', gain: 0.12, slideTo: 160 });
    tone({ freq: 150, dur: 0.24, type: 'sine', gain: 0.14, delay: 0.1 });
  },

  card:    () => noise({ dur: 0.24, gain: 0.13, filterHz: 3200, type: 'highpass' }),

  jail:    () => {
    tone({ freq: 220, dur: 0.3, type: 'sawtooth', gain: 0.16, slideTo: 90 });
    noise({ dur: 0.3, gain: 0.1, filterHz: 600, delay: 0.05 });
  },

  auction: () => arpeggio([NOTES.C5, NOTES.G4, NOTES.C5], { step: 0.09, dur: 0.18, type: 'square', gain: 0.14 }),

  gavel:   () => {
    noise({ dur: 0.08, gain: 0.25, filterHz: 1200 });
    tone({ freq: 140, dur: 0.16, type: 'square', gain: 0.18, delay: 0.01 });
  },

  trade:   () => arpeggio([NOTES.A4, NOTES.D5, NOTES.A5], { step: 0.07, dur: 0.2, gain: 0.17 }),

  error:   () => tone({ freq: 170, dur: 0.16, type: 'square', gain: 0.13, slideTo: 110 }),

  bankrupt: () => {
    arpeggio([NOTES.G4, NOTES.F4, NOTES.E4, NOTES.C4], { step: 0.13, dur: 0.34, type: 'sine', gain: 0.2 });
    tone({ freq: 80, dur: 0.7, type: 'sine', gain: 0.16, delay: 0.4 });
  },

  win:     () => {
    arpeggio([NOTES.C5, NOTES.E5, NOTES.G5, NOTES.C6], { step: 0.11, dur: 0.34, gain: 0.24 });
    arpeggio([NOTES.E5, NOTES.G5, NOTES.C6], { step: 0.09, dur: 0.5, gain: 0.18 });
    for (let i = 0; i < 3; i++) noise({ dur: 0.4, gain: 0.08, delay: 0.5 + i * 0.12, filterHz: 5000, type: 'highpass' });
  },

  turn:    () => tone({ freq: 520, dur: 0.09, type: 'triangle', gain: 0.12 }),
};
