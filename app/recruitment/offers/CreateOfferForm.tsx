"use client";

import { useState } from "react";
import { format } from "date-fns";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FilePlus2, Loader2 } from "lucide-react";

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
import { createOfferRecord } from "@/app/lib/actions/recruitment";

/**
 * Offer drafting (§14).
 *
 * Only applications the state machine allows (SELECTED, already OFFERED) are
 * offered. Salary is validated here for fast feedback, and again server-side —
 * the server is the authority.
 */
export function CreateOfferForm({
    applications,
}: {
    applications: {
        id: string;
        candidateId: string;
        candidate: { firstName: string; lastName: string };
        jobRequisition: { title: string; department: string } | null;
    }[];
}) {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});

    const [applicationId, setApplicationId] = useState(applications[0]?.id ?? "");
    const [offeredSalary, setOfferedSalary] = useState("");
    const [allowances, setAllowances] = useState("0");
    const [joiningDate, setJoiningDate] = useState(
        new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
    );
    const [probationMonths, setProbationMonths] = useState("6");
    const [offerExpiry, setOfferExpiry] = useState(
        new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
    );
    const [benefits, setBenefits] = useState("");

    if (applications.length === 0) {
        return (
            <p className="text-xs text-slate-500 bg-slate-50 dark:bg-slate-900 rounded-xl p-4">
                No application is ready for an offer. A candidate must be SELECTED first — the state
                machine will not allow an offer to be created before that.
            </p>
        );
    }

    const chosen = applications.find((a) => a.id === applicationId);

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (submitting) return;

        const nextErrors: Record<string, string> = {};
        const salary = Number(offeredSalary);
        if (!offeredSalary.trim()) nextErrors.offeredSalary = "Required";
        else if (!Number.isFinite(salary) || salary <= 0) nextErrors.offeredSalary = "Must be a positive number";
        else if (salary > 10_000_000) nextErrors.offeredSalary = "Above the supported limit";

        if (!joiningDate) nextErrors.joiningDate = "Required";
        if (offerExpiry && joiningDate && new Date(offerExpiry) < new Date(joiningDate)) {
            nextErrors.offerExpiry = "Expiry must be on or after the joining date";
        }

        setErrors(nextErrors);
        if (Object.keys(nextErrors).length > 0) {
            toast.error("Please correct the highlighted fields.");
            return;
        }

        setSubmitting(true);
        const formData = new FormData();
        formData.set("applicationId", applicationId);
        formData.set("candidateId", chosen?.candidateId ?? "");
        formData.set("offeredSalary", offeredSalary);
        formData.set("allowances", allowances || "0");
        formData.set(
            "designation",
            chosen?.jobRequisition?.title ?? "Staff"
        );
        formData.set("department", chosen?.jobRequisition?.department ?? "General");
        formData.set("joiningDate", joiningDate);
        formData.set("probationPeriodMonths", probationMonths || "0");
        formData.set("offerExpiry", offerExpiry);
        if (benefits) formData.set("benefits", benefits);

        const result = await createOfferRecord(null, formData);
        setSubmitting(false);

        if (result.success) {
            toast.success(result.message);
            setOpen(false);
            setOfferedSalary("");
            router.refresh();
        } else {
            toast.error(result.message);
        }
    }

    return (
        <>
            <Button
                onClick={() => setOpen((o) => !o)}
                className="h-11 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-700 font-black uppercase text-xs tracking-widest"
            >
                <FilePlus2 className="h-4 w-4 mr-2" />
                Draft an offer
            </Button>

            {open && (
                <form
                    onSubmit={onSubmit}
                    noValidate
                    className="mt-4 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-5 space-y-4"
                >
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5 sm:col-span-2">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                                Application
                            </Label>
                            <Select value={applicationId} onValueChange={setApplicationId}>
                                <SelectTrigger className="h-11">
                                    <SelectValue placeholder="Select an application" />
                                </SelectTrigger>
                                <SelectContent>
                                    {applications.map((a) => (
                                        <SelectItem key={a.id} value={a.id}>
                                            {a.candidate.firstName} {a.candidate.lastName}
                                            {a.jobRequisition ? ` — ${a.jobRequisition.title}` : ""}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-1.5">
                            <Label
                                htmlFor="offer-salary"
                                className="text-[10px] font-black uppercase tracking-widest text-slate-400"
                            >
                                Basic salary (AED)
                            </Label>
                            <Input
                                id="offer-salary"
                                type="number"
                                min={0}
                                value={offeredSalary}
                                onChange={(e) => setOfferedSalary(e.target.value)}
                                aria-invalid={errors.offeredSalary ? "true" : undefined}
                                className="h-11"
                            />
                            {errors.offeredSalary && (
                                <p role="alert" className="text-[11px] font-bold text-rose-600">
                                    {errors.offeredSalary}
                                </p>
                            )}
                        </div>

                        <div className="space-y-1.5">
                            <Label
                                htmlFor="offer-allow"
                                className="text-[10px] font-black uppercase tracking-widest text-slate-400"
                            >
                                Allowances (AED)
                            </Label>
                            <Input
                                id="offer-allow"
                                type="number"
                                min={0}
                                value={allowances}
                                onChange={(e) => setAllowances(e.target.value)}
                                className="h-11"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label
                                htmlFor="offer-join"
                                className="text-[10px] font-black uppercase tracking-widest text-slate-400"
                            >
                                Joining date
                            </Label>
                            <DatePicker
                                id="offer-join"
                                value={joiningDate}
                                onChange={(date) => setJoiningDate(date ? format(date, "yyyy-MM-dd") : "")}
                                aria-label="Joining date"
                                aria-invalid={errors.joiningDate ? "true" : undefined}
                                className="h-11"
                            />
                            {errors.joiningDate && (
                                <p role="alert" className="text-[11px] font-bold text-rose-600">
                                    {errors.joiningDate}
                                </p>
                            )}
                        </div>

                        <div className="space-y-1.5">
                            <Label
                                htmlFor="offer-exp"
                                className="text-[10px] font-black uppercase tracking-widest text-slate-400"
                            >
                                Offer expires
                            </Label>
                            <DatePicker
                                id="offer-exp"
                                value={offerExpiry}
                                onChange={(date) => setOfferExpiry(date ? format(date, "yyyy-MM-dd") : "")}
                                aria-label="Offer expiry date"
                                aria-invalid={errors.offerExpiry ? "true" : undefined}
                                className="h-11"
                            />
                            {errors.offerExpiry && (
                                <p role="alert" className="text-[11px] font-bold text-rose-600">
                                    {errors.offerExpiry}
                                </p>
                            )}
                        </div>

                        <div className="space-y-1.5">
                            <Label
                                htmlFor="offer-prob"
                                className="text-[10px] font-black uppercase tracking-widest text-slate-400"
                            >
                                Probation (months)
                            </Label>
                            <Input
                                id="offer-prob"
                                type="number"
                                min={0}
                                value={probationMonths}
                                onChange={(e) => setProbationMonths(e.target.value)}
                                className="h-11"
                            />
                        </div>

                        <div className="space-y-1.5 sm:col-span-2">
                            <Label
                                htmlFor="offer-benefits"
                                className="text-[10px] font-black uppercase tracking-widest text-slate-400"
                            >
                                Benefits
                            </Label>
                            <Input
                                id="offer-benefits"
                                value={benefits}
                                onChange={(e) => setBenefits(e.target.value)}
                                placeholder="Medical, transport, annual leave"
                                className="h-11"
                            />
                        </div>
                    </div>

                    <Button
                        type="submit"
                        disabled={submitting}
                        aria-busy={submitting}
                        className="w-full h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 font-black uppercase text-xs tracking-widest"
                    >
                        {submitting ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Creating…
                            </>
                        ) : (
                            "Create offer (draft)"
                        )}
                    </Button>

                    <p className="text-[11px] text-slate-500">
                        A new version is created if the candidate already has an offer — previous terms
                        are superseded, never overwritten.
                    </p>
                </form>
            )}
        </>
    );
}
