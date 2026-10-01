"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { submitExitCaseForm } from "@/app/lib/actions/exit";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";

type EmployeeOption = { id: string; firstName: string; lastName: string; employeeCode: string | null };

export function ExitCaseForm({
    employees,
    ownEmployeeId,
    canManage,
}: {
    employees: EmployeeOption[];
    ownEmployeeId: string | null;
    canManage: boolean;
}) {
    const [saving, setSaving] = useState(false);
    const router = useRouter();

    async function handleSubmit(formData: FormData) {
        setSaving(true);
        try {
            const result = await submitExitCaseForm(formData);
            if (!result.success) {
                toast.error(result.message);
                return;
            }
            toast.success("Request submitted. HR will review it shortly.");
            router.refresh();
            const form = document.getElementById("exit-case-form") as HTMLFormElement | null;
            form?.reset();
        } catch {
            toast.error("Could not submit the exit request. Please try again.");
        } finally {
            setSaving(false);
        }
    }

    const hasEmployee = canManage ? employees.length > 0 : Boolean(ownEmployeeId);

    return (
        <Card className="rounded-2xl border-slate-200 shadow-sm dark:border-slate-800">
            <CardHeader>
                <CardTitle>{canManage ? "Start an employee exit" : "Submit a resignation"}</CardTitle>
                <CardDescription>
                    {canManage
                        ? "Start a resignation, termination, or contract-end case. The employee record stays in the audit history."
                        : "Send a resignation request to HR for review. You can submit a request only for your own employee record."}
                </CardDescription>
            </CardHeader>
            <CardContent>
                {!hasEmployee ? (
                    <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                        No active employee record is linked to your account. Ask HR to link your account before submitting a resignation.
                    </p>
                ) : (
                    <form id="exit-case-form" action={handleSubmit} className="space-y-5">
                        {canManage ? (
                            <div className="space-y-2">
                                <Label htmlFor="employeeId">Employee</Label>
                                <select id="employeeId" name="employeeId" required defaultValue="" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                    <option value="" disabled>Select an employee</option>
                                    {employees.map((employee) => (
                                        <option key={employee.id} value={employee.id}>
                                            {employee.firstName} {employee.lastName} · {employee.employeeCode ?? "No employee code"}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        ) : (
                            <input type="hidden" name="employeeId" value={ownEmployeeId ?? ""} />
                        )}

                        <div className="space-y-2">
                            <Label htmlFor="type">Request type</Label>
                            <select id="type" name="type" defaultValue="RESIGNATION" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                <option value="RESIGNATION">Resignation</option>
                                {canManage && <option value="TERMINATION">Termination</option>}
                                {canManage && <option value="END_OF_CONTRACT">End of contract</option>}
                            </select>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="reason">Reason</Label>
                            <textarea id="reason" name="reason" required minLength={3} maxLength={2000} rows={3} placeholder="Add the reason for this request" className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="resignationLetter">Resignation letter (optional)</Label>
                            <Input id="resignationLetter" name="resignationLetter" type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="h-auto min-h-10 py-2" />
                            <p className="text-xs text-slate-500">PDF or Word document, up to 5 MB. Stored privately with your request; only you and authorized HR/admin users can download it.</p>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-3">
                            <div className="space-y-2">
                                <Label htmlFor="effectiveDate">Effective date</Label>
                                <DatePicker id="effectiveDate" name="effectiveDate" aria-label="Effective date" />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="lastWorkingDate">Last working day</Label>
                                <DatePicker id="lastWorkingDate" name="lastWorkingDate" aria-label="Last working day" />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="noticePeriodDays">Notice period (days)</Label>
                                <Input id="noticePeriodDays" name="noticePeriodDays" type="number" min="0" step="1" required placeholder="Enter agreed days" />
                            </div>
                        </div>

                        <p className="text-xs leading-relaxed text-slate-500">
                            Enter the agreed notice period from the employee’s contract or company policy. The system does not assume a legal notice period.
                        </p>
                        <div className="flex justify-end">
                            <Button type="submit" disabled={saving} className="w-full sm:w-auto">
                                {saving ? "Submitting…" : canManage ? "Start exit case" : "Submit resignation"}
                            </Button>
                        </div>
                    </form>
                )}
            </CardContent>
        </Card>
    );
}
