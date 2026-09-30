"use client";

/**
 * Approve / Reject controls for an exit case in the central approval queue.
 *
 * Both buttons call the real server actions from `@/app/lib/actions/exit`
 * (`approveExitCase` / `rejectExitCase`), which own the authorization
 * (`requireAnyPermission([RESIGNATION_APPROVE, TERMINATION_APPROVE])`), the
 * state-machine check, the guarded `updateMany` that makes a double submit
 * impossible, and the audit row. Nothing here re-decides an exit; it only
 * collects input and reports the result the action returned.
 *
 * WHY REJECT OPENS A DIALOG: `decideExit` refuses a rejection with no note —
 * "A rejection must record why. The note is kept on the case." A one-click
 * Reject would therefore always fail, so the note is collected up front and the
 * confirm button stays disabled until there is one. Approve needs no input, so
 * it stays a single click; the case keeps whatever dates and notice period it
 * already carries, and those can still be amended on the case itself.
 *
 * Styling note: `transition-*` / `duration-*` only. The tailwindcss-animate
 * plugin is not installed, so `animate-*` variants (and the Radix
 * `data-[state=open]:animate-in` classes the dialog primitive carries) are
 * dead CSS here.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { approveExitCase, rejectExitCase } from "@/app/lib/actions/exit";

/** The three facts a rejection note has to carry, as prompts. */
const REJECT_HINTS = [
    "The reason the case was refused",
    "What the employee or manager should do next",
    "Any contractual or policy reference relied on",
];

export function ExitCaseDecision({ exitCaseId, employeeName }: { exitCaseId: string; employeeName: string }) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [note, setNote] = useState("");

    const disabled = isPending || busy !== null;
    const trimmedNote = note.trim();

    function finish(result: { success: boolean; message: string }) {
        if (result.success) {
            toast.success(result.message);
            setDialogOpen(false);
            setNote("");
        } else {
            // The action returns a `{ success, message }` pair rather than
            // throwing, and the message is the only explanation available —
            // "not permitted: PENDING_APPROVAL → APPROVED" is worth showing.
            toast.error(result.message);
        }
        startTransition(() => router.refresh());
    }

    function approve() {
        setBusy("approve");
        (async () => {
            try {
                finish(await approveExitCase(exitCaseId));
            } catch {
                toast.error("Could not reach the approval service. Nothing was changed.");
            } finally {
                setBusy(null);
            }
        })();
    }

    function reject() {
        setBusy("reject");
        (async () => {
            try {
                finish(await rejectExitCase(exitCaseId, { decisionNote: trimmedNote }));
            } catch {
                toast.error("Could not reach the approval service. Nothing was changed.");
            } finally {
                setBusy(null);
            }
        })();
    }

    return (
        <>
            <div className="flex items-end justify-end gap-2">
                <Button
                    type="button"
                    onClick={() => setDialogOpen(true)}
                    disabled={disabled}
                    className="gap-2 rounded-xl font-bold transition-colors duration-200"
                    variant="destructive"
                    size="sm"
                >
                    <XCircle className="h-4 w-4" aria-hidden="true" />
                    Reject
                </Button>
                <Button
                    type="button"
                    onClick={approve}
                    disabled={disabled}
                    aria-busy={busy === "approve"}
                    className="gap-2 rounded-xl font-bold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 transition-colors duration-200"
                    size="sm"
                >
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    {busy === "approve" ? "Approving..." : "Approve"}
                </Button>
            </div>

            <Dialog
                open={dialogOpen}
                onOpenChange={(open) => {
                    if (busy === "reject") return;
                    setDialogOpen(open);
                    if (!open) setNote("");
                }}
            >
                <DialogContent className="max-w-[calc(100%_-_2rem)] sm:max-w-md max-h-[calc(100dvh_-_2rem)] overflow-y-auto rounded-[1.5rem] sm:rounded-[2rem] border-0 shadow-2xl bg-white dark:bg-slate-950 p-5 sm:p-6">
                    <DialogHeader>
                        <DialogTitle className="text-lg font-black uppercase tracking-tight text-slate-900 dark:text-white">
                            Reject exit case
                        </DialogTitle>
                        <DialogDescription className="text-xs text-slate-500 font-bold">
                            {employeeName} — a rejection is final. This case is not revived; a
                            corrected request is opened as a new case so the refusal stays on
                            record.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-2 my-2">
                        <Label
                            htmlFor={`exit-reject-note-${exitCaseId}`}
                            className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1"
                        >
                            Reason (required)
                        </Label>
                        <Textarea
                            id={`exit-reject-note-${exitCaseId}`}
                            value={note}
                            onChange={(event) => setNote(event.target.value)}
                            rows={4}
                            autoFocus
                            placeholder="e.g. Notice period not served in full; agreed last working date is 30 June, not 31 May."
                            className="rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-medium"
                        />
                        <ul className="space-y-1 pt-1">
                            {REJECT_HINTS.map((hint) => (
                                <li
                                    key={hint}
                                    className="text-[11px] font-medium text-slate-400 flex items-start gap-2"
                                >
                                    <span aria-hidden="true" className="text-slate-300">
                                        &bull;
                                    </span>
                                    {hint}
                                </li>
                            ))}
                        </ul>
                    </div>

                    <DialogFooter className="gap-2">
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={() => setDialogOpen(false)}
                            disabled={busy === "reject"}
                            className="rounded-xl font-bold uppercase text-[10px] h-10 transition-colors duration-200"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            onClick={reject}
                            // The action refuses an empty note, so do not offer
                            // the click that is guaranteed to fail.
                            disabled={disabled || trimmedNote.length === 0}
                            className="h-10 px-6 rounded-xl font-black uppercase text-xs text-white shadow-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-60 transition-colors duration-200"
                        >
                            {busy === "reject" ? "Rejecting..." : "Confirm rejection"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
