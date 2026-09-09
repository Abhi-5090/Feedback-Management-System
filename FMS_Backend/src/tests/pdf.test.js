import { jest } from '@jest/globals';
import { buildPdfDocDefinition, buildPdf } from '../export/pdfBuilder.js';

jest.setTimeout(30_000);

/**
 * The PDF's CONTENT, asserted against the document definition rather than the
 * rendered bytes. Decompressing streams and pattern-matching text fragments
 * tests pdfmake's encoding, not the report.
 */
const row = (className, i, isoDate) => ({
  yearGroup: 'Third Year',
  className,
  batchName: 'AI Ready 2028 · Batch-2',
  dept: 'AIML',
  mainMentors: 'Bhargava R',
  supportMentors: 'Jayanth M',
  'Content clarity': 4,
  average: 4.1,
  comment: `${className} remark ${i}`,
  submittedAt: new Date(isoDate),
});

const report = (rows) => ({
  title: 'Batch Feedback — AI Ready 2028 · Batch-2',
  filterContext: 'Batch: AI Ready 2028 · Batch-2',
  generatedAt: new Date('2026-09-10T08:00:00Z'),
  overall: { feedbackCount: rows.length, overallAverage: 4.1 },
  summary: [{ label: 'Content clarity', average: 4.2, responses: rows.length }],
  parameters: [{ id: 'p1', label: 'Content clarity' }],
  rows,
  truncated: false,
});

/** Walk the definition and collect every table, in document order. */
function tables(def) {
  const found = [];
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    if (node.table) found.push(node.table);
    for (const v of Object.values(node)) walk(v);
  };
  walk(def.content);
  return found;
}

/** Every text node, in document order. */
function texts(def) {
  const found = [];
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    if (typeof node.text === 'string') found.push(node.text);
    for (const v of Object.values(node)) walk(v);
  };
  walk(def.content);
  return found;
}

const cell = (c) => (c && typeof c === 'object' && 'text' in c ? String(c.text) : String(c));

describe('PDF comments layout', () => {
  const rows = [
    row('GenAI', 1, '2026-09-08T10:00:00Z'),
    row('Coding', 1, '2026-09-09T10:00:00Z'),
    row('GenAI', 2, '2026-09-09T11:00:00Z'),
    row('Coding', 2, '2026-09-08T09:00:00Z'),
    row('GenAI', 3, '2026-09-09T12:00:00Z'),
  ];

  test('batch and class are SEPARATE columns, not joined into one', () => {
    const def = buildPdfDocDefinition(report(rows));
    // The comment tables are the ones whose header starts with Batch, Class.
    const commentTables = tables(def).filter((t) => {
      const head = t.body[0].map(cell);
      return head[0] === 'Batch' && head[1] === 'Class';
    });
    expect(commentTables.length).toBeGreaterThan(0);

    for (const t of commentTables) {
      expect(t.body[0].map(cell)).toEqual(['Batch', 'Class', 'Submitted', 'Avg (1-5)', 'Comment']);
      for (const r of t.body.slice(1)) {
        // Each cell holds ONE value; the old format put "batch · class" in one.
        expect(cell(r[0])).toBe('AI Ready 2028 · Batch-2');
        expect(['GenAI', 'Coding']).toContain(cell(r[1]));
        expect(cell(r[1])).not.toContain('Batch-2');
      }
    }
  });

  test('comments are grouped under a per-subject heading', () => {
    const def = buildPdfDocDefinition(report(rows));
    const all = texts(def);
    expect(all).toContain('Comments — GenAI  (3)');
    expect(all).toContain('Comments — Coding  (2)');
    // The busiest subject leads.
    expect(all.indexOf('Comments — GenAI  (3)')).toBeLessThan(
      all.indexOf('Comments — Coding  (2)')
    );
  });

  test('each subject block holds only its own comments', () => {
    const def = buildPdfDocDefinition(report(rows));
    const commentTables = tables(def).filter((t) => cell(t.body[0][0]) === 'Batch');
    for (const t of commentTables) {
      const subjects = new Set(t.body.slice(1).map((r) => cell(r[1])));
      expect(subjects.size).toBe(1);
    }
  });

  test('rows within a subject run oldest first, in submission order', () => {
    const def = buildPdfDocDefinition(report(rows));
    const genai = tables(def)
      .filter((t) => cell(t.body[0][0]) === 'Batch')
      .find((t) => cell(t.body[1][1]) === 'GenAI');
    const comments = genai.body.slice(1).map((r) => cell(r[4]));
    // GenAI 1 was submitted on the 8th, then 2 and 3 on the 9th.
    expect(comments).toEqual(['GenAI remark 1', 'GenAI remark 2', 'GenAI remark 3']);
  });

  test('a single-subject report still gets its heading', () => {
    const def = buildPdfDocDefinition(report([row('Python', 1, '2026-09-09T10:00:00Z')]));
    expect(texts(def)).toContain('Comments — Python  (1)');
  });

  test('a report with no comments has no comments section at all', () => {
    const bare = report([{ ...row('GenAI', 1, '2026-09-09T10:00:00Z'), comment: '' }]);
    const def = buildPdfDocDefinition(bare);
    expect(texts(def).some((t) => t.startsWith('Comments'))).toBe(false);
  });

  test('the definition still renders to real PDF bytes', async () => {
    const buf = await buildPdf(report(rows));
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    expect(buf.length).toBeGreaterThan(1000);
  });
});
