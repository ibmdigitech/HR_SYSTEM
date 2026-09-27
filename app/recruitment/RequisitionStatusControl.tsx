"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Loader2, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { moveRequisition } from "@/app/lib/actions/recruitment";
import { REQUISITION_STATUS, REQUISITION_TRANSITIONS } from "@/lib/workflow/recruitment-machine";

/**
 * Requisition approval controls (brief §3).
 *
 * The requisition state machine requires
 *   DRAFT → SUBMITTED → MANAGER_REVIEW → HR_REVIEW → FINANCE_REVIEW → APPROVED
 * so a newly created requisition is DRAFT and cannot receive applications until
 * it is APPROVED. Without this control a requisition is stuck at DRAFT forever,
 * which is why a new requisition appeared "not active".
 *
 * Only the transitions the current role may perform are offered, and the server
 * re-validates regardless — this is convenience, not authority.
 */

const STATUS_STYLE: Record<string, string> = {
    DRAFT: "bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-300",
    SUBMITTED: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
    MANAGER_REVIEW: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
    HR_REVIEW: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
    FINANCE_REVIEW: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    APPROVED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    REJECTED: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
    CANCELLED: "bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
};

const STAGE_LABEL: Record<string, string> = {
    DRAFT: "Draft",
    SUBMITTED: "Submitted",
    MANAGER_REVIEW: "Manager review",
    HR_REVIEW: "HR review",
    FINANCE_REVIEW: "Finance review",
    APPROVED: "Approved",
    REJECTED: "Rejected",
    CANCELLED: "Cancelled",
};

export function RequisitionStatusControl({
    requisitionId,
    status,
}: {
    requisitionId: string;
    status: string;
}) {
    const router = useRouter();
    const [busy, setBusy] = useState(false);

    // Which moves the state machine allows from here. Approval ordering is
    // enforced server-side; this only avoids showing impossible buttons.
    const targets = Object.keys(REQUISITION_TRANSITIONS[status] ?? {});

    if (targets.length === 0) {
        return (
            <span
                className={cn(
                    "inline-flex items-center rounded-lg px-2 py-1 text-[9px] font-black uppercase tracking-widest",
                    STATUS_STYLE[status] ?? "bg-slate-100 text-slate-500"
                )}
            >
                {STAGE_LABEL[status] ?? status}
            </span>
        );
    }

    async function move(to: string) {
        if (busy) return;
        setBusy(true);
        const result = await moveRequisition(requisitionId, to);
        setBusy(false);

        if (result.success) {
            toast.success(result.message);
            router.refresh();
        } else {
            toast.error(result.message);
        }
    }

    return (
        <div className="flex flex-wrap items-center gap-2">
            <span
                className={cn(
                    "inline-flex items-center rounded-lg px-2 py-1 text-[9px] font-black uppercase tracking-widest",
                    STATUS_STYLE[status] ?? "bg-slate-100 text-slate-500"
                )}
            >
                {STAGE_LABEL[status] ?? status}
            </span>

            {targets.map((to) => {
                const destructive = to === REQUISITION_STATUS.REJECTED || to === REQUISITION_STATUS.CANCELLED;
                return (
                    <Button
                        key={to}
                        size="sm"
                        disabled={busy}
                        onClick={() => move(to)}
                        className={cn(
                            "h-7 rounded-lg text-[10px] font-black uppercase tracking-widest",
                            destructive
                                ? "bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                                : "bg-indigo-600 hover:bg-indigo-700 text-white"
                        )}
                    >
                        {busy ? (
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        ) : destructive ? (
                            <XCircle className="h-3 w-3 mr-1" />
                        ) : (
                            <ArrowRight className="h-3 w-3 mr-1" />
                        )}
                        {destructive ? (to === REQUISITION_STATUS.CANCELLED ? "Cancel" : "Reject") : STAGE_LABEL[to] ?? to}
                    </Button>
                );
            })}
        </div>
    );
}
