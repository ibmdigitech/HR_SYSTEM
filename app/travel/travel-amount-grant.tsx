"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CircleDollarSign } from "lucide-react";
import { grantBusinessTravelAmount } from "@/app/lib/actions/travel";
import { Button } from "@/components/ui/button";

const money = (value: number): string =>
    new Intl.NumberFormat("en-AE", { maximumFractionDigits: 2 }).format(value);

/**
 * HR's control over what the company agrees to pay for one trip.
 *
 * THE THREE NUMBERS ARE THE POINT. The traveller's estimate, the granted amount
 * and the difference between them are shown side by side, because "we agreed
 * more than the quote" is a fact somebody has to see rather than infer from two
 * columns. The remaining budget for the employee's window is shown with it, so
 * the amount being typed can be compared against what is left before it is
 * submitted.
 *
 * THE OVERRIDE IS DELIBERATE AND VISIBLE. The server refuses any grant above the
 * remaining budget unless the override is recorded, and this control surfaces
 * the case instead of hiding it: the tick appears with a warning naming the
 * shortfall, so approving over budget is a second, obvious act rather than a
 * silent pass. Granting more does not raise the cap — the window total still
 * includes this grant, so the next trip sees less headroom.
 *
 * The server re-checks the permission, the state, the budget and the amount.
 * `canGrant` only decides what is drawn.
 */
export function TravelAmountGrant({
    requestId,
    estimatedCost,
    approvedAmount,
    budgetVariance,
    grantedBy,
    budgetRemaining,
    annualBudget,
    canGrant,
}: {
    requestId: string;
    /** The traveller's quote. AED. */
    estimatedCost: number;
    /** What HR granted, or null when nothing has been granted yet. */
    approvedAmount: number | null;
    /** approvedAmount - estimatedCost, or null. */
    budgetVariance: number | null;
    grantedBy: string | null;
    /** AED left in the employee's window budget, or null when no cap is set. */
    budgetRemaining: number | null;
    annualBudget: number | null;
    canGrant: boolean;
}) {
    const [amount, setAmount] = useState(
        approvedAmount === null ? String(estimatedCost) : String(approvedAmount)
    );
    const [override, setOverride] = useState(false);
    const [saving, setSaving] = useState(false);
    const router = useRouter();

    const typed = Number(amount);
    const typedIsNumber = amount.trim() !== "" && Number.isFinite(typed);
    // Mirrors the server's own three over-budget cases so the operator sees the
    // warning before the click rather than after the refusal.
    const overBudget =
        budgetRemaining === null ? typedIsNumber : typedIsNumber && typed > budgetRemaining;

    async function handleSubmit(formData: FormData) {
        setSaving(true);
        try {
            const result = await grantBusinessTravelAmount(formData);
            if (!result.success) toast.error(result.message, { duration: 8000 });
            else toast.success(result.message);
            setOverride(false);
            router.refresh();
        } catch {
            toast.error("Could not grant the amount. Please try again.");
        } finally {
            setSaving(false);
        }
    }

    if (!canGrant) {
        return (
            <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5 text-[11px] text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300">
                <span className="flex items-center gap-1.5 font-bold uppercase tracking-[0.1em] text-slate-500">
                    <CircleDollarSign className="h-3.5 w-3.5 text-indigo-500" aria-hidden="true" />
                    Amount
                </span>
                <p className="mt-1">
                    {approvedAmount === null
                        ? `Not granted yet. Traveller's estimate AED ${money(estimatedCost)}. HR must grant an amount before this trip can be approved.`
                        : `AED ${money(approvedAmount)} approved by ${grantedBy ?? "an earlier approver"}.`}
                </p>
            </div>
        );
    }

    return (
        <form
            action={handleSubmit}
            className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 dark:border-indigo-900 dark:bg-indigo-950/20"
        >
            <input type="hidden" name="requestId" value={requestId} />
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-indigo-700 dark:text-indigo-300">
                <CircleDollarSign className="h-3.5 w-3.5" aria-hidden="true" />
                Approved amount
            </p>

            <dl className="mt-2 grid gap-x-4 gap-y-1 text-[11px] sm:grid-cols-3">
                <div>
                    <dt className="text-slate-500">Traveller&apos;s estimate</dt>
                    <dd className="font-bold tabular-nums">AED {money(estimatedCost)}</dd>
                </div>
                <div>
                    <dt className="text-slate-500">Granted</dt>
                    <dd className="font-bold tabular-nums">
                        {approvedAmount === null ? (
                            <span className="text-amber-700 dark:text-amber-400">Not granted</span>
                        ) : (
                            `AED ${money(approvedAmount)}`
                        )}
                    </dd>
                </div>
                <div>
                    <dt className="text-slate-500">Variance</dt>
                    <dd
                        className={`font-bold tabular-nums ${
                            budgetVariance === null || budgetVariance === 0
                                ? "text-slate-500"
                                : budgetVariance < 0
                                  ? "text-emerald-700 dark:text-emerald-400"
                                  : "text-amber-700 dark:text-amber-400"
                        }`}
                    >
                        {budgetVariance === null
                            ? "--"
                            : budgetVariance === 0
                              ? "Matches estimate"
                              : `${budgetVariance < 0 ? "-" : "+"} AED ${money(Math.abs(budgetVariance))}`}
                    </dd>
                </div>
            </dl>

            <p className="mt-1 text-[10px] text-slate-500">
                {annualBudget === null
                    ? "No annual travel budget is recorded for this employee, so every grant is an over-budget exception."
                    : `AED ${money(budgetRemaining ?? 0)} left of the AED ${money(annualBudget)} budget for this entitlement window.`}
                {grantedBy ? ` Last granted by ${grantedBy}.` : ""}
            </p>

            <div className="mt-2 grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
                <div>
                    <label
                        htmlFor={`amount-${requestId}`}
                        className="mb-1 block text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500"
                    >
                        Amount (AED)
                    </label>
                    <input
                        id={`amount-${requestId}`}
                        name="approvedAmount"
                        type="number"
                        min={0}
                        step={0.01}
                        required
                        value={amount}
                        onChange={(event) => setAmount(event.target.value)}
                        className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs tabular-nums dark:border-slate-800 dark:bg-slate-900"
                    />
                </div>
                <div>
                    <label
                        htmlFor={`amount-note-${requestId}`}
                        className="mb-1 block text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500"
                    >
                        Note (optional, kept in the audit trail)
                    </label>
                    <input
                        id={`amount-note-${requestId}`}
                        name="note"
                        type="text"
                        maxLength={1000}
                        placeholder="e.g. cheaper off-peak fare agreed with the travel office"
                        className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs dark:border-slate-800 dark:bg-slate-900"
                    />
                </div>
            </div>

            {/*
                The override is not hidden behind a menu. It appears only when the
                typed amount is over the window's remaining budget, says how far
                over it is, and has to be ticked for the grant to go through.
            */}
            {overBudget && (
                <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 dark:border-amber-800 dark:bg-amber-950/40">
                    <p className="flex items-center gap-1.5 text-[11px] font-bold text-amber-800 dark:text-amber-300">
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                        {budgetRemaining === null
                            ? "This employee has no annual travel budget recorded."
                            : `AED ${money(typed - budgetRemaining)} over the remaining budget.`}
                    </p>
                    <label className="mt-1.5 flex items-start gap-2 text-[11px] text-amber-900 dark:text-amber-200">
                        <input
                            type="checkbox"
                            name="overrideBudget"
                            checked={override}
                            onChange={(event) => setOverride(event.target.checked)}
                            className="mt-0.5 h-3.5 w-3.5"
                        />
                        Record this as an over-budget exception. It is written to the audit trail against
                        your name; it does not raise the budget for anyone else.
                    </label>
                </div>
            )}

            <div className="mt-2 flex justify-end">
                <Button type="submit" size="sm" disabled={saving || (overBudget && !override)}>
                    {saving
                        ? "Saving…"
                        : approvedAmount === null
                          ? "Grant amount"
                          : "Update amount"}
                </Button>
            </div>
        </form>
    );
}