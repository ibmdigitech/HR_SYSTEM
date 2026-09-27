import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Mail, CalendarDays, History, Building2 } from "lucide-react";

import { getSessionUser } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/permissions";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getOfferDetail } from "@/lib/recruitment/offer-queries";
import { OfferActions } from "@/app/recruitment/offers/OfferActions";
import { LetterPreview } from "@/app/recruitment/offers/LetterPreview";
import { CompleteJoining } from "@/app/recruitment/CompleteJoining";

/**
 * /recruitment/offers/[id] — brief §14, §15, §16, §23.
 *
 * Carries the approval chain, the offer letter (rendered by the EXISTING
 * letters engine, not a second one) and the revision history.
 */
export const dynamic = "force-dynamic";

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

export default async function OfferDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const session = await getSessionUser();
    if (!session.ok) redirect("/login");

    const { id } = await params;

    let offer: Awaited<ReturnType<typeof getOfferDetail>> = null;
    try {
        offer = await getOfferDetail(id);
    } catch {
        redirect("/recruitment/offers");
    }
    if (!offer) notFound();

    const gross = offer.offeredSalary + (offer.allowances ?? 0);
    const canApprove = hasPermission(session.user.role, PERMISSIONS.RECRUITMENT_OFFER);

    return (
        <div className="space-y-8 p-4 md:p-8 w-full max-w-6xl mx-auto">
            <Link
                href="/recruitment/offers"
                className="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-slate-500 hover:text-indigo-600"
            >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                All offers
            </Link>

            <header className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                <div className="min-w-0">
                    <h1 className="text-2xl md:text-3xl font-black text-slate-900 dark:text-white tracking-tight">
                        {offer.candidate.firstName} {offer.candidate.lastName}
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">
                        {offer.designation} · {offer.department}
                        {offer.application?.jobRequisition.requisitionCode
                            ? ` · ${offer.application.jobRequisition.requisitionCode}`
                            : ""}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <span
                        className={`rounded-lg px-3 py-1.5 text-[10px] font-black uppercase tracking-widest ${
                            STATUS_STYLE[offer.status] ?? "bg-slate-100 text-slate-500"
                        }`}
                    >
                        {offer.status.replace(/_/g, " ")}
                    </span>
                    <span className="rounded-lg bg-slate-100 dark:bg-slate-900 px-2 py-1.5 text-[10px] font-black uppercase text-slate-500">
                        v{offer.version}
                    </span>
                </div>
            </header>

            <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
                {/* ── Left: terms + actions ──────────────────────────────── */}
                <div className="space-y-6">
                    <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-5 space-y-3">
                        <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                            Terms
                        </h2>
                        <p className="text-3xl font-black text-slate-900 dark:text-white">
                            AED {gross.toLocaleString("en-GB", { minimumFractionDigits: 2 })}
                            <span className="text-xs font-bold text-slate-400 ml-1">/month gross</span>
                        </p>
                        <dl className="space-y-1.5 text-sm text-slate-600 dark:text-slate-300">
                            <div className="flex justify-between">
                                <dt className="text-slate-500">Basic</dt>
                                <dd className="font-bold">
                                    AED {offer.offeredSalary.toLocaleString("en-GB")}
                                </dd>
                            </div>
                            <div className="flex justify-between">
                                <dt className="text-slate-500">Allowances</dt>
                                <dd className="font-bold">
                                    AED {(offer.allowances ?? 0).toLocaleString("en-GB")}
                                </dd>
                            </div>
                            <div className="flex items-center gap-2 pt-1">
                                <CalendarDays className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                                <dt className="sr-only">Joining date</dt>
                                <dd>
                                    Joins{" "}
                                    {new Date(offer.joiningDate).toLocaleDateString("en-GB", {
                                        day: "2-digit",
                                        month: "long",
                                        year: "numeric",
                                    })}
                                </dd>
                            </div>
                            {offer.probationPeriodMonths != null && (
                                <div className="flex justify-between">
                                    <dt className="text-slate-500">Probation</dt>
                                    <dd className="font-bold">{offer.probationPeriodMonths} month(s)</dd>
                                </div>
                            )}
                            {offer.benefits && (
                                <div className="flex items-start gap-2">
                                    <Building2 className="h-4 w-4 shrink-0 mt-0.5 text-slate-400" aria-hidden="true" />
                                    <dt className="sr-only">Benefits</dt>
                                    <dd className="text-xs">{offer.benefits}</dd>
                                </div>
                            )}
                        </dl>
                    </section>

                    <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-5">
                        <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-3">
                            Actions
                        </h2>
                        <OfferActions
                            offerId={offer.id}
                            status={offer.status}
                            superseded={Boolean(offer.supersededById)}
                            hasLetter={Boolean(offer.letterRecordId)}
                            canApprove={canApprove}
                        />

                        {/* §19 — the accepted offer is the gate; joining is what
                            actually creates the Employee. */}
                        {offer.application && (
                            <div className="pt-3 mt-3 border-t border-slate-100 dark:border-slate-800">
                                <CompleteJoining
                                    applicationId={offer.application.id}
                                    candidateName={`${offer.candidate.firstName} ${offer.candidate.lastName}`}
                                    hasAcceptedOffer={offer.status === "ACCEPTED"}
                                />
                            </div>
                        )}
                    </section>

                    <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-5 space-y-2">
                        <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                            Candidate
                        </h2>
                        <p className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                            <Mail className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                            {offer.candidate.email}
                        </p>
                        {offer.candidate.phone && (
                            <p className="text-sm text-slate-700 dark:text-slate-300">
                                {offer.candidate.phone}
                            </p>
                        )}
                        {offer.application && (
                            <p className="pt-1 text-xs text-slate-500">
                                Application:{" "}
                                <span className="font-bold">{offer.application.status}</span>
                            </p>
                        )}
                    </section>
                </div>

                {/* ── Right: the issued letter ──────────────────────────── */}
                <div>
                    {offer.letterRecord ? (
                        <LetterPreview letter={offer.letterRecord} />
                    ) : (
                        <div className="rounded-3xl border border-dashed border-slate-300 dark:border-slate-800 p-10 text-center">
                            <p className="text-sm font-black text-slate-800 dark:text-white">
                                No letter yet
                            </p>
                            <p className="mt-1.5 text-xs text-slate-500 max-w-md mx-auto">
                                Approve the offer to issue a letter. It is generated by the existing
                                Letters module — no second PDF engine is used.
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
