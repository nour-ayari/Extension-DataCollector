import { cn } from '../utils/cn.js'
import { TableSkeleton } from './Skeletons.jsx'

export function DataTable({
  columns,
  data,
  rowKey = 'id',
  loading = false,
  emptyTitle = 'No data available',
  emptyDescription = 'There is nothing to show for the selected filter.',
  skeletonRows = 5,
}) {
  if (loading) {
    return <TableSkeleton columns={columns.length} rows={skeletonRows} />
  }

  if (!data.length) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50/80 p-8 text-center dark:border-slate-800 dark:bg-slate-950/60">
        <p className="text-base font-semibold text-slate-900 dark:text-white">{emptyTitle}</p>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{emptyDescription}</p>
      </div>
    )
  }

  const resolveRowKey = typeof rowKey === 'function' ? rowKey : (row) => row[rowKey]

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200/80 dark:border-slate-800">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200/80 text-left dark:divide-slate-800">
          <thead className="bg-slate-50/80 dark:bg-slate-950/80">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={cn(
                    'px-5 py-3.5 text-xs font-semibold uppercase tracking-[0.28em] text-slate-500 dark:text-slate-400',
                    column.align === 'right' && 'text-right',
                    column.align === 'center' && 'text-center',
                    column.className,
                  )}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200/70 bg-white/70 dark:divide-slate-800 dark:bg-slate-950/40">
            {data.map((row) => (
              <tr key={resolveRowKey(row)} className="transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-900/50">
                {columns.map((column) => {
                  const content = column.render ? column.render(row) : row[column.key]

                  return (
                    <td
                      key={`${resolveRowKey(row)}-${column.key}`}
                      className={cn(
                        'px-5 py-3.5 text-sm text-slate-700 dark:text-slate-200',
                        column.align === 'right' && 'text-right',
                        column.align === 'center' && 'text-center',
                        column.cellClassName,
                      )}
                    >
                      {content}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}