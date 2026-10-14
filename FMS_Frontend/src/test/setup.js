import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';
import { MotionGlobalConfig } from 'framer-motion';

/**
 * Animations complete instantly under test.
 *
 * jsdom has no layout and no reliable animation frame, so a panel that
 * animates in exists in the DOM before React has settled the tree inside it.
 * Acting in that window succeeds most of the time and fails some of the time,
 * which is the worst available outcome: a suite that is wrong about whether
 * the product works, intermittently. Skipping animations removes the window
 * rather than each test guessing how long to wait for it.
 *
 * It does not weaken what the tests check. The assertions are about what the
 * UI does, not how long it takes to look like it.
 */
MotionGlobalConfig.skipAnimations = true;

/* Testing Library retries async queries for 1000ms by default. Several suites
   here render a page, resolve a mocked request, open a modal and then act —
   a chain that comfortably exceeds a second on a loaded machine, and the
   failure it produces is a timeout dressed up as "the button did nothing".
   Raising the budget costs nothing when things pass and removes a whole class
   of false failure when the machine is busy. */
configure({ asyncUtilTimeout: 5000 });

// RTL's auto-cleanup only registers with a global afterEach; register it
// explicitly so a leaked DOM from one test can never affect the next.
afterEach(() => {
  cleanup();
});
