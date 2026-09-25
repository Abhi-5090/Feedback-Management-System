import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

/**
 * PDF export via pdfmake (pure JS — no headless Chromium to install/run, which
 * makes it reliable in Docker/CI). Output is a print-clean report:
 *   - every DATA cell centered horizontally AND vertically (symmetric cell
 *     padding + single-line rows in the numeric tables → true centering),
 *   - visible gridlines/borders, consistent padding, even column spacing,
 *   - header row repeats on every page (table.headerRows),
 *   - page header shows title + active-filter context + generated-on timestamp,
 *   - page footer shows "Page X of Y",
 *   - numbers formatted to 2 decimals.
 *
 * pdfmake's node printer needs font files on disk. We extract the Roboto TTFs
 * that ship inside pdfmake's own vfs bundle to a temp dir once, so there is no
 * network dependency and nothing extra to install.
 */

let printerPromise = null;

function loadVfs() {
  const mod = require('pdfmake/build/vfs_fonts.js');
  return mod?.pdfMake?.vfs || mod?.vfs || mod?.default?.pdfMake?.vfs || mod?.default?.vfs || mod;
}

function getPrinter() {
  if (printerPromise) return printerPromise;
  printerPromise = (async () => {
    const PdfPrinter = require('pdfmake');
    const vfs = loadVfs();
    const dir = path.join(os.tmpdir(), 'fms-pdf-fonts');
    fs.mkdirSync(dir, { recursive: true });

    const files = {
      normal: 'Roboto-Regular.ttf',
      bold: 'Roboto-Medium.ttf',
      italics: 'Roboto-Italic.ttf',
      bolditalics: 'Roboto-MediumItalic.ttf',
    };
    const fontDef = {};
    for (const [style, file] of Object.entries(files)) {
      const dest = path.join(dir, file);
      if (!fs.existsSync(dest)) {
        const b64 = vfs[file];
        if (!b64) throw new Error(`pdfmake vfs missing font ${file}`);
        fs.writeFileSync(dest, Buffer.from(b64, 'base64'));
      }
      fontDef[style] = dest;
    }
    return new PdfPrinter({ Roboto: fontDef });
  })();
  return printerPromise;
}

/**
 * Export palette — the same Torii tokens the app uses, so a downloaded report
 * is recognisably the same product as the screen it came from. These were
 * indigo, left over from before the rebrand.
 *
 *   BRAND  #EA5829  Torii-gate vermilion (header fills, section titles)
 *   GRID   #E5E7EB  the app's border token
 *   ZEBRA  #FDF3EF  a warm tint derived from brand-50, so alternating rows
 *                   read as part of the brand rather than a cool grey-blue
 */
const BRAND = '#EA5829';
/* A light brand tint for the summary's column labels. Stacking two solid brand
   rows — the batch band and the labels beneath it — puts a thick orange slab at
   the top of every block and flattens the hierarchy: the batch name stops
   looking like the heading it is. */
const BRAND_TINT = '#FBDDD1';
const BRAND_INK = '#A33C18';
const GRID = '#E5E7EB';
const ZEBRA = '#FDF3EF';
const fmt = (n) => (Number(n) || 0).toFixed(2);

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

// A shared table layout: gridlines, symmetric padding (→ vertical centering),
// indigo header fill, zebra striping.
/* A4 landscape, in points, with the page margins this document uses.
   The detail table is the only thing in the report that can overflow, and it
   overflows silently — pdfmake just draws past the edge — so its widths are
   computed against this budget rather than guessed. */
export const PAGE = {
  width: 841.89, // A4 landscape
  marginX: 32,
  get printable() {
    return this.width - this.marginX * 2; // 777.89pt
  },
};

// Roomier than the dense grid: the summary has three columns, not fifteen.
const SUMMARY_PADDING = { left: 10, right: 10 };

/* The summary PDF is PORTRAIT. Three columns on a landscape sheet leave two
   thirds of the page empty, which reads as a table someone forgot to finish.
   Portrait A4 is also the shape people print and file. */
export const PAGE_PORTRAIT = {
  width: 595.28, // A4 portrait
  marginX: 40,
  get printable() {
    return this.width - this.marginX * 2; // 515.28pt
  },
};

/**
 * Column widths for the three-column summary table: Batch | Mentor | Rating.
 *
 * Computed against the real budget for the same reason the detail table's are
 * — pdfmake draws straight past the page edge without complaint — and exported
 * so a test can assert the fit rather than trusting the arithmetic.
 */
export function summaryColumnWidths() {
  const columns = 3;
  const padding = columns * (SUMMARY_PADDING.left + SUMMARY_PADDING.right);
  const borders = (columns + 1) * 0.7;
  const SAFETY = 6;
  const budget = PAGE_PORTRAIT.printable - padding - borders - SAFETY;

  // "4.25" centred; the rest of the page belongs to the two name columns.
  const ratingWidth = 76;
  const flexible = budget - ratingWidth;
  /* Subject names are short ("Java", "DS", "GenAI"); mentor names are not, and
     a wrapped name in a three-column table is the thing that makes a printed
     sheet look broken. */
  const subjectWidth = Math.floor(flexible * 0.4);
  const mentorWidth = Math.floor(flexible - subjectWidth);

  return { columns, padding, borders, budget, widths: [subjectWidth, mentorWidth, ratingWidth] };
}

/**
 * A tighter layout for the wide ratings table.
 *
 * The standard 8pt of horizontal padding is right for a three-column summary
 * and ruinous for a fifteen-column grid: padding alone consumed 240pt of a
 * 778pt page, leaving barely two thirds for the actual data. Halving it buys
 * back 120pt — the difference between the table fitting and running off the
 * sheet.
 */
const densePadding = { left: 4, right: 4 };

const denseTableLayout = {
  hLineWidth: () => 0.7,
  vLineWidth: () => 0.7,
  hLineColor: () => GRID,
  vLineColor: () => GRID,
  paddingTop: () => 5,
  paddingBottom: () => 5,
  paddingLeft: () => densePadding.left,
  paddingRight: () => densePadding.right,
  fillColor: (rowIndex) => (rowIndex === 0 ? BRAND : rowIndex % 2 === 0 ? ZEBRA : null),
};

/**
 * Column widths for the detail table that are GUARANTEED to fit the page.
 *
 * pdfmake's 'auto' sizes a column to its widest unbroken content, so eight
 * headers like "Real-world / practical examples" produced a table far wider
 * than A4 and the right-hand columns — average, submitted — were simply drawn
 * off the sheet. Nothing warns you; the PDF just renders cut off.
 *
 * Fixed numbers computed from the real budget make that impossible. Text
 * columns take a proportional share of whatever the fixed columns leave, so
 * adding or removing a rating parameter re-balances instead of overflowing.
 */
export function detailColumnWidths(paramCount) {
  const columns = 4 + paramCount + 2; // batch, class, main, support, …, avg, submitted
  const padding = columns * (densePadding.left + densePadding.right);
  const borders = (columns + 1) * 0.7;
  /* A few points held back. The arithmetic here is exact, but pdfmake rounds
     and a glyph wider than expected in one header can nudge a column; landing
     1pt inside the page is not a margin, it is luck. */
  const SAFETY = 8;
  const budget = PAGE.printable - padding - borders - SAFETY;

  // Numeric columns are sized to their content, which is known and short.
  const paramWidth = 20; // fits "4" under a two-character code
  const avgWidth = 26; // "4.25"
  const submittedWidth = 52; // "09 Sep 2026"

  const flexible = budget - paramCount * paramWidth - avgWidth - submittedWidth;
  /* Shares, not equal splits: a batch name is the longest field on the row and
     a class name the shortest, so equal columns would wrap one to four lines
     while the other sat half empty. */
  const share = (fraction) => Math.max(40, Math.floor(flexible * fraction));

  return {
    columns,
    padding,
    borders,
    widths: [
      share(0.3), // batch
      share(0.19), // class
      share(0.255), // main mentors
      share(0.255), // support mentors
      ...Array.from({ length: paramCount }, () => paramWidth),
      avgWidth,
      submittedWidth,
    ],
    budget,
  };
}

const centeredTableLayout = {
  hLineWidth: () => 0.7,
  vLineWidth: () => 0.7,
  hLineColor: () => GRID,
  vLineColor: () => GRID,
  paddingTop: () => 6,
  paddingBottom: () => 6,
  paddingLeft: () => 8,
  paddingRight: () => 8,
  fillColor: (rowIndex) => (rowIndex === 0 ? BRAND : rowIndex % 2 === 0 ? ZEBRA : null),
};


/**
 * The summary block's layout.
 *
 * Row 0 is the batch band and row 1 the column labels, so the zebra has to
 * start counting from row 2 — striping by raw row index would tint the label
 * row and leave the first real row white.
 *
 * `subjectBreaks` holds the body indices where a new subject starts; those get
 * a heavier rule, which is what separates Java from DS without repeating a
 * word or risking a blank cell at a page break.
 */
const summaryLayoutWithBreaks = (subjectBreaks = new Set()) => ({
  hLineWidth: (i) => (subjectBreaks.has(i) ? 1.6 : 0.7),
  vLineWidth: () => 0.7,
  // Dark enough to actually read as a divider — #D9DDE3 was indistinguishable
  // from the ordinary gridline it was supposed to stand out against.
  hLineColor: (i) => (subjectBreaks.has(i) ? '#9AA1AC' : GRID),
  vLineColor: () => GRID,
  paddingTop: () => 7,
  paddingBottom: () => 7,
  paddingLeft: () => SUMMARY_PADDING.left,
  paddingRight: () => SUMMARY_PADDING.right,
  fillColor: (rowIndex) => {
    if (rowIndex === 0) return BRAND; // batch band — the heading
    if (rowIndex === 1) return BRAND_TINT; // column labels — subordinate to it
    return rowIndex % 2 === 0 ? ZEBRA : null;
  },
});

const headerCell = (text) => ({ text, bold: true, color: 'white', alignment: 'center' });
// Column labels sitting on BRAND_TINT rather than on solid brand.
const subHeaderCell = (text) => ({ text, bold: true, color: BRAND_INK, alignment: 'center' });
const dataCell = (text, align = 'center') => ({ text: String(text ?? ''), alignment: align });

/**
 * The crisp dashboard report: one block per batch, Subject | Mentor | Rating.
 *
 * Every other section the full report prints — the per-parameter averages, the
 * per-response grid, the comment tables — answers a question you ask from a
 * drill-down, and each of them is still one click away as its own export. What
 * a dashboard-wide PDF is for is the overview: who teaches what, to which
 * cohort, and how that cohort rates them.
 *
 * The batch is a BAND across the top of its own block rather than a column
 * repeated down the page. "2nd Year Credit Course" printed four times in
 * column one is four times the ink saying one thing, and it pushes the two
 * facts that do change — the subject and the mentor — into the narrow half of
 * the sheet. Stated once, the batch reads as a heading and the columns below
 * it carry only what varies.
 */
function buildSummaryDocDefinition(report) {
  const rows = report.mentorRows || [];
  const { widths } = summaryColumnWidths();

  /* Group into batches, preserving the order the service sorted them into
     (batch, then subject, then rating). A Map keeps insertion order, so no
     second sort is needed and the two orderings cannot drift apart. */
  const byBatch = new Map();
  for (const r of rows) {
    const key = r.batchName || '—';
    if (!byBatch.has(key)) byBatch.set(key, []);
    byBatch.get(key).push(r);
  }

  /** One self-contained block: batch band, column labels, then its sessions. */
  const blockFor = (batchName, batchRows) => {
    const body = [
      [{ text: batchName, colSpan: 3, style: 'batchBand' }, {}, {}],
      [subHeaderCell('Subject'), subHeaderCell('Mentor'), subHeaderCell('Rating (out of 5)')],
      ...batchRows.map((r) => [
        dataCell(r.className || '—', 'left'),
        dataCell(r.mentorName || '—', 'left'),
        dataCell(r.average == null ? '—' : fmt(r.average)),
      ]),
    ];

    /* Where the subject changes, so the layout can rule a heavier line there.
       The subject is repeated on every row rather than blanked after the first:
       a blank leading cell reads cleanly until the group straddles a page
       break, and then the reader is looking at mentors under no subject at
       all. A rule groups them without ever lying about which row is which. */
    const subjectBreaks = new Set();
    batchRows.forEach((r, i) => {
      if (i > 0 && r.className !== batchRows[i - 1].className) subjectBreaks.add(i + 2);
    });

    return {
      table: {
        // Both the band and the column labels repeat after a page break, so a
        // continued batch never arrives as an unlabelled list of names.
        headerRows: 2,
        widths,
        body,
        dontBreakRows: true,
        keepWithHeaderRows: 1,
      },
      layout: summaryLayoutWithBreaks(subjectBreaks),
      fontSize: 10,
      margin: [0, 0, 0, 14],
    };
  };

  const content = rows.length
    ? [...byBatch.entries()].map(([batchName, batchRows]) => blockFor(batchName, batchRows))
    : [
        {
          text: 'No feedback has been submitted for this selection yet.',
          italics: true,
          color: '#888',
        },
      ];

  return {
    pageOrientation: 'portrait',
    pageSize: 'A4',
    pageMargins: [PAGE_PORTRAIT.marginX, 92, PAGE_PORTRAIT.marginX, 44],
    defaultStyle: { font: 'Roboto', fontSize: 10, color: '#1f2430' },
    styles: {
      batchBand: { bold: true, fontSize: 11, color: 'white', alignment: 'left' },
    },

    header: () => ({
      margin: [PAGE_PORTRAIT.marginX, 24, PAGE_PORTRAIT.marginX, 0],
      stack: [
        { text: report.title, fontSize: 15, bold: true, color: BRAND },
        {
          text: `${report.overall?.feedbackCount ?? 0} responses   ·   overall ${fmt(
            report.overall?.overallAverage ?? 0
          )} / 5   ·   ${byBatch.size} batch${byBatch.size === 1 ? '' : 'es'}   ·   ${
            rows.length
          } session${rows.length === 1 ? '' : 's'}`,
          fontSize: 8.5,
          color: '#666',
          margin: [0, 3, 0, 0],
        },
        {
          columns: [
            { text: `Filters: ${report.filterContext || 'All data'}`, fontSize: 8, color: '#999' },
            { text: fmtDate(report.generatedAt), alignment: 'right', fontSize: 8, color: '#999' },
          ],
          margin: [0, 2, 0, 0],
        },
        {
          canvas: [
            {
              type: 'line',
              x1: 0,
              y1: 8,
              x2: PAGE_PORTRAIT.printable,
              y2: 8,
              lineWidth: 0.5,
              lineColor: GRID,
            },
          ],
        },
      ],
    }),

    footer: (currentPage, pageCount) => ({
      margin: [PAGE_PORTRAIT.marginX, 10, PAGE_PORTRAIT.marginX, 0],
      columns: [
        { text: 'Feedback Management System', fontSize: 7, color: '#aaa' },
        {
          text: `Page ${currentPage} of ${pageCount}`,
          alignment: 'right',
          fontSize: 8,
          color: '#888',
        },
      ],
    }),

    content,
  };
}

/**
 * @param {object} report  same shape produced by exportController.assembleReport
 */
/**
 * Build the pdfmake document definition for a report.
 *
 * Separated from rendering so the CONTENT can be asserted directly. Verifying
 * a rendered PDF means decompressing its streams and pattern-matching text
 * fragments, which is fragile enough that a test doing it tells you more about
 * pdfmake's encoding than about your document. A pure definition is just an
 * object: a test can check that batch and class are separate cells, that each
 * subject has its own heading, and that rows within one are in submission
 * order.
 */
export function buildPdfDocDefinition(report) {
  if (report.layout === 'summary') return buildSummaryDocDefinition(report);

  const paramLabels = (report.parameters || []).map((p) => p.label);

  // ── Summary table: Parameter | Average | Responses (all single-line) ─────
  const summaryBody = [
    [headerCell('Parameter'), headerCell('Average (1-5)'), headerCell('Responses')],
    ...(report.summary || []).map((r) => [
      dataCell(r.label, 'left'),
      dataCell(fmt(r.average)),
      dataCell(r.responses),
    ]),
  ];

  /* ── Detail ratings table ─────────────────────────────────────────────────
     Batch | Class | Main | Support | P1…Pn | Avg | Submitted

     The parameter columns are numbered rather than titled, with a legend
     directly beneath. Spelling "Real-world / practical examples" above a
     column that holds a single digit is what made this table wider than the
     page: 'auto' sized each column to its header, and eight such headers
     cannot coexist on A4 at a readable size. A code plus a legend costs one
     glance and buys a table that fits and can actually be read across.

     The Year column is gone. It repeated on every row, it is already stated in
     the filter line of the page header, and the batch name carries it in
     practice — one column of redundancy is expensive when the budget is this
     tight.

     Mentors stay on the row: a printed sheet is what gets circulated in a
     review, and "who was in the room" cannot be recovered from a class name. */
  const paramCodes = paramLabels.map((_, i) => `P${i + 1}`);
  const { widths: detailWidths } = detailColumnWidths(paramLabels.length);

  const detailHeader = [
    headerCell('Batch'),
    headerCell('Class'),
    headerCell('Main mentor(s)'),
    headerCell('Support mentor(s)'),
    ...paramCodes.map((c) => headerCell(c)),
    headerCell('Avg'),
    headerCell('Submitted'),
  ];
  const detailBody = [
    detailHeader,
    ...(report.rows || []).map((r) => [
      dataCell(r.batchName, 'left'),
      dataCell(r.className, 'left'),
      dataCell(r.mainMentors || '—', 'left'),
      dataCell(r.supportMentors || '—', 'left'),
      ...paramLabels.map((l) => dataCell(r[l] === '' || r[l] == null ? '—' : r[l])),
      dataCell(fmt(r.average)),
      dataCell(fmtDate(r.submittedAt)),
    ]),
  ];

  /* The legend that makes the codes readable. Laid out in columns rather than
     one long line so it stays compact under a landscape table. */
  const legendEntries = paramCodes.map((code, i) => `${code} = ${paramLabels[i]}`);
  const legendColumnCount = legendEntries.length > 4 ? 3 : 2;
  const perColumn = Math.ceil(legendEntries.length / legendColumnCount);
  const legend = {
    columns: Array.from({ length: legendColumnCount }, (_, c) => ({
      width: '*',
      stack: legendEntries
        .slice(c * perColumn, (c + 1) * perColumn)
        .map((text) => ({ text, fontSize: 7.5, color: '#6b7280', margin: [0, 0, 0, 1] })),
    })),
    columnGap: 12,
    margin: [0, 6, 0, 0],
  };

  /* ── Comments, GROUPED BY SUBJECT ───────────────────────────────────────
     Batch and class each get their own column. They were previously joined
     into one ("AI Ready 2028 · Batch-2 · GenAI"), which is unsortable,
     unfilterable once the PDF is pasted into a spreadsheet, and wastes width
     repeating the batch on every row of a single-batch export.

     And the comments are grouped: one section per subject, headed
     "Comments — GenAI", with rows in the order they were submitted. Read
     interleaved, a multi-subject batch gives you a GenAI remark about pace
     followed by a Coding remark about pace and no way to tell whether the
     complaint is about one session or both. Grouped, each subject reads as its
     own body of feedback, which is how anyone acts on it. */
  const commentRows = (report.rows || []).filter((r) => r.comment);

  const bySubject = new Map();
  for (const r of commentRows) {
    const key = r.className || '—';
    if (!bySubject.has(key)) bySubject.set(key, []);
    bySubject.get(key).push(r);
  }
  /* Within a subject, oldest first — the order students actually answered in,
     so reading down the column follows the session as it unfolded. */
  for (const rows of bySubject.values()) {
    rows.sort((a, b) => new Date(a.submittedAt || 0) - new Date(b.submittedAt || 0));
  }
  // Busiest subject first, so the section with the most to say leads.
  const subjectSections = [...bySubject.entries()].sort((a, b) => b[1].length - a[1].length);

  /** One table of comments for a single subject. */
  const commentTableFor = (rows) => [
    [
      headerCell('Batch'),
      headerCell('Class'),
      headerCell('Submitted'),
      headerCell('Avg (1-5)'),
      headerCell('Comment'),
    ],
    ...rows.map((r) => [
      dataCell(r.batchName || '—', 'left'),
      dataCell(r.className || '—', 'left'),
      dataCell(fmtDate(r.submittedAt), 'left'),
      dataCell(fmt(r.average)),
      dataCell(r.comment, 'left'),
    ]),
  ];

  const content = [
    { text: 'Averages per parameter', style: 'sectionTitle' },
    {
      table: { headerRows: 1, widths: ['*', 'auto', 'auto'], body: summaryBody },
      layout: centeredTableLayout,
    },
    { text: 'Individual feedback', style: 'sectionTitle', margin: [0, 16, 0, 6] },
    ...((report.rows || []).length
      ? [
          {
            table: {
              headerRows: 1,
              widths: detailWidths,
              body: detailBody,
              dontBreakRows: true,
              keepWithHeaderRows: 1,
            },
            // Tighter padding and 8pt type: this is the one dense grid in the
            // report, and the standard spacing does not fit on A4.
            layout: denseTableLayout,
            fontSize: 8,
          },
          legend,
        ]
      : [{ text: 'No feedback yet for this selection.', italics: true, color: '#888' }]),
  ];

  if (commentRows.length) {
    content.push({
      text: `Comments · ${commentRows.length} in total`,
      style: 'sectionTitle',
      margin: [0, 16, 0, 2],
    });

    for (const [subject, rows] of subjectSections) {
      content.push(
        /* The subject heading the user asked for, above each block. Kept with
           the table that follows it so a page break can never orphan it. */
        {
          text: `Comments — ${subject}  (${rows.length})`,
          style: 'subSectionTitle',
          margin: [0, 10, 0, 4],
        },
        {
          table: {
            headerRows: 1,
            /* Fixed, not 'auto', for the same reason the ratings table is:
               an 'auto' column grows to its widest content, so one unusually
               long batch name would squeeze the comment column — the whole
               point of the table — down to nothing, or past the page edge.
               Fixed leaders let long names wrap and give the comment every
               remaining point. */
            widths: [104, 84, 62, 34, '*'],
            body: commentTableFor(rows),
            dontBreakRows: true,
            keepWithHeaderRows: 1,
          },
          layout: centeredTableLayout,
        }
      );
    }
  }

  const docDefinition = {
    pageOrientation: 'landscape',
    pageSize: 'A4',
    /* Top margin has to clear the repeating header, which grows by a line for
       a mentor role split and another for a truncation notice. A fixed 84
       would let those lines print underneath the first table row. */
    pageMargins: [32, 84 + (report.roleSplit ? 12 : 0) + (report.truncated ? 12 : 0), 32, 48],
    defaultStyle: { font: 'Roboto', fontSize: 9, color: '#1f2430' },
    styles: {
      sectionTitle: { fontSize: 12, bold: true, color: BRAND, margin: [0, 0, 0, 6] },
      /* Smaller and inked rather than brand-coloured, so a subject heading
         reads as a subdivision of "Comments" and not as a peer of it. */
      subSectionTitle: { fontSize: 10.5, bold: true, color: '#111827' },
    },

    // Repeating page header: title + filter context + generated-on + KPIs.
    header: () => ({
      margin: [32, 20, 32, 0],
      stack: [
        {
          columns: [
            { text: report.title, fontSize: 14, bold: true, color: BRAND },
            { text: `Generated: ${fmtDate(report.generatedAt)}`, alignment: 'right', fontSize: 8, color: '#666' },
          ],
        },
        {
          columns: [
            { text: `Filters: ${report.filterContext || 'All data'}`, fontSize: 8, color: '#666' },
            {
              text: `Total feedback: ${report.overall?.feedbackCount ?? 0}   ·   Overall average: ${fmt(
                report.overall?.overallAverage ?? 0
              )} / 5`,
              alignment: 'right',
              fontSize: 8,
              color: '#666',
            },
          ],
          margin: [0, 2, 0, 0],
        },
        ...(report.roleSplit
          ? [
              {
                // One mentor's report states both roles separately: a blended
                // average hides whether a low score came from sessions they
                // delivered or ones they only assisted on.
                text:
                  `As main mentor: ${report.roleSplit.main.feedbackCount} responses, avg ` +
                  `${fmt(report.roleSplit.main.overallAverage)} / 5   ·   ` +
                  `As support mentor: ${report.roleSplit.support.feedbackCount} responses, avg ` +
                  `${fmt(report.roleSplit.support.overallAverage)} / 5`,
                fontSize: 8,
                italics: true,
                color: '#666',
                margin: [0, 2, 0, 0],
              },
            ]
          : []),
        ...(report.truncated
          ? [
              {
                text: `Capped at ${report.rowLimit} rows — narrow the filters for a complete export.`,
                fontSize: 8,
                bold: true,
                color: '#b4530a',
                margin: [0, 2, 0, 0],
              },
            ]
          : []),
        { canvas: [{ type: 'line', x1: 0, y1: 6, x2: 778, y2: 6, lineWidth: 0.5, lineColor: GRID }] },
      ],
    }),

    footer: (currentPage, pageCount) => ({
      margin: [32, 8, 32, 0],
      columns: [
        { text: 'Feedback Management System', fontSize: 7, color: '#aaa' },
        { text: `Page ${currentPage} of ${pageCount}`, alignment: 'right', fontSize: 8, color: '#888' },
      ],
    }),

    content,
  };

  return docDefinition;
}

/** Render a report to PDF bytes. */
export async function buildPdf(report) {
  // Font loading belongs to rendering; the document definition needs no printer.
  const printer = await getPrinter();
  const pdfDoc = printer.createPdfKitDocument(buildPdfDocDefinition(report));
  return new Promise((resolve, reject) => {
    const chunks = [];
    pdfDoc.on('data', (c) => chunks.push(c));
    pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
    pdfDoc.on('error', reject);
    pdfDoc.end();
  });
}
