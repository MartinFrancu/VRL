// A certificate for localhost, made on demand.
//
// The camera will not start without https, so every way of running this app
// locally needs one — the browser tests and `npm run serve`, which is how it
// gets onto a phone to be tried for real. Certificates are private keys, so
// they are not committed; they are generated on first use instead, which also
// means a fresh clone works without a setup step nobody remembers.
//
// Two details are not decoration, both learned from an iPhone refusing to load
// the page at all:
//
//   extendedKeyUsage = serverAuth   iOS 13 and later will not accept a
//                                   certificate for a server without it.
//   825 days                        Apple's maximum lifetime. A longer one is
//                                   rejected outright rather than warned about.
//
// The extensions go through a config file rather than `-addext`, because that
// flag is not in the LibreSSL that macOS ships as `openssl`.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CONFIG = `
[req]
distinguished_name = subject
x509_extensions    = extensions
prompt             = no

[subject]
CN = localhost

[extensions]
subjectAltName   = DNS:localhost, IP:127.0.0.1
extendedKeyUsage = serverAuth
basicConstraints = critical, CA:FALSE
keyUsage         = critical, digitalSignature, keyEncipherment
`;

/**
 * Make sure `dir` holds a key and certificate, generating them if not.
 *
 * @param {string} dir where to keep them
 * @returns {{key: string, cert: string}} the two paths
 */
export function ensureCerts(dir) {
  const key = join(dir, 'key.pem');
  const cert = join(dir, 'cert.pem');
  if (existsSync(key) && existsSync(cert)) return { key, cert };

  mkdirSync(dir, { recursive: true });
  const config = join(mkdtempSync(join(tmpdir(), 'vrl-cert-')), 'openssl.cnf');
  writeFileSync(config, CONFIG);

  try {
    execFileSync(
      'openssl',
      [
        'req', '-x509',
        '-newkey', 'rsa:2048',
        '-nodes',
        '-days', '825',
        '-keyout', key,
        '-out', cert,
        '-config', config,
      ],
      { stdio: 'pipe' }
    );
  } catch (error) {
    throw new Error(
      'could not make a certificate for localhost, so the app cannot be served ' +
        'over https and the camera will not start.\n' +
        'This needs `openssl` on the path.\n' +
        String(error.stderr ?? error.message)
    );
  }

  console.log(`  made a fresh certificate for localhost in ${dir}`);
  return { key, cert };
}
