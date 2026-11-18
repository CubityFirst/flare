/**
 * Plays alert sounds in the page. Built-in sounds are synthesised with WebAudio;
 * custom sounds are fetched from the API.
 *
 * Browsers only allow audio after the user has interacted with the page, so
 * `unlockAudio` is called on the first click/tap.
 */
import { DEFAULT_SOUND } from "@shared/sounds";

let ctx: AudioContext | null = null;

function audio(): AudioContext {
  ctx ??= new AudioContext();
  return ctx;
}

export function unlockAudio() {
  const c = audio();
  if (c.state === "suspended") void c.resume();
}

type Wave = OscillatorType;

function tone(at: number, freq: number, dur: number, opts: { type?: Wave; gain?: number; to?: number } = {}) {
  const c = audio();
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = opts.type ?? "sine";
  osc.frequency.setValueAtTime(freq, at);
  if (opts.to) osc.frequency.linearRampToValueAtTime(opts.to, at + dur);
  const peak = opts.gain ?? 0.25;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(c.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

const SYNTHS: Record<string, (t: number) => void> = {
  flare: (t) => {
    tone(t, 880, 0.14);
    tone(t + 0.12, 1320, 0.28);
  },
  chime: (t) => {
    for (const f of [1047, 1319, 1568]) tone(t, f, 1.3, { gain: 0.12 });
  },
  blip: (t) => tone(t, 1200, 0.08, { type: "square", gain: 0.08 }),
  pulse: (t) => {
    for (let i = 0; i < 3; i++) tone(t + i * 0.15, 1000, 0.09, { type: "triangle", gain: 0.3 });
  },
  cascade: (t) => {
    [1568, 1319, 1047, 784].forEach((f, i) => tone(t + i * 0.09, f, 0.25, { gain: 0.18 }));
  },
  klaxon: (t) => {
    for (let i = 0; i < 6; i++) tone(t + i * 0.2, i % 2 ? 440 : 560, 0.19, { type: "sawtooth", gain: 0.12 });
  },
  siren: (t) => {
    tone(t, 600, 0.8, { to: 1400, gain: 0.2 });
    tone(t + 0.8, 1400, 0.8, { to: 600, gain: 0.2 });
  },
  none: () => {},
};

const audioCache = new Map<string, HTMLAudioElement>();

export function playSound(slug: string | null | undefined, url?: string | null) {
  try {
    if (url) {
      let el = audioCache.get(url);
      if (!el) {
        el = new Audio(url);
        audioCache.set(url, el);
      }
      el.currentTime = 0;
      void el.play().catch(() => {});
      return;
    }
    const synth = SYNTHS[slug ?? DEFAULT_SOUND] ?? SYNTHS[DEFAULT_SOUND];
    const c = audio();
    if (c.state === "suspended") void c.resume();
    synth(c.currentTime + 0.02);
  } catch {
    // Audio unavailable; ignore.
  }
}
