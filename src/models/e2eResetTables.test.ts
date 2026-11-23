import type { PgTable } from 'drizzle-orm/pg-core';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getTableColumns, getTableName, is } from 'drizzle-orm';
import { PgTable as PgTableClass } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { RESET_TABLES } from '../../scripts/e2eResetTables';
import * as schema from './Schema';

const OWNER_COLUMNS = new Set(['user_id', 'author_id', 'reporter_id']);

/** The data export's tables and owner columns (internal/service/dataexport, Tables). */
function exportTables(): { table: string; owner: string }[] {
  const source = readFileSync(path.join(__dirname, '../../internal/service/dataexport/dataexport.go'), 'utf8');
  const block = /var Tables = \[\]Spec\{([\s\S]*?)\n\}/.exec(source)?.[1] ?? '';
  return [...block.matchAll(/^\t\{"([^"]+)", "([^"]+)",/gm)].map(m => ({ table: m[1]!, owner: m[2]! }));
}

describe('scripts/e2eResetTables', () => {
  const reset = new Map(RESET_TABLES.map(r => [getTableName(r.table), r.owner.name]));

  it('covers every table with an owner column', () => {
    const owned = (Object.values(schema) as unknown[])
      .filter((t): t is PgTable => is(t, PgTableClass))
      .filter(t => Object.values(getTableColumns(t)).some(c => OWNER_COLUMNS.has(c.name)))
      .map(t => getTableName(t))
      .sort();

    expect([...reset.keys()].sort()).toEqual(owned);
  });

  it('wipes every exported table by the same owner column', () => {
    const tables = exportTables();

    expect(tables.length).toBeGreaterThan(30);

    for (const { table, owner } of tables) {
      if (table === 'user') {
        continue;
      }

      expect(reset.get(table), table).toBe(owner);
    }
  });
});
