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
  const summary = wb.addWorksheet('Summary', {
    views: [{ state: 'frozen', ySplit: 5 }],
  });
  summary.mergeCells('A1:C1');
  summary.getCell('A1').value = report.title;
  summary.getCell('A1').font = { bold: true, size: 15 };
  summary.getCell('A2').value = `Filters: ${report.filterContext || 'All data'}`;
  summary.getCell('A3').value = `Generated: ${fmtDate(report.generatedAt)}`;
  summary.getCell('A4').value =
    `Total feedback: ${report.overall?.feedbackCount ?? 0}   |   Overall average: ${fmt(
      report.overall?.overallAverage ?? 0
    )} ★`;

  summary.columns = [
    { key: 'label', width: 40 },
    { key: 'average', width: 16 },
    { key: 'responses', width: 16 },
  ];
  const sHeader = summary.getRow(5);
  sHeader.values = ['Parameter', 'Average (★)', 'Responses'];
  styleHeader(sHeader);

  report.summary.forEach((r) => {
    const row = summary.addRow({ label: r.label, average: Number(fmt(r.average)), responses: r.responses });
    row.getCell('average').numFmt = '0.00';
    row.eachCell((cell, col) => {
      cell.alignment = { vertical: 'middle', horizontal: col === 1 ? 'left' : 'center' };
      cell.border = { top: { style: 'hair' }, bottom: { style: 'hair' } };
    });
  });

  // ── Detail sheet ─────────────────────────────────────────────────────────
  const detail = wb.addWorksheet('Detail', { views: [{ state: 'frozen', ySplit: 1 }] });
  const paramLabels = report.parameters.map((p) => p.label);
  const columns = [
    { header: 'Class', key: 'className', width: 24 },
    { header: 'Batch', key: 'batchName', width: 20 },
    ...paramLabels.map((label) => ({ header: label, key: label, width: 16 })),
    { header: 'Average', key: 'average', width: 12 },
    { header: 'Comment', key: 'comment', width: 60 },
    { header: 'Submitted', key: 'submittedAt', width: 22 },
  ];
  detail.columns = columns;
  styleHeader(detail.getRow(1));

  report.rows.forEach((r) => {
    const row = detail.addRow({
      ...r,
      average: Number(fmt(r.average)),
      submittedAt: fmtDate(r.submittedAt),
    });
    row.alignment = { vertical: 'middle', wrapText: true };
    row.getCell('average').numFmt = '0.00';
    paramLabels.forEach((label) => {
      row.getCell(label).alignment = { vertical: 'middle', horizontal: 'center' };
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
