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
const GRID = '#E5E7EB';
const ZEBRA = '#FDF3EF';
const fmt = (n) => (Number(n) || 0).toFixed(2);

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

// A shared table layout: gridlines, symmetric padding (→ vertical centering),
// indigo header fill, zebra striping.
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

const headerCell = (text) => ({ text, bold: true, color: 'white', alignment: 'center' });
const dataCell = (text, align = 'center') => ({ text: String(text ?? ''), alignment: align });

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
     Year | Batch | Class | Main | Support | [params] | Avg | Submitted

     Mentor columns are on the row because a session is co-taught: a printed
     sheet is the artifact people actually circulate in a review meeting, and
     "who was in the room" cannot be recovered from a class name. Kept to two
     narrow columns (comma-joined names) so the landscape A4 still fits the
     eight parameter columns without shrinking the type. */
  const detailHeader = [
    headerCell('Year'),
    headerCell('Batch'),
    headerCell('Class'),
    headerCell('Main mentor(s)'),
    headerCell('Support mentor(s)'),
    ...paramLabels.map((l) => headerCell(l)),
    headerCell('Avg'),
    headerCell('Submitted'),
  ];
  const detailBody = [
    detailHeader,
    ...(report.rows || []).map((r) => [
      dataCell(r.yearGroup || '—'),
      dataCell(r.batchName, 'left'),
      dataCell(r.className, 'left'),
      dataCell(r.mainMentors || '—', 'left'),
      dataCell(r.supportMentors || '—', 'left'),
      ...paramLabels.map((l) => dataCell(r[l] === '' || r[l] == null ? '—' : r[l])),
      dataCell(fmt(r.average)),
      dataCell(fmtDate(r.submittedAt)),
    ]),
  ];
  const detailWidths = [
    'auto', 'auto', 'auto', 'auto', 'auto',
    ...paramLabels.map(() => 'auto'),
    'auto', 'auto',
  ];

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
    (report.rows || []).length
      ? {
          table: { headerRows: 1, widths: detailWidths, body: detailBody, dontBreakRows: true, keepWithHeaderRows: 1 },
          layout: centeredTableLayout,
        }
      : { text: 'No feedback yet for this selection.', italics: true, color: '#888' },
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
            widths: ['auto', 'auto', 'auto', 'auto', '*'],
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
