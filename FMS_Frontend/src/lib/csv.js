/**
 * Minimal RFC-4180 CSV parser and serializer.
 *
 * Hand-rolled rather than pulling in a dependency, but it handles the cases a
 * naive `split(',')` gets wrong — which is exactly the file a user will upload:
 *   - quoted fields containing commas:   "Doe, Jane",jane@x.com
 *   - escaped quotes inside quotes:      "She said ""hi"""
 *   - CRLF, LF or CR line endings
 *   - a UTF-8 BOM from Excel (the #1 cause of a mangled first header)
 *   - trailing newline / blank lines
 */

/** Parse CSV text into { headers, rows } where each row is an object. */
export function parseCsv(text) {
  const clean = String(text ?? '').replace(/^﻿/, ''); // strip Excel's BOM
  const table = parseRows(clean);
  if (!table.length) return { headers: [], rows: [] };

  const headers = table[0].map((h) => h.trim().toLowerCase());
  const rows = table
    .slice(1)
    // Ignore rows that are entirely empty (trailing newlines, spacer lines).
    .filter((cells) => cells.some((c) => c.trim() !== ''))
    .map((cells) => {
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = (cells[i] ?? '').trim();
      });
      return obj;
    });

  return { headers, rows };
}

/** Character-by-character scan — the only reliable way to respect quoting. */
function parseRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'; // "" is a literal quote
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      // Treat CRLF as one break, not two.
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  // Flush whatever the last line left in the buffer (no trailing newline).
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Quote a value only when it needs it, escaping embedded quotes. */
function escapeCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build CSV text from column defs + rows. */
export function toCsv(columns, rows) {
  const head = columns.map((c) => escapeCell(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => escapeCell(r[c.key])).join(',')).join('\r\n');
  return `${head}\r\n${body}`;
}

/** Trigger a client-side file download for generated text. */
export function downloadText(filename, text, mime = 'text/csv;charset=utf-8') {
  // The BOM makes Excel open UTF-8 correctly instead of mojibake.
  const blob = new Blob([`﻿${text}`], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
