/**
 * Built-in alert sounds. These are synthesised in the browser with WebAudio (see
 * src/lib/sounds.ts), so they need no audio files. Custom sounds are uploaded by users
 * and referenced by their slug.
 */
export interface BuiltinSound {
  slug: string;
  name: string;
  description: string;
}

export const BUILTIN_SOUNDS: BuiltinSound[] = [
  { slug: "flare", name: "Flare", description: "Bright two-note rise (default)" },
  { slug: "chime", name: "Chime", description: "Soft bell chord" },
  { slug: "blip", name: "Blip", description: "Short single blip" },
  { slug: "pulse", name: "Pulse", description: "Three quick pulses" },
  { slug: "cascade", name: "Cascade", description: "Falling arpeggio" },
  { slug: "klaxon", name: "Klaxon", description: "Insistent alarm, good for urgent alerts" },
  { slug: "siren", name: "Siren", description: "Rising and falling sweep" },
  { slug: "none", name: "None (silent)", description: "No sound" },
];

export const DEFAULT_SOUND = "flare";

export const BUILTIN_SOUND_SLUGS = new Set(BUILTIN_SOUNDS.map((s) => s.slug));
