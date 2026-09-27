import Link from "next/link";
import { CalendarClock, Users, MapPin, Video, CircleCheck, CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { InterviewListItem } from "@/lib/recruitment/queries";

const STATUS_STYLE: Record<string, string> = {
    SCHEDULED: "bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-300",
    RESCHEDULED: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    IN_PROGRESS: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
    COMPLETED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    CANCELLED: "bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
    NO_SHOW: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
};

/**
 * Interview summary card (§8, §11).
 *
 * The panel row shows, per interviewer, whether their feedback is in — which is
 * the operational signal §10 needs. It is presentation only; the authority for
 * who may submit is the server action.
 */
export function InterviewCard({ interview }: { interview: InterviewListItem }) {
    const start = new Date(interview.startAt);
    const end = new Date(interview.endAt);
    const durationMins = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));

    return (
        <Link
            href={`/recruitment/interviews/${interview.id}`}
            className="block h-full rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-5 hover:border-indigo-300 dark:hover:border-indigo-800 transition-colors"
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-sm font-black text-slate-900 dark:text-white truncate">
                        {interview.candidateName}
                    </p>
                    <p className="text-xs text-slate-500 truncate">
                        {interview.jobTitle ?? "No job linked"}
                        {interview.requisitionCode ? ` · ${interview.requisitionCode}` : ""}
                    </p>
                </div>
                <span
                    className={cn(
                        "shrink-0 rounded-lg px-2 py-1 text-[9px] font-black uppercase tracking-widest",
                        STATUS_STYLE[interview.status] ?? "bg-slate-100 text-slate-500"
                    )}
                >
                    {interview.status.replace(/_/g, " ")}
                </span>
            </div>

            <dl className="mt-3 space-y-1.5 text-xs text-slate-600 dark:text-slate-400">
                <div className="flex items-center gap-2">
                    <CalendarClock className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                    <dt className="sr-only">When</dt>
                    <dd>
                        {start.toLocaleString("en-GB", {
                            weekday: "short",
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                        })}
                        <span className="text-slate-400"> · {durationMins} min</span>
                    </dd>
                </div>

                <div className="flex items-center gap-2">
                    {interview.mode === "ONLINE" ? (
                        <Video className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                    ) : (
                        <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                    )}
                    <dt className="sr-only">Where</dt>
                    <dd className="truncate">
                        {interview.mode === "ONLINE"
                            ? interview.meetingLink ?? "Online"
                            : interview.location ?? "Onsite"}
                    </dd>
                </div>
            </dl>

            <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400">
                        <Users className="h-3 w-3" aria-hidden="true" />
                        Panel · round {interview.round} · {interview.interviewType}
                    </span>
                </div>

                <ul className="flex flex-wrap gap-1.5">
                    {interview.panel.map((p) => (
                        <li
                            key={p.id}
                            className={cn(
                                "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold",
                                p.hasFeedback
                                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                                    : "bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-300"
                            )}
                        >
                            {p.hasFeedback ? (
                                <CircleCheck className="h-3 w-3" aria-hidden="true" />
                            ) : (
                                <CircleAlert className="h-3 w-3" aria-hidden="true" />
                            )}
                            <span className="truncate max-w-[9rem]">
                                {p.isLead ? "★ " : ""}
                                {p.name}
                            </span>
                            <span className="sr-only">
                                {p.hasFeedback ? "feedback submitted" : "feedback outstanding"}
                            </span>
                        </li>
                    ))}
                    {interview.panel.length === 0 && (
                        <li className="text-[10px] text-rose-500 font-bold">No panel assigned</li>
                    )}
                </ul>
            </div>
        </Link>
    );
}
