import type { PgTable } from 'drizzle-orm/pg-core';
import { getTableColumns, getTableName, is } from 'drizzle-orm';
import { PgTable as PgTableClass } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { RESET_TABLES } from '../../scripts/e2eResetTables';
import { EXPORT_TABLES } from '../services/dataExport/DataExportService';
import * as schema from './Schema';

const OWNER_COLUMNS = new Set(['user_id', 'author_id', 'reporter_id']);

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
    for (const spec of EXPORT_TABLES) {
      const name = getTableName(spec.table);
      if (name === 'user') {
        continue;
      }

      expect(reset.get(name), name).toBe(spec.ownerColumn.name);
    }
  });
});
