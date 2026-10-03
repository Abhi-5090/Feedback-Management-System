/**
 * Design-review capture — screenshots of every page in both themes.
 *
 * A separate config from playwright.config.js on purpose: this suite asserts
 * nothing, so it must never be able to gate a build. It reuses the same two
 * web servers, which means the app under review is the real build served the
 * way production serves it, not a dev server.
 *
 * Run: npm run review:shots
 */
import base from './playwright.config.js';

export default {
  ...base,
  testDir: './e2e/review',
  testIgnore: undefined,
  retries: 0,
  reporter: [['list']],
};
