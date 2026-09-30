"use client";

import { useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { CheckCircle2, Loader2, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { createJobRequisitionAction, type RequisitionFormState } from "@/app/lib/actions/requisition";
import {
    MAX_REQUISITION_POSITIONS,
    REQUISITION_DEFAULT_EMPLOYMENT_TYPE,
    REQUISITION_DEFAULT_POSITION_TYPE,
    REQUISITION_DEFAULT_PRIORITY,
    REQUISITION_EMPLOYMENT_TYPE_LABELS,
    REQUISITION_EMPLOYMENT_TYPES,
    REQUISITION_POSITION_TYPE_LABELS,
    REQUISITION_POSITION_TYPES,
    REQUISITION_POSITION_TYPE_REPLACEMENT,
    REQUISITION_PRIORITY_LABELS,
    REQUISITION_PRIORITIES,
} from "@/lib/recruitment/requisition-validation";

/**
 * New job requisition form.
 *
 * The client check below is a CONVENIENCE. Every rule it applies is applied
 * again, server-side, by `parseRequisitionFormData` inside the action — a
 * crafted request that skips this component is rejected before anything is
 * written. Validation is duplicated deliberately: the point of the form is fast
 * feedback, and the point of the action is correctness.
 *
 * The generated `requisitionCode` is not a field here. It is issued by the
 * server from the highest existing code for the year, because the column is
 * unique and two people creating a requisition at the same moment is a normal
 * thing to do.
 */

const initialState: RequisitionFormState = { success: false, message: "" };

interface Replacements {
    id: string;
    firstName: string;
    lastName: string;
    employeeCode: string | null;
    department: string | null;
}

interface FieldValues {
    title: string;
    department: string;
    branch: string;
    location: string;
    employmentType: string;
    positionsCount: string;
    positionType: string;
    replacementEmployeeId: string;
    reason: string;
    requiredSkills: string;
    requiredExperience: string;
    requiredEducation: string;
    budget: string;
    minSalary: string;
    maxSalary: string;
    priority: string;
    targetJoiningDate: string;
}

const EMPTY: FieldValues = {
    title: "",
    department: "",
    branch: "",
    location: "",
    employmentType: REQUISITION_DEFAULT_EMPLOYMENT_TYPE,
    positionsCount: "1",
    positionType: REQUISITION_DEFAULT_POSITION_TYPE,
    replacementEmployeeId: "",
    reason: "",
    requiredSkills: "",
    requiredExperience: "",
    requiredEducation: "",
    budget: "",
    minSalary: "",
    maxSalary: "",
    priority: REQUISITION_DEFAULT_PRIORITY,
    targetJoiningDate: "",
};

const LABEL = "text-[10px] font-black uppercase tracking-widest text-slate-400";
const FIELD = "h-11";

/** Client-side mirror of the server rules that are cheap to check here. */
function validateOnClient(values: FieldValues): Record<string, string> {
    const errors: Record<string, string> = {};

    if (!values.title.trim()) errors.title = "Job title is required";
    if (!values.department.trim()) errors.department = "Department is required";

    const positions = Number(values.positionsCount);
    if (!values.positionsCount.trim() || !Number.isFinite(positions)) {
        errors.positionsCount = "Enter the number of positions";
    } else if (!Number.isInteger(positions) || positions < 1) {
        errors.positionsCount = "At least one position must be requested";
    } else if (positions > MAX_REQUISITION_POSITIONS) {
        errors.positionsCount = `At most ${MAX_REQUISITION_POSITIONS} positions`;
    }

    const min = values.minSalary.trim() === "" ? undefined : Number(values.minSalary);
    const max = values.maxSalary.trim() === "" ? undefined : Number(values.maxSalary);
    if (min !== undefined && !Number.isFinite(min)) errors.minSalary = "Enter a number";
    if (max !== undefined && !Number.isFinite(max)) errors.maxSalary = "Enter a number";
    if (min !== undefined && max === undefined) {
        errors.minSalary = "Enter both the minimum and maximum salary, or leave both blank";
    }
    if (max !== undefined && min === undefined) {
        errors.maxSalary = "Enter both the minimum and maximum salary, or leave both blank";
    }
    if (min !== undefined && max !== undefined && Number.isFinite(min) && Number.isFinite(max) && min > max) {
        errors.minSalary = "The minimum salary cannot be above the maximum";
    }

    if (
        values.positionType === REQUISITION_POSITION_TYPE_REPLACEMENT &&
        !values.replacementEmployeeId.trim()
    ) {
        errors.replacementEmployeeId = "Select the employee being replaced, or choose New position";
    }

    return errors;
}

export function NewRequisitionForm({ employees }: { employees: Replacements[] }) {
    const [state, formAction] = useActionState(createJobRequisitionAction, initialState);
    const [values, setValues] = useState<FieldValues>(EMPTY);
    const [clientErrors, setClientErrors] = useState<Record<string, string>>({});

    function set<K extends keyof FieldValues>(key: K, value: FieldValues[K]) {
        setValues((v) => ({ ...v, [key]: value }));
    }

    function onSubmit(event: React.FormEvent<HTMLFormElement>) {
        const errors = validateOnClient(values);
        setClientErrors(errors);
        if (Object.keys(errors).length > 0) {
            // The server would refuse this too; stopping here only saves a round
            // trip and shows the message without a full page transition.
            event.preventDefault();
        }
    }

    // The server is the authority, so its verdict wins where both have one.
    const errors: Record<string, string> = { ...clientErrors, ...(state.fieldErrors ?? {}) };

    if (state.success) {
        return (
            <div className="rounded-3xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 p-8 text-center space-y-4">
                <div className="inline-flex items-center justify-center p-4 bg-emerald-100 dark:bg-emerald-900/40 rounded-2xl">
                    <CheckCircle2 className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
                </div>
                <h2 className="text-xl font-black text-slate-900 dark:text-white">
                    Requisition {state.requisitionCode} created
                </h2>
                <p className="text-sm text-slate-600 dark:text-slate-400 max-w-md mx-auto">
                    It has been saved as a draft. Nothing has been sent for approval — a requisition has
                    to be submitted and cleared by the manager, HR and finance before it can accept
                    candidates.
                </p>
                <div className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
                    <Button
                        asChild
                        className="h-11 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-700 font-black uppercase text-xs tracking-widest"
                    >
                        <Link href="/recruitment">Back to recruitment</Link>
                    </Button>
                    <Button
                        variant="outline"
                        onClick={() => {
                            setValues(EMPTY);
                            setClientErrors({});
                        }}
                        className="h-11 px-5 rounded-xl font-black uppercase text-xs tracking-widest"
                    >
                        Raise another
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <form
            action={formAction}
            onSubmit={onSubmit}
            noValidate
            className="min-w-0 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-5 md:p-7 space-y-6"
        >
            {/* ── The role ────────────────────────────────────────────── */}
            <fieldset className="min-w-0 space-y-4">
                <legend className="text-[10px] font-black uppercase tracking-widest text-indigo-600 dark:text-indigo-400">
                    The role
                </legend>

                <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                    <Field
                        id="req-title"
                        label="Job title *"
                        error={errors.title}
                        className="sm:col-span-2"
                    >
                        <Input
                            id="req-title"
                            name="title"
                            value={values.title}
                            onChange={(e) => set("title", e.target.value)}
                            placeholder="Senior Finance Analyst"
                            aria-invalid={errors.title ? "true" : undefined}
                            className={FIELD}
                        />
                    </Field>

                    <Field id="req-department" label="Department *" error={errors.department}>
                        <Input
                            id="req-department"
                            name="department"
                            value={values.department}
                            onChange={(e) => set("department", e.target.value)}
                            placeholder="Finance"
                            aria-invalid={errors.department ? "true" : undefined}
                            className={FIELD}
                        />
                    </Field>

                    <Field id="req-branch" label="Branch">
                        <Input
                            id="req-branch"
                            name="branch"
                            value={values.branch}
                            onChange={(e) => set("branch", e.target.value)}
                            className={FIELD}
                        />
                    </Field>

                    <Field id="req-location" label="Location" className="sm:col-span-2">
                        <Input
                            id="req-location"
                            name="location"
                            value={values.location}
                            onChange={(e) => set("location", e.target.value)}
                            placeholder="Dubai HQ"
                            className={FIELD}
                        />
                    </Field>
                </div>
            </fieldset>

            {/* ── The vacancy ─────────────────────────────────────────── */}
            <fieldset className="min-w-0 space-y-4">
                <legend className="text-[10px] font-black uppercase tracking-widest text-indigo-600 dark:text-indigo-400">
                    The vacancy
                </legend>

                <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                    <Field id="req-employment-type" label="Employment type">
                        <Select
                            name="employmentType"
                            value={values.employmentType}
                            onValueChange={(v) => set("employmentType", v)}
                        >
                            <SelectTrigger id="req-employment-type" className={FIELD}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {REQUISITION_EMPLOYMENT_TYPES.map((t) => (
                                    <SelectItem key={t} value={t}>
                                        {REQUISITION_EMPLOYMENT_TYPE_LABELS[t]}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </Field>

                    <Field id="req-positions" label="Positions" error={errors.positionsCount}>
                        <Input
                            id="req-positions"
                            name="positionsCount"
                            type="number"
                            min={1}
                            max={MAX_REQUISITION_POSITIONS}
                            value={values.positionsCount}
                            onChange={(e) => set("positionsCount", e.target.value)}
                            aria-invalid={errors.positionsCount ? "true" : undefined}
                            className={FIELD}
                        />
                    </Field>

                    <Field id="req-position-type" label="Position type">
                        <Select
                            name="positionType"
                            value={values.positionType}
                            onValueChange={(v) => set("positionType", v)}
                        >
                            <SelectTrigger id="req-position-type" className={FIELD}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {REQUISITION_POSITION_TYPES.map((t) => (
                                    <SelectItem key={t} value={t}>
                                        {REQUISITION_POSITION_TYPE_LABELS[t]}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </Field>

                    {values.positionType === REQUISITION_POSITION_TYPE_REPLACEMENT && (
                        <Field
                            id="req-replacement"
                            label="Employee being replaced *"
                            error={errors.replacementEmployeeId}
                        >
                            <Select
                                name="replacementEmployeeId"
                                value={values.replacementEmployeeId}
                                onValueChange={(v) => set("replacementEmployeeId", v)}
                            >
                                <SelectTrigger
                                    id="req-replacement"
                                    aria-invalid={errors.replacementEmployeeId ? "true" : undefined}
                                    className={FIELD}
                                >
                                    <SelectValue placeholder="Select an employee" />
                                </SelectTrigger>
                                <SelectContent>
                                    {employees.map((e) => (
                                        <SelectItem key={e.id} value={e.id}>
                                            {e.firstName} {e.lastName}
                                            {e.employeeCode ? ` — ${e.employeeCode}` : ""}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </Field>
                    )}

                    <Field
                        id="req-priority"
                        label="Priority"
                        className={values.positionType === REQUISITION_POSITION_TYPE_REPLACEMENT ? "" : "sm:col-span-1"}
                    >
                        <Select name="priority" value={values.priority} onValueChange={(v) => set("priority", v)}>
                            <SelectTrigger id="req-priority" className={FIELD}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {REQUISITION_PRIORITIES.map((p) => (
                                    <SelectItem key={p} value={p}>
                                        {REQUISITION_PRIORITY_LABELS[p]}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </Field>

                    <Field id="req-target" label="Target joining date" error={errors.targetJoiningDate}>
                        <Input
                            id="req-target"
                            name="targetJoiningDate"
                            type="date"
                            value={values.targetJoiningDate}
                            onChange={(e) => set("targetJoiningDate", e.target.value)}
                            aria-invalid={errors.targetJoiningDate ? "true" : undefined}
                            className={FIELD}
                        />
                    </Field>
                </div>

                <Field id="req-reason" label="Reason for the vacancy">
                    <Textarea
                        id="req-reason"
                        name="reason"
                        value={values.reason}
                        onChange={(e) => set("reason", e.target.value)}
                        placeholder="New headcount approved in the FY budget, or the reason a replacement is needed."
                        className="min-h-[90px] resize-y"
                    />
                </Field>
            </fieldset>

            {/* ── Requirements ────────────────────────────────────────── */}
            <fieldset className="min-w-0 space-y-4">
                <legend className="text-[10px] font-black uppercase tracking-widest text-indigo-600 dark:text-indigo-400">
                    Requirements
                </legend>

                <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                    <Field
                        id="req-skills"
                        label="Required skills"
                        className="sm:col-span-2"
                    >
                        <Textarea
                            id="req-skills"
                            name="requiredSkills"
                            value={values.requiredSkills}
                            onChange={(e) => set("requiredSkills", e.target.value)}
                            placeholder="Oracle Financials, FP&A, IFRS reporting"
                            className="min-h-[70px] resize-y"
                        />
                    </Field>

                    <Field id="req-experience" label="Required experience">
                        <Input
                            id="req-experience"
                            name="requiredExperience"
                            value={values.requiredExperience}
                            onChange={(e) => set("requiredExperience", e.target.value)}
                            placeholder="5+ years"
                            className={FIELD}
                        />
                    </Field>

                    <Field id="req-education" label="Required education">
                        <Input
                            id="req-education"
                            name="requiredEducation"
                            value={values.requiredEducation}
                            onChange={(e) => set("requiredEducation", e.target.value)}
                            placeholder="Bachelor's degree in Finance"
                            className={FIELD}
                        />
                    </Field>
                </div>
            </fieldset>

            {/* ── Budget ───────────────────────────────────────────────── */}
            <fieldset className="min-w-0 space-y-4">
                <legend className="text-[10px] font-black uppercase tracking-widest text-indigo-600 dark:text-indigo-400">
                    Budget
                </legend>

                <div className="grid min-w-0 gap-4 sm:grid-cols-3">
                    <Field id="req-budget" label="Budget (AED)" error={errors.budget}>
                        <Input
                            id="req-budget"
                            name="budget"
                            type="number"
                            min={0}
                            value={values.budget}
                            onChange={(e) => set("budget", e.target.value)}
                            aria-invalid={errors.budget ? "true" : undefined}
                            className={FIELD}
                        />
                    </Field>

                    <Field id="req-min" label="Salary from (AED)" error={errors.minSalary}>
                        <Input
                            id="req-min"
                            name="minSalary"
                            type="number"
                            min={0}
                            value={values.minSalary}
                            onChange={(e) => set("minSalary", e.target.value)}
                            aria-invalid={errors.minSalary ? "true" : undefined}
                            className={FIELD}
                        />
                    </Field>

                    <Field id="req-max" label="Salary to (AED)" error={errors.maxSalary}>
                        <Input
                            id="req-max"
                            name="maxSalary"
                            type="number"
                            min={0}
                            value={values.maxSalary}
                            onChange={(e) => set("maxSalary", e.target.value)}
                            aria-invalid={errors.maxSalary ? "true" : undefined}
                            className={FIELD}
                        />
                    </Field>
                </div>
            </fieldset>

            {state.message && !state.success && (
                <div
                    role="alert"
                    className="rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 px-4 py-3 text-sm font-bold text-rose-600 dark:text-rose-400"
                >
                    {state.message}
                </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2 pt-1">
                <SubmitButton />
                <Button
                    asChild
                    variant="outline"
                    className="h-11 px-5 rounded-xl font-black uppercase text-xs tracking-widest"
                >
                    <Link href="/recruitment">Cancel</Link>
                </Button>
            </div>
        </form>
    );
}

function SubmitButton() {
    const { pending } = useFormStatus();
    return (
        <Button
            type="submit"
            disabled={pending}
            aria-busy={pending}
            className="flex-1 h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 font-black uppercase text-xs tracking-widest"
        >
            {pending ? (
                <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating…
                </>
            ) : (
                <>
                    <Save className="h-4 w-4 mr-2" />
                    Create draft requisition
                </>
            )}
        </Button>
    );
}

function Field({
    id,
    label,
    error,
    className = "",
    children,
}: {
    id: string;
    label: string;
    error?: string;
    className?: string;
    children: React.ReactNode;
}) {
    return (
        // `min-w-0` is required, not decorative. A grid item defaults to
        // `min-width: auto`, which means it refuses to shrink below its
        // content's intrinsic width — so the intrinsic width of an
        // <input type="number"> or <input type="date"> (both of which reserve
        // room for spinners, a calendar icon and a locale-formatted value)
        // would push the track wider than its column. The grid would then be
        // wider than the form, and the overflow scrollbar would appear along
        // the BOTTOM edge of the page, where a user reads it as "this form is
        // cut off" rather than "a field is too wide". `min-w-0` makes the item
        // shrinkable, which is what lets the inner `w-full` on the inputs
        // actually mean full-width-of-the-column.
        <div className={`min-w-0 space-y-1.5 ${className}`}>
            <Label htmlFor={id} className={LABEL}>
                {label}
            </Label>
            {children}
            {error && (
                <p role="alert" className="text-[11px] font-bold text-rose-600">
                    {error}
                </p>
            )}
        </div>
    );
}
