"use client";

/**
 * Approve button for a letter row in the central approval queue.
 *
 * It calls `POST /api/letters/[id]/approve` rather than re-implementing the
 * transition. That route is the only place the letter approval rules live:
 * `authorizePermission(LETTER_APPROVE)`, the guarded
 * `updateMany({ where: { id, status: "PENDING" } })` that makes two
 * concurrent approvals impossible, the 404/409 distinction, and the security
 * audit row. A second implementation in this file would be a third set of rules
 * to keep in step, and this route had ZERO callers before — it is the caller
 * that makes the workflow reachable at all.
 *
 * There is deliberately no Reject button here. No letter rejection endpoint
 * exists anywhere in the product, so a Reject control would be a dead button
 * that fails silently — worse than an absent one. The queue row says so.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";

export function LetterApproveButton({ letterId }: { letterId: string }) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    // `useTransition` only tracks React work; the fetch is not React work, so
    // the disabled state is tracked explicitly. Without it the button stays
    // clickable through the round trip and a second POST returns 409.
    const [busy, setBusy] = useState(false);
    const disabled = isPending || busy;

    function approve() {
        setBusy(true);
        (async () => {
            try {
                const response = await fetch(`/api/letters/${letterId}/approve`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                });

                const payload = await response.json().catch(() => null);

                if (!response.ok) {
                    // 409 is the expected one: someone else decided this letter
                    // between the queue rendering and this click. Say so, rather
                    // than showing a generic failure that sends people hunting.
                    toast.error(
                        (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
                            ? payload.error
                            : null) ?? "The letter could not be approved."
                    );
                    startTransition(() => router.refresh());
                    return;
                }

                const reference =
                    payload && typeof payload === "object" && "referenceNumber" in payload
                        ? String(payload.referenceNumber)
                        : null;
                toast.success(reference ? `Letter ${reference} approved.` : "Letter approved.");
                startTransition(() => router.refresh());
            } catch {
                toast.error("Could not reach the approval service. Nothing was changed.");
            } finally {
                setBusy(false);
            }
        })();
    }

    return (
        <Button
            type="button"
            onClick={approve}
            disabled={disabled}
            aria-busy={disabled}
            className="gap-2 rounded-xl font-bold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 transition-colors duration-200"
        >
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            {disabled ? "Approving..." : "Approve"}
        </Button>
    );
}
