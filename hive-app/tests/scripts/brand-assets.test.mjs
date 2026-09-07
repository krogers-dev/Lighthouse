/** Brand asset integrity (HIVE 2026 design package, 2026-09-07).
 *
 * The app bundles five static Manrope faces and the approved HIVE mark.
 * Each is the exact file the design handoff supplied: this suite ties the
 * tracked bytes to the handoff's own manifest (docs/design), checks the
 * faces really carry the weights their names promise (OS/2 usWeightClass,
 * and no variable-font axis to alias through), checks the mark is the
 * 512 × 460 transparent artwork, and checks the native configuration
 * carries the v3.0 colors. A swapped, re-exported, or redrawn asset fails
 * here before it reaches a device.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifestPath = path.join(
  appRoot,
  'docs/design/2026-09-07-hive-2026-design-package/asset-manifest.json',
);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const manifestHash = (name) => {
  const entry = manifest.assets.find((asset) => asset.path === `assets/${name}`);
  assert.ok(entry, `manifest lists assets/${name}`);
  return entry.sha256;
};

const FACES = [
  ['Manrope-400.ttf', 400, 'Manrope400'],
  ['Manrope-500.ttf', 500, 'Manrope500'],
  ['Manrope-600.ttf', 600, 'Manrope600'],
  ['Manrope-700.ttf', 700, 'Manrope700'],
  ['Manrope-800.ttf', 800, 'Manrope800'],
];

/** Minimal TrueType table directory + OS/2 weight + name-table family. */
function inspectFace(buffer) {
  const numTables = buffer.readUInt16BE(4);
  const tables = new Map();
  for (let i = 0; i < numTables; i += 1) {
    const record = 12 + 16 * i;
    tables.set(buffer.toString('latin1', record, record + 4), {
      offset: buffer.readUInt32BE(record + 8),
      length: buffer.readUInt32BE(record + 12),
    });
  }
  const os2 = tables.get('OS/2');
  assert.ok(os2, 'has an OS/2 table');
  const weightClass = buffer.readUInt16BE(os2.offset + 4);
  const name = tables.get('name');
  assert.ok(name, 'has a name table');
  const count = buffer.readUInt16BE(name.offset + 2);
  const stringOffset = buffer.readUInt16BE(name.offset + 4);
  let family = null;
  for (let i = 0; i < count; i += 1) {
    const record = name.offset + 6 + 12 * i;
    const platform = buffer.readUInt16BE(record);
    const nameId = buffer.readUInt16BE(record + 6);
    const length = buffer.readUInt16BE(record + 8);
    const offset = buffer.readUInt16BE(record + 10);
    if (platform === 3 && nameId === 1) {
      const start = name.offset + stringOffset + offset;
      family = buffer
        .subarray(start, start + length)
        .swap16()
        .toString('utf16le');
    }
  }
  return { weightClass, family, variable: tables.has('fvar') };
}

for (const [file, weight, family] of FACES) {
  test(`assets/fonts/${file} is the supplied static ${weight} face named ${family}`, () => {
    const buffer = readFileSync(path.join(appRoot, 'assets/fonts', file));
    assert.equal(sha256(buffer), manifestHash(file), 'bytes match the handoff manifest');
    const face = inspectFace(buffer);
    assert.equal(face.weightClass, weight, 'OS/2 usWeightClass is the weight in the name');
    assert.equal(face.family, family, 'internal family name is unique per weight');
    assert.equal(face.variable, false, 'a static instance, not a variable font');
  });
}

test('the font license and source notice ship beside the faces', () => {
  const ofl = readFileSync(path.join(appRoot, 'assets/fonts/OFL.txt'), 'utf8');
  assert.match(ofl, /SIL Open Font License, Version 1\.1/);
  assert.equal(sha256(Buffer.from(ofl)), manifestHash('OFL.txt'));
  const notice = readFileSync(path.join(appRoot, 'assets/fonts/Font-Source-Notice.txt'), 'utf8');
  assert.match(notice, /Manrope Project Authors/);
});

/** Decode an 8-bit RGBA PNG far enough to read its alpha channel. */
function decodeRgbaPng(buffer) {
  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'PNG signature');
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const bitDepth = buffer[24];
  const colorType = buffer[25];
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
  const stride = width * bpp + 1;
  const rows = [];
  let prev = Buffer.alloc(width * bpp);
  let p = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[p];
    const line = Buffer.from(raw.subarray(p + 1, p + 1 + width * bpp));
    p += stride;
    for (let i = 0; i < line.length; i += 1) {
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
      }
      line[i] = (line[i] + predictor) & 255;
    }
    rows.push(line);
    prev = line;
  }
  return { width, height, bitDepth, colorType, rows };
}

test('assets/brand/hive-mark-primary-512.png is the approved transparent 512 × 460 mark, unchanged', () => {
  const buffer = readFileSync(path.join(appRoot, 'assets/brand/hive-mark-primary-512.png'));
  assert.equal(sha256(buffer), manifestHash('hive-mark-primary-512.png'));
  assert.equal(manifest.active_in_app_mark, 'assets/hive-mark-primary-512.png');
  const png = decodeRgbaPng(buffer);
  assert.equal(png.width, 512);
  assert.equal(png.height, 460);
  assert.equal(png.bitDepth, 8);
  assert.equal(png.colorType, 6, 'RGBA: the mark carries real transparency');
  const alphaAt = (x, y) => png.rows[y][x * 4 + 3];
  // No backing rectangle: every corner is fully transparent.
  for (const [x, y] of [
    [0, 0],
    [511, 0],
    [0, 459],
    [511, 459],
  ]) {
    assert.equal(alphaAt(x, y), 0, `corner ${x},${y} is transparent`);
  }
  // The centre ring is opaque artwork.
  assert.ok(alphaAt(256, 160) > 200, 'the honeycomb ring is opaque');
});

test('app.json carries the Brand Kit v3.0 colors and no v2.0 value', () => {
  const raw = readFileSync(path.join(appRoot, 'app.json'), 'utf8');
  const { expo } = JSON.parse(raw);
  assert.equal(expo.backgroundColor, '#F3F2EA', 'window background is Warm Paper');
  const splash = expo.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen',
  );
  assert.deepEqual(splash[1], { backgroundColor: '#F3F2EA', dark: { backgroundColor: '#111310' } });
  assert.equal(
    expo.android.adaptiveIcon.backgroundColor,
    '#111310',
    'adaptive icon sits on Soft Black',
  );
  assert.equal(
    expo.android.adaptiveIcon.backgroundImage,
    undefined,
    'color, not a placeholder image',
  );
  for (const retired of ['#F4E4CD', '#0A0B0A', '#EEA723', '#F5BC49', '#6C6B66']) {
    assert.equal(raw.includes(retired), false, `${retired} (Brand Kit v2.0) no longer appears`);
  }
});

test('the token module carries no Brand Kit v2.0 value', () => {
  const tokens = readFileSync(path.join(appRoot, 'src/ui/tokens.ts'), 'utf8');
  for (const retired of ['#F4E4CD', '#0A0B0A', '#EEA723', '#F5BC49', '#6C6B66', '#FFFFFF']) {
    assert.equal(tokens.includes(retired), false, `${retired} no longer appears in tokens.ts`);
  }
  for (const current of [
    '#111310',
    '#0B0C0A',
    '#F3F2EA',
    '#E7E6DD',
    '#E8C655',
    '#F2DA82',
    '#A6ADA0',
    '#D7D9CF',
    '#684F00',
    '#5B5E55',
    '#9D3E25',
    '#365B2B',
  ]) {
    assert.equal(tokens.includes(current), true, `${current} is in tokens.ts`);
  }
});
