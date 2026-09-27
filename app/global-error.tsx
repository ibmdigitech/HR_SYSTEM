"use client";

import Link from "next/link";

/**
 * Root error boundary (P0-19).
 *
 * Catches failures in the ROOT LAYOUT itself, where `app/error.tsx` cannot
 * reach because its own provider tree is broken. Next.js requires this file to
 * render its own `<html>` and `<body>`.
 *
 * SECURITY: as with `app/error.tsx`, no error message or stack is rendered.
 * The markup is inline because global-error replaces the entire document, so
 * no imported component or stylesheet can be relied upon.
 */
export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    // `console.error` is the only reporting available at this level; Next.js also
    // logs the error server-side.
    if (typeof console !== "undefined") {
        console.error("[global-error]", { message: (error instanceof Error ? error.message : "Unknown error"), digest: error.digest });
    }

    return (
        <html lang="en">
            <body
                style={{
                    margin: 0,
                    minHeight: "100vh",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "#f8fafc",
                    color: "#0f172a",
                    fontFamily:
                        "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
                    padding: "2rem",
                }}
            >
                <div style={{ maxWidth: "32rem", textAlign: "center" }}>
                    <h1 style={{ fontSize: "1.5rem", fontWeight: 800, margin: "0 0 0.75rem" }}>
                        Application error
                    </h1>
                    <p style={{ fontSize: "0.875rem", color: "#475569", margin: "0 0 1.5rem" }}>
                        A critical error occurred and the application could not recover. The error has been
                        recorded. Please try again.
                    </p>

                    {error.digest && (
                        <p
                            style={{
                                fontSize: "0.75rem",
                                fontFamily: "ui-monospace, monospace",
                                color: "#94a3b8",
                                margin: "0 0 1.5rem",
                            }}
                        >
                            Reference: {error.digest}
                        </p>
                    )}

                    <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
                        <button
                            onClick={() => reset()}
                            style={{
                                height: "2.75rem",
                                padding: "0 1.5rem",
                                borderRadius: "0.75rem",
                                border: "none",
                                background: "#4f46e5",
                                color: "#ffffff",
                                fontSize: "0.875rem",
                                fontWeight: 700,
                                cursor: "pointer",
                            }}
                        >
                            Try again
                        </button>
                        {/* Link, not <a>: an internal navigation must not trigger a
                            full document reload, which would re-run the failing
                            layout that produced this boundary in the first place. */}
                        <Link
                            href="/"
                            style={{
                                height: "2.75rem",
                                padding: "0 1.5rem",
                                borderRadius: "0.75rem",
                                border: "1px solid #e2e8f0",
                                background: "#ffffff",
                                color: "#334155",
                                fontSize: "0.875rem",
                                fontWeight: 700,
                                display: "inline-flex",
                                alignItems: "center",
                                textDecoration: "none",
                            }}
                        >
                            Go to sign in
                        </Link>
                    </div>
                </div>
            </body>
        </html>
    );
}
