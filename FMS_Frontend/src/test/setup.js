import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// RTL's auto-cleanup only registers with a global afterEach; register it
// explicitly so a leaked DOM from one test can never affect the next.
afterEach(() => {
  cleanup();
});
