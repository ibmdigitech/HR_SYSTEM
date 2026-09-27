import Link from "next/link";
import { Compass, ArrowLeft, LayoutDashboard } from "lucide-react";

/**
 * 404 boundary (P0-19).
 *
 * Server component — no "use client" needed, nothing here is interactive.
 * Reached when a route does not resolve. Previously the application had no
 * `not-found.tsx`, so users saw the unbranded Next.js default page.
 */
export default function NotFound() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-6 py-16">
            <div className="w-full max-w-md text-center space-y-6">
                <div className="flex justify-center">
                    <div className="p-4 rounded-2xl bg-indigo-100 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-900/50">
                        <Compass className="h-8 w-8 text-indigo-600 dark:text-indigo-400" />
                    </div>
                </div>

                <div className="space-y-2">
                    <p className="text-5xl font-black tracking-tight text-slate-900 dark:text-white">404</p>
                    <h1 className="text-xl font-bold text-slate-900 dark:text-white">Page not found</h1>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                        The page you are looking for does not exist or has been moved.
                    </p>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                    <Link
                        href="/dashboard"
                        className="inline-flex items-center justify-center gap-2 h-11 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold transition-colors"
                    >
                        <LayoutDashboard className="h-4 w-4" />
                        Go to dashboard
                    </Link>
                    <Link
                        href="/"
                        className="inline-flex items-center justify-center gap-2 h-11 px-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 text-sm font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        Back to start
                    </Link>
                </div>
            </div>
        </div>
    );
}
