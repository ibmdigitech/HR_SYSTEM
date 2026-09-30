"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw, Home, ShieldAlert } from "lucide-react";
import { reportClientError } from "@/lib/observability/client-report";

/**
 * Route-segment error boundary (P0-17 / P0-19).
 *
 * SECURITY: this component deliberately does NOT render `(error instanceof Error ? error.message : "Unknown error")` or
 * `error.digest` to the user. A server-rendered error can carry a Prisma
 * message, a file path, or a connection string, all of which are information
 * disclosure. The full detail is logged server-side by Next.js and is available
 * in production logs; `digest` is an opaque correlation id safe to show so a
 * user can quote it in a support request.
 *
 * This boundary catches render and data-fetch errors for everything below
 * `app/`. It does not catch errors in the root layout itself — that is what
 * `global-error.tsx` is for.
 */
export default function AppError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        // Structured, one JSON object per line, with a correlation id and a
        // Prisma-aware classification instead of a devtools object blob.
        // The message may contain sensitive detail, so it is logged and never
        // rendered.
        //
        // `reportClientError` is the allow-listed client reporter, NOT
        // `reportError`: the latter reaches `@/lib/auth/audit` for `redact()`,
        // which imports `@/lib/prisma`, and that would put the Prisma client
        // in a browser bundle. See lib/observability/client-report.ts.
        reportClientError(error, { digest: error.digest });
    }, [error]);

    const isDev = process.env.NODE_ENV === "development";

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-6 py-16">
            <div className="w-full max-w-lg text-center space-y-6">
                <div className="flex justify-center">
                    <div className="p-4 rounded-2xl bg-rose-100 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50">
                        <AlertTriangle className="h-8 w-8 text-rose-600 dark:text-rose-400" />
                    </div>
                </div>

                <div className="space-y-2">
                    <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">
                        Something went wrong
                    </h1>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                        This page could not be loaded. The error has been recorded. You can try again, or
                        return to the dashboard.
                    </p>
                </div>

                {error.digest && (
                    <p className="text-xs font-mono text-slate-400 dark:text-slate-600">
                        Reference: {error.digest}
                    </p>
                )}

                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                    <button
                        onClick={() => reset()}
                        className="inline-flex items-center justify-center gap-2 h-11 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold transition-colors"
                    >
                        <RefreshCw className="h-4 w-4" />
                        Try again
                    </button>
                    <Link
                        href="/dashboard"
                        className="inline-flex items-center justify-center gap-2 h-11 px-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 text-sm font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                    >
                        <Home className="h-4 w-4" />
                        Go to dashboard
                    </Link>
                </div>

                {/* Development only. Stripped from the production bundle path. */}
                {isDev && (
                    <details className="text-left">
                        <summary className="cursor-pointer text-xs font-bold text-slate-400 hover:text-slate-600 flex items-center gap-2 justify-center">
                            <ShieldAlert className="h-3.5 w-3.5" />
                            Developer detail
                        </summary>
                        <pre className="mt-3 p-4 rounded-xl bg-slate-900 text-slate-200 text-xs overflow-auto whitespace-pre-wrap break-words max-h-64">
                            {(error instanceof Error ? error.message : "Unknown error")}
                            {error.stack ? `\n\n${error.stack}` : ""}
                        </pre>
                    </details>
                )}
            </div>
        </div>
    );
}
