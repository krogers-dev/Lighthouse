/** The tracked native icons are exactly what scripts/brand-icons.mjs
 * derives from the approved mark: a hand-edited, re-exported, or redrawn
 * icon fails here. The derivation itself is checked for the properties
 * the platforms need. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { ICON_SPECS, appRoot, composeIcons, decodePng } from '../../scripts/brand-icons.mjs';

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const derived = composeIcons();

for (const spec of ICON_SPECS) {
  test(`${spec.file} matches the derivation from the approved mark byte for byte`, () => {
    const tracked = readFileSync(path.join(appRoot, spec.file));
    const produced = derived.find((icon) => icon.file === spec.file).png;
    assert.equal(sha256(tracked), sha256(produced));
  });
}

test('the iOS icon is an opaque 1024 square on Soft Black with the mark centred', () => {
  const icon = decodePng(derived.find((i) => i.file === 'assets/images/icon.png').png);
  assert.equal(icon.width, 1024);
  assert.equal(icon.height, 1024);
  const px = (x, y) => Array.from(icon.data.subarray((y * 1024 + x) * 4, (y * 1024 + x) * 4 + 4));
  assert.deepEqual(px(0, 0), [0x11, 0x13, 0x10, 255], 'corner is opaque Soft Black');
  assert.deepEqual(px(1023, 1023), [0x11, 0x13, 0x10, 255]);
  for (let i = 3; i < icon.data.length; i += 4) assert.equal(icon.data[i], 255);
  assert.notDeepEqual(px(512, 420), [0x11, 0x13, 0x10, 255], 'the ring sits at the centre');
});

test('the adaptive foreground keeps the whole mark inside the 61 % safe circle', () => {
  const icon = decodePng(
    derived.find((i) => i.file === 'assets/images/adaptive-icon-foreground.png').png,
  );
  assert.equal(icon.width, 1024);
  const limit = 0.305 * 1024; // radius of the guaranteed-visible circle
  let maxRadius = 0;
  for (let y = 0; y < 1024; y += 1) {
    for (let x = 0; x < 1024; x += 1) {
      if (icon.data[(y * 1024 + x) * 4 + 3] > 8) {
        maxRadius = Math.max(maxRadius, Math.hypot(x + 0.5 - 512, y + 0.5 - 512));
      }
    }
  }
  assert.ok(maxRadius > 0, 'the mark is present');
  assert.ok(maxRadius <= limit, `farthest artwork pixel ${maxRadius.toFixed(1)} <= ${limit}`);
  assert.equal(icon.data[3], 0, 'transparent outside the mark');
});

test('the monochrome layer is a white silhouette with the mark’s alpha', () => {
  const mono = decodePng(
    derived.find((i) => i.file === 'assets/images/adaptive-icon-monochrome.png').png,
  );
  let opaque = 0;
  for (let i = 0; i < mono.data.length; i += 4) {
    if (mono.data[i + 3] > 0) {
      opaque += 1;
      assert.deepEqual(Array.from(mono.data.subarray(i, i + 3)), [255, 255, 255]);
    }
  }
  assert.ok(opaque > 1000);
});
