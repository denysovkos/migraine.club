'use client';

import type { ColumnDef, RowData } from '@tanstack/react-table';
import type { BasicTableFeatures } from '@/components/ui/table-features';
import { flexRender, useTable } from '@tanstack/react-table';
import { useTranslations } from 'next-intl';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { basicTableFeatures } from '@/components/ui/table-features';

type ClickableDataTableProps<TData extends RowData> = {
  columns: ColumnDef<BasicTableFeatures, TData, unknown>[];
  data: TData[];
  onRowClick?: (row: TData) => void;
};

export function ClickableDataTable<TData extends RowData>({
  columns,
  data,
  onRowClick,
}: ClickableDataTableProps<TData>) {
  const table = useTable({
    features: basicTableFeatures,
    data,
    columns,
  });
  const t = useTranslations('DataTable');

  return (
    <div className="rounded-md border bg-card">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map(headerGroup => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                return (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows?.length
            ? (
                table.getRowModel().rows.map(row => (
                  <TableRow
                    key={row.id}
                    onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                    className={
                      onRowClick
                        ? 'cursor-pointer transition-colors hover:bg-muted/80 active:bg-muted'
                        : ''
                    }
                    role={onRowClick ? 'button' : undefined}
                    tabIndex={onRowClick ? 0 : undefined}
                    onKeyDown={
                      onRowClick
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onRowClick(row.original);
                            }
                          }
                        : undefined
                    }
                  >
                    {row.getAllCells().map(cell => (
                      <TableCell key={cell.id} className="whitespace-nowrap">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )
            : (
                <TableRow>
                  <TableCell colSpan={columns.length} className="h-24 text-center">
                    {t('no_results')}
                  </TableCell>
                </TableRow>
              )}
        </TableBody>
      </Table>
    </div>
  );
}
