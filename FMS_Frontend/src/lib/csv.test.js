import { describe, it, expect } from 'vitest';
import { parseCsv, toCsv } from './csv.js';

describe('parseCsv', () => {
  it('parses a simple table into lower-cased headers and row objects', () => {
    const { headers, rows } = parseCsv('Name,Email\nJane,jane@x.com\nJohn,john@x.com');
    expect(headers).toEqual(['name', 'email']);
    expect(rows).toEqual([
      { name: 'Jane', email: 'jane@x.com' },
      { name: 'John', email: 'john@x.com' },
    ]);
  });

  it('keeps commas that live inside a quoted field', () => {
    const { rows } = parseCsv('name,email\n"Doe, Jane",jane@x.com');
    expect(rows[0]).toEqual({ name: 'Doe, Jane', email: 'jane@x.com' });
  });

  it('unescapes "" as a literal quote inside a quoted field', () => {
    const { rows } = parseCsv('name,note\nJane,"She said ""hi"""');
    expect(rows[0].note).toBe('She said "hi"');
  });

  it('handles CRLF line endings', () => {
    const { headers, rows } = parseCsv('name,email\r\nJane,jane@x.com\r\nJohn,john@x.com');
    expect(headers).toEqual(['name', 'email']);
    expect(rows).toHaveLength(2);
    expect(rows[1].name).toBe('John');
  });

  it('handles bare LF line endings', () => {
    const { rows } = parseCsv('name\nJane\nJohn');
    expect(rows.map((r) => r.name)).toEqual(['Jane', 'John']);
  });

  it('strips the UTF-8 BOM Excel writes onto the first header', () => {
    const { headers, rows } = parseCsv('﻿name,email\nJane,jane@x.com');
    expect(headers[0]).toBe('name');
    // The regression this guards: with the BOM intact the key would be
    // "﻿name" and every lookup of `row.name` would come back undefined.
    expect(rows[0].name).toBe('Jane');
  });

  it('ignores trailing newlines and entirely blank spacer lines', () => {
    const { rows } = parseCsv('name,email\nJane,jane@x.com\n\n  ,  \nJohn,john@x.com\n\n');
    expect(rows).toEqual([
      { name: 'Jane', email: 'jane@x.com' },
      { name: 'John', email: 'john@x.com' },
    ]);
  });

  it('trims surrounding whitespace on headers and cells', () => {
    const { headers, rows } = parseCsv(' Name , Email \n Jane , jane@x.com ');
    expect(headers).toEqual(['name', 'email']);
    expect(rows[0]).toEqual({ name: 'Jane', email: 'jane@x.com' });
  });

  it('fills missing trailing columns with an empty string', () => {
    const { rows } = parseCsv('name,email,phone\nJane,jane@x.com');
    expect(rows[0]).toEqual({ name: 'Jane', email: 'jane@x.com', phone: '' });
  });

  it('returns empty structures for empty / nullish input', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [] });
    expect(parseCsv(null)).toEqual({ headers: [], rows: [] });
    expect(parseCsv(undefined)).toEqual({ headers: [], rows: [] });
  });

  it('returns headers but no rows for a header-only file', () => {
    expect(parseCsv('name,email\n')).toEqual({ headers: ['name', 'email'], rows: [] });
  });
});

describe('toCsv', () => {
  const columns = [
    { key: 'name', label: 'Name' },
    { key: 'note', label: 'Note' },
  ];

  it('writes a header row and CRLF-separated body', () => {
    const out = toCsv(columns, [{ name: 'Jane', note: 'ok' }]);
    expect(out).toBe('Name,Note\r\nJane,ok');
  });

  it('does not quote values that do not need it', () => {
    expect(toCsv(columns, [{ name: 'Jane', note: 'plain' }])).not.toContain('"');
  });

  it('renders null / undefined cells as empty, not "null"', () => {
    const out = toCsv(columns, [{ name: null, note: undefined }]);
    expect(out).toBe('Name,Note\r\n,');
  });

  it('round-trips values containing commas, quotes and newlines', () => {
    const rows = [
      { name: 'Doe, Jane', note: 'She said "hi"' },
      { name: 'Line\nBreak', note: 'CRLF\r\ninside' },
      { name: 'plain', note: '' },
    ];
    const parsed = parseCsv(toCsv(columns, rows));

    expect(parsed.headers).toEqual(['name', 'note']);
    expect(parsed.rows[0]).toEqual({ name: 'Doe, Jane', note: 'She said "hi"' });
    // Line breaks INSIDE a quoted field are data, not row separators, and come
    // back byte-for-byte — CRLF is only collapsed when it ends a record.
    expect(parsed.rows[1].name).toBe('Line\nBreak');
    expect(parsed.rows[1].note).toBe('CRLF\r\ninside');
    expect(parsed.rows[2]).toEqual({ name: 'plain', note: '' });
  });
});
