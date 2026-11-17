import { describe, expect, it } from 'vitest';

import { collectCsvColumns, formatCsvCell, toCsv } from './csv';

describe('formatCsvCell', () => {
  it('renders empty cells for null and undefined', () => {
    expect(formatCsvCell(null)).toBe('');
    expect(formatCsvCell(undefined)).toBe('');
  });

  it('renders dates as ISO strings', () => {
    expect(formatCsvCell(new Date('2026-03-01T10:15:00.000Z'))).toBe('2026-03-01T10:15:00.000Z');
  });

  it('renders objects and arrays as quoted JSON', () => {
    expect(formatCsvCell(['nausea', 'aura'])).toBe('"[""nausea"",""aura""]"');
  });

  it('quotes cells containing commas, quotes and newlines', () => {
    expect(formatCsvCell('a,b')).toBe('"a,b"');
    expect(formatCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(formatCsvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('neutralises formula-like strings but leaves numbers alone', () => {
    expect(formatCsvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(formatCsvCell('@cmd')).toBe('\'@cmd');
    expect(formatCsvCell(-3)).toBe('-3');
  });
});

describe('toCsv', () => {
  it('uses the union of keys as header in first-seen order', () => {
    const rows = [{ id: 1, notes: 'x' }, { id: 2, intensity: 7 }];

    expect(collectCsvColumns(rows)).toEqual(['id', 'notes', 'intensity']);
    expect(toCsv(rows)).toBe('id,notes,intensity\r\n1,x,\r\n2,,7\r\n');
  });

  it('writes only a header line for no rows when columns are given', () => {
    expect(toCsv([], ['id'])).toBe('id\r\n');
  });
});
