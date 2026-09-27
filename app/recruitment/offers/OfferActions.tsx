"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, FileText, Send, Check, X, RotateCcw } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { moveOffer, issueOfferLetterAction } from "@/app/lib/actions/recruitment";
import { OFFER_STATUS, OFFER_TRANSITIONS } from "@/lib/workflow/recruitment-machine";

/**
 * Offer actions (§14, §16, §23).
 *
 * The state machine is the authority: only transitions it permits from the
 * current status are rendered, and the server re-validates. Superseded
 * versions are refused entirely — the previous terms are history.
 */

const ACTION_LABEL: Record<string, string> = {
    PENDING_APPROVAL: "Send for approval",
    APPROVED: "Mark approved",
    SENT: "Mark as sent",
    VIEWED: "Mark as viewed",
    ACCEPTED: "Record acceptance",
    DECLINED: "Record decline",
    EXPIRED: "Mark expired",
    WITHDRAWN: "Withdraw",
    DRAFT: "Revise as new version",
};

export function OfferActions({
    offerId,
    status,
    superseded,
    hasLetter,
    canApprove,
}: {
    offerId: string;
    status: string;
    superseded: boolean;
    hasLetter: boolean;
    canApprove: boolean;
}) {
    const router = useRouter();
    const [busy, setBusy] = useState(false);

    const targets = superseded ? [] : Object.keys(OFFER_TRANSITIONS[status] ?? {});

    if (superseded) {
        return (
            <p className="text-xs font-bold text-slate-500 bg-slate-50 dark:bg-slate-900 rounded-xl p-3">
                This version was superseded and cannot be actioned. Its terms remain on record.
            </p>
        );
    }

    async function move(to: string) {
        if (busy) return;
        setBusy(true);
        const result = await moveOffer(offerId, to);
        setBusy(false);
        if (result.success) {
            toast.success(result.message);
            router.refresh();
        } else {
            toast.error(result.message);
        }
    }

    async function issueLetter() {
        if (busy) return;
        setBusy(true);
        const result = await issueOfferLetterAction(offerId);
        setBusy(false);
        if (result.success) {
            toast.success(result.message);
            router.refresh();
        } else {
            toast.error(result.message);
        }
    }

    // A letter may only be produced from an APPROVED offer, and only once.
    const canIssueLetter = status === OFFER_STATUS.APPROVED && !hasLetter;

    return (
        <div className="space-y-3">
            {canApprove && status === OFFER_STATUS.PENDING_APPROVAL && (
                <p className="text-[11px] text-slate-500">
                    Waiting on approval. Finance, HR or an administrator can approve it.
                </p>
            )}

            <div className="flex flex-wrap gap-2">
                {targets.map((to) => {
                    const negative =
                        to === OFFER_STATUS.DECLINED ||
                        to === OFFER_STATUS.WITHDRAWN ||
                        to === OFFER_STATUS.EXPIRED;
                    return (
                        <Button
                            key={to}
                            size="sm"
                            disabled={busy}
                            onClick={() => move(to)}
                            className={cn(
                                "h-9 rounded-lg text-[10px] font-black uppercase tracking-widest",
                                negative
                                    ? "bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900 text-rose-600 hover:bg-rose-50"
                                    : "bg-indigo-600 hover:bg-indigo-700 text-white"
                            )}
                        >
                            {busy ? (
                                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            ) : negative ? (
                                <X className="h-3 w-3 mr-1" />
                            ) : to === OFFER_STATUS.ACCEPTED ? (
                                <Check className="h-3 w-3 mr-1" />
                            ) : to === OFFER_STATUS.DRAFT ? (
                                <RotateCcw className="h-3 w-3 mr-1" />
                            ) : (
                                <Send className="h-3 w-3 mr-1" />
                            )}
                            {ACTION_LABEL[to] ?? to}
                        </Button>
                    );
                })}
            </div>

            {hasLetter && (
                <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    Offer letter issued through the letters module.
                </p>
            )}

            {canIssueLetter && (
                <Button
                    variant="outline"
                    disabled={busy}
                    onClick={issueLetter}
                    className="w-full h-10 rounded-xl text-[10px] font-black uppercase tracking-widest"
                >
                    {busy ? (
                        <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                    ) : (
                        <FileText className="h-3.5 w-3.5 mr-2" />
                    )}
                    Issue offer letter
                </Button>
            )}
        </div>
    );
}
