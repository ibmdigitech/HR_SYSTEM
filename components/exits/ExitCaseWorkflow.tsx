"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
    advanceExitCaseWorkflow,
    advanceExitSettlement,
    completeExitCase,
    prepareExitSettlement,
    recordExitInterview,
    updateExitChecklist,
    type ExitActionResult,
} from "@/app/lib/actions/exit";

type ChecklistItem = {
    id: string;
    label: string;
    category: string;
    required: boolean;
    status: string;
    notes: string | null;
};

type Settlement = {
    status: string;
    pendingSalaryDays: number;
    pendingSalaryAmount: number;
    leaveEncashmentDays: number;
    leaveEncashmentAmount: number;
    loanDeductions: number;
    advanceDeductions: number;
    otherDeductions: number;
    otherAdditions: number;
    gratuityAmount: number;
    finalAmount: number;
    calculationNotes: string | null;
    paidReference: string | null;
};

type Offboarding = {
    id: string;
    status: string;
    checklist: ChecklistItem[];
    settlement: Settlement | null;
} | null;

type PayoutDestination = { bankName: string | null; accountNumber: string | null; iban: string | null } | null;

type Props = {
    exitCase: {
        id: string;
        type: string;
        status: string;
        lastWorkingDate: Date | null;
        noticePeriodDays: number | null;
    };
    offboarding: Offboarding;
    payoutDestination: PayoutDestination;
    permissions: {
        advanceApproval: boolean;
        clearance: boolean;
        interview: boolean;
        prepareSettlement: boolean;
        approveSettlement: boolean;
        paySettlement: boolean;
        complete: boolean;
    };
};

const amountFields = [
    ["pendingSalaryDays", "Pending salary days", "0.5"],
    ["pendingSalaryAmount", "Pending salary amount", "0.01"],
    ["leaveEncashmentDays", "Leave encashment days", "0.5"],
    ["leaveEncashmentAmount", "Leave encashment amount", "0.01"],
    ["loanDeductions", "Loan deductions", "0.01"],
    ["advanceDeductions", "Advance deductions", "0.01"],
    ["otherDeductions", "Other deductions", "0.01"],
    ["otherAdditions", "Other additions", "0.01"],
    ["gratuityAmount", "Gratuity (enter approved calculation)", "0.01"],
] as const;

export function ExitCaseWorkflow({ exitCase, offboarding, payoutDestination, permissions }: Props) {
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    const [paymentReference, setPaymentReference] = useState("");
    const [noSettlementConfirmed, setNoSettlementConfirmed] = useState(false);
    const [transferConfirmed, setTransferConfirmed] = useState(false);

    async function run(action: () => Promise<ExitActionResult>) {
        setBusy(true);
        try {
            const result = await action();
            if (result.success) toast.success(result.message);
            else toast.error(result.message);
            router.refresh();
        } catch {
            toast.error("The exit workflow could not be updated. Nothing was changed.");
        } finally {
            setBusy(false);
        }
    }

    async function prepare(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const value = (name: string) => Number(form.get(name) || 0);
        const calculationNotes = String(form.get("calculationNotes") || "").trim();
        await run(() => prepareExitSettlement({
            exitCaseId: exitCase.id,
            inputs: {
                pendingSalaryDays: value("pendingSalaryDays"),
                pendingSalaryAmount: value("pendingSalaryAmount"),
                leaveEncashmentDays: value("leaveEncashmentDays"),
                leaveEncashmentAmount: value("leaveEncashmentAmount"),
                loanDeductions: value("loanDeductions"),
                advanceDeductions: value("advanceDeductions"),
                otherDeductions: value("otherDeductions"),
                otherAdditions: value("otherAdditions"),
                gratuityAmount: value("gratuityAmount"),
                calculationNotes,
            },
        }));
    }

    const settlement = offboarding?.settlement;
    const showChecklist = Boolean(offboarding) && exitCase.status !== "COMPLETED";

    return (
        <div className="space-y-6">
            {permissions.advanceApproval && exitCase.status === "APPROVED" && (
                <section className="rounded-2xl border p-5">
                    <h2 className="font-semibold">Start notice period</h2>
                    <p className="mt-1 text-sm text-slate-600">The approved last working date and agreed notice length will be recorded. No legal notice period is inferred.</p>
                    <Button className="mt-4" disabled={busy} onClick={() => run(() => advanceExitCaseWorkflow({ exitCaseId: exitCase.id, to: "NOTICE_PERIOD" }))}>Start notice</Button>
                </section>
            )}

            {permissions.clearance && exitCase.status === "NOTICE_PERIOD" && (
                <section className="rounded-2xl border p-5">
                    <h2 className="font-semibold">Schedule exit interview</h2>
                    <p className="mt-1 text-sm text-slate-600">Move the case to the interview step when the notice details have been confirmed.</p>
                    <Button className="mt-4" disabled={busy} onClick={() => run(() => advanceExitCaseWorkflow({ exitCaseId: exitCase.id, to: "INTERVIEW_PENDING" }))}>Open interview step</Button>
                </section>
            )}

            {permissions.interview && exitCase.status === "INTERVIEW_PENDING" && (
                <form className="space-y-3 rounded-2xl border p-5" onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    const rawRating = String(form.get("rating") ?? "");
                    void run(() => recordExitInterview({
                        exitCaseId: exitCase.id,
                        ...(rawRating ? { rating: Number(rawRating) } : {}),
                        comments: String(form.get("comments") ?? "").trim(),
                    }));
                }}>
                    <h2 className="font-semibold">Record exit interview</h2>
                    <label className="block text-sm">Rating (optional, 1–5)
                        <select name="rating" defaultValue="" className="mt-1 block h-10 w-full rounded-md border bg-background px-3">
                            <option value="">Not scored</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                    </label>
                    <label className="block text-sm">Notes (optional)
                        <textarea name="comments" maxLength={4000} rows={3} className="mt-1 block w-full rounded-md border bg-background p-3" />
                    </label>
                    <Button disabled={busy}>Save interview</Button>
                </form>
            )}

            {showChecklist && (
                <section className="space-y-3 rounded-2xl border p-5">
                    <div>
                        <h2 className="font-semibold">Clearance checklist</h2>
                        <p className="mt-1 text-sm text-slate-600">Required items must be completed or explicitly waived before settlement.</p>
                    </div>
                    {offboarding!.checklist.map((item) => (
                        <div key={item.id} className="flex flex-col gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <p className="font-medium">{item.label} {item.required ? <span className="text-rose-600">*</span> : null}</p>
                                <p className="text-xs text-slate-500">{item.category} · {item.status.replaceAll("_", " ")}{item.notes ? ` · ${item.notes}` : ""}</p>
                            </div>
                            {permissions.clearance && !["COMPLETED", "WAIVED"].includes(item.status) && (
                                <div className="flex gap-2">
                                    <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => updateExitChecklist({ itemId: item.id, to: "COMPLETED" }))}>Complete</Button>
                                    {!item.required && <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => updateExitChecklist({ itemId: item.id, to: "WAIVED", notes: "Not applicable" }))}>Not applicable</Button>}
                                </div>
                            )}
                        </div>
                    ))}
                </section>
            )}

            {permissions.clearance && exitCase.status === "INTERVIEW_COMPLETED" && (
                <section className="rounded-2xl border p-5">
                    <h2 className="font-semibold">Move to clearance</h2>
                    <p className="mt-1 text-sm text-slate-600">All required checklist items must be completed before moving forward.</p>
                    <Button className="mt-4" disabled={busy} onClick={() => run(() => advanceExitCaseWorkflow({ exitCaseId: exitCase.id, to: "CLEARANCE_PENDING" }))}>Begin clearance</Button>
                </section>
            )}

            {permissions.clearance && exitCase.status === "CLEARANCE_PENDING" && (
                <section className="rounded-2xl border p-5">
                    <h2 className="font-semibold">Send to settlement</h2>
                    <p className="mt-1 text-sm text-slate-600">This requires all mandatory clearance items to be resolved.</p>
                    <Button className="mt-4" disabled={busy} onClick={() => run(() => advanceExitCaseWorkflow({ exitCaseId: exitCase.id, to: "SETTLEMENT_PENDING" }))}>Open settlement</Button>
                </section>
            )}

            {permissions.prepareSettlement && ["CLEARANCE_PENDING", "SETTLEMENT_PENDING"].includes(exitCase.status) && (!settlement || ["DRAFT", "CALCULATED"].includes(settlement.status)) && (
                <form className="space-y-4 rounded-2xl border p-5" onSubmit={prepare}>
                    <div>
                        <h2 className="font-semibold">Prepare final settlement</h2>
                        <p className="mt-1 text-sm text-slate-600">Enter amounts from approved HR/Finance calculations. The system does not calculate statutory gratuity or notice pay.</p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {amountFields.map(([name, label, step]) => (
                            <label key={name} className="text-sm">{label}
                                <input name={name} type="number" min="0" step={step} defaultValue={settlement?.[name] ?? 0} className="mt-1 block h-10 w-full rounded-md border bg-background px-3" />
                            </label>
                        ))}
                    </div>
                    <label className="block text-sm">Calculation source / notes
                        <textarea name="calculationNotes" maxLength={4000} defaultValue={settlement?.calculationNotes ?? ""} rows={3} className="mt-1 block w-full rounded-md border bg-background p-3" />
                    </label>
                    {settlement && <p className="text-sm font-semibold">Current calculated total: {settlement.finalAmount.toFixed(2)} AED</p>}
                    <Button disabled={busy}>{settlement ? "Update draft figures" : "Calculate draft total"}</Button>
                </form>
            )}

            {settlement && (
                <section className="space-y-3 rounded-2xl border p-5">
                    <h2 className="font-semibold">Settlement · {settlement.status.replaceAll("_", " ")}</h2>
                    <p className="text-2xl font-bold">{settlement.finalAmount.toFixed(2)} AED</p>
                    {settlement.calculationNotes && <p className="whitespace-pre-wrap text-sm text-slate-600">{settlement.calculationNotes}</p>}
                    {settlement.paidReference && <p className="text-sm">Payment reference: {settlement.paidReference}</p>}
                    {permissions.prepareSettlement && settlement.status === "CALCULATED" && <Button disabled={busy} onClick={() => run(() => advanceExitSettlement({ exitCaseId: exitCase.id, to: "UNDER_REVIEW" }))}>Send for approval</Button>}
                    {permissions.approveSettlement && settlement.status === "UNDER_REVIEW" && <Button disabled={busy} onClick={() => run(() => advanceExitSettlement({ exitCaseId: exitCase.id, to: "APPROVED" }))}>Approve settlement</Button>}
                    {permissions.paySettlement && settlement.status === "APPROVED" && (
                        <div className="space-y-3 rounded-xl bg-slate-50 p-4 dark:bg-slate-900">
                            <h3 className="font-semibold">Employee bank transfer</h3>
                            {payoutDestination?.bankName || payoutDestination?.accountNumber || payoutDestination?.iban ? (
                                <dl className="grid gap-2 text-sm sm:grid-cols-2">
                                    <div><dt className="text-slate-500">Bank</dt><dd>{payoutDestination.bankName || "Not recorded"}</dd></div>
                                    <div><dt className="text-slate-500">Account number</dt><dd>{payoutDestination.accountNumber || "Not recorded"}</dd></div>
                                    <div className="sm:col-span-2"><dt className="text-slate-500">IBAN</dt><dd className="break-all">{payoutDestination.iban || "Not recorded"}</dd></div>
                                </dl>
                            ) : (
                                <p className="text-sm text-rose-700">Employee bank details are missing. Add and verify them on the employee record before transferring.</p>
                            )}
                            <p className="text-sm text-slate-600">Make the transfer through your bank or approved payroll provider. This system records the transfer; it does not send money.</p>
                            <label className="flex items-start gap-2 text-sm">
                                <input type="checkbox" checked={transferConfirmed} onChange={(event) => setTransferConfirmed(event.target.checked)} disabled={!payoutDestination?.bankName || !payoutDestination?.iban} className="mt-1" />
                                I verified this destination and completed the bank transfer.
                            </label>
                            <div className="flex flex-col gap-2 sm:flex-row">
                                <input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} maxLength={120} placeholder="Bank/payment reference (required)" className="h-10 min-w-0 flex-1 rounded-md border bg-background px-3" />
                                <Button disabled={busy || !paymentReference.trim() || !transferConfirmed || !payoutDestination?.bankName || !payoutDestination?.iban} onClick={() => run(() => advanceExitSettlement({ exitCaseId: exitCase.id, to: "PAID", reference: paymentReference.trim(), confirmBankTransfer: transferConfirmed }))}>Record payment</Button>
                            </div>
                        </div>
                    )}
                </section>
            )}

            {permissions.complete && exitCase.status === "SETTLEMENT_PENDING" && (!settlement || settlement.status === "PAID") && (
                <section className="space-y-3 rounded-2xl border border-emerald-300 bg-emerald-50 p-5 dark:bg-emerald-950/20">
                    <h2 className="font-semibold">Finalize employee exit</h2>
                    {!settlement && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={noSettlementConfirmed} onChange={(event) => setNoSettlementConfirmed(event.target.checked)} className="mt-1" />I confirm HR/Finance reviewed the account and no settlement is owed.</label>}
                    <p className="text-sm text-slate-600">Finalization marks employment ended, disables the linked login, invalidates unused activation links, and retains the employee and payroll history.</p>
                    <Button variant="destructive" disabled={busy || (!settlement && !noSettlementConfirmed)} onClick={() => run(() => completeExitCase({ exitCaseId: exitCase.id, acknowledgeNoSettlement: noSettlementConfirmed }))}>Complete exit and revoke access</Button>
                </section>
            )}
        </div>
    );
}
