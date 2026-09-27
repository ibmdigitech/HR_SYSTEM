import { redirect } from "next/navigation";
import ActivateClient from "./ActivateClient";
import { findValidToken } from "@/lib/workflow/credentials";

/**
 * Activation route: `/activate/[token]`.
 *
 * The token is validated server-side before the form is shown, so an invalid or
 * already-used link produces a clear message rather than a form that fails on
 * submit. Only the existence and validity of the token are revealed — never who
 * it belongs to.
 */
export const dynamic = "force-dynamic";

export default async function ActivatePage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;

    if (!token || token.length < 20) redirect("/login");

    const record = await findValidToken(token);
    if (!record) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-6 py-16">
                <div className="w-full max-w-md text-center space-y-4">
                    <h1 className="text-xl font-black text-slate-900 dark:text-white">Link no longer valid</h1>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                        This activation link has expired or has already been used. Ask HR to issue a new one.
                    </p>
                    <a
                        href="/login"
                        className="inline-flex h-11 items-center justify-center rounded-xl bg-indigo-600 px-6 text-sm font-bold text-white hover:bg-indigo-700"
                    >
                        Go to sign in
                    </a>
                </div>
            </div>
        );
    }

    return <ActivateClient token={token} />;
}
