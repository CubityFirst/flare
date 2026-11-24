// Generates every app icon from two SVG masters:
//   assets/icon.svg        the full-colour icon, full bleed: <defs>, a 512×512 background <rect fill="url(#bg)">,
//                          then the mark
//   assets/icon-badge.svg  the same mark as a white silhouette, for notification badges
// Outputs the web favicon and PWA icons in public/, the Android app's icons in mobile/assets/, and the
// Android status-bar vector in the flare-push module. Run from the repo root: node scripts/gen-icons.mjs
import sharp from "sharp";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const icon = readFileSync("assets/icon.svg", "utf8");
const badge = readFileSync("assets/icon-badge.svg", "utf8");

const DEFS = icon.match(/<defs>[\s\S]*?<\/defs>/)?.[0];
const BG = icon.match(/<rect width="512" height="512" fill="url\(#bg\)"\/>/)?.[0];
if (!DEFS || !BG) throw new Error("assets/icon.svg: expected <defs> and a 512×512 <rect fill=url(#bg)> background");
const MARK = icon.slice(icon.indexOf(BG) + BG.length, icon.lastIndexOf("</svg>"));
const BADGE_MARK = badge.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");

const scaled = (body, s) => (s === 1 ? body : `<g transform="translate(256 256) scale(${s}) translate(-256 -256)">${body}</g>`);

/**
 * Builds a 512-unit SVG. `bg` is the background element (or none), `mark` the mark's markup, scaled about
 * the centre by `scale`; `rx` rounds the corners.
 */
function compose({ defs = DEFS, bg = BG, mark = MARK, scale = 1, rx = 0 }) {
  const clip = rx ? `<clipPath id="round"><rect width="512" height="512" rx="${rx}"/></clipPath>` : "";
  const body = (bg ?? "") + scaled(mark, scale);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${defs ?? ""}${clip && `<defs>${clip}</defs>`}${rx ? `<g clip-path="url(#round)">${body}</g>` : body}</svg>`;
}

const ROUND = 112; // ≈ 22% corner radius, close to the OS masks
// Maskable icons may be cropped to a centred circle of radius 40%, and the arcs reach further than that.
const MASKABLE_SCALE = 0.82;
// Android adaptive icon layers show their middle 66%, and the launcher may crop that to a circle.
const ADAPTIVE_SCALE = 0.6;
// The badge mark fills about 72% of its box; badges want it nearly edge to edge.
const BADGE_SCALE = 1.15;

const write = async (path, svg, size) =>
  writeFileSync(path, await sharp(Buffer.from(svg), { density: Math.ceil((size / 512) * 72 * 4) }).resize(size, size).png({ compressionLevel: 9 }).toBuffer());

mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icon.svg", compose({ rx: ROUND }) + "\n");
await write("public/icons/icon-192.png", compose({ rx: ROUND }), 192);
await write("public/icons/icon-512.png", compose({ rx: ROUND }), 512);
await write("public/icons/icon-maskable-512.png", compose({ scale: MASKABLE_SCALE }), 512);
await write("public/icons/apple-touch-icon.png", compose({}), 180); // iOS rounds the corners itself
await write("public/icons/badge-96.png", compose({ defs: null, bg: null, mark: BADGE_MARK, scale: BADGE_SCALE }), 96);
console.log("Wrote public/icon.svg and public/icons/*.png");

// Android app. The adaptive background layer shows only its middle 66%, so its glow is pulled in to
// match the full icon's look once the foreground is shrunk into the safe zone.
const adaptiveDefs = DEFS.replace(/(<radialGradient id="bg")[^>]*>/, '$1 cx="0.5" cy="0.45" r="0.5">');
if (adaptiveDefs === DEFS) throw new Error('assets/icon.svg: expected <radialGradient id="bg">');
mkdirSync("mobile/assets", { recursive: true });
await write("mobile/assets/icon.png", compose({}), 1024);
await write("mobile/assets/android-icon-background.png", compose({ defs: adaptiveDefs, mark: "" }), 512);
await write("mobile/assets/android-icon-foreground.png", compose({ bg: null, scale: ADAPTIVE_SCALE }), 1024);
await write("mobile/assets/android-icon-monochrome.png", compose({ defs: null, bg: null, mark: BADGE_MARK, scale: ADAPTIVE_SCALE }), 1024);
await write("mobile/assets/splash-icon.png", compose({ bg: null }), 512);
console.log("Wrote mobile/assets/*.png");

// Status-bar icon. Android vector drawables accept SVG path data, arcs included. The viewport is cropped
// to the middle of the 512 box so the mark is scaled up by BADGE_SCALE, like badge-96.png.
const paths = [...badge.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);
if (!paths.length) throw new Error("assets/icon-badge.svg: no <path d> found");
const vb = +(512 / BADGE_SCALE).toFixed(2), off = +((512 - vb) / 2).toFixed(2);
writeFileSync(
  "mobile/modules/flare-push/android/src/main/res/drawable/ic_flare_notification.xml",
  `<!-- Status bar icon: the Flare mark, white on transparent as Android requires.
     Generated from assets/icon-badge.svg by scripts/gen-icons.mjs. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
  android:width="24dp"
  android:height="24dp"
  android:viewportWidth="${vb}"
  android:viewportHeight="${vb}">
  <group android:translateX="-${off}" android:translateY="-${off}">
${paths.map((d) => `    <path android:fillColor="#FFFFFFFF" android:pathData="${d}" />`).join("\n")}
  </group>
</vector>
`,
);
console.log("Wrote mobile/modules/flare-push/.../ic_flare_notification.xml");
