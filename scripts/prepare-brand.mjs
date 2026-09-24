#!/usr/bin/env node
/**
 * Brand assets for the prototype, derived from the official files in Convalt_Energy_Images/
 * (preserved untouched).
 *
 * The official logo.png (988×304) is a white wordmark for dark backgrounds, with transparent
 * padding around the artwork (884×266 at 56,19) — displayed as-is, its visible lettering was ≈ 10%
 * smaller than its box. The derivatives are trimmed to the artwork bounds (+2 px so antialiased
 * edges are never clipped) and exported at 400 px wide, enough for ≈ 160 CSS px on 2.5× screens.
 * The ivory scenes use a single-colour petrol version made by recolouring the same artwork (alpha
 * preserved, shapes untouched — the logo is not redrawn). Confirm with the brand guidelines.
 */
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'Convalt_Energy_Images', 'logos_icons');
const OUT = path.join(ROOT, 'public', 'brand');
fs.mkdirSync(OUT, { recursive: true });

const PETROL = [0x12, 0x33, 0x36];
const WIDTH = 400;
const MARGIN = 2;

const original = path.join(SRC, 'logo.png');
const trimmed = await sharp(original).ensureAlpha().trim({ threshold: 1 }).toBuffer({ resolveWithObject: true });
const framed = await sharp(trimmed.data)
  .extend({ top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN, background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const { data, info } = framed;
const tinted = Buffer.from(data);
for (let i = 0; i < tinted.length; i += 4) { tinted[i] = PETROL[0]; tinted[i + 1] = PETROL[1]; tinted[i + 2] = PETROL[2]; }
for (const [name, buf] of [['convalt-logo-petrol', tinted], ['convalt-logo-white', data]]) {
  await sharp(buf, { raw: info }).resize({ width: WIDTH, kernel: 'lanczos3' }).webp({ lossless: true }).toFile(path.join(OUT, `${name}.webp`));
  await sharp(buf, { raw: info }).resize({ width: WIDTH, kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toFile(path.join(OUT, `${name}.png`));
}
const meta = await sharp(path.join(OUT, 'convalt-logo-white.webp')).metadata();
await sharp(path.join(SRC, 'fav_32x32.png')).png().toFile(path.join(OUT, 'favicon-32.png'));
await sharp(path.join(SRC, 'fav_310x310.png')).resize(180, 180).png().toFile(path.join(OUT, 'apple-touch-icon.png'));
console.log(`logo: artwork ${trimmed.info.width}×${trimmed.info.height} (trimmed from ${(await sharp(original).metadata()).width}×${(await sharp(original).metadata()).height}) → ${meta.width}×${meta.height} derivatives`);
for (const f of fs.readdirSync(OUT)) console.log(' ', f, fs.statSync(path.join(OUT, f)).size, 'bytes');
