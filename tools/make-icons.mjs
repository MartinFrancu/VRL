// Draws the app icons. Run when the mark changes, not on every build.
//
// A phone's home screen is a grid of 40px squares glanced at, never studied, so
// the icon has one idea and no detail: the instant that was marked, and the
// footage either side of it. Red for the mark, because the BOOKMARK button is
// red and that is the only thing in the app anyone will remember pressing.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../', import.meta.url));

const icon = (size) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: ${size}px; height: ${size}px; }
  svg { display: block; }
</style></head><body>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#0b0f12"/>
  <!-- The footage: a strip running through, dimmed either side of the mark. -->
  <rect x="64" y="196" width="384" height="120" rx="16" fill="#1d262c"/>
  <!-- Sprocket holes, so the strip reads as film at a glance. -->
  <g fill="#0b0f12">
    <rect x="88" y="216" width="34" height="30" rx="7"/>
    <rect x="88" y="266" width="34" height="30" rx="7"/>
    <rect x="390" y="216" width="34" height="30" rx="7"/>
    <rect x="390" y="266" width="34" height="30" rx="7"/>
  </g>
  <!-- The mark itself: one instant, straight through the middle. -->
  <rect x="240" y="150" width="32" height="212" rx="16" fill="#e05252"/>
  <!-- And that it can be played back. -->
  <path d="M175 236 L175 276 L143 256 Z" fill="#37c8d8"/>
  <path d="M337 236 L337 276 L369 256 Z" fill="#37c8d8"/>
</svg>
</body></html>`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const size of [180, 192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(icon(size));
  await page.screenshot({ path: `${OUT}icon-${size}.png`, omitBackground: false });
  await page.close();
  console.log(`wrote icon-${size}.png`);
}
await browser.close();
