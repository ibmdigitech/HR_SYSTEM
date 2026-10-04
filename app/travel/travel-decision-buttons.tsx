"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { decideBusinessTravelRequest } from "@/app/lib/actions/travel";
import { Button } from "@/components/ui/button";

/**
 * The decision buttons for one travel request.
 *
 * WHICH BUTTONS APPEAR is decided server-side from the session role, and every
 * click re-checks it: `advanceTravelRequest` calls `assertTransition` with the
 * actor's role read from the database, so hiding a button is a usability
 * affordance and not the control.
 */
export function TravelDecisionButtons({
    requestId,
    status,
    canDecide,
    isOwnRequest,
    approvalBlockers,
}: {
    requestId: string;
    status: string;
    canDecide: boolean;
    /** Used to explain, rather than silently hide, why a decision is unavailable. */
    isOwnRequest: boolean;
    /**
     * What is still missing before APPROVED is accepted. Rendered on the button
     * rather than left to the refusal toast, so the approver can see the two
     * gates before clicking rather than after.
     */
    approvalBlockers?: readonly string[];
}) {
    const [busy, setBusy] = useState(false);
    const router = useRouter();

    async function decide(to: string) {
        setBusy(true);
        try {
            const result = await decideBusinessTravelRequest(requestId, to);
            if (!result.success) toast.error(result.message);
            else toast.success(result.message);
            router.refresh();
        } catch {
            toast.error("Could not update the travel request.");
        } finally {
            setBusy(false);
        }
    }

    const cancelable = status === "REQUESTED" || status === "PENDING_APPROVAL" || status === "APPROVED";
    const decider = status === "REQUESTED" || status === "PENDING_APPROVAL";
    const blocked = decider && (approvalBlockers?.length ?? 0) > 0;

    if (!canDecide && !cancelable) return null;

    return (
        <div className="flex flex-wrap items-center gap-2">
            {canDecide && decider && (
                <>
                    <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => decide("APPROVED")}
                        title={
                            blocked
                                ? "Cannot approve yet: an approved amount must be granted and every filed document verified."
                                : "Approves the trip at the granted amount."
                        }
                        className={blocked ? "opacity-60" : undefined}
                    >
                        Approve
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => decide("REJECTED")}
                    >
                        Reject
                    </Button>
                </>
            )}
            {canDecide && status === "APPROVED" && (
                <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => decide("COMPLETED")}
                    // The rule is on the button as well as on the request, because the
                    // refusal otherwise arrives only after the traveller has already
                    // flown and the click is the first time anyone hears about it.
                    title="Records the ticket as issued and consumes it from the entitlement window. A boarding pass must be attached first."
                >
                    Record ticket issued
                </Button>
            )}
            {cancelable && (
                <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => decide("CANCELLED")}
                    title={
                        isOwnRequest
                            ? "Cancel this request"
                            : "Only the traveller can cancel this request"
                    }
                >
                    Cancel
                </Button>
            )}
            {canDecide && isOwnRequest && decider && (
                <span className="text-[11px] text-slate-500">
                    You raised this request, so you cannot decide it.
                </span>
            )}
            {blocked && (
                <span className="w-full text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                    Not approvable yet: {approvalBlockers?.join(" and ")}. Amount must be granted and
                    documents verified before this trip can be approved.
                </span>
            )}
        </div>
    );
}