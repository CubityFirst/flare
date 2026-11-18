// Generates the PNG app icons in public/icons from a simple vector description:
// a fuchsia rounded square with a white four-point "flare" star. No dependencies.
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const FUCHSIA = [0xc0, 0x26, 0xd3];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const SS = 4; // supersampling for antialiasing
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let acc = [0, 0, 0, 0];
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const [r, g, b, a] = pixel((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
          acc = [acc[0] + r * a, acc[1] + g * a, acc[2] + b * a, acc[3] + a];
        }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const a = acc[3] / (SS * SS);
      raw[o] = a ? Math.round(acc[0] / acc[3]) : 0;
      raw[o + 1] = a ? Math.round(acc[1] / acc[3]) : 0;
      raw[o + 2] = a ? Math.round(acc[2] / acc[3]) : 0;
      raw[o + 3] = Math.round(a * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function inRoundedSquare(x, y, r) {
  const cx = Math.min(Math.max(x, r), 1 - r), cy = Math.min(Math.max(y, r), 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

// Four-point star: |dx|^p + |dy|^p <= R^p with p < 1 gives concave sides.
function inStar(x, y, cx, cy, R) {
  const dx = Math.abs(x - cx) / R, dy = Math.abs(y - cy) / R;
  return Math.pow(dx, 0.5) + Math.pow(dy, 0.5) <= 1;
}

function glyph(x, y, scale) {
  return inStar(x, y, 0.5, 0.5, 0.36 * scale) || inStar(x, y, 0.735, 0.27, 0.11 * scale);
}

const icon = (scale, rounded) => (x, y) => {
  const bg = rounded ? inRoundedSquare(x, y, 0.22) : true;
  if (!bg) return [0, 0, 0, 0];
  return glyph(x, y, scale) ? [255, 255, 255, 1] : [...FUCHSIA, 1];
};

mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icons/icon-192.png", png(192, icon(1, true)));
writeFileSync("public/icons/icon-512.png", png(512, icon(1, true)));
writeFileSync("public/icons/icon-maskable-512.png", png(512, icon(0.75, false)));
writeFileSync("public/icons/apple-touch-icon.png", png(180, icon(1, false))); // iOS rounds corners itself
// Android status-bar badge: white glyph on transparent.
writeFileSync("public/icons/badge-96.png", png(96, (x, y) => (glyph(x, y, 1.15) ? [255, 255, 255, 1] : [0, 0, 0, 0])));
console.log("Wrote public/icons/*.png");
