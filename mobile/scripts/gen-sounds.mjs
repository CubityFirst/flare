#!/usr/bin/env node
/**
 * Renders Flare's built-in alert sounds to WAV files for the Android app.
 *
 * The web app synthesises these live with WebAudio (src/lib/sounds.ts). This is a sample-by-
 * sample port of the same oscillators and envelopes, so both play the same sounds. Rerun it
 * after changing a sound there:
 *
 *   node scripts/gen-sounds.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";

const RATE = 22050;
const OUT = new URL("../modules/flare-push/android/src/main/res/raw/", import.meta.url);

/** One WebAudio-style tone: oscillator + gain envelope (exp. attack 10 ms, exp. decay). */
function tone(buf, at, freq, dur, { type = "sine", gain = 0.25, to } = {}) {
  const start = Math.floor(at * RATE);
  const n = Math.floor((dur + 0.02) * RATE);
  let phase = 0;
  for (let i = 0; i < n && start + i < buf.length; i++) {
    const t = i / RATE;
    const f = to && t <= dur ? freq + (to - freq) * (t / dur) : to && t > dur ? to : freq;
    phase += f / RATE;
    const p = phase % 1;
    const wave =
      type === "square" ? (p < 0.5 ? 1 : -1)
      : type === "triangle" ? 1 - 4 * Math.abs(p - 0.5)
      : type === "sawtooth" ? 2 * p - 1
      : Math.sin(2 * Math.PI * phase);
    // exponentialRampToValueAtTime from 0.0001 to peak over 10 ms, then down to 0.0001 at dur.
    const env =
      t < 0.01 ? 0.0001 * (gain / 0.0001) ** (t / 0.01)
      : t < dur ? gain * (0.0001 / gain) ** ((t - 0.01) / (dur - 0.01))
      : 0.0001;
    buf[start + i] += wave * env;
  }
}

const SYNTHS = {
  flare: (b) => {
    tone(b, 0, 880, 0.14);
    tone(b, 0.12, 1320, 0.28);
  },
  chime: (b) => {
    for (const f of [1047, 1319, 1568]) tone(b, 0, f, 1.3, { gain: 0.12 });
  },
  blip: (b) => tone(b, 0, 1200, 0.08, { type: "square", gain: 0.08 }),
  pulse: (b) => {
    for (let i = 0; i < 3; i++) tone(b, i * 0.15, 1000, 0.09, { type: "triangle", gain: 0.3 });
  },
  cascade: (b) => {
    [1568, 1319, 1047, 784].forEach((f, i) => tone(b, i * 0.09, f, 0.25, { gain: 0.18 }));
  },
  klaxon: (b) => {
    for (let i = 0; i < 6; i++) tone(b, i * 0.2, i % 2 ? 440 : 560, 0.19, { type: "sawtooth", gain: 0.12 });
  },
  siren: (b) => {
    tone(b, 0, 600, 0.8, { to: 1400, gain: 0.2 });
    tone(b, 0.8, 1400, 0.8, { to: 600, gain: 0.2 });
  },
};

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  // Normalise so the loudest sound peaks near full scale, like a phone's other alert tones.
  samples.forEach((s, i) => data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(s * 32767))), i * 2));
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

mkdirSync(OUT, { recursive: true });
for (const [slug, synth] of Object.entries(SYNTHS)) {
  const buf = new Float64Array(Math.ceil(1.8 * RATE));
  synth(buf);
  // Trim trailing silence.
  let end = buf.length;
  while (end > 0 && Math.abs(buf[end - 1]) < 1e-4) end--;
  // WebAudio output is quiet next to system tones; lift every sound by the same amount.
  const out = Array.from(buf.subarray(0, end + Math.floor(0.05 * RATE)), (s) => s * 2.5);
  writeFileSync(new URL(`flare_sound_${slug}.wav`, OUT), wav(out));
  console.log(`flare_sound_${slug}.wav  ${(out.length / RATE).toFixed(2)} s`);
}
