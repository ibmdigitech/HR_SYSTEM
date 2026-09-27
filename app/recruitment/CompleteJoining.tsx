"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UserPlus, Loader2, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { completeJoiningAction } from "@/app/lib/actions/recruitment";

/**
 * Completing a joining (§19).
 *
 * This is the moment a candidate becomes an Employee. The brief is explicit:
 * "Do NOT create an Employee record merely because someone applied for a job",
 * and "Only when the candidate actually joins should the system activate the
 * Employee record."
 *
 * The button is therefore only offered when the application has an ACCEPTED
 * offer. Everything the transaction creates — user, employee, salary structure,
 * leave balances, probation record, checklist, notification, audit — is atomic
 * and server-side; this control only confirms the intent.
 */
export function CompleteJoining({
    applicationId,
    candidateName,
    hasAcceptedOffer,
    alreadyEmployed,
}: {
    applicationId: string;
    candidateName: string;
    hasAcceptedOffer: boolean;
    alreadyEmployed?: boolean;
}) {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [confirm, setConfirm] = useState(false);
    const [busy, setBusy] = useState(false);

    if (alreadyEmployed) {
        return (
            <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 rounded-xl p-3">
                {candidateName} has already joined. An employee record exists.
            </p>
        );
    }

    if (!hasAcceptedOffer) {
        return (
            <div className="rounded-xl bg-amber-50 dark:bg-amber-950/40 p-3 space-y-2">
                <p className="text-xs font-bold text-amber-700 dark:text-amber-300 flex items-start gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>
                        {candidateName} cannot join yet — no ACCEPTED offer. Record the acceptance
                        on the offer first.
                    </span>
                </p>
            </div>
        );
    }

    async function onConfirm() {
        if (!confirm || busy) return;
        setBusy(true);
        const result = await completeJoiningAction(applicationId);
        setBusy(false);

        if (result.success) {
            toast.success(result.message);
            setOpen(false);
            router.refresh();
        } else {
            toast.error(result.message);
        }
    }

    return (
        <>
            <Button
                onClick={() => setOpen(true)}
                className="h-11 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 font-black uppercase text-xs tracking-widest"
            >
                <UserPlus className="h-4 w-4 mr-2" />
                Mark as joined
            </Button>

            {open && (
                <div
                    className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="join-title"
                >
                    <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-6 space-y-4">
                        <h2 id="join-title" className="text-lg font-black text-slate-900 dark:text-white">
                            Confirm {candidateName} has joined
                        </h2>

                        <p className="text-xs text-slate-600 dark:text-slate-400">
                            This creates the employee record. In one transaction it will:
                        </p>
                        <ul className="text-xs text-slate-500 space-y-1 list-disc pl-4">
                            <li>Create a user account with a one-time activation link</li>
                            <li>Create the employee master record with an employee code</li>
                            <li>Create the salary structure from the accepted offer</li>
                            <li>Create leave balances for the joining year</li>
                            <li>Start probation tracking</li>
                            <li>Create the onboarding checklist and notify the manager</li>
                        </ul>

                        <p className="text-xs font-bold text-rose-600 dark:text-rose-400">
                            If any step fails, everything is rolled back. No partial employee is left
                            behind.
                        </p>

                        <label className="flex items-start gap-2 text-xs cursor-pointer">
                            <input
                                type="checkbox"
                                checked={confirm}
                                onChange={(e) => setConfirm(e.target.checked)}
                                className="mt-0.5"
                            />
                            <span className="text-slate-600 dark:text-slate-400">
                                I confirm {candidateName} has physically joined and all checks are complete.
                            </span>
                        </label>

                        <div className="flex gap-2 pt-1">
                            <Button
                                variant="ghost"
                                onClick={() => setOpen(false)}
                                className="flex-1 h-10 rounded-xl text-[10px] font-black uppercase tracking-widest"
                            >
                                Cancel
                            </Button>
                            <Button
                                onClick={onConfirm}
                                disabled={!confirm || busy}
                                aria-busy={busy}
                                className="flex-1 h-10 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-[10px] font-black uppercase tracking-widest"
                            >
                                {busy ? (
                                    <>
                                        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                        Creating…
                                    </>
                                ) : (
                                    "Create employee"
                                )}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
