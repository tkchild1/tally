import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

/**
 * Renders the app icons as opaque PNGs (iOS ignores transparency) without any image
 * dependencies: a blue tile with three ascending white bars. Run with `npm run icons`.
 */

type RGB = [number, number, number];
const BG: RGB = [0x1f, 0x4f, 0x8a];
const FG: RGB = [0xff, 0xff, 0xff];

function render(size: number, safeZone: number): Buffer {
  // Bars are laid out inside the central `safeZone` fraction of the canvas.
  const inset = (size * (1 - safeZone)) / 2;
  const inner = size * safeZone;
  const barW = inner * 0.16;
  const gap = inner * 0.1;
  const left = inset + (inner - (3 * barW + 2 * gap)) / 2;
  const bottom = inset + inner * 0.8;
  const heights = [0.3, 0.48, 0.66].map((h) => h * inner);

  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      let color = BG;
      for (let b = 0; b < 3; b++) {
        const x0 = left + b * (barW + gap);
        const top = bottom - (heights[b] ?? 0);
        if (x >= x0 && x < x0 + barW && y >= top && y < bottom) color = FG;
      }
      raw.set(color, row + 1 + x * 3);
    }
  }
  return png(size, size, raw);
}

function png(w: number, h: number, raw: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

const out = join(process.cwd(), 'public');
mkdirSync(out, { recursive: true });
const icons: Array<[string, number, number]> = [
  ['icon-192.png', 192, 0.8],
  ['icon-512.png', 512, 0.8],
  ['icon-maskable-512.png', 512, 0.6],
  ['apple-touch-icon.png', 180, 0.8],
];
for (const [name, size, safe] of icons) {
  writeFileSync(join(out, name), render(size, safe));
  console.log(`wrote public/${name}`);
}
