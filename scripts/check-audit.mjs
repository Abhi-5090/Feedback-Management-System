#!/usr/bin/env node
/**
 * Fail the build on a known vulnerability, unless it carries a reasoned,
 * dated exception in scripts/audit-policy.json.
 *
 * `npm audit --audit-level=high` alone is a blunt instrument: it passes
 * silently on a pile of moderates, and when a moderate IS genuinely
 * unfixable the only options are to ignore the whole gate or to downgrade a
 * package and make things worse. Neither produces a trail of who decided what.
 *
 * So: high and critical always fail, no exceptions. Moderate and below fail
 * too, unless listed with a reason and an expiry — and when that expiry passes
 * the build fails again, which forces the judgement to be re-made rather than
 * quietly inherited by whoever comes next.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const WORKSPACES = ['FMS_Backend', 'FMS_Frontend'];
const BLOCKING = new Set(['high', 'critical']);
const RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };

const policy = JSON.parse(readFileSync(join(HERE, 'audit-policy.json'), 'utf8'));
const today = new Date().toISOString().slice(0, 10);

const exceptions = new Map(policy.exceptions.map((e) => [e.advisory, e]));
const problems = [];
const notes = [];

for (const ws of WORKSPACES) {
  let report;
  try {
    // `npm audit` exits non-zero when it finds anything, so the throw is the
    // normal path and the output we want is on stdout either way.
    report = execFileSync('npm', ['audit', '--omit=dev', '--json'], {
      cwd: join(ROOT, ws), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (err) {
    report = err.stdout;
  }
  if (!report) { problems.push(`${ws}: npm audit produced no output`); continue; }

  const { vulnerabilities = {} } = JSON.parse(report);
  for (const [name, v] of Object.entries(vulnerabilities)) {
    const severity = v.severity || 'unknown';
    const exception = exceptions.get(name);

    if (BLOCKING.has(severity)) {
      problems.push(`${ws}: ${severity.toUpperCase()} in ${name} — high and critical are never excepted`);
      continue;
    }
    if (!exception) {
      problems.push(`${ws}: ${severity} in ${name} — fix it, or add a reasoned exception to scripts/audit-policy.json`);
      continue;
    }
    if (!exception.expires) {
      problems.push(`${ws}: the exception for ${name} has no expiry date`);
      continue;
    }
    if (exception.expires < today) {
      problems.push(`${ws}: the exception for ${name} EXPIRED on ${exception.expires} — re-assess it`);
      continue;
    }
    if (RANK[severity] > RANK[exception.severity ?? 'moderate']) {
      problems.push(`${ws}: ${name} is now ${severity}, but its exception was written for ${exception.severity}`);
      continue;
    }
    notes.push(`${ws}: ${name} (${severity}) — excepted until ${exception.expires}`);
  }
}

// An exception for something that no longer appears is dead weight; say so,
// but do not fail the build over tidiness.
const seen = new Set(notes.map((n) => n.split(': ')[1].split(' ')[0]));
for (const name of exceptions.keys()) {
  if (!seen.has(name)) notes.push(`note: the exception for "${name}" matches nothing — it can be removed`);
}

for (const n of notes) console.log(`  ${n}`);
if (problems.length) {
  console.error(`\n${problems.length} dependency problem(s):`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log(`\nOK — no unaccepted vulnerabilities across ${WORKSPACES.join(', ')}.`);
