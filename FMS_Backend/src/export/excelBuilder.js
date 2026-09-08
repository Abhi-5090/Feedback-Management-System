import ExcelJS from 'exceljs';

/**
 * Build a two-sheet .xlsx workbook and return it as a Buffer.
 *
 *  - "Summary" sheet: averages per parameter (+ overall).
 *  - "Detail"  sheet: one row per feedback submission, a column per parameter.
 *
 * Both sheets get a bold, frozen, filled header row and sensible column widths.
 *
 * @param {object} report  { title, filterContext, generatedAt, overall,
 *                           summary:[{label,average,responses}],
 *                           parameters:[{label}], rows:[{className,batchName,
 *                           [paramLabel]:stars, average, comment, submittedAt}] }
 */
export async function buildExcel(report) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Feedback Management System';
  wb.created = report.generatedAt || new Date();

  // Torii-gate vermilion — matches the app and the PDF export. Was indigo,
  // left over from before the rebrand.
  const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEA5829' } };
  const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };

  const styleHeader = (row) => {
    row.eachCell((cell) => {
      cell.fill = HEADER_FILL;
      cell.font = HEADER_FONT;
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        top: { style: 'thin' }, left: { style: 'thin' },
        bottom: { style: 'thin' }, right: { style: 'thin' },
      };
    });
    row.height = 22;
  };

  // ── Summary sheet ────────────────────────────────────────────────────────
  const summary = wb.addWorksheet('Summary');
  summary.mergeCells('A1:C1');
  summary.getCell('A1').value = report.title;
  summary.getCell('A1').font = { bold: true, size: 15 };
  summary.getCell('A2').value = `Filters: ${report.filterContext || 'All data'}`;
  summary.getCell('A3').value = `Generated: ${fmtDate(report.generatedAt)}`;
  summary.getCell('A4').value =
    `Total feedback: ${report.overall?.feedbackCount ?? 0}   |   Overall average: ${fmt(
      report.overall?.overallAverage ?? 0
    )} ★`;

  /* When the report belongs to one mentor, state the two roles separately.
     A single blended average hides that a low number may come from sessions
     they only assisted on — which is a different conversation from a low
     number on sessions they delivered. */
  let cursor = 5;
  if (report.roleSplit) {
    const { main, support } = report.roleSplit;
    summary.getCell(`A${cursor}`).value =
      `As MAIN mentor: ${main.feedbackCount} responses, avg ${fmt(main.overallAverage)} ★` +
      `     |     As SUPPORT mentor: ${support.feedbackCount} responses, avg ${fmt(support.overallAverage)} ★`;
    summary.getCell(`A${cursor}`).font = { italic: true, size: 10 };
    cursor += 1;
  }
  if (report.truncated) {
    summary.getCell(`A${cursor}`).value =
      `NOTE: the Detail sheet was capped at ${report.rowLimit} rows. Narrow the filters for a complete export.`;
    summary.getCell(`A${cursor}`).font = { bold: true, color: { argb: 'FFB4530A' }, size: 10 };
    cursor += 1;
  }
  cursor += 1; // blank spacer before the table

  summary.columns = [
    { key: 'label', width: 40 },
    { key: 'average', width: 16 },
    { key: 'responses', width: 16 },
  ];
  const sHeader = summary.getRow(cursor);
  sHeader.values = ['Parameter', 'Average (★)', 'Responses'];
  styleHeader(sHeader);

  // Freeze below the header wherever it ended up after the optional notices.
  summary.views = [{ state: 'frozen', ySplit: cursor }];

  (report.summary || []).forEach((r) => {
    const row = summary.addRow({ label: r.label, average: Number(fmt(r.average)), responses: r.responses });
    row.getCell('average').numFmt = '0.00';
    row.eachCell((cell, col) => {
      cell.alignment = { vertical: 'middle', horizontal: col === 1 ? 'left' : 'center' };
      cell.border = { top: { style: 'hair' }, bottom: { style: 'hair' } };
    });
  });

  // ── Detail sheet ─────────────────────────────────────────────────────────
  const detail = wb.addWorksheet('Detail', { views: [{ state: 'frozen', ySplit: 1 }] });
  const paramLabels = (report.parameters || []).map((p) => p.label);
  /* Column order follows how the sheet is actually read: WHO was surveyed
     (year, dept, batch), WHAT was rated (class), WHO taught it (main/support
     mentors), then the scores. Mentor attribution has to be on the row itself —
     a session is co-taught, and a reader filtering this sheet by mentor cannot
     recover that from a class name alone. */
  /* A report may declare its own detail columns (the mentor matrix has an
     entirely different row shape). Falling through to the feedback layout for
     those rows would produce a sheet of empty cells, which reads as a broken
     export rather than a mismatched one. */
  const columns = report.detailColumns || [
    { header: 'Year Group', key: 'yearGroup', width: 16 },
    { header: 'Department', key: 'dept', width: 18 },
    { header: 'Batch', key: 'batchName', width: 24 },
    { header: 'Class', key: 'className', width: 22 },
    { header: 'Main Mentor(s)', key: 'mainMentors', width: 28 },
    { header: 'Support Mentor(s)', key: 'supportMentors', width: 28 },
    ...paramLabels.map((label) => ({ header: label, key: label, width: 16 })),
    { header: 'Average', key: 'average', width: 12 },
    { header: 'Comment', key: 'comment', width: 60 },
    { header: 'Submitted', key: 'submittedAt', width: 22 },
  ];
  detail.columns = columns;
  styleHeader(detail.getRow(1));

  (report.rows || []).forEach((r) => {
    const row = detail.addRow({
      ...r,
      ...(r.average !== undefined && r.average !== '' ? { average: Number(fmt(r.average)) } : {}),
      ...(r.submittedAt ? { submittedAt: fmtDate(r.submittedAt) } : {}),
    });
    row.alignment = { vertical: 'middle', wrapText: true };
    if (columns.some((c) => c.key === 'average')) row.getCell('average').numFmt = '0.00';
    paramLabels.forEach((label) => {
      // A custom column set may not include every parameter label.
      if (columns.some((c) => c.key === label)) {
        row.getCell(label).alignment = { vertical: 'middle', horizontal: 'center' };
      }
    });
  });

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

const fmt = (n) => (Number(n) || 0).toFixed(2);
function fmtDate(d) {
  if (!d) return '—';
  const date = new Date(d);
  return date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}
