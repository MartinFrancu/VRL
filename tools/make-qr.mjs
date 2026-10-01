// Draws the QR of the app's own address. Run it if that address ever changes.
//
//   node tools/make-qr.mjs
//
// Generated once rather than drawn in the browser, because the address is
// fixed and a QR encoder is several hundred lines to carry around for a picture
// that never changes. The result is a file like any other — cached by the
// service worker, so it is there in a hall with no signal, which is exactly
// where somebody asks how to get this on their phone.
import QRCode from 'qrcode';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const URL_ = process.env['APP_URL'] ?? 'https://martinfrancu.github.io/VRL/';

const svg = await QRCode.toString(URL_, {
  type: 'svg',
  // A quiet margin, or a scanner cannot find the edges against a dark screen.
  margin: 2,
  errorCorrectionLevel: 'M',
  color: { dark: '#000000', light: '#ffffff' },
});

writeFileSync(`${ROOT}qr.svg`, svg);
console.log(`wrote qr.svg for ${URL_}`);
