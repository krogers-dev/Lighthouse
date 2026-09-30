/** Derive the native icon set from the approved HIVE mark — reproducibly.
 *
 * The mark (assets/brand/hive-mark-primary-512.png) is the exact approved
 * transparent artwork; nothing here redraws it. This script only
 * resamples it and places it on the canvases the platforms require:
 *
 *   assets/images/icon.png                     1024² opaque Soft Black, mark 720 wide
 *   assets/images/adaptive-icon-foreground.png 1024² transparent, mark 440 wide
 *   assets/images/adaptive-icon-monochrome.png 1024² transparent, mark silhouette 440 wide
 *   assets/images/favicon.png                  64² transparent, mark 56 wide
 *
 * The adaptive foreground keeps the mark inside Android's 61 % safe circle
 * (a 440-wide mark's corner cells reach a 296-radius circle on a 1024
 * canvas, inside the 312 the mask guarantees), so no cell tip is clipped
 * under any launcher shape. The store master rule — opaque 1024 from the
 * vector source — is a separate packaging gate; this set serves the
 * development build. Pure Node: no image library, so the output is a
 * function of the mark's bytes and this file alone, and
 * tests/scripts/brand-icons.test.mjs holds the tree to it.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

export const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MARK_PATH = path.join(appRoot, 'assets/brand/hive-mark-primary-512.png');

const SOFT_BLACK = [0x11, 0x13, 0x10];

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

/** Decode an 8-bit RGBA, non-interlaced PNG into a flat RGBA buffer. */
export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('not a PNG');
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const bitDepth = buffer[24];
  const colorType = buffer[25];
  const interlace = buffer[28];
  if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) {
    throw new Error('expected an 8-bit RGBA non-interlaced PNG');
  }
  let pos = 8;
  const idat = [];
  while (pos < buffer.length) {
    const length = buffer.readUInt32BE(pos);
    const type = buffer.toString('latin1', pos + 4, pos + 8);
    if (type === 'IDAT') idat.push(buffer.subarray(pos + 8, pos + 8 + length));
    pos += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = width * bpp;
  const data = Buffer.alloc(width * height * bpp);
  let prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[p];
    const line = Buffer.from(raw.subarray(p + 1, p + 1 + stride));
    p += stride + 1;
    for (let i = 0; i < stride; i += 1) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let predictor = 0;
      if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`unsupported PNG filter ${filter}`);
      line[i] = (line[i] + predictor) & 255;
    }
    line.copy(data, y * stride);
    prev = line;
  }
  return { width, height, data };
}

export function encodePng({ width, height, data }) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Resample to `width` (height follows the source ratio). Each output
 * pixel is the mean of an n × n grid of bilinear samples in premultiplied
 * space, where n grows as the image shrinks, so downscaling averages the
 * source instead of dropping pixels and upscaling stays smooth. */
export function resample(src, width) {
  const height = Math.round((width * src.height) / src.width);
  const scale = width / src.width;
  const grid = Math.max(1, Math.ceil(1 / scale));
  const out = Buffer.alloc(width * height * 4);
  const sample = (fx, fy) => {
    const x0 = Math.max(0, Math.min(src.width - 1, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(src.height - 1, Math.floor(fy)));
    const x1 = Math.min(src.width - 1, x0 + 1);
    const y1 = Math.min(src.height - 1, y0 + 1);
    const tx = Math.max(0, Math.min(1, fx - x0));
    const ty = Math.max(0, Math.min(1, fy - y0));
    const acc = [0, 0, 0, 0];
    const taps = [
      [x0, y0, (1 - tx) * (1 - ty)],
      [x1, y0, tx * (1 - ty)],
      [x0, y1, (1 - tx) * ty],
      [x1, y1, tx * ty],
    ];
    for (const [x, y, w] of taps) {
      const i = (y * src.width + x) * 4;
      const a = src.data[i + 3] / 255;
      acc[0] += src.data[i] * a * w;
      acc[1] += src.data[i + 1] * a * w;
      acc[2] += src.data[i + 2] * a * w;
      acc[3] += a * w;
    }
    return acc;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const acc = [0, 0, 0, 0];
      for (let gy = 0; gy < grid; gy += 1) {
        for (let gx = 0; gx < grid; gx += 1) {
          const fx = ((x + (gx + 0.5) / grid) * src.width) / width - 0.5;
          const fy = ((y + (gy + 0.5) / grid) * src.height) / height - 0.5;
          const s = sample(fx, fy);
          for (let k = 0; k < 4; k += 1) acc[k] += s[k];
        }
      }
      const n = grid * grid;
      const alpha = acc[3] / n;
      const o = (y * width + x) * 4;
      if (alpha > 0) {
        out[o] = Math.round(acc[0] / n / alpha);
        out[o + 1] = Math.round(acc[1] / n / alpha);
        out[o + 2] = Math.round(acc[2] / n / alpha);
      }
      out[o + 3] = Math.round(alpha * 255);
    }
  }
  return { width, height, data: out };
}

export function canvas(size, rgb) {
  const data = Buffer.alloc(size * size * 4);
  if (rgb) {
    for (let i = 0; i < size * size; i += 1) {
      data[i * 4] = rgb[0];
      data[i * 4 + 1] = rgb[1];
      data[i * 4 + 2] = rgb[2];
      data[i * 4 + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

/** Standard "over" compositing of `layer` centred on `base`. */
export function composeCentred(base, layer, { silhouette = false } = {}) {
  const ox = Math.round((base.width - layer.width) / 2);
  const oy = Math.round((base.height - layer.height) / 2);
  for (let y = 0; y < layer.height; y += 1) {
    for (let x = 0; x < layer.width; x += 1) {
      const li = (y * layer.width + x) * 4;
      const sa = layer.data[li + 3] / 255;
      if (sa === 0) continue;
      const bi = ((oy + y) * base.width + (ox + x)) * 4;
      const da = base.data[bi + 3] / 255;
      const oa = sa + da * (1 - sa);
      for (let k = 0; k < 3; k += 1) {
        const sc = silhouette ? 255 : layer.data[li + k];
        const dc = base.data[bi + k];
        base.data[bi + k] = Math.round((sc * sa + dc * da * (1 - sa)) / oa);
      }
      base.data[bi + 3] = Math.round(oa * 255);
    }
  }
  return base;
}

export const ICON_SPECS = [
  { file: 'assets/images/icon.png', size: 1024, mark: 720, background: SOFT_BLACK },
  { file: 'assets/images/adaptive-icon-foreground.png', size: 1024, mark: 440 },
  { file: 'assets/images/adaptive-icon-monochrome.png', size: 1024, mark: 440, silhouette: true },
  { file: 'assets/images/favicon.png', size: 64, mark: 56 },
];

export function composeIcons(markPng = readFileSync(MARK_PATH)) {
  const mark = decodePng(markPng);
  const scaled = new Map();
  const marks = (width) => {
    if (!scaled.has(width)) scaled.set(width, resample(mark, width));
    return scaled.get(width);
  };
  return ICON_SPECS.map((spec) => ({
    file: spec.file,
    png: encodePng(
      composeCentred(canvas(spec.size, spec.background), marks(spec.mark), {
        silhouette: Boolean(spec.silhouette),
      }),
    ),
  }));
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  for (const { file, png } of composeIcons()) {
    writeFileSync(path.join(appRoot, file), png);
    console.log(`${createHash('sha256').update(png).digest('hex')}  ${png.length}  ${file}`);
  }
}
