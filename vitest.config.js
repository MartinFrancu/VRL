import { defineConfig } from 'vitest/config';

// Two suites with very different costs, kept separable so the cheap one can be
// run constantly and the expensive one before a release.
//
//   npm run test:unit   the pure modules. about a second.
//   npm run test:e2e    a real browser filming real recordings. about a minute.
//   npm test            both.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          // Root level only — otherwise this picks up the browser tests too.
          include: ['*.test.js'],
        },
      },
      {
        test: {
          name: 'e2e',
          include: ['e2e/**/*.test.js'],
          // A bout takes seconds to film and the browser takes seconds to
          // start. Neither is a hang.
          testTimeout: 60_000,
          hookTimeout: 120_000,
          // One browser, one camera. Two files filming at once would be two
          // tests competing for the same fake device.
          fileParallelism: false,
        },
      },
    ],
  },
});
