// Draws the app icons from logo.png. Run it when the logo changes.
//
//   node tools/make-icons.mjs
//
// A home screen is a grid of forty-pixel squares glanced at and never studied,
// so the icon is the mark and nothing else: no text, no frame, no cleverness.
//
// The mark is composed onto a solid background rather than left transparent,
// because iOS renders transparency in a home-screen icon as black — which for
// a logo that is mostly black would quietly eat half of it. It is inset a
// little, because iOS masks the corners into a rounded square and anything
// touching an edge is what gets clipped.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** The ground the mark sits on. White, which is what it was drawn for. */
const BACKGROUND = process.env['ICON_BACKGROUND'] ?? '#ffffff';
/** How much of the square the mark fills, leaving room for the corner mask. */
const FILL = Number(process.env['ICON_FILL'] ?? 0.86);

const logo = `data:image/png;base64,${readFileSync(`${ROOT}logo.png`).toString('base64')}`;

const page = (size) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: ${size}px; height: ${size}px; }
  body {
    background: ${BACKGROUND};
    display: grid;
    place-content: center;
  }
  img { display: block; width: ${Math.round(size * FILL)}px; height: ${Math.round(size * FILL)}px; }
</style></head><body><img src="${logo}" alt=""></body></html>`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const size of [180, 192, 512]) {
  const tab = await browser.newPage({ viewport: { width: size, height: size } });
  await tab.setContent(page(size));
  await tab.screenshot({ path: `${ROOT}icon-${size}.png` });
  await tab.close();
  console.log(`wrote icon-${size}.png`);
}
await browser.close();
