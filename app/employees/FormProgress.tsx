"use client";

import { Check, Circle, AlertCircle } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

/**
 * Section progress for the employee entry form (P1).
 *
 * Shows which of the four sections are complete, so a long form no longer
 * leaves the user guessing what is left. Completion is derived from the live
 * form values on every change — it is not a manual checklist that can drift
 * from the fields.
 */

export interface SectionSpec {
    id: string;
    label: string;
    /** Must be filled for the section to count as complete. */
    required: string[];
    /** Fill these for a "mostly done" state; shown as optional. */
    optional?: string[];
}

export const EMPLOYEE_SECTIONS: SectionSpec[] = [
    {
        id: "personal",
        label: "Personal",
        required: ["firstName", "lastName", "email"],
        optional: ["phone", "gender", "bloodGroup", "maritalStatus", "nationality", "dateOfBirth", "address", "permanentAddress", "emergencyContact", "emergencyPhone"],
    },
    {
        id: "employment",
        label: "Employment",
        required: ["rollNumber", "designation", "department", "joiningDate"],
        optional: ["employmentType", "workLocation", "probationDays"],
    },
    {
        id: "finance",
        label: "Finance",
        // Money fields are optional by business rule, but if any is present it
        // must be numeric — a blank finance section is legitimate.
        required: [],
        optional: ["basicSalary", "housingAllowance", "transportAllowance", "otherAllowance", "bankName", "accountNumber", "iban", "ifscCode"],
    },
    {
        id: "docs",
        label: "Verification",
        required: [],
        optional: ["passportNumber", "passportExpiry", "emiratesId", "emiratesIdExpiry", "visaNumber", "visaExpiry", "medicalInsuranceExpiry"],
    },
];

function isFilled(value: FormDataEntryValue | null): boolean {
    return typeof value === "string" && value.trim().length > 0;
}

export function computeSectionState(
    formData: FormData,
    section: SectionSpec
): { complete: boolean; missingRequired: string[]; filledOptional: number; totalOptional: number } {
    const missingRequired = section.required.filter((f) => !isFilled(formData.get(f)));
    const optionals = section.optional ?? [];
    const filledOptional = optionals.filter((f) => isFilled(formData.get(f))).length;

    return {
        // A section is complete when nothing required is missing. Sections with
        // no required fields are complete once at least one field is filled, so
        // an untouched optional-only section does not read as "done".
        complete:
            missingRequired.length === 0 &&
            (section.required.length > 0 || filledOptional > 0),
        missingRequired,
        filledOptional,
        totalOptional: optionals.length,
    };
}

export function FormProgress({
    activeTab,
    onTabChange,
    formData,
    sections = EMPLOYEE_SECTIONS,
}: {
    activeTab: string;
    onTabChange: (id: string) => void;
    formData: FormData | null;
    sections?: SectionSpec[];
}) {
    const states = sections.map((s) => computeSectionState(formData ?? new FormData(), s));
    const done = states.filter((s) => s.complete).length;
    const percent = Math.round((done / sections.length) * 100);
    const hasAnyValue = states.some(
        (s) => s.filledOptional > 0 || s.complete
    );
    const shownPercent = hasAnyValue ? percent : 0;

    return (
        <div className="space-y-3" aria-label="Form completion">
            {/* Overall bar */}
            <div className="flex items-center gap-3">
                <Progress
                    value={shownPercent}
                    aria-label="Form completion"
                    className="h-2 flex-1 rounded-full bg-slate-200 dark:bg-slate-800"
                    indicatorClassName="rounded-full bg-gradient-to-r from-indigo-500 via-violet-500 to-emerald-500"
                />
                <span className="shrink-0 text-[11px] font-black tabular-nums text-slate-500 dark:text-slate-400">
                    {done}/{sections.length} · {shownPercent}%
                </span>
            </div>

            {/* Per-section pills — also act as jump targets */}
            <ul className="flex flex-wrap gap-1.5">
                {sections.map((section, i) => {
                    const state = states[i];
                    const isActive = activeTab === section.id;
                    const hasMissing = state.missingRequired.length > 0;
                    // Only nag about a section the user has actually visited,
                    // otherwise an untouched form opens full of warnings.
                    const touched = isActive || hasAnyValue;

                    return (
                        <li key={section.id}>
                            <button
                                type="button"
                                onClick={() => onTabChange(section.id)}
                                aria-current={isActive ? "step" : undefined}
                                className={cn(
                                    "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950",
                                    isActive
                                        ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20"
                                        : state.complete
                                          ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
                                          : touched && hasMissing
                                            ? "bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/50 dark:text-amber-300 dark:hover:bg-amber-900/60"
                                            : "bg-slate-100 text-slate-600 hover:bg-indigo-50 hover:text-indigo-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-indigo-950/60 dark:hover:text-indigo-200"
                                )}
                            >
                                {state.complete ? (
                                    <Check className="h-3 w-3" aria-hidden="true" />
                                ) : touched && hasMissing ? (
                                    <AlertCircle className="h-3 w-3" aria-hidden="true" />
                                ) : (
                                    <Circle className="h-3 w-3" aria-hidden="true" />
                                )}
                                {section.label}
                                {state.complete && <span className="sr-only">(complete)</span>}
                                {!state.complete && hasMissing && (
                                    <span className="sr-only">
                                        (missing {state.missingRequired.length} required field(s))
                                    </span>
                                )}
                            </button>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
