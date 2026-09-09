#!/usr/bin/env node
/**
 * Fail if a JSX file uses a react-router export it never imported.
 *
 * This exists because of a real outage: `useLocation()` was added to
 * BatchFeedbackView without being added to its import list. A bare identifier
 * looks like a global to the bundler, so `vite build` reported success and the
 * failure only appeared in a browser — every "View feedback" link opened a
 * blank page.
 *
 * Deliberately narrow. A general "undefined identifier" check is ESLint's job;
 * this covers the specific family that bit us, costs nothing, and cannot
 * produce false positives on legitimate globals.
 *
 * Run:  node scripts/check-imports.mjs
 */
import { readFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOTS = ['FMS_Frontend/src'];
const ROUTER_NAMES = [
  'useLocation', 'useNavigate', 'useParams', 'useSearchParams',
  'useMatch', 'useOutletContext', 'Link', 'NavLink', 'Navigate',
  'Outlet', 'Routes', 'Route', 'MemoryRouter', 'BrowserRouter',
];

/* React hooks belong here for the same reason: adding a useEffect to a file
   that only imported useState builds cleanly and throws on render. That
   happened while wiring the dashboard comment filters. */
const REACT_NAMES = [
  'useState', 'useEffect', 'useCallback', 'useMemo', 'useRef',
  'useContext', 'useReducer', 'useId', 'useLayoutEffect', 'useTransition',
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.jsx') || full.endsWith('.js')) out.push(full);
  }
  return out;
}

let problems = 0;
let scanned = 0;

for (const root of ROOTS) {
  for (const file of walk(root)) {
    const src = readFileSync(file, 'utf8');
    if (!src.includes('react-router-dom')) {
      // A file that imports nothing from the router may still USE a name — but
      // then it is unambiguously a bug, so keep checking.
    }
    scanned += 1;

    /** Named imports from one module. */
    const namedFrom = (mod) => {
      const found = new Set();
      const re = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*['"]${mod}['"]`, 'g');
      for (const m of src.matchAll(re)) {
        for (const part of m[1].split(',')) {
          const name = part.trim().split(/\s+as\s+/)[0].trim();
          if (name) found.add(name);
        }
      }
      return found;
    };
    const routerImports = namedFrom('react-router-dom');
    const reactImports = namedFrom('react');

    // Strip imports and comments so a mention in prose is not a usage.
    const body = src
      .replace(/^\s*import[^\n]*\n/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/[^\n]*$/gm, '');

    for (const [names, imported, mod] of [
      [ROUTER_NAMES, routerImports, 'react-router-dom'],
      [REACT_NAMES, reactImports, 'react'],
    ]) {
      for (const name of names) {
        // A hook call `useX(` or a component `<X` / `<X>`. The negative
        // lookbehind skips `React.useState(` and `foo.useState(`, which are
        // qualified and therefore fine.
        const used = new RegExp(`((?<![.\\w])\\b${name}\\s*\\()|(<${name}[\\s/>])`).test(body);
        if (used && !imported.has(name)) {
          console.error(`FAIL ${file}: uses \`${name}\` but does not import it from ${mod}`);
          problems += 1;
        }
      }
    }
  }
}

console.log(`Scanned ${scanned} files for missing react and react-router imports.`);
if (problems) {
  console.error(`\n${problems} missing import(s). These build fine and crash at runtime.`);
  process.exit(1);
}
console.log('OK — every react and react-router name used is imported.');
