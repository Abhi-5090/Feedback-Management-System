import { jest } from '@jest/globals';
import ExcelJS from 'exceljs';
import {
  parseTrainerWorkbook,
  buildTrainerTemplate,
  REQUIRED_HEADERS,
  MAX_ROWS,
} from '../services/trainerImportService.js';

jest.setTimeout(30_000);

/**
 * Bulk mentor import.
 *
 * This parses a file an admin uploaded and turns rows into real accounts with
 * real credentials, and it was at 5% coverage. The failure modes are quiet:
 * a header the parser does not recognise silently produces zero rows, a
 * duplicate email creates one account and shadows another, and a spreadsheet
 * with 40,000 formatted-but-empty rows turns an import into a timeout.
 */

/** Build a real .xlsx in memory — not a stub, the same library production reads. */
async function xlsx(rows) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Mentors');
  rows.forEach((r) => sheet.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const csv = (text) => Buffer.from(text, 'utf8');
const HEADERS = ['First Name', 'Last Name', 'Email', 'Mobile Number'];

describe('header handling', () => {
  test('accepts the canonical headers', async () => {
    const { headerError, rows } = await parseTrainerWorkbook(
      await xlsx([HEADERS, ['Bhargav', 'Rao', 'b@ncet.test', '9876543210']])
    );
    expect(headerError).toBe('');
    expect(rows).toHaveLength(1);
  });

  test.each([
    ['different case', ['FIRST NAME', 'last name', 'EMAIL', 'Mobile Number']],
    ['extra spacing', ['  First Name  ', 'Last  Name', ' Email ', 'Mobile  Number']],
  ])('tolerates %s', async (_label, headers) => {
    const { headerError } = await parseTrainerWorkbook(
      await xlsx([headers, ['A', 'B', 'a@b.test', '9876543210']])
    );
    expect(headerError).toBe('');
  });

  test('a missing header is refused, and the error ECHOES what was actually read', async () => {
    /* The difference between a usable error and a support ticket. "We saw:
       Name, E-Mail Id, Phone" tells the admin exactly which column to rename;
       "invalid file" does not. */
    const { headerError, rows } = await parseTrainerWorkbook(
      await xlsx([['Name', 'E-Mail Id', 'Phone'], ['x', 'y', 'z']])
    );
    expect(rows).toHaveLength(0);
    expect(headerError).toMatch(/first name/i);
    expect(headerError).toContain('Name, E-Mail Id, Phone');
  });

  test('an empty first row says so rather than listing nothing', async () => {
    const { headerError } = await parseTrainerWorkbook(await xlsx([[], ['a', 'b']]));
    expect(headerError).toMatch(/empty|must contain/i);
  });

  test('REQUIRED_HEADERS is what the parser actually enforces', () => {
    // These are shown in the UI; if they drift from the parser, the UI lies.
    expect(REQUIRED_HEADERS).toEqual(['first name', 'last name', 'email', 'mobile number']);
  });
});

describe('row validation', () => {
  const parse = async (...dataRows) =>
    (await parseTrainerWorkbook(await xlsx([HEADERS, ...dataRows]))).rows;

  test('a good row carries no error', async () => {
    const [row] = await parse(['Bhargav', 'Rao', 'Bhargav@NCET.test', '9876543210']);
    expect(row.error).toBe('');
    // Email is normalised, because it is the account's identity.
    expect(row.email).toBe('bhargav@ncet.test');
  });

  test.each([
    [['', 'Rao', 'a@b.test', '9876543210'], /first name/i],
    [['Bhargav', '', 'a@b.test', '9876543210'], /last name/i],
    [['Bhargav', 'Rao', '', '9876543210'], /email is required/i],
    [['Bhargav', 'Rao', 'not-an-email', '9876543210'], /valid email/i],
    [['Bhargav', 'Rao', 'a@b.test', ''], /mobile number is required/i],
    [['Bhargav', 'Rao', 'a@b.test', 'abc'], /valid mobile/i],
  ])('rejects %j', async (data, expected) => {
    const [row] = await parse(data);
    expect(row.error).toMatch(expected);
  });

  test('a duplicate email inside the file is flagged on the SECOND row only', async () => {
    /* The first occurrence is legitimate. Flagging both would make the admin
       delete the row they meant to keep. */
    const rows = await parse(
      ['A', 'One', 'same@ncet.test', '9876543210'],
      ['B', 'Two', 'SAME@ncet.test', '9876543211']
    );
    expect(rows[0].error).toBe('');
    expect(rows[1].error).toMatch(/duplicate/i);
  });

  test('blank rows are skipped, not reported as errors', async () => {
    // Excel leaves formatted-but-empty rows behind constantly.
    const rows = await parse(['A', 'One', 'a@ncet.test', '9876543210'], ['', '', '', '']);
    expect(rows).toHaveLength(1);
  });

  test('rows keep their spreadsheet line number, so an error can be found', async () => {
    const rows = await parse(
      ['A', 'One', 'a@ncet.test', '9876543210'],
      ['B', 'Two', 'bad-email', '9876543211']
    );
    expect(rows[0].row).toBe(2); // row 1 is the header
    expect(rows[1].row).toBe(3);
  });

  test('a row beyond MAX_ROWS is dropped and the result says it was truncated', async () => {
    /* Silent truncation is the dangerous version: the admin sees "500 created"
       and assumes the other 200 were duplicates. */
    const many = Array.from({ length: MAX_ROWS + 5 }, (_, i) => [
      'A', `N${i}`, `a${i}@ncet.test`, '9876543210',
    ]);
    const { rows, truncated } = await parseTrainerWorkbook(await xlsx([HEADERS, ...many]));
    expect(rows).toHaveLength(MAX_ROWS);
    expect(truncated).toBe(true);
  });
});

describe('CSV input', () => {
  test('a .csv is parsed by the same rules', async () => {
    const { rows, headerError } = await parseTrainerWorkbook(
      csv('First Name,Last Name,Email,Mobile Number\nBhargav,Rao,b@ncet.test,9876543210\n'),
      'mentors.csv'
    );
    expect(headerError).toBe('');
    expect(rows).toHaveLength(1);
    expect(rows[0].error).toBe('');
  });

  test('the extension decides the parser, not the content', async () => {
    // A csv body sent as .xlsx must fail cleanly rather than throwing.
    await expect(
      parseTrainerWorkbook(csv('a,b,c\n1,2,3\n'), 'mentors.xlsx')
    ).rejects.toThrow();
  });
});

describe('the downloadable template', () => {
  test('is a real workbook whose headers the parser accepts', async () => {
    /* A template the importer rejects is the worst possible bug here: the
       admin did exactly what they were told and it still failed. */
    const buffer = await buildTrainerTemplate();
    const { headerError } = await parseTrainerWorkbook(Buffer.from(buffer), 'template.xlsx');
    expect(headerError).toBe('');
  });
});
