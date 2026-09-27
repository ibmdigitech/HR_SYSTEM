import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/guards";
import { listInterviews, listMyInterviews, RECRUITMENT_PAGE_SIZE } from "@/lib/recruitment/queries";
import { InterviewCard } from "@/app/recruitment/interviews/InterviewCard";
import { ScheduleInterviewForm } from "@/app/recruitment/interviews/ScheduleInterviewForm";
import { EmptyState } from "@/components/common/EmptyState";
import { getInterviewable } from "@/lib/recruitment/queries";

/**
 * /recruitment/interviews — brief §8, §9.
 *
 * Shows the interview schedule with the panel and, critically, whether
 * feedback is outstanding per interviewer (§10). Server-rendered and
 * permission-gated at the data layer, not just by the sidebar link.
 */
export const dynamic = "force-dynamic";

const STATUS_FILTERS = [
    { value: "", label: "All" },
    { value: "SCHEDULED", label: "Scheduled" },
    { value: "IN_PROGRESS", label: "In progress" },
    { value: "COMPLETED", label: "Completed" },
    { value: "CANCELLED", label: "Cancelled" },
    { value: "NO_SHOW", label: "No show" },
] as const;

export default async function InterviewsPage({
    searchParams,
}: {
    searchParams: Promise<{ status?: string; page?: string }>;
}) {
    const session = await getSessionUser();
    if (!session.ok) redirect("/login");

    const params = await searchParams;
    const status = params.status ?? "";
    const page = Number.parseInt(params.page ?? "1", 10) || 1;

    let result: Awaited<ReturnType<typeof listInterviews>> | null = null;
    let mine: Awaited<ReturnType<typeof listMyInterviews>> = [];
    let interviewable: Awaited<ReturnType<typeof getInterviewable>> = {
        candidates: [],
        interviewers: [],
    };
    let accessError: string | null = null;

    try {
        result = await listInterviews({ status: status || undefined, page });
        mine = await listMyInterviews();
        interviewable = await getInterviewable();
    } catch (error) {
        // No `recruitment.view` — say so plainly rather than showing an
        // empty list that looks like "no interviews scheduled".
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

    const totalPages = Math.max(1, Math.ceil((result?.total ?? 0) / RECRUITMENT_PAGE_SIZE));
    const outstanding = result?.items.filter((i) => !i.feedbackComplete).length ?? 0;

    return (
        <div className="space-y-8 p-4 md:p-8 w-full max-w-7xl mx-auto">
            <header className="flex flex-col md:flex-row justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">
                        Interviews
                    </h1>
                    <p className="text-slate-500 font-medium mt-1">
                        Scheduling, panels and feedback for {result?.total ?? 0} interview(s).
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    {outstanding > 0 && (
                        <span className="rounded-xl bg-amber-100 dark:bg-amber-950/50 px-4 py-2 text-xs font-black uppercase tracking-widest text-amber-700 dark:text-amber-300">
                            {outstanding} awaiting feedback
                        </span>
                    )}
                    <Link
                        href="/recruitment"
                        className="h-11 px-5 rounded-xl border border-slate-200 dark:border-slate-800 text-sm font-black uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-slate-900"
                    >
                        Pipeline
                    </Link>
                </div>
            </header>

            {/* §9 — the interviewer's own diary, so a panel member sees only
                their interviews. Scoped in the query by participant row. */}
            {mine.length > 0 && (
                <section className="rounded-3xl bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900 p-5">
                    <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400 mb-3">
                        Your upcoming interviews
                    </h2>
                    <ul className="space-y-1.5">
                        {mine.map((m) => (
                            <li key={m.id}>
                                <Link
                                    href={`/recruitment/interviews/${m.id}`}
                                    className="flex flex-wrap items-center gap-2 text-sm text-slate-700 dark:text-slate-200 hover:text-indigo-700"
                                >
                                    <span className="font-bold">
                                        {m.candidate.firstName} {m.candidate.lastName}
                                    </span>
                                    <span className="text-slate-400">·</span>
                                    <span>{m.application?.jobRequisition.title ?? "—"}</span>
                                    <span className="text-slate-400">·</span>
                                    <span className="text-xs">
                                        {new Date(m.startAt).toLocaleString("en-GB", {
                                            day: "2-digit",
                                            month: "short",
                                            hour: "2-digit",
                                            minute: "2-digit",
                                        })}
                                    </span>
                                    {m.interviewers.every((p) => p.feedback.length > 0) ? (
                                        <span className="text-[10px] font-black uppercase text-emerald-600">Feedback in</span>
                                    ) : (
                                        <span className="text-[10px] font-black uppercase text-rose-600">Feedback due</span>
                                    )}
                                </Link>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {/* Scheduling (brief §9) */}
            {result && result.items.length > 0 && (
                <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-5">
                    <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-4">
                        Schedule
                    </h2>
                    <ScheduleInterviewForm
                        candidates={interviewable.candidates}
                        interviewers={interviewable.interviewers}
                    />
                </section>
            )}

            {/* Status filters */}
            <nav className="flex flex-wrap gap-2" aria-label="Filter interviews by status">
                {STATUS_FILTERS.map((f) => {
                    const qs = new URLSearchParams();
                    if (f.value) qs.set("status", f.value);
                    if (page > 1) qs.set("page", String(page));
                    const href = `/recruitment/interviews${qs.toString() ? `?${qs}` : ""}`;
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
                    title="No interviews scheduled"
                    description={
                        status
                            ? `No interviews with status "${status}".`
                            : "Schedule an interview from a shortlisted candidate to get started."
                    }
                    variant="calendar"
                />
            ) : (
                <ul className="grid gap-4 md:grid-cols-2">
                    {result?.items.map((item) => (
                        <li key={item.id}>
                            <InterviewCard interview={item} />
                        </li>
                    ))}
                </ul>
            )}

            {result && result.total > RECRUITMENT_PAGE_SIZE && (
                <nav className="flex items-center justify-between pt-2" aria-label="Pagination">
                    <span className="text-xs font-bold text-slate-500">
                        Page {result.page} of {totalPages}
                    </span>
                    <div className="flex gap-2">
                        {page > 1 && (
                            <Link
                                href={`/recruitment/interviews?${new URLSearchParams({
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
                                href={`/recruitment/interviews?${new URLSearchParams({
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

            <p className="sr-only" aria-live="polite">
                Showing {result?.items.length ?? 0} of {result?.total ?? 0} interviews.
            </p>
        </div>
    );
}
