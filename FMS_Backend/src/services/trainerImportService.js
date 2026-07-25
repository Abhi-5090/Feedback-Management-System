import ExcelJS from 'exceljs';

/**
 * Trainer bulk-import parsing.
 *
 * Parsing happens on the SERVER using ExcelJS, which the project already
 * depends on for exports. The alternative — a spreadsheet parser in the browser
 * — would have added ~1MB to a bundle we just spent effort splitting, and would
 * still need re-validating server-side anyway.
 *
 * Expected headers (case/spacing/punctuation insensitive):
 *   first name | last name | email | mobile number
 */

export const REQUIRED_HEADERS = ['first name', 'last name', 'email', 'mobile number'];
export const MAX_ROWS = 500;

/**
 * "First  Name" / "first_name" / "FirstName*" / "E-mail" → "first name" / "e mail".
 *
 * Whitespace is collapsed FIRST — including non-breaking spaces and other
 * Unicode spaces that arrive via copy-paste from web pages or Word. The old
 * order stripped "unknown" characters before collapsing, which silently glued
 * "Email Address" (nbsp) into "emailaddress" and made it unrecognisable.
 */
const normalizeHeader = (v) =>
  String(v ?? '')
    .replace(/\s+/g, ' ') // nbsp / tabs / newlines → a single normal space
    .replace(/[_-]+/g, ' ') // first_name / e-mail → space-separated words
    .replace(/[^a-z0-9 ]/gi, '') // drop *, (), :, etc.
    .replace(/\s+/g, ' ') // re-collapse after the substitutions above
    .trim()
    .toLowerCase();

/** Exact spellings we map straight onto our four canonical fields. */
const HEADER_ALIASES = {
  'first name': 'firstName',
  firstname: 'firstName',
  first: 'firstName',
  'last name': 'lastName',
  lastname: 'lastName',
  last: 'lastName',
  surname: 'lastName',
  email: 'email',
  'email id': 'email',
  'email address': 'email',
  mail: 'email',
  'mobile number': 'phone',
  mobile: 'phone',
  'phone number': 'phone',
  phone: 'phone',
  contact: 'phone',
  'contact number': 'phone',
};

/**
 * Resolve a header cell to a canonical field.
 *
 * Tries the exact alias table first, then falls back to "does the meaningful
 * word appear anywhere in the header?" — so "trainer email", "mail id",
 * "e mail", "mobile no.", "contact number (work)" and friends all resolve
 * without needing an exhaustive alias list. The four fields key off distinct
 * words, so a single header can't match two of them ambiguously.
 */
function resolveHeaderField(raw) {
  const h = normalizeHeader(raw);
  if (!h) return null;
  if (HEADER_ALIASES[h]) return HEADER_ALIASES[h];
  if (/mail/.test(h)) return 'email'; // email, e mail, mail id, emailaddress
  if (/first/.test(h)) return 'firstName';
  if (/last|surname/.test(h)) return 'lastName';
  if (/mobile|phone|contact|whatsapp|\bcell\b|\bmob\b/.test(h)) return 'phone';
  return null;
}

/**
 * Excel gives cells back as rich objects, formulas, hyperlinks or numbers
 * depending on how the file was authored. Flatten all of that to a string.
 */
function cellText(cell) {
  const v = cell?.value;
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.text) return String(v.text);                       // hyperlink / rich text
    if (v.result != null) return String(v.result);           // formula
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
    if (v instanceof Date) return v.toISOString();
    return '';
  }
  return String(v);
}

const emailOk = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
// Permissive on purpose: +, spaces, dashes, parens and 7–15 digits covers
// international formats. Rejecting valid real numbers is worse than accepting
// a loose one for a contact field.
const phoneOk = (v) => /^[+()\d][\d\s().-]{5,19}$/.test(v) && (v.match(/\d/g) || []).length >= 7;

/**
 * Parse an .xlsx (or .csv) buffer into validated rows.
 * Returns { rows, headerError } — never throws on bad DATA, only on an
 * unreadable file, so the caller can show per-row problems.
 */
export async function parseTrainerWorkbook(buffer, filename = '') {
  const wb = new ExcelJS.Workbook();

  if (/\.csv$/i.test(filename)) {
    const { Readable } = await import('node:stream');
    await wb.csv.read(Readable.from(buffer.toString('utf8')));
  } else {
    await wb.xlsx.load(buffer);
  }

  const sheet = wb.worksheets[0];
  if (!sheet || sheet.rowCount < 1) {
    return { rows: [], headerError: 'The file has no readable sheet.' };
  }

  // Map each column index to a canonical field name via the header row.
  const colToField = {};
  const found = new Set();
  const seenHeaders = [];
  sheet.getRow(1).eachCell((cell, col) => {
    const text = cellText(cell).trim();
    if (text) seenHeaders.push(text);
    const field = resolveHeaderField(text);
    if (field) {
      colToField[col] = field;
      found.add(field);
    }
  });

  const missing = [];
  if (!found.has('firstName')) missing.push('first name');
  if (!found.has('lastName')) missing.push('last name');
  if (!found.has('email')) missing.push('email');
  if (!found.has('phone')) missing.push('mobile number');
  if (missing.length) {
    // Echo the headers we DID read so the mismatch is obvious at a glance
    // ("we saw: Name, E-Mail Id, Phone" tells the user exactly what to rename).
    const seen = seenHeaders.length
      ? ` The first row we read was: ${seenHeaders.join(', ')}.`
      : ' The first row appears to be empty.';
    return {
      rows: [],
      headerError: `The first row must contain these column headers: ${missing.join(', ')}.${seen}`,
    };
  }

  const rows = [];
  const seen = new Set();
  let truncated = false;

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header
    if (rows.length >= MAX_ROWS) {
      truncated = true;
      return;
    }

    const rec = { firstName: '', lastName: '', email: '', phone: '' };
    Object.entries(colToField).forEach(([col, field]) => {
      rec[field] = cellText(row.getCell(Number(col))).trim();
    });

    // Skip rows that are entirely blank (trailing formatting in Excel).
    if (!rec.firstName && !rec.lastName && !rec.email && !rec.phone) return;

    const email = rec.email.toLowerCase();
    let error = '';
    if (!rec.firstName) error = 'First name is required';
    else if (!rec.lastName) error = 'Last name is required';
    else if (!email) error = 'Email is required';
    else if (!emailOk(email)) error = 'Not a valid email address';
    else if (seen.has(email)) error = 'Duplicate email in this file';
    else if (!rec.phone) error = 'Mobile number is required';
    else if (!phoneOk(rec.phone)) error = 'Not a valid mobile number';
    if (!error) seen.add(email);

    rows.push({ row: rowNumber, ...rec, email, error });
  });

  return { rows, headerError: '', truncated };
}

/** Build the downloadable .xlsx template with the four required headers. */
export async function buildTrainerTemplate() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Trainers');

  // Headers are lowercase. Parsing is case-insensitive (see normalizeHeader),
  // so this is purely how the template reads — kept lowercase to match the
  // canonical field names in REQUIRED_HEADERS.
  ws.columns = [
    { header: 'first name', key: 'firstName', width: 22 },
    { header: 'last name', key: 'lastName', width: 22 },
    { header: 'email', key: 'email', width: 34 },
    { header: 'mobile number', key: 'phone', width: 20 },
  ];

  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  // Torii-gate vermilion, matching the app and the other exports.
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEA5829' } };
  head.alignment = { vertical: 'middle', horizontal: 'center' };
  head.height = 22;
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  // Two example rows so the expected shape is unambiguous.
  ws.addRow({ firstName: 'Asha', lastName: 'Menon', email: 'asha.menon@example.com', phone: '+91 98765 43210' });
  ws.addRow({ firstName: 'Ravi', lastName: 'Kumar', email: 'ravi.kumar@example.com', phone: '9876543211' });

  // Force the phone column to text so Excel doesn't mangle leading zeros / '+'.
  ws.getColumn('phone').numFmt = '@';

  return wb.xlsx.writeBuffer();
}
