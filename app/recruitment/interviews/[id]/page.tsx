import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
    ArrowLeft,
    CalendarClock,
    MapPin,
    Video,
    Mail,
    Phone,
    Building2,
    ExternalLink,
} from "lucide-react";

import { getSessionUser } from "@/lib/auth/guards";
import { getInterviewDetail } from "@/lib/recruitment/queries";
import { FeedbackForm } from "./FeedbackForm";

/**
 * /recruitment/interviews/[id] — brief §8, §11.
 *
 * Panel feedback is rendered per interviewer and never merged into a single
 * blob: §11 requires that one interviewer cannot overwrite another's, and the
 * UI must not imply otherwise. The form is shown only to a panel member.
 */
export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
    SCHEDULED: "bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-300",
    RESCHEDULED: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    IN_PROGRESS: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
    COMPLETED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    CANCELLED: "bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
    NO_SHOW: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
};

const RECOMMENDATION_STYLE: Record<string, string> = {
    STRONG_HIRE: "bg-emerald-500 text-white",
    HIRE: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    HOLD: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    NO_HIRE: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
};

export default async function InterviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const session = await getSessionUser();
    if (!session.ok) redirect("/login");

    const { id } = await params;

    let interview: Awaited<ReturnType<typeof getInterviewDetail>> = null;
    try {
        interview = await getInterviewDetail(id);
    } catch {
        // No recruitment.view — do not leak whether this interview exists.
        redirect("/recruitment/interviews");
    }

    if (!interview) notFound();

    const myParticipant = interview.panel.find((p) => p.interviewerId === session.user.employeeId);
    const submittedCount = interview.panel.filter((p) => p.feedback).length;

    return (
        <div className="space-y-8 p-4 md:p-8 w-full max-w-6xl mx-auto">
            <Link
                href="/recruitment/interviews"
                className="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-slate-500 hover:text-indigo-600"
            >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                All interviews
            </Link>

            <header className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                <div className="min-w-0">
                    <h1 className="text-2xl md:text-3xl font-black text-slate-900 dark:text-white tracking-tight">
                        {interview.candidate.firstName} {interview.candidate.lastName}
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">
                        {interview.job?.title ?? "No job linked"}
                        {interview.job?.requisitionCode ? ` · ${interview.job.requisitionCode}` : ""}
                    </p>
                </div>
                <span
                    className={`self-start shrink-0 rounded-lg px-3 py-1.5 text-[10px] font-black uppercase tracking-widest ${
                        STATUS_STYLE[interview.status] ?? "bg-slate-100 text-slate-500"
                    }`}
                >
                    {interview.status.replace(/_/g, " ")}
                </span>
            </header>

            <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
                {/* ── Left: schedule, candidate, panel ─────────────────── */}
                <div className="space-y-6">
                    <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-5 space-y-3">
                        <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                            Schedule
                        </h2>
                        <dl className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
                            <div className="flex items-center gap-2">
                                <CalendarClock className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                                <dt className="sr-only">When</dt>
                                <dd>
                                    {new Date(interview.startAt).toLocaleString("en-GB", {
                                        weekday: "long",
                                        day: "2-digit",
                                        month: "long",
                                        year: "numeric",
                                        hour: "2-digit",
                                        minute: "2-digit",
                                    })}
                                </dd>
                            </div>
                            <div className="flex items-center gap-2 pl-6 text-xs text-slate-500">
                                to{" "}
                                {new Date(interview.endAt).toLocaleTimeString("en-GB", {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                })}
                                {" · "}
                                {Math.round(
                                    (interview.endAt.getTime() - interview.startAt.getTime()) / 60000
                                )}{" "}
                                min
                            </div>
                            <div className="flex items-center gap-2">
                                {interview.mode === "ONLINE" ? (
                                    <Video className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                                ) : (
                                    <MapPin className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                                )}
                                <dt className="sr-only">Where</dt>
                                <dd className="truncate">
                                    {interview.mode === "ONLINE" ? (
                                        interview.meetingLink ? (
                                            <a
                                                href={interview.meetingLink}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-1 text-indigo-600 hover:underline"
                                            >
                                                {interview.meetingLink}
                                                <ExternalLink className="h-3 w-3" aria-hidden="true" />
                                            </a>
                                        ) : (
                                            "Online — no link set"
                                        )
                                    ) : (
                                        interview.location ?? "Onsite"
                                    )}
                                </dd>
                            </div>
                        </dl>
                        <p className="pt-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
                            Round {interview.round} · {interview.interviewType} ·{" "}
                            {interview.mode === "ONLINE" ? "Online" : "Onsite"}
                        </p>
                    </section>

                    <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-5 space-y-3">
                        <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                            Candidate
                        </h2>
                        <dl className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
                            <div className="flex items-center gap-2">
                                <Mail className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                                <dt className="sr-only">Email</dt>
                                <dd className="truncate">{interview.candidate.email}</dd>
                            </div>
                            {interview.candidate.phone && (
                                <div className="flex items-center gap-2">
                                    <Phone className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                                    <dt className="sr-only">Phone</dt>
                                    <dd>{interview.candidate.phone}</dd>
                                </div>
                            )}
                            {interview.candidate.currentEmployer && (
                                <div className="flex items-center gap-2">
                                    <Building2 className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                                    <dt className="sr-only">Current employer</dt>
                                    <dd>
                                        {interview.candidate.currentPosition
                                            ? `${interview.candidate.currentPosition} at ${interview.candidate.currentEmployer}`
                                            : interview.candidate.currentEmployer}
                                    </dd>
                                </div>
                            )}
                        </dl>
                        {interview.candidate.resumeUrl && (
                            <a
                                href={interview.candidate.resumeUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 hover:underline"
                            >
                                View resume
                                <ExternalLink className="h-3 w-3" aria-hidden="true" />
                            </a>
                        )}
                        {interview.application && (
                            <p className="pt-2 text-xs text-slate-500">
                                Application:{" "}
                                <span className="font-bold">{interview.application.status}</span>
                                {interview.application.screeningRecommendation
                                    ? ` · screening ${interview.application.screeningRecommendation.toLowerCase()}`
                                    : ""}
                            </p>
                        )}
                    </section>

                    {/* §11 — each panel member's feedback, kept separate. */}
                    <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-5 space-y-4">
                        <div className="flex items-center justify-between gap-2">
                            <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                                Panel feedback
                            </h2>
                            <span className="text-[10px] font-black uppercase text-slate-400">
                                {submittedCount}/{interview.panel.length} submitted
                            </span>
                        </div>

                        {interview.panel.length === 0 ? (
                            <p className="text-xs text-rose-500 font-bold">No panel assigned to this interview.</p>
                        ) : (
                            <ul className="space-y-4">
                                {interview.panel.map((member) => (
                                    <li
                                        key={member.id}
                                        className="rounded-2xl border border-slate-100 dark:border-slate-800 p-4"
                                    >
                                        <div className="flex items-center justify-between gap-2 flex-wrap">
                                            <p className="text-sm font-black text-slate-800 dark:text-white">
                                                {member.isLead ? "★ " : ""}
                                                {member.interviewerName}
                                                {member.id === myParticipant?.id && (
                                                    <span className="ml-2 text-[10px] font-black uppercase text-indigo-600">
                                                        (you)
                                                    </span>
                                                )}
                                            </p>
                                            {member.feedback ? (
                                                <span
                                                    className={`rounded-lg px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${
                                                        RECOMMENDATION_STYLE[member.feedback.recommendation ?? ""] ??
                                                        "bg-slate-100 text-slate-500"
                                                    }`}
                                                >
                                                    {(member.feedback.recommendation ?? "submitted").replace(
                                                        /_/g,
                                                        " "
                                                    )}
                                                </span>
                                            ) : (
                                                <span className="rounded-lg bg-amber-100 dark:bg-amber-950/50 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-300">
                                                    Awaiting
                                                </span>
                                            )}
                                        </div>

                                        {member.feedback ? (
                                            <div className="mt-3 space-y-2">
                                                <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-[11px] text-slate-600 dark:text-slate-400">
                                                    {(
                                                        [
                                                            ["Technical", member.feedback.technicalSkills],
                                                            ["Problem solving", member.feedback.problemSolving],
                                                            ["Domain", member.feedback.domainKnowledge],
                                                            ["Communication", member.feedback.communication],
                                                            ["Team fit", member.feedback.teamFit],
                                                            ["Leadership", member.feedback.leadership],
                                                        ] as const
                                                    ).map(([label, value]) => (
                                                        <div key={label} className="flex justify-between gap-2">
                                                            <dt>{label}</dt>
                                                            <dd className="font-black">{value ?? "—"}</dd>
                                                        </div>
                                                    ))}
                                                </dl>
                                                {member.feedback.strengths && (
                                                    <p className="text-xs text-slate-600 dark:text-slate-400">
                                                        <span className="font-black text-emerald-600">Strengths: </span>
                                                        {member.feedback.strengths}
                                                    </p>
                                                )}
                                                {member.feedback.concerns && (
                                                    <p className="text-xs text-slate-600 dark:text-slate-400">
                                                        <span className="font-black text-rose-600">Concerns: </span>
                                                        {member.feedback.concerns}
                                                    </p>
                                                )}
                                                {member.feedback.comments && (
                                                    <p className="text-xs text-slate-600 dark:text-slate-400">
                                                        <span className="font-black">Comments: </span>
                                                        {member.feedback.comments}
                                                    </p>
                                                )}
                                            </div>
                                        ) : (
                                            <p className="mt-2 text-xs text-slate-400 italic">
                                                No feedback submitted yet.
                                            </p>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                </div>

                {/* ── Right: your feedback form ───────────────────────── */}
                <aside>
                    <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-5 lg:sticky lg:top-6">
                        <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-4">
                            {myParticipant?.feedback ? "Your feedback" : "Your feedback"}
                        </h2>
                        <FeedbackForm
                            interviewId={interview.id}
                            participantId={myParticipant?.id ?? ""}
                            existing={myParticipant?.feedback ?? null}
                            canSubmit={Boolean(myParticipant) && !["CANCELLED"].includes(interview.status)}
                            reason={
                                !myParticipant
                                    ? "You are not on this panel. Only panel members can submit feedback for this interview."
                                    : interview.status === "CANCELLED"
                                      ? "This interview was cancelled, so feedback is closed."
                                      : undefined
                            }
                        />
                    </div>
                </aside>
            </div>
        </div>
    );
}
