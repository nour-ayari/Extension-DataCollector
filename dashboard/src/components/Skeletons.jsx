export function MetricCardSkeleton() {
  return (
    <div className="animate-pulse rounded-[28px] border border-slate-200/80 bg-white/85 p-5 shadow-[var(--page-shadow)] dark:border-slate-800 dark:bg-slate-950/60">
      <div className="mb-4 h-12 w-12 rounded-2xl bg-slate-200/80 dark:bg-slate-800" />
      <div className="mb-3 h-3 w-32 rounded-full bg-slate-200/80 dark:bg-slate-800" />
      <div className="mb-2 h-10 w-24 rounded-full bg-slate-200/80 dark:bg-slate-800" />
      <div className="h-3 w-40 rounded-full bg-slate-200/80 dark:bg-slate-800" />
    </div>
  )
}

export function ChartSkeleton() {
  return (
    <div className="animate-pulse rounded-3xl border border-slate-200/80 bg-white/85 p-6 dark:border-slate-800 dark:bg-slate-950/60">
      <div className="mb-5 h-4 w-40 rounded-full bg-slate-200/80 dark:bg-slate-800" />
      <div className="flex h-72 items-end gap-3">
        {[42, 68, 54, 78, 60, 84].map((height) => (
          <div key={height} className="flex-1 rounded-t-3xl bg-slate-200/80 dark:bg-slate-800" style={{ height: `${height}%` }} />
        ))}
      </div>
    </div>
  )
}

export function TableSkeleton({ columns = 6, rows = 5 }) {
  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200/80 dark:border-slate-800">
      <div className="animate-pulse overflow-x-auto bg-white/85 dark:bg-slate-950/60">
        <table className="min-w-full text-left">
          <thead className="border-b border-slate-200/80 dark:border-slate-800">
            <tr>
              {Array.from({ length: columns }).map((_, columnIndex) => (
                <th key={columnIndex} className="px-4 py-3">
                  <div className="h-3 w-20 rounded-full bg-slate-200/80 dark:bg-slate-800" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }).map((_, rowIndex) => (
              <tr key={rowIndex} className="border-b border-slate-200/60 dark:border-slate-800">
                {Array.from({ length: columns }).map((__, columnIndex) => (
                  <td key={columnIndex} className="px-4 py-4">
                    <div className="h-3 w-full rounded-full bg-slate-200/80 dark:bg-slate-800" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function FeedSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="rounded-2xl border border-slate-200/80 bg-white/85 p-4 dark:border-slate-800 dark:bg-slate-950/60">
          <div className="h-4 w-36 rounded-full bg-slate-200/80 dark:bg-slate-800" />
          <div className="mt-3 h-3 w-full rounded-full bg-slate-200/80 dark:bg-slate-800" />
          <div className="mt-2 h-3 w-2/3 rounded-full bg-slate-200/80 dark:bg-slate-800" />
        </div>
      ))}
    </div>
  )
}