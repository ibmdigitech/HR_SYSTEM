"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plane } from "lucide-react";
import { requestBusinessTravel } from "@/app/lib/actions/travel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DateField } from "@/components/ui/date-field";
import { FormField } from "@/components/common/FormField";
import { Label } from "@/components/ui/label";

type EmployeeOption = { id: string; firstName: string; lastName: string; employeeCode: string | null };

const CLASSES = [
    { value: "ECONOMY", label: "Economy" },
    { value: "PREMIUM_ECONOMY", label: "Premium economy" },
    { value: "BUSINESS", label: "Business" },
];

/**
 * Request form for company-purpose travel.
 *
 * The employee selector only appears for a holder of `travel.request.any`; for
 * everyone else the employee id is a hidden field carrying their own id. That is
 * a convenience, not the control: `requestBusinessTravel` re-derives the actor
 * from the session and refuses a request for anyone else, so editing this form
 * in the browser buys nothing.
 */
export function TravelRequestForm({
    employees,
    ownEmployeeId,
    canRequestForOthers,
    entitledCount,
}: {
    employees: EmployeeOption[];
    ownEmployeeId: string | null;
    canRequestForOthers: boolean;
    /** Remaining tickets in the actor's own current window, for the hint line. */
    entitledCount: number;
}) {
    const [saving, setSaving] = useState(false);
    const router = useRouter();

    async function handleSubmit(formData: FormData) {
        setSaving(true);
        try {
            const result = await requestBusinessTravel(formData);
            if (!result.success) {
                toast.error(result.message);
                return;
            }
            toast.success(result.message);
            router.refresh();
            (document.getElementById("travel-request-form") as HTMLFormElement | null)?.reset();
        } catch {
            toast.error("Could not submit the travel request. Please try again.");
        } finally {
            setSaving(false);
        }
    }

    const selectable = canRequestForOthers ? employees : ownEmployeeId ? [ownEmployeeId] : [];
    if (selectable.length === 0) {
        return (
            <Card className="rounded-2xl border-slate-200 shadow-sm dark:border-slate-800">
                <CardHeader>
                    <CardTitle>Request business travel</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                        No active employee record is linked to your account. Ask HR to link it before
                        requesting travel.
                    </p>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="rounded-2xl border-slate-200 shadow-sm dark:border-slate-800">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Plane className="h-4 w-4" aria-hidden="true" />
                    Request business travel
                </CardTitle>
                <CardDescription>
                    Company-purpose travel outside the country. The request is checked against the
                    traveller&apos;s air ticket entitlement for the entitlement window the departure falls in.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <form id="travel-request-form" action={handleSubmit} className="space-y-5">
                    {canRequestForOthers ? (
                        <div className="space-y-2">
                            <Label htmlFor="travel-employee">Employee</Label>
                            <select
                                id="travel-employee"
                                name="employeeId"
                                required
                                defaultValue=""
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                                <option value="" disabled>
                                    Select an employee
                                </option>
                                {employees.map((employee) => (
                                    <option key={employee.id} value={employee.id}>
                                        {employee.firstName} {employee.lastName}
                                        {employee.employeeCode ? ` · ${employee.employeeCode}` : ""}
                                    </option>
                                ))}
                            </select>
                        </div>
                    ) : (
                        <input type="hidden" name="employeeId" value={ownEmployeeId ?? ""} />
                    )}

                    <FormField
                        name="purpose"
                        label="Purpose of travel"
                        required
                        maxLength={1000}
                        placeholder="e.g. Client site survey, Doha"
                    />

                    <div className="grid gap-4 sm:grid-cols-2">
                        <FormField
                            name="destinationCountry"
                            label="Destination country"
                            required
                            maxLength={80}
                            placeholder="e.g. Qatar"
                        />
                        <FormField
                            name="destinationCity"
                            label="Destination city"
                            maxLength={80}
                            placeholder="e.g. Doha"
                        />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <DateField name="departureDate" label="Departure date" required />
                        <DateField name="returnDate" label="Return date" hint="Leave empty for one-way travel." />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-3">
                        <div className="space-y-2">
                            <Label htmlFor="travel-class">Travel class</Label>
                            <select
                                id="travel-class"
                                name="travelClass"
                                defaultValue="ECONOMY"
                                className="flex h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold dark:border-slate-800 dark:bg-slate-900"
                            >
                                {CLASSES.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="cost-bearer">Ticket cost borne by</Label>
                            <select
                                id="cost-bearer"
                                name="ticketCostBorneBy"
                                defaultValue="COMPANY"
                                className="flex h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold dark:border-slate-800 dark:bg-slate-900"
                            >
                                <option value="COMPANY">Company</option>
                                <option value="EMPLOYEE">Employee</option>
                            </select>
                        </div>

                        <FormField
                            name="estimatedCost"
                            label="Estimated cost (AED)"
                            type="number"
                            inputMode="decimal"
                            placeholder="0"
                        />
                    </div>

                    <p className="text-xs leading-relaxed text-slate-500">
                        {entitledCount > 0
                            ? `${entitledCount} ticket(s) remain in your current entitlement window. A class above your entitled class can only be approved by HR.`
                            : "No air ticket entitlement is recorded against your account. HR can still accept this request, but it will not consume an entitlement."}
                    </p>

                    <div className="flex justify-end">
                        <Button type="submit" disabled={saving}>
                            {saving ? "Submitting…" : "Submit travel request"}
                        </Button>
                    </div>
                </form>
            </CardContent>
        </Card>
    );
}