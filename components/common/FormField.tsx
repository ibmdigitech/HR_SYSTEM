"use client";

import { useId, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/common/FieldError";

/**
 * Form field with a completion tick.
 *
 * A plain `<Input required>` shows nothing once it is satisfied, so a user
 * scrolling a long form cannot tell which fields are already done. This adds:
 *   - a visible tick when a required field holds a value,
 *   - a visible `*` when a field is required and still empty,
 *   - a bordered/ringed state on the tick so it reads at a glance.
 *
 * The tick is decorative — `aria-hidden` — because the input's own required and
 * invalid semantics already convey the state to assistive technology.
 */
export interface FormFieldProps {
    name: string;
    label: string;
    type?: string;
    required?: boolean;
    defaultValue?: string | number | null;
    placeholder?: string;
    autoComplete?: string;
    inputMode?: "text" | "numeric" | "tel" | "email" | "decimal" | "search";
    maxLength?: number;
    className?: string;
    /** Server-side error for this field. */
    error?: string;
    /** Disable the completion tick (e.g. on a field with no required state). */
    showTick?: boolean;
}

export function FormField({
    name,
    label,
    type = "text",
    required,
    defaultValue,
    placeholder,
    autoComplete,
    inputMode,
    maxLength,
    className,
    error,
    showTick = true,
}: FormFieldProps) {
    const generatedId = useId();
    const inputId = `field-${name}-${generatedId}`;
    const [value, setValue] = useState(defaultValue == null ? "" : String(defaultValue));

    const filled = value.trim().length > 0;
    const complete = required ? filled : filled && showTick;
    const showRequiredMark = Boolean(required) && !complete;

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 min-h-[16px]">
                <Label
                    htmlFor={inputId}
                    className="text-xs font-bold uppercase text-slate-600 tracking-[0.1em] ml-1 dark:text-slate-300"
                >
                    {label}
                    {showRequiredMark && (
                        <span className="text-rose-500 ml-0.5" aria-hidden="true">
                            *
                        </span>
                    )}
                </Label>

                {showTick && complete && (
                    <span
                        aria-hidden="true"
                        title={required ? "Completed" : "Filled"}
                        className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-white shadow-sm shrink-0"
                    >
                        <Check className="h-2.5 w-2.5" strokeWidth={4} />
                    </span>
                )}
            </div>

            <Input
                id={inputId}
                name={name}
                type={type}
                required={required}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={placeholder}
                autoComplete={autoComplete}
                inputMode={inputMode}
                maxLength={maxLength}
                aria-invalid={error ? "true" : undefined}
                aria-describedby={error ? `${inputId}-error` : undefined}
                className={cn(
                    "h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold",
                    complete && showTick && "border-emerald-300 dark:border-emerald-800",
                    error && "border-rose-400 dark:border-rose-500 focus-visible:ring-rose-500",
                    className
                )}
            />

            <FieldError id={inputId} error={error} />
        </div>
    );
}
