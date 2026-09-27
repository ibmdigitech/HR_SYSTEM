import Link from "next/link";
import { History, FileText, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OfferListItem } from "@/lib/recruitment/offer-queries";

const STATUS_STYLE: Record<string, string> = {
    DRAFT: "bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-300",
    PENDING_APPROVAL: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    APPROVED: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
    SENT: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
    VIEWED: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
    ACCEPTED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    DECLINED: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
    EXPIRED: "bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
    WITHDRAWN: "bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
};

/**
 * Offer card (§14, §23).
 *
 * A superseded version is rendered as history — visibly inert — because the
 * state machine refuses to act on it and the previous terms must remain
 * auditable.
 */
export function OfferCard({ offer }: { offer: OfferListItem }) {
    const gross = offer.offeredSalary + (offer.allowances ?? 0);

    return (
        <Link
            href={`/recruitment/offers/${offer.id}`}
            className={cn(
                "block h-full rounded-3xl border bg-white dark:bg-slate-950 p-5 transition-colors",
                offer.superseded
                    ? "border-slate-200 dark:border-slate-800 opacity-70"
                    : "border-slate-200 dark:border-slate-800 hover:border-indigo-300"
            )}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-sm font-black text-slate-900 dark:text-white truncate">
                        {offer.candidate.firstName} {offer.candidate.lastName}
                    </p>
                    <p className="text-xs text-slate-500 truncate">
                        {offer.designation} · {offer.department}
                    </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                    <span
                        className={cn(
                            "rounded-lg px-2 py-1 text-[9px] font-black uppercase tracking-widest",
                            STATUS_STYLE[offer.status] ?? "bg-slate-100 text-slate-500"
                        )}
                    >
                        {offer.status.replace(/_/g, " ")}
                    </span>
                    <span className="text-[10px] font-black uppercase text-slate-400">v{offer.version}</span>
                </div>
            </div>

            <p className="mt-3 text-2xl font-black text-slate-900 dark:text-white">
                AED {gross.toLocaleString("en-GB", { minimumFractionDigits: 2 })}
                <span className="text-xs font-bold text-slate-400 ml-1">/month gross</span>
            </p>

            <dl className="mt-3 space-y-1 text-xs text-slate-500">
                <div className="flex items-center gap-2">
                    <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <dt className="sr-only">Joining date</dt>
                    <dd>
                        Joins{" "}
                        {new Date(offer.joiningDate).toLocaleDateString("en-GB", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                        })}
                        {offer.offerExpiry
                            ? ` · expires ${new Date(offer.offerExpiry).toLocaleDateString("en-GB")}`
                            : ""}
                    </dd>
                </div>
            </dl>

            {offer.jobTitle && (
                <p className="mt-1 text-xs text-slate-500 truncate">
                    {offer.jobTitle}
                    {offer.requisitionCode ? ` · ${offer.requisitionCode}` : ""}
                </p>
            )}

            <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap gap-2">
                {offer.superseded ? (
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 dark:bg-slate-900 px-2 py-1 text-[10px] font-black uppercase text-slate-500">
                        <History className="h-3 w-3" aria-hidden="true" />
                        Superseded — history only
                    </span>
                ) : offer.letterRecordId ? (
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 px-2 py-1 text-[10px] font-black uppercase text-emerald-700 dark:text-emerald-300">
                        <FileText className="h-3 w-3" aria-hidden="true" />
                        Letter issued
                    </span>
                ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/50 px-2 py-1 text-[10px] font-black uppercase text-amber-700 dark:text-amber-300">
                        No letter yet
                    </span>
                )}
            </div>
        </Link>
    );
}
