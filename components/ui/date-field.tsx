"use client";

import * as React from "react";
import { format, isValid, parse } from "date-fns";
import {
    Calendar as CalendarIcon,
    X,
    CheckCircle2,
    AlertTriangle,
    Clock,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FieldError } from "@/components/common/FieldError";

/**
 * Date field — the employee form's date editing area.
 *
 * REPLACES the previous picker, which had five problems this addresses:
 *
 *  1. Typing was impossible. HR staff transcribing from a passport or visa
 *     physically in front of them had to use the calendar widget alone.
 *  2. A date could be set but never cleared, so a typo on an optional expiry
 *     was permanent.
 *  3. No bounds. A future joining date or a past visa expiry was selectable,
 *     and only the server rejected it — after the user had filled everything in.
 *  4. No context. "2027-03-14" tells HR nothing; "expires in 4 months" does.
 *  5. The popover had no mobile treatment and could overflow a narrow viewport.
 *
 * The value contract is unchanged — a hidden input named `name` carrying
 * `yyyy-MM-dd` — so the server action and its validation are untouched.
 */

export type DateFieldStatus = "neutral" | "upcoming" | "expiring" | "expired";

export interface DateFieldProps {
    name: string;
    label: string;
    /** Controlled value, `yyyy-MM-dd` or a Date. */
    defaultValue?: string | Date | null;
    required?: boolean;
    disabled?: boolean;
    /** Hint under the field, e.g. "Must be in the future". */
    hint?: string;
    /** Earliest selectable date (e.g. an expiry must be today or later). */
    minDate?: Date;
    /** Latest selectable date (e.g. a joining date cannot be in the future). */
    maxDate?: Date;
    /**
     * Treats the value as a document expiry and shows relative status, colouring
     * the field as it approaches.
     */
    expiry?: boolean;
    /** Server-side field error key, wired to `fieldErrors[name]`. */
    error?: string;
    className?: string;
}

/** ISO `yyyy-MM-dd`, the format the form submits. */
function toIso(value: Date | string | null | undefined): string {
    if (!value) return "";
    if (typeof value === "string") {
        const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
        if (dateOnly) {
            const [, year, month, day] = dateOnly;
            const local = new Date(Number(year), Number(month) - 1, Number(day));
            return local.getFullYear() === Number(year)
                && local.getMonth() === Number(month) - 1
                && local.getDate() === Number(day)
                ? value
                : "";
        }
        // Accept a full ISO timestamp from the database.
        const d = new Date(value);
        return isValid(d) ? format(d, "yyyy-MM-dd") : "";
    }
    return isValid(value) ? format(value, "yyyy-MM-dd") : "";
}

function fromIso(iso: string): Date | undefined {
    if (!iso) return undefined;
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (dateOnly) {
        const [, year, month, day] = dateOnly;
        const local = new Date(Number(year), Number(month) - 1, Number(day));
        return local.getFullYear() === Number(year)
            && local.getMonth() === Number(month) - 1
            && local.getDate() === Number(day)
            ? local
            : undefined;
    }
    const d = new Date(iso);
    return isValid(d) ? d : undefined;
}

/** Days from today to `date`; negative once the date has passed. */
function daysUntil(date: Date, today: Date): number {
    const a = new Date(date);
    a.setHours(0, 0, 0, 0);
    const b = new Date(today);
    b.setHours(0, 0, 0, 0);
    return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

function relativeLabel(days: number): { text: string; status: DateFieldStatus } {
    if (days < 0) {
        const past = Math.abs(days);
        return {
            text: past === 1 ? "Expired yesterday" : `Expired ${past} days ago`,
            status: "expired",
        };
    }
    if (days === 0) return { text: "Expires today", status: "expired" };
    if (days <= 30) return { text: `Expires in ${days} day${days === 1 ? "" : "s"}`, status: "expiring" };
    if (days <= 90) return { text: `Expires in ${days} days`, status: "expiring" };
    const months = Math.round(days / 30);
    const years = Math.floor(days / 365);
    if (years >= 1) {
        const rem = Math.round((days - years * 365) / 30);
        return {
            text: rem > 0 ? `Expires in ${years}y ${rem}m` : `Expires in ${years} year${years === 1 ? "" : "s"}`,
            status: "upcoming",
        };
    }
    return { text: `Expires in ${months} month${months === 1 ? "" : "s"}`, status: "upcoming" };
}

/**
 * Accepts the formats HR actually types or sees printed on documents.
 * Ambiguous input is rejected rather than guessed, because silently reading
 * 03/04 as March instead of April would corrupt a compliance record.
 */
function parseTyped(raw: string): { date?: Date; error?: string } {
    const value = raw.trim();
    if (!value) return {};

    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const d = fromIso(value);
        return d && format(d, "yyyy-MM-dd") === value ? { date: d } : { error: "Not a real date" };
    }

    if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
        const [d, m, y] = value.split("/");
        const parsed = parse(`${y}-${m}-${d}`, "yyyy-MM-dd", new Date());
        return isValid(parsed) && format(parsed, "dd/MM/yyyy") === value
            ? { date: parsed }
            : { error: "Use DD/MM/YYYY" };
    }

    // Written out, e.g. "14 Mar 2027".
    const written = parse(value, "d MMM yyyy", new Date());
    if (isValid(written)) return { date: written };
    const writtenLong = parse(value, "d MMMM yyyy", new Date());
    if (isValid(writtenLong)) return { date: writtenLong };

    return { error: "Use YYYY-MM-DD or DD/MM/YYYY" };
}

const STATUS_RING: Record<DateFieldStatus, string> = {
    neutral: "",
    upcoming: "border-emerald-300 dark:border-emerald-800",
    expiring: "border-amber-400 dark:border-amber-600",
    expired: "border-rose-500 dark:border-rose-500",
};

const STATUS_TEXT: Record<Exclude<DateFieldStatus, "neutral">, string> = {
    upcoming: "text-emerald-600 dark:text-emerald-400",
    expiring: "text-amber-600 dark:text-amber-400",
    expired: "text-rose-600 dark:text-rose-400",
};

export function DateField({
    name,
    label,
    defaultValue,
    required,
    disabled,
    hint,
    minDate,
    maxDate,
    expiry = false,
    error,
    className,
}: DateFieldProps) {
    const initial = toIso(defaultValue);
    const [iso, setIso] = React.useState(initial);
    const [text, setText] = React.useState(initial ? format(fromIso(initial)!, "dd/MM/yyyy") : "");
    const [open, setOpen] = React.useState(false);
    const [parseError, setParseError] = React.useState<string | null>(null);
    const inputId = `date-${name}`;

    // Sync when the form re-targets a different employee.
    React.useEffect(() => {
        setIso(initial);
        setText(initial ? format(fromIso(initial)!, "dd/MM/yyyy") : "");
        setParseError(null);
    }, [initial]);

    const selected = fromIso(iso);
    const today = React.useMemo(() => new Date(), []);

    const days = selected ? daysUntil(selected, today) : null;
    const relative = expiry && days !== null ? relativeLabel(days) : null;
    const status: DateFieldStatus = relative ? relative.status : "neutral";

    const commit = (d: Date | undefined) => {
        const next = d ? toIso(d) : "";
        setIso(next);
        setText(d ? format(d, "dd/MM/yyyy") : "");
        setParseError(null);
        setOpen(false);
    };

    const onType = (raw: string) => {
        setText(raw);
        if (!raw.trim()) {
            setIso("");
            setParseError(null);
            return;
        }
        const { date, error } = parseTyped(raw);
        if (error) {
            setParseError(error);
            return;
        }
        // Bounds are enforced on commit so the user is not blocked mid-edit.
        if (date && minDate && date < minDate) {
            setParseError("Must be today or later");
            return;
        }
        if (date && maxDate && date > maxDate) {
            setParseError("Cannot be in the future");
            return;
        }
        setIso(toIso(date));
        setParseError(null);
    };

    const disabledMatcher = React.useCallback(
        (day: Date) => {
            if (minDate && day < minDate) return true;
            if (maxDate && day > maxDate) return true;
            return false;
        },
        [minDate, maxDate]
    );

    const showError = Boolean(error || parseError);

    return (
        <div className={cn("space-y-2", className)}>
            <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor={inputId} className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">
                    {label}
                    {required && (
                        <span className="text-rose-500 ml-0.5" aria-hidden="true">
                            *
                        </span>
                    )}
                </Label>
                {relative && (
                    <span className={cn("text-[10px] font-bold flex items-center gap-1", STATUS_TEXT[relative.status as Exclude<DateFieldStatus, "neutral">])}>
                        {relative.status === "expired" ? (
                            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                        ) : relative.status === "expiring" ? (
                            <Clock className="h-3 w-3" aria-hidden="true" />
                        ) : (
                            <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                        )}
                        {relative.text}
                    </span>
                )}
            </div>

            {/* Submitted value. Kept as a hidden input so the server action and
                its zod schema are unchanged. */}
            <input type="hidden" name={name} value={iso} required={required} />

            <div className="flex gap-2">
                <div className="relative flex-1">
                    <Input
                        id={inputId}
                        value={text}
                        onChange={(e) => onType(e.target.value)}
                        onBlur={() => {
                            // Normalise whatever was typed into a clean label.
                            const d = fromIso(iso);
                            setText(d ? format(d, "dd/MM/yyyy") : "");
                            setParseError(null);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                const d = fromIso(iso);
                                if (d) commit(d);
                            }
                            if (e.key === "Escape") setOpen(false);
                        }}
                        disabled={disabled}
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder="DD/MM/YYYY"
                        aria-invalid={showError || undefined}
                        aria-describedby={showError ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
                        className={cn(
                            "h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold pr-9",
                            STATUS_RING[status],
                            showError && "border-rose-400 dark:border-rose-500 focus-visible:ring-rose-500"
                        )}
                    />
                    {iso && !disabled && (
                        <button
                            type="button"
                            onClick={() => commit(undefined)}
                            aria-label={`Clear ${label}`}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 h-7 w-7 inline-flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition-colors"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    )}
                </div>

                <Popover open={open} onOpenChange={setOpen}>
                    <PopoverTrigger asChild>
                        <Button
                            type="button"
                            variant="outline"
                            disabled={disabled}
                            aria-label={`Open calendar for ${label}`}
                            className={cn(
                                "h-12 w-12 shrink-0 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800",
                                STATUS_RING[status]
                            )}
                        >
                            <CalendarIcon className="h-4 w-4 text-slate-500" />
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent
                        // Full width on a phone so the calendar never overflows.
                        className="w-[--radix-popover-trigger-width] min-w-[19rem] max-w-full p-0 rounded-xl"
                        align="end"
                        sideOffset={6}
                    >
                        <Calendar
                            mode="single"
                            selected={selected}
                            onSelect={commit}
                            disabled={disabledMatcher}
                            initialFocus
                        />
                    </PopoverContent>
                </Popover>
            </div>

            {showError ? (
                <FieldError id={inputId} error={error ?? parseError ?? undefined} />
            ) : hint ? (
                <p id={`${inputId}-hint`} className="text-[10px] text-slate-400 ml-1">
                    {hint}
                </p>
            ) : null}
        </div>
    );
}
