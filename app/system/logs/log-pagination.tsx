"use client";

import Link from "next/link";

/**
 * Server-link pagination.
 *
 * Deliberately plain `<Link>`s driven by the URL rather than a client-side
 * "load more" button: the page is already a server component, so a full
 * navigation costs nothing extra, the result is linkable and survives a
 * reload, and every control works with JavaScript disabled.
 *
 * The page numbers preserve the active filters, so paging never silently
 * discards a search the user had applied.
 */
export function LogPagination({
    basePath,
    param,
    page,
    pageCount,
    total,
    pageSize,
    params,
}: {
    basePath: string;
    /**
     * URL key holding this list's cursor — `secPage` or `actPage`.
     *
     * Passed in rather than hardcoded because the two lists paginate
     * independently. Emitting a single `page=` key would make paging the security
     * list also move the activity list, and the activity list's own cursor would
     * then fight it.
     */
    param: string;
    page: number;
    pageCount: number;
    total: number;
    pageSize: number;
    /** Current filter values, re-applied to every generated link. */
    params: Record<string, string | undefined>;
}) {
    if (pageCount <= 1) {
        return (
            <p className="text-xs text-slate-500">
                Showing all {total} record{total === 1 ? "" : "s"}.
            </p>
        );
    }

    const href = (target: number) => {
        const q = new URLSearchParams();
        q.set(param, String(target));
        // Carry the other list's cursor so switching between them does not reset
        // it, but never emit a key the server does not read.
        for (const [k, v] of Object.entries(params)) {
            if (k === param || k === "page" || !v) continue;
            q.set(k, v);
        }
        return `${basePath}?${q.toString()}`;
    };

    const from = (page - 1) * pageSize + 1;
    const to = Math.min(page * pageSize, total);

    return (
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <p className="text-xs text-slate-500">
                Showing <span className="font-bold text-slate-700 dark:text-slate-300">{from}</span>–
                <span className="font-bold text-slate-700 dark:text-slate-300">{to}</span> of{" "}
                <span className="font-bold text-slate-700 dark:text-slate-300">{total}</span>
            </p>
            <nav className="flex items-center gap-1" aria-label="Pagination">
                <PageLink href={href(Math.max(1, page - 1))} disabled={page === 1}>
                    Previous
                </PageLink>
                {pageNumbers(page, pageCount).map((n, i) =>
                    n === null ? (
                        <span key={`gap-${i}`} className="px-1 text-xs text-slate-400" aria-hidden="true">
                            …
                        </span>
                    ) : (
                        <PageLink key={n} href={href(n)} current={n === page}>
                            {n}
                        </PageLink>
                    )
                )}
                <PageLink href={href(Math.min(pageCount, page + 1))} disabled={page === pageCount}>
                    Next
                </PageLink>
            </nav>
        </div>
    );
}

function PageLink({
    href,
    disabled,
    current,
    children,
}: {
    href: string;
    disabled?: boolean;
    current?: boolean;
    children: React.ReactNode;
}) {
    const cls = current
        ? "bg-indigo-600 text-white border-indigo-600"
        : disabled
          ? "text-slate-300 dark:text-slate-600 border-slate-100 dark:border-slate-800"
          : "text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900";

    if (disabled) {
        return (
            <span
                aria-disabled="true"
                className={`inline-flex h-8 min-w-8 items-center justify-center rounded-lg border px-2 text-xs font-bold ${cls} cursor-not-allowed`}
            >
                {children}
            </span>
        );
    }

    return (
        <Link
            href={href}
            aria-current={current ? "page" : undefined}
            className={`inline-flex h-8 min-w-8 items-center justify-center rounded-lg border px-2 text-xs font-bold transition-colors ${cls}`}
        >
            {children}
        </Link>
    );
}

/** 1 … 4 5 6 … 12 — first/last always visible, a window around the current page. */
function pageNumbers(page: number, pageCount: number): (number | null)[] {
    const out: (number | null)[] = [];
    const window = new Set<number>([1, pageCount, page, page - 1, page + 1]);
    const sorted = [...window].filter((n) => n >= 1 && n <= pageCount).sort((a, b) => a - b);

    let previous = 0;
    for (const n of sorted) {
        if (previous && n - previous > 1) out.push(null);
        out.push(n);
        previous = n;
    }
    return out;
}
