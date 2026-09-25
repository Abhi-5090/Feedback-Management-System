import { jest } from '@jest/globals';
import zlib from 'zlib';
import {
  buildPdfDocDefinition,
  buildPdf,
  detailColumnWidths,
  summaryColumnWidths,
  PAGE,
  PAGE_PORTRAIT,
} from '../export/pdfBuilder.js';

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

/* Comment tables, identified by their last header being "Comment".
   Matching on the first two headers is no longer enough: the detail ratings
   table also begins Batch, Class since the Year column was dropped. */
const commentTables = (def) =>
  tables(def).filter((t) => cell(t.body[0][t.body[0].length - 1]) === 'Comment');

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
    const found = commentTables(def);
    expect(found.length).toBeGreaterThan(0);

    for (const t of found) {
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
    for (const t of commentTables(def)) {
      const subjects = new Set(t.body.slice(1).map((r) => cell(r[1])));
      expect(subjects.size).toBe(1);
    }
  });

  test('rows within a subject run oldest first, in submission order', () => {
    const def = buildPdfDocDefinition(report(rows));
    const genai = commentTables(def).find((t) => cell(t.body[1][1]) === 'GenAI');
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

describe('PDF detail table fits the page', () => {
  /**
   * The ratings table ran off the right edge of the sheet, taking the average
   * and submitted columns with it. pdfmake gives no warning for this — it
   * simply draws past the paper — so the only way to know was to open the file
   * and look.
   *
   * Cause: every column was 'auto', which sizes to the widest unbroken content,
   * and the headers were full parameter names ("Real-world / practical
   * examples"). Eight of those cannot share an A4 landscape page at a readable
   * size, before counting 16pt of padding per column across fifteen columns.
   *
   * These assert the geometry directly, so a future column or a wider padding
   * fails here instead of in a printout someone is holding in a meeting.
   */
  const measure = (n) => {
    const { widths, padding, borders } = detailColumnWidths(n);
    return widths.reduce((a, b) => a + b, 0) + padding + borders;
  };

  test.each([1, 2, 4, 8, 10, 12, 16])('fits with %i rating parameters', (n) => {
    expect(measure(n)).toBeLessThanOrEqual(PAGE.printable);
  });

  test('keeps a safety margin rather than landing exactly on the edge', () => {
    // Exact arithmetic still rounds; a table 1pt inside the page is luck.
    expect(PAGE.printable - measure(8)).toBeGreaterThanOrEqual(5);
  });

  test('every column has a real width — no "auto" can creep back in', () => {
    const { widths } = detailColumnWidths(8);
    for (const w of widths) {
      expect(typeof w).toBe('number');
      expect(w).toBeGreaterThan(0);
    }
  });

  test('text columns never collapse below a legible width', () => {
    // With many parameters the flexible share shrinks; it must not vanish.
    const { widths } = detailColumnWidths(16);
    expect(Math.min(...widths.slice(0, 4))).toBeGreaterThanOrEqual(40);
  });

  test('the detail table uses coded headers with a legend beneath', () => {
    const params = [
      'Content clarity',
      "Trainer's subject knowledge",
      'Real-world / practical examples',
    ];
    const rows = [
      {
        batchName: 'AI Ready 2028 · Batch-2',
        className: 'GenAI',
        mainMentors: 'Bhargava R',
        supportMentors: 'Jayanth M',
        average: 4.25,
        comment: 'ok',
        submittedAt: new Date('2026-09-09T10:00:00Z'),
        ...Object.fromEntries(params.map((l) => [l, 4])),
      },
    ];
    const def = buildPdfDocDefinition({
      title: 'T',
      filterContext: 'F',
      generatedAt: new Date(),
      overall: { feedbackCount: 1, overallAverage: 4.25 },
      summary: params.map((l) => ({ label: l, average: 4.2, responses: 1 })),
      parameters: params.map((l, i) => ({ id: `p${i}`, label: l })),
      rows,
      truncated: false,
    });

    const found = [];
    const walk = (n) => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (!n || typeof n !== 'object') return;
      if (n.table) found.push(n.table);
      for (const v of Object.values(n)) walk(v);
    };
    walk(def.content);

    const detail = found.find((t) => String(t.body[0][0].text) === 'Batch' && t.body[0].length > 6);
    expect(detail).toBeDefined();
    const header = detail.body[0].map((c) => String(c.text));
    // Codes, not the full labels that made the table too wide to fit.
    expect(header).toEqual([
      'Batch',
      'Class',
      'Main mentor(s)',
      'Support mentor(s)',
      'P1',
      'P2',
      'P3',
      'Avg',
      'Submitted',
    ]);
    // And the legend that makes them readable is present.
    const texts = [];
    const walkText = (n) => {
      if (Array.isArray(n)) return n.forEach(walkText);
      if (!n || typeof n !== 'object') return;
      if (typeof n.text === 'string') texts.push(n.text);
      for (const v of Object.values(n)) walkText(v);
    };
    walkText(def.content);
    expect(texts).toContain('P1 = Content clarity');
    expect(texts).toContain("P3 = Real-world / practical examples");
  });

  test('the Year column is gone — it repeated on every row', () => {
    const def = buildPdfDocDefinition({
      title: 'T',
      filterContext: 'F',
      generatedAt: new Date(),
      overall: { feedbackCount: 0, overallAverage: 0 },
      summary: [],
      parameters: [{ id: 'p1', label: 'Content clarity' }],
      rows: [
        {
          yearGroup: 'Third Year',
          batchName: 'B',
          className: 'C',
          mainMentors: 'M',
          supportMentors: 'S',
          'Content clarity': 4,
          average: 4,
          comment: '',
          submittedAt: new Date(),
        },
      ],
      truncated: false,
    });
    const found = [];
    const walk = (n) => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (!n || typeof n !== 'object') return;
      if (n.table) found.push(n.table);
      for (const v of Object.values(n)) walk(v);
    };
    walk(def.content);
    const detail = found.find((t) => String(t.body[0][0].text) === 'Batch');
    expect(detail.body[0].map((c) => String(c.text))).not.toContain('Year');
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   The crisp dashboard summary — Batch | Mentor | Rating, and nothing else.

   The dashboard used to export the full report: per-parameter averages, one
   row per submission, and every comment. On real data that was 94 landscape
   pages, and the thing anyone actually wanted from it — how each mentor is
   scoring in each batch — was buried inside it. These tests pin the new
   layout down to "three columns, one table, no comments", because the easy
   way to lose it is for a later change to the shared builder to quietly put a
   section back.
   ════════════════════════════════════════════════════════════════════════ */

const mentorRow = (batchName, className, mentorName, average) => ({
  batchName,
  className,
  mentorName,
  average,
  responses: 12,
});

const summaryReport = (mentorRows) => ({
  layout: 'summary',
  title: 'Feedback Summary — Mentor Ratings',
  filterContext: 'All data',
  generatedAt: new Date('2026-09-10T08:00:00Z'),
  overall: { feedbackCount: 128, overallAverage: 4.17 },
  mentorRows,
});

/** Right-most x coordinate anything is DRAWN at, across every page. */
function rightMostMark(buf) {
  const num = '(-?\\d+(?:\\.\\d+)?)';
  const ops = [
    new RegExp(`${num} ${num} ${num} ${num} re`, 'g'), // rectangles (fills, rules)
    new RegExp(`${num} ${num} (?:m|l)\\b`, 'g'), // path moves/lines
    new RegExp(`${num} ${num} (?:Td|TD)\\b`, 'g'), // text placement
  ];
  let maxX = -Infinity;
  let i = 0;
  while (true) {
    const start = buf.indexOf('stream', i);
    if (start === -1) break;
    let from = start + 6;
    if (buf[from] === 0x0d) from++;
    if (buf[from] === 0x0a) from++;
    const end = buf.indexOf('endstream', from);
    if (end === -1) break;
    let content = null;
    try {
      content = zlib.inflateSync(buf.subarray(from, end)).toString('latin1');
    } catch {
      /* font programs and other binary streams are not page content */
    }
    if (content) {
      for (const [opIndex, re] of ops.entries()) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(content))) {
          // A rectangle's right edge is x + width; everything else starts at x.
          const x = opIndex === 0 ? +m[1] + +m[3] : +m[1];
          if (Number.isFinite(x) && x > maxX) maxX = x;
        }
      }
    }
    i = end + 9;
  }
  return maxX;
}

describe('crisp dashboard summary PDF', () => {
  /* The shape the user described: one cohort, two subjects, several mentors.
     "2nd Year Credit Course is there, in that we have two things, like a Java
     and DS" — the subject has to be on the sheet, and the batch name must not
     be printed once per mentor. */
  const rows = [
    mentorRow('2nd Year Credit Course', 'DS', 'Abraham', 4.68),
    mentorRow('2nd Year Credit Course', 'DS', 'Bhargav', 4.68),
    mentorRow('2nd Year Credit Course', 'JAVA', 'Naveen', 4.74),
    mentorRow('AI Ready 2027 · Batch-1', 'Coding', 'Harika', 3.36),
  ];
  const def = buildPdfDocDefinition(summaryReport(rows));

  const blocks = () => tables(def);
  /** The batch band is the first row of a block, spanning every column. */
  const bandOf = (t) => cell(t.body[0][0]);

  test('one block per BATCH, not one row per mentor', () => {
    expect(blocks()).toHaveLength(2);
    expect(blocks().map(bandOf)).toEqual(['2nd Year Credit Course', 'AI Ready 2027 · Batch-1']);
  });

  test('the batch name is printed ONCE, however many mentors it has', () => {
    /* The complaint that prompted this layout: "2nd Year Credit Course is
       there, it's for four times". Counting every occurrence across the whole
       document is the only assertion that actually catches a regression to a
       repeated column. */
    const occurrences = texts(def).filter((t) => t === '2nd Year Credit Course');
    expect(occurrences).toHaveLength(1);
  });

  test('the band spans the full width so nothing sits beside it', () => {
    const band = blocks()[0].body[0];
    expect(band[0].colSpan).toBe(3);
    expect(band).toHaveLength(3); // the two placeholders pdfmake requires
  });

  test('the columns beneath a band are Subject, Mentor, Rating', () => {
    expect(blocks()[0].body[1].map(cell)).toEqual(['Subject', 'Mentor', 'Rating (out of 5)']);
  });

  test('every subject in a batch appears, each row naming its own', () => {
    const body = blocks()[0].body.slice(2).map((r) => r.map(cell));
    expect(body).toEqual([
      ['DS', 'Abraham', '4.68'],
      ['DS', 'Bhargav', '4.68'],
      // Repeated rather than blanked after the first: a group that straddles a
      // page break would otherwise leave a mentor under no subject at all.
      ['JAVA', 'Naveen', '4.74'],
    ]);
  });

  test('both the band and the column labels repeat after a page break', () => {
    // headerRows: 2 — a continued batch must not arrive as an unlabelled list.
    expect(blocks()[0].headerRows).toBe(2);
  });

  test('prints no comments, no per-parameter breakdown, no submission dates', () => {
    const all = texts(def).join(' ');
    expect(all).not.toMatch(/Comment/i);
    expect(all).not.toMatch(/Averages per parameter/i);
    expect(all).not.toMatch(/Individual feedback/i);
    expect(all).not.toMatch(/Submitted/i);
  });

  test('is portrait — three columns on a landscape sheet read as unfinished', () => {
    expect(def.pageOrientation).toBe('portrait');
    expect(def.pageSize).toBe('A4');
  });

  test('a mentor with no rating shows a dash, not 0.00', () => {
    // 0.00 is a real score a mentor could receive; "no data" must not wear it.
    const d = buildPdfDocDefinition(summaryReport([mentorRow('B', 'Java', 'M', null)]));
    expect(cell(tables(d)[0].body[2][2])).toBe('—');
  });

  test('an empty selection says so instead of printing a headerless table', () => {
    const d = buildPdfDocDefinition(summaryReport([]));
    expect(tables(d)).toHaveLength(0);
    expect(texts(d).join(' ')).toMatch(/No feedback has been submitted/i);
  });

  test('the header counts batches and sessions, not just responses', () => {
    const head = JSON.stringify(def.header());
    expect(head).toContain('128 responses');
    expect(head).toContain('4.17 / 5');
    expect(head).toContain('2 batches');
    expect(head).toContain('4 sessions');
    expect(head).toContain('All data');
  });

  test('a single-batch, single-mentor export still reads as a block', () => {
    const d = buildPdfDocDefinition(summaryReport([mentorRow('Solo', 'Java', 'Naveen', 5)]));
    expect(JSON.stringify(d.header())).toContain('1 batch ');
    const body = tables(d)[0].body;
    // The band's two trailing cells are the empty placeholders a colSpan needs.
    expect(cell(body[0][0])).toBe('Solo');
    expect(body[0].slice(1)).toEqual([{}, {}]);
    expect(body.slice(1).map((r) => r.map(cell))).toEqual([
      ['Subject', 'Mentor', 'Rating (out of 5)'],
      ['Java', 'Naveen', '5.00'],
    ]);
  });

  describe('alignment', () => {
    test('the table fits the printable width of A4 portrait', () => {
      const { widths, padding, borders } = summaryColumnWidths();
      const total = widths.reduce((a, b) => a + b, 0) + padding + borders;
      expect(total).toBeLessThanOrEqual(PAGE_PORTRAIT.printable);
    });

    test('keeps a safety margin rather than landing exactly on the edge', () => {
      const { widths, padding, borders } = summaryColumnWidths();
      const total = widths.reduce((a, b) => a + b, 0) + padding + borders;
      expect(PAGE_PORTRAIT.printable - total).toBeGreaterThanOrEqual(4);
    });

    test('every column has a real, legible width — no "auto"', () => {
      for (const w of summaryColumnWidths().widths) {
        expect(typeof w).toBe('number');
        expect(w).toBeGreaterThanOrEqual(70);
      }
    });

    test('nothing is DRAWN past the page edge in the rendered bytes', async () => {
      /* The one test that reads the rendered PDF rather than the definition,
         and it earns it: pdfmake draws straight past the sheet without error,
         so the only proof that a column fits is where the ink lands. Long
         names on purpose — the widths have to survive real data. */
      const long = Array.from({ length: 40 }, (_, i) =>
        mentorRow(
          'Advanced Placement Readiness 2026 · Batch-3',
          i % 3 ? 'Industry Readiness 1' : 'Data Structures',
          i % 2 ? 'Harshavardhini' : 'Kiran Immandi',
          3 + (i % 20) / 10
        )
      );
      const buf = await buildPdf(summaryReport(long));
      const rightMost = rightMostMark(buf);
      /* Guard the guard. If the streams ever stop inflating — a pdfmake
         upgrade, a different filter — rightMost is -Infinity and the fit
         assertion below passes for a PDF nobody measured. Proving ink was
         found near the right margin is what makes the next line mean
         something. */
      expect(rightMost).toBeGreaterThan(PAGE_PORTRAIT.printable / 2);
      expect(rightMost).toBeLessThanOrEqual(PAGE_PORTRAIT.width);
    });
  });

  test('the full report layout is untouched when no layout is set', () => {
    // The class/batch/mentor exports still print everything.
    const full = buildPdfDocDefinition(report([row('GenAI', 1, '2026-09-01T10:00:00Z')]));
    expect(full.pageOrientation).toBe('landscape');
    expect(tables(full).length).toBeGreaterThan(1);
    expect(texts(full).join(' ')).toMatch(/Averages per parameter/);
  });
});
