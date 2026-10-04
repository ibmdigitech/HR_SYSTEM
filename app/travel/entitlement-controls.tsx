"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Settings2 } from "lucide-react";
import { updateAirTicketEntitlement } from "@/app/lib/actions/travel";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";

const CLASSES = [
    { value: "", label: "Not set" },
    { value: "ECONOMY", label: "Economy" },
    { value: "PREMIUM_ECONOMY", label: "Premium economy" },
    { value: "BUSINESS", label: "Business" },
];

/**
 * HR's control over the entitlement contract.
 *
 * The anchor date field is deliberately optional and pre-filled from the visa
 * issue date when there is no explicit anchor: the entitlement is meant to
 * follow the visa renewal, so the operator should see the date the window will
 * actually use rather than have to look it up.
 *
 * The TICKET COUNT and the ANNUAL BUDGET sit together because they reset on the
 * same day. Editing one next to the other is the only way to keep the promise
 * honest: "two tickets worth AED 20,000" is one decision, not two.
 *
 * A change to the count applies from the NEXT window. A window already in
 * progress keeps the entitlement it opened with, so raising the count mid-window
 * cannot mint a ticket that was already spent. The budget is read live and
 * applies at once, which the hint under the field says.
 */
export function EntitlementControls({
    employeeId,
    employeeName,
    entitledPerYear,
    travelClass,
    anchorDate,
    anchorFallback,
    annualBudget,
}: {
    employeeId: string;
    employeeName: string;
    entitledPerYear: number;
    travelClass: string | null;
    /** ISO `yyyy-MM-dd`, or null when the employee has no explicit anchor. */
    anchorDate: string | null;
    /** The visa-derived date the window uses when there is no explicit anchor. */
    anchorFallback: string | null;
    /** AED cap for the window, or null when HR has not agreed one. */
    annualBudget: number | null;
}) {
    const [saving, setSaving] = useState(false);
    const router = useRouter();

    async function handleSubmit(formData: FormData) {
        setSaving(true);
        try {
            const result = await updateAirTicketEntitlement(formData);
            if (!result.success) toast.error(result.message);
            else toast.success(result.message);
            router.refresh();
        } catch {
            toast.error("Could not save the entitlement.");
        } finally {
            setSaving(false);
        }
    }

    return (
        <form action={handleSubmit} className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
            <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.15em] text-slate-500">
                <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
                Entitlement for {employeeName}
            </p>
            <input type="hidden" name="employeeId" value={employeeId} />

            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                <div className="space-y-2">
                    <Label htmlFor={`entitled-${employeeId}`}>Tickets per year</Label>
                    <input
                        id={`entitled-${employeeId}`}
                        name="entitledPerYear"
                        type="number"
                        min={0}
                        max={12}
                        step={1}
                        required
                        defaultValue={entitledPerYear}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                    <p className="text-[11px] text-slate-500">0 revokes the entitlement. 1 or 2 is the usual range.</p>
                </div>

                <div className="space-y-2">
                    <Label htmlFor={`budget-${employeeId}`}>Annual travel budget (AED)</Label>
                    <input
                        id={`budget-${employeeId}`}
                        name="annualBudget"
                        type="number"
                        min={0}
                        max={10000000}
                        step={0.01}
                        placeholder="No cap set"
                        defaultValue={annualBudget ?? ""}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                    <p className="text-[11px] text-slate-500">
                        Leave empty for no cap. Without one, every grant is an over-budget exception.
                    </p>
                </div>

                <div className="space-y-2">
                    <Label htmlFor={`class-${employeeId}`}>Travel class</Label>
                    <select
                        id={`class-${employeeId}`}
                        name="travelClass"
                        defaultValue={travelClass ?? ""}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                        {CLASSES.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                    <p className="text-[11px] text-slate-500">
                        The cap applies to the window open now as well as the next one.
                    </p>
                </div>
            </div>

            <DateField
                name="anchorDate"
                label="Entitlement anchor (visa renewal)"
                defaultValue={anchorDate}
                hint={
                    anchorDate
                        ? "Window resets on this date each year."
                        : anchorFallback
                            ? `Not set. The window currently resets on ${anchorFallback}, taken from the visa issue date.`
                            : "Not set. With no visa date either, the window falls back to the calendar year."
                }
            />

            <div className="flex justify-end">
                <Button type="submit" size="sm" disabled={saving}>
                    {saving ? "Saving…" : "Save entitlement"}
                </Button>
            </div>
        </form>
    );
}