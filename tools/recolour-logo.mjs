// Recolours the kite inside the logo, leaving everything else alone.
//
//   node tools/recolour-logo.mjs <out.png> [hue]
//
// Only the test build uses this. The real logo is the SBA's and does not
// change; what this produces is a copy whose gold field is a different colour,
// so a glance at a home screen says which build is installed.
//
// It rotates hue rather than swapping one colour for another, because the edges
// of the kite are antialiased: a pixel halfway between gold and black is a dark
// gold, and matching on an exact value would miss every one of them and leave a
// gold fringe around a blue shape. Keeping each pixel's saturation and lightness
// and moving only its hue takes the whole gradient with it, and leaves the black
// bird, the white eye and the transparent surround untouched, since none of them
// has a hue worth speaking of.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** The gold is hue 47°; this is the window counted as "the kite". */
const GOLD_RANGE = [20, 75];
/** Below this there is no colour to speak of — black, white, the surround. */
const MIN_SATURATION = 0.15;

export async function recolourLogo(outPath, hue = 217) {
  const source = `data:image/png;base64,${readFileSync(`${ROOT}logo.png`).toString('base64')}`;

  const browser = await chromium.launch({ executablePath: process.env['VRL_CHROMIUM'] || undefined });
  try {
    const page = await browser.newPage();
    const dataUrl = await page.evaluate(
      async ({ src, hue, range, minSaturation }) => {
        const image = new Image();
        image.src = src;
        await image.decode();

        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);

        const picture = context.getImageData(0, 0, canvas.width, canvas.height);
        const pixels = picture.data;

        for (let at = 0; at < pixels.length; at += 4) {
          const r = pixels[at] / 255;
          const g = pixels[at + 1] / 255;
          const b = pixels[at + 2] / 255;

          const high = Math.max(r, g, b);
          const low = Math.min(r, g, b);
          const spread = high - low;
          if (spread === 0) continue; // grey: the bird, the eye, the surround

          const lightness = (high + low) / 2;
          const saturation = spread / (1 - Math.abs(2 * lightness - 1));
          if (saturation < minSaturation) continue;

          let was =
            high === r ? ((g - b) / spread) % 6 : high === g ? (b - r) / spread + 2 : (r - g) / spread + 4;
          was *= 60;
          if (was < 0) was += 360;
          if (was < range[0] || was > range[1]) continue; // not the kite

          // Back to RGB with the new hue, keeping this pixel's own saturation
          // and lightness so the shading and the soft edges survive.
          const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
          const second = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
          const lift = lightness - chroma / 2;
          const [rr, gg, bb] =
            hue < 60 ? [chroma, second, 0]
            : hue < 120 ? [second, chroma, 0]
            : hue < 180 ? [0, chroma, second]
            : hue < 240 ? [0, second, chroma]
            : hue < 300 ? [second, 0, chroma]
            : [chroma, 0, second];

          pixels[at] = Math.round((rr + lift) * 255);
          pixels[at + 1] = Math.round((gg + lift) * 255);
          pixels[at + 2] = Math.round((bb + lift) * 255);
        }

        context.putImageData(picture, 0, 0);
        return canvas.toDataURL('image/png');
      },
      { src: source, hue, range: GOLD_RANGE, minSaturation: MIN_SATURATION }
    );

    writeFileSync(outPath, Buffer.from(dataUrl.split(',')[1], 'base64'));
    return outPath;
  } finally {
    await browser.close();
  }
}

// Run directly: node tools/recolour-logo.mjs <out.png> [hue]
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const out = process.argv[2];
  if (!out) {
    console.error('usage: node tools/recolour-logo.mjs <out.png> [hue]');
    process.exit(1);
  }
  await recolourLogo(out, Number(process.argv[3] ?? 217));
  console.log(`wrote ${out}`);
}
