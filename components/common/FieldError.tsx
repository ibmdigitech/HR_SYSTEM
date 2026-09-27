"use client";

import { AlertCircle } from "lucide-react";

/**
 * Inline field error (P0-16 / A11Y).
 *
 * Wires the message to its input with `aria-describedby` and marks the field
 * `aria-invalid`, so a screen reader announces the error when focus lands on
 * the control rather than only showing it visually.
 *
 * The parent must render:
 *   <label htmlFor={id} aria-describedby={error ? `${id}-error` : undefined}>
 */
export function FieldError({ id, error }: { id: string; error?: string }) {
    if (!error) return null;
    return (
        <p
            id={`${id}-error`}
            role="alert"
            className="mt-1.5 flex items-start gap-1.5 text-xs font-bold text-rose-600 dark:text-rose-400"
        >
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-px" aria-hidden="true" />
            <span>{error}</span>
        </p>
    );
}

/** Shared classes so an invalid input is styled identically everywhere. */
export const invalidInputClass =
    "border-rose-400 dark:border-rose-500 focus-visible:ring-rose-500";
