import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * True when this module is the file node was asked to run, false when it was
 * imported by something else.
 *
 * WHY THIS EXISTS. Every script in src/scripts ended with a bare `main()` at
 * module scope, so importing one RAN it. That is untestable by construction —
 * and worse, it is dangerous: importing `reconcile-counters.js` to read a
 * helper out of it connects to whatever MONGO_URI points at and starts writing.
 * It happened while these very tests were being written, against production.
 * Nothing was lost, because that script only moves counters toward the truth,
 * but `import` is not supposed to be a destructive operation.
 *
 * realpath on both sides so a symlinked bin or a `npm run` shim still matches.
 */
export function isMain(importMetaUrl) {
  const invoked = process.argv[1];
  if (!invoked) return false;
  try {
    return realpathSync(fileURLToPath(importMetaUrl)) === realpathSync(invoked);
  } catch {
    return false;
  }
}
