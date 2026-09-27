import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/guards";
import { listOffers, OFFER_PAGE_SIZE, getOfferableApplications } from "@/lib/recruitment/offer-queries";
import { OfferCard } from "@/app/recruitment/offers/OfferCard";
import { CreateOfferForm } from "@/app/recruitment/offers/CreateOfferForm";
import { EmptyState } from "@/components/common/EmptyState";

/**
 * /recruitment/offers — brief §14.
 *
 * Offers are versioned (§23), so a superseded version stays visible and is
 * marked as history rather than edited. Access is gated at the data layer.
 */
export const dynamic = "force-dynamic";

const FILTERS = [
    { value: "", label: "All" },
    { value: "DRAFT", label: "Draft" },
    { value: "PENDING_APPROVAL", label: "Pending approval" },
    { value: "APPROVED", label: "Approved" },
    { value: "SENT", label: "Sent" },
    { value: "ACCEPTED", label: "Accepted" },
    { value: "DECLINED", label: "Declined" },
] as const;

export default async function OffersPage({
    searchParams,
}: {
    searchParams: Promise<{ status?: string; page?: string }>;
}) {
    const session = await getSessionUser();
    if (!session.ok) redirect("/login");

    const params = await searchParams;
    const status = params.status ?? "";
    const page = Number.parseInt(params.page ?? "1", 10) || 1;

    let result: Awaited<ReturnType<typeof listOffers>> | null = null;
    let offerable: Awaited<ReturnType<typeof getOfferableApplications>> = [];
    let accessError: string | null = null;

    try {
        result = await listOffers({ status: status || undefined, page });
        offerable = await getOfferableApplications();
    } catch (error) {
        accessError = error instanceof Error ? error.message : "Access denied";
    }

    if (accessError) {
        return (
            <div className="p-8 max-w-2xl mx-auto text-center space-y-4">
                <h1 className="text-2xl font-black text-slate-900 dark:text-white">Access denied</h1>
                <p className="text-sm text-slate-500">{accessError}</p>
                <Link href="/dashboard" className="inline-block text-sm font-bold text-indigo-600 hover:underline">
                    Back to dashboard
                </Link>
            </div>
        );
    }

    const totalPages = Math.max(1, Math.ceil((result?.total ?? 0) / OFFER_PAGE_SIZE));

    return (
        <div className="space-y-8 p-4 md:p-8 w-full max-w-7xl mx-auto">
            <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">Offers</h1>
                    <p className="text-slate-500 font-medium mt-1">
                        {result?.total ?? 0} offer version(s). Revisions supersede rather than overwrite.
                    </p>
                </div>
                <Link
                    href="/recruitment/interviews"
                    className="h-11 px-5 rounded-xl border border-slate-200 dark:border-slate-800 text-sm font-black uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-slate-900"
                >
                    Interviews
                </Link>
            </header>

            <CreateOfferForm
                applications={offerable.map((a) => ({
                    id: a.id,
                    candidateId: a.candidateId,
                    candidate: a.candidate,
                    jobRequisition: a.jobRequisition,
                }))}
            />

            <nav className="flex flex-wrap gap-2" aria-label="Filter offers by status">
                {FILTERS.map((f) => {
                    const qs = new URLSearchParams();
                    if (f.value) qs.set("status", f.value);
                    if (page > 1) qs.set("page", String(page));
                    const href = `/recruitment/offers${qs.toString() ? `?${qs}` : ""}`;
                    const active = status === f.value;
                    return (
                        <Link
                            key={f.value || "all"}
                            href={href}
                            aria-current={active ? "page" : undefined}
                            className={
                                active
                                    ? "h-9 px-4 inline-flex items-center rounded-xl bg-indigo-600 text-white text-xs font-black uppercase tracking-widest"
                                    : "h-9 px-4 inline-flex items-center rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-black uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-slate-800"
                            }
                        >
                            {f.label}
                        </Link>
                    );
                })}
            </nav>

            {result && result.items.length === 0 ? (
                <EmptyState
                    title="No offers yet"
                    description={
                        status
                            ? `No offers with status "${status}".`
                            : "Select a candidate above to draft their first offer."
                    }
                    variant="folder"
                />
            ) : (
                <ul className="grid gap-4 md:grid-cols-2">
                    {result?.items.map((offer) => (
                        <li key={offer.id}>
                            <OfferCard offer={offer} />
                        </li>
                    ))}
                </ul>
            )}

            {result && result.total > OFFER_PAGE_SIZE && (
                <nav className="flex items-center justify-between pt-2" aria-label="Pagination">
                    <span className="text-xs font-bold text-slate-500">
                        Page {result.page} of {totalPages}
                    </span>
                    <div className="flex gap-2">
                        {page > 1 && (
                            <Link
                                href={`/recruitment/offers?${new URLSearchParams({
                                    ...(status ? { status } : {}),
                                    page: String(page - 1),
                                })}`}
                                className="h-9 px-4 inline-flex items-center rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-black uppercase tracking-widest"
                            >
                                Previous
                            </Link>
                        )}
                        {page < totalPages && (
                            <Link
                                href={`/recruitment/offers?${new URLSearchParams({
                                    ...(status ? { status } : {}),
                                    page: String(page + 1),
                                })}`}
                                className="h-9 px-4 inline-flex items-center rounded-xl bg-indigo-600 text-white text-xs font-black uppercase tracking-widest"
                            >
                                Next
                            </Link>
                        )}
                    </div>
                </nav>
            )}
        </div>
    );
}
