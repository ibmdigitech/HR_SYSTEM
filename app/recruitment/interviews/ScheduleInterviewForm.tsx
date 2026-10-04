"use client";

import { useState } from "react";
import { format } from "date-fns";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarPlus, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { scheduleInterview } from "@/app/lib/actions/recruitment";

/**
 * Interview scheduling (brief §9).
 *
 * Conflicts are NOT checked in the browser. The server refuses an overlapping
 * booking for the interviewer or the candidate; this form exists to collect
 * input, not to pre-validate. Showing a green "available" here would be a
 * lie the moment two people submit at once.
 */

const TYPES = ["HR", "TECHNICAL", "MANAGER", "PANEL", "FINAL"] as const;
const MODES = ["ONSITE", "ONLINE"] as const;

/** `<input type="datetime-local">` wants `YYYY-MM-DDTHH:mm` in local time. */
function toLocalInput(date: Date): string {
    const offset = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function withDateTimeDate(current: string, date?: Date): string {
    if (!date) return "";
    return `${format(date, "yyyy-MM-dd")}T${current.slice(11, 16) || "09:00"}`;
}

function withDateTimeTime(current: string, time: string): string {
    return current ? `${current.slice(0, 10)}T${time}` : current;
}

export function ScheduleInterviewForm({
    candidates,
    interviewers,
    defaultCandidateId,
    defaultApplicationId,
}: {
    /** Candidates with an application in an interviewable state. */
    candidates: { id: string; name: string; applicationId: string | null; jobTitle: string | null }[];
    /** Employee records eligible to interview. */
    interviewers: { id: string; name: string }[];
    defaultCandidateId?: string;
    defaultApplicationId?: string;
}) {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const now = new Date();
    const initialCandidate = candidates.find((candidate) =>
        (defaultApplicationId && candidate.applicationId === defaultApplicationId)
        || (defaultCandidateId && candidate.id === defaultCandidateId)
    ) ?? candidates[0];
    const [candidateSelection, setCandidateSelection] = useState(
        initialCandidate?.applicationId ?? initialCandidate?.id ?? ""
    );
    const [interviewType, setInterviewType] = useState<string>("HR");
    const [round, setRound] = useState("1");
    const [mode, setMode] = useState<string>("ONSITE");
    const [startAt, setStartAt] = useState(toLocalInput(new Date(now.getTime() + 86_400_000)));
    const [endAt, setEndAt] = useState(toLocalInput(new Date(now.getTime() + 86_400_000 + 3_600_000)));
    const [location, setLocation] = useState("");
    const [meetingLink, setMeetingLink] = useState("");
    const [selected, setSelected] = useState<string[]>([]);

    const chosen = candidates.find((c) => (c.applicationId ?? c.id) === candidateSelection);
    const candidateId = chosen?.id ?? "";
    const applicationId = chosen?.applicationId ?? defaultApplicationId ?? "";

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (submitting) return;

        if (!candidateId) {
            toast.error("Choose a candidate.");
            return;
        }
        if (selected.length === 0) {
            toast.error("Select at least one interviewer.");
            return;
        }
        if (new Date(endAt) <= new Date(startAt)) {
            toast.error("The end time must be after the start time.");
            return;
        }
        if (mode === "ONLINE" && meetingLink && !/^https?:\/\//i.test(meetingLink)) {
            toast.error("The meeting link must start with http:// or https://");
            return;
        }

        setSubmitting(true);
        const formData = new FormData();
        formData.set("candidateId", candidateId);
        if (applicationId) formData.set("applicationId", applicationId);
        formData.set("interviewType", interviewType);
        formData.set("round", round);
        formData.set("mode", mode);
        formData.set("startAt", startAt);
        formData.set("endAt", endAt);
        if (location) formData.set("location", location);
        if (meetingLink) formData.set("meetingLink", meetingLink);
        for (const id of selected) formData.append("interviewerIds", id);

        const result = await scheduleInterview(null, formData);
        setSubmitting(false);

        if (result.success) {
            toast.success("Interview scheduled.");
            setOpen(false);
            setSelected([]);
            router.refresh();
        } else {
            // The server's reason — e.g. "X is already booked at that time."
            toast.error(result.message);
        }
    }

    if (candidates.length === 0) {
        return (
            <p className="text-xs text-slate-500 bg-slate-50 dark:bg-slate-900 rounded-xl p-4">
                No candidate is in an interviewable state. Shortlist a candidate in the pipeline first.
            </p>
        );
    }

    return (
        <>
            <Button
                onClick={() => setOpen((o) => !o)}
                className="h-11 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-700 font-black uppercase text-xs tracking-widest"
            >
                <CalendarPlus className="h-4 w-4 mr-2" />
                Schedule interview
            </Button>

            {open && (
                <form
                    onSubmit={onSubmit}
                    className="mt-4 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-5 space-y-4"
                    noValidate
                >
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                                Candidate
                            </Label>
                                <Select value={candidateSelection} onValueChange={setCandidateSelection}>
                                <SelectTrigger className="h-11">
                                    <SelectValue placeholder="Select candidate" />
                                </SelectTrigger>
                                <SelectContent>
                                    {candidates.map((c) => (
                                        <SelectItem key={c.applicationId ?? c.id} value={c.applicationId ?? c.id}>
                                            {c.name}
                                            {c.jobTitle ? ` — ${c.jobTitle}` : ""}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-1.5">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                                Interview type
                            </Label>
                            <Select value={interviewType} onValueChange={setInterviewType}>
                                <SelectTrigger className="h-11">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {TYPES.map((t) => (
                                        <SelectItem key={t} value={t}>
                                            {t}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-1.5">
                            <Label
                                htmlFor="int-round"
                                className="text-[10px] font-black uppercase tracking-widest text-slate-400"
                            >
                                Round
                            </Label>
                            <Input
                                id="int-round"
                                type="number"
                                min={1}
                                max={20}
                                value={round}
                                onChange={(e) => setRound(e.target.value)}
                                className="h-11"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                                Mode
                            </Label>
                            <Select value={mode} onValueChange={setMode}>
                                <SelectTrigger className="h-11">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {MODES.map((m) => (
                                        <SelectItem key={m} value={m}>
                                            {m === "ONSITE" ? "Onsite" : "Online"}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-1.5">
                            <Label
                                htmlFor="int-start"
                                className="text-[10px] font-black uppercase tracking-widest text-slate-400"
                            >
                                Starts
                            </Label>
                            <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-2">
                                <DatePicker
                                    id="int-start-date"
                                    required
                                    value={startAt.slice(0, 10)}
                                    onChange={(date) => setStartAt((current) => withDateTimeDate(current, date))}
                                    aria-label="Interview start date"
                                    className="h-11"
                                />
                                <Input
                                    id="int-start-time"
                                    type="time"
                                    required
                                    value={startAt.slice(11, 16)}
                                    onChange={(e) => setStartAt((current) => withDateTimeTime(current, e.target.value))}
                                    className="h-11"
                                    aria-label="Interview start time"
                                />
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <Label
                                htmlFor="int-end"
                                className="text-[10px] font-black uppercase tracking-widest text-slate-400"
                            >
                                Ends
                            </Label>
                            <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-2">
                                <DatePicker
                                    id="int-end-date"
                                    required
                                    value={endAt.slice(0, 10)}
                                    onChange={(date) => setEndAt((current) => withDateTimeDate(current, date))}
                                    aria-label="Interview end date"
                                    className="h-11"
                                />
                                <Input
                                    id="int-end-time"
                                    type="time"
                                    required
                                    value={endAt.slice(11, 16)}
                                    onChange={(e) => setEndAt((current) => withDateTimeTime(current, e.target.value))}
                                    className="h-11"
                                    aria-label="Interview end time"
                                />
                            </div>
                        </div>

                        {mode === "ONSITE" ? (
                            <div className="space-y-1.5">
                                <Label
                                    htmlFor="int-location"
                                    className="text-[10px] font-black uppercase tracking-widest text-slate-400"
                                >
                                    Location
                                </Label>
                                <Input
                                    id="int-location"
                                    value={location}
                                    onChange={(e) => setLocation(e.target.value)}
                                    placeholder="Meeting room / office"
                                    className="h-11"
                                />
                            </div>
                        ) : (
                            <div className="space-y-1.5">
                                <Label
                                    htmlFor="int-link"
                                    className="text-[10px] font-black uppercase tracking-widest text-slate-400"
                                >
                                    Meeting link
                                </Label>
                                <Input
                                    id="int-link"
                                    type="url"
                                    value={meetingLink}
                                    onChange={(e) => setMeetingLink(e.target.value)}
                                    placeholder="https://…"
                                    className="h-11"
                                />
                            </div>
                        )}
                    </div>

                    {/* §11 — a panel, not a single interviewer. */}
                    <fieldset className="space-y-2">
                        <legend className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                            Panel ({selected.length} selected)
                        </legend>
                        <div className="grid gap-1.5 sm:grid-cols-2 max-h-48 overflow-y-auto">
                            {interviewers.map((i) => (
                                <label
                                    key={i.id}
                                    className="flex items-center gap-2 text-xs cursor-pointer py-1"
                                >
                                    <input
                                        type="checkbox"
                                        checked={selected.includes(i.id)}
                                        onChange={(e) =>
                                            setSelected((s) =>
                                                e.target.checked ? [...s, i.id] : s.filter((x) => x !== i.id)
                                            )
                                        }
                                    />
                                    <span className="truncate">{i.name}</span>
                                </label>
                            ))}
                            {interviewers.length === 0 && (
                                <p className="text-xs text-rose-500 font-bold">
                                    No employee records are available to interview.
                                </p>
                            )}
                        </div>
                    </fieldset>

                    <Button
                        type="submit"
                        disabled={submitting}
                        aria-busy={submitting}
                        className="w-full h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 font-black uppercase text-xs tracking-widest"
                    >
                        {submitting ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Scheduling…
                            </>
                        ) : (
                            "Schedule interview"
                        )}
                    </Button>

                    <p className="text-[11px] text-slate-500">
                        Double-booking is checked on the server. If an interviewer or the candidate is
                        already booked at that time, the request is refused.
                    </p>
                </form>
            )}
        </>
    );
}
