/**
 * Shared loading skeletons.
 *
 * P0-24 / P0-20: the application had no route-level loading states, so a slow
 * query produced a blank screen that looked like a failure. Skeletons are
 * preferred over spinners for page and table loading because they preserve
 * layout and communicate the shape of the incoming content.
 */

export function PageSkeleton({ label = "Loading" }: { label?: string }) {
    return (
        <div className="p-8 space-y-6" role="status" aria-busy="true" aria-live="polite">
            <span className="sr-only">{label}</span>

            {/* Heading */}
            <div className="space-y-3">
                <div className="h-9 w-64 rounded-xl bg-slate-200 dark:bg-slate-800 animate-pulse" />
                <div className="h-4 w-96 max-w-full rounded-lg bg-slate-100 dark:bg-slate-800/60 animate-pulse" />
            </div>

            {/* Stat cards */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                    <div
                        key={i}
                        className="h-28 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-3"
                    >
                        <div className="h-3 w-20 rounded bg-slate-200 dark:bg-slate-800 animate-pulse" />
                        <div className="h-7 w-16 rounded-lg bg-slate-200 dark:bg-slate-800 animate-pulse" />
                    </div>
                ))}
            </div>

            {/* Table */}
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
                <div className="h-12 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40" />
                {Array.from({ length: 6 }).map((_, i) => (
                    <div
                        key={i}
                        className="h-16 border-b border-slate-100 dark:border-slate-800/60 px-5 flex items-center gap-4"
                    >
                        <div className="h-10 w-10 rounded-full bg-slate-200 dark:bg-slate-800 animate-pulse shrink-0" />
                        <div className="flex-1 space-y-2">
                            <div className="h-3.5 w-48 rounded bg-slate-200 dark:bg-slate-800 animate-pulse" />
                            <div className="h-3 w-64 max-w-full rounded bg-slate-100 dark:bg-slate-800/70 animate-pulse" />
                        </div>
                        <div className="h-7 w-20 rounded-lg bg-slate-100 dark:bg-slate-800/70 animate-pulse shrink-0" />
                    </div>
                ))}
            </div>
        </div>
    );
}

export function TableSkeleton({ rows = 8 }: { rows?: number }) {
    return (
        <div
            className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden"
            role="status"
            aria-busy="true"
        >
            <span className="sr-only">Loading data</span>
            <div className="h-12 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40" />
            {Array.from({ length: rows }).map((_, i) => (
                <div key={i} className="h-16 border-b border-slate-100 dark:border-slate-800/60 px-5 flex items-center gap-4">
                    <div className="h-10 w-10 rounded-full bg-slate-200 dark:bg-slate-800 animate-pulse shrink-0" />
                    <div className="flex-1 space-y-2">
                        <div className="h-3.5 w-48 rounded bg-slate-200 dark:bg-slate-800 animate-pulse" />
                        <div className="h-3 w-64 max-w-full rounded bg-slate-100 dark:bg-slate-800/70 animate-pulse" />
                    </div>
                </div>
            ))}
        </div>
    );
}
