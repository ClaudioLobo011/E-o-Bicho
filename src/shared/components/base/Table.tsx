import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable
} from '@tanstack/react-table';
import { useState } from 'react';
import { Button } from './Button';
import { Pagination } from './Pagination';

interface TableProps<TData> {
  data: TData[];
  columns: ColumnDef<TData, any>[];
  initialSorting?: SortingState;
  pageSize?: number;
  emptyMessage?: string;
}

export function Table<TData>({
  data,
  columns,
  initialSorting,
  pageSize = 10,
  emptyMessage = 'Nenhum registro encontrado.'
}: TableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting ?? []);

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } }
  });

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600"
                >
                  {header.isPlaceholder ? null : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="-ml-2 flex items-center gap-1 text-xs font-semibold uppercase text-gray-600 hover:text-primary"
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {{
                        asc: <i className="fa-solid fa-arrow-up-wide-short" aria-hidden />,
                        desc: <i className="fa-solid fa-arrow-down-wide-short" aria-hidden />,
                        false: <i className="fa-solid fa-sort" aria-hidden />
                      }[header.column.getIsSorted() as string || 'false']}
                    </Button>
                  )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody className="divide-y divide-gray-100">
          {table.getRowModel().rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-4 py-6 text-center text-sm text-gray-500">
                {emptyMessage}
              </td>
            </tr>
          )}
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="hover:bg-gray-50">
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-4 py-3 text-sm text-gray-700">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-xs text-gray-500">
          Página {table.getState().pagination.pageIndex + 1} de {table.getPageCount() || 1}
        </span>
        <Pagination
          canPrevious={table.getCanPreviousPage()}
          canNext={table.getCanNextPage()}
          onPrevious={table.previousPage}
          onNext={table.nextPage}
        />
      </div>
    </div>
  );
}
