// Capture screenshots of the dev-only asset lab (dev/lab.html) for visual inspection.
// Usage: node scripts/lab-shots.mjs <outDir> mode:view[:light] ...
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const [outDir, ...combos] = process.argv.slice(2);
const base = process.env.LAB_URL ?? 'http://localhost:5173/dev/lab.html';
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 750 } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('  [console]', m.type(), m.text().slice(0, 200)); });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
for (const combo of combos) {
  const [mode, view, light = 'neutral', extra = ''] = combo.split(':');
  const url = `${base}?mode=${mode}&view=${view}&light=${light}${extra ? '&' + extra : ''}`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__labReady === true, null, { timeout: 60000 });
  await page.waitForTimeout(2500); // allow large textures to upload and re-render
  const file = path.join(outDir, `${mode}-${view}-${light}.png`);
  await page.screenshot({ path: file });
  console.log('saved', file);
}
await browser.close();
