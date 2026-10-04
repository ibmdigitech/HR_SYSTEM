"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Check, X, Loader2, CalendarDays } from "lucide-react";
import { updateDocumentExpiry } from "@/app/lib/actions/visa-compliance";

/**
 * One document cell in the compliance directory, editable in place.
 *
 * INTERACTION — "click, get a space to adjust, save"
 *
 * Idle:   the value, plus a faint dotted rule and a pencil that fade in on
 *         hover, so the cell advertises that it is editable without every row
 *         looking like a form.
 * Active: the cell expands into a bordered, tinted "section" with a date input
 *         and Save/Cancel. The section styling is the point — while open it must
 *         read as one distinct unit against the grid, not as two loose inputs
 *         floating in a cell.
 *
 * Escape cancels, Enter saves, and focus moves into the input on open so the
 * keyboard path needs no extra clicks.
 */
export function DocumentCellEditor({
    employeeId,
    documentType,
    label,
    number,
    expiry,
    status,
    canEdit,
}: {
    employeeId: string;
    documentType: string;
    label: string;
    number?: string | null;
    expiry: Date | string | null;
    status: { label: string; color: string };
    canEdit: boolean;
}) {
    const router = useRouter();
    const [editing, setEditing] = useState(false);
    const [draftExpiry, setDraftExpiry] = useState("");
    const [draftNumber, setDraftNumber] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (editing) inputRef.current?.focus();
    }, [editing]);

    // `yyyy-mm-dd` for <input type="date">. Built from local parts, NOT
    // toISOString(), which would shift the day by a timezone offset and silently
    // save the expiry one day early or late.
    const toInputValue = (v: Date | string | null): string => {
        if (!v) return "";
        const d = v instanceof Date ? v : new Date(v);
        if (isNaN(d.getTime())) return "";
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${d.getFullYear()}-${m}-${day}`;
    };

    const currentExpiry = toInputValue(expiry);

    function open() {
        if (!canEdit) return;
        setDraftExpiry(currentExpiry);
        setDraftNumber(number ?? "");
        setError(null);
        setEditing(true);
    }

    function cancel() {
        setEditing(false);
        setError(null);
    }

    function save() {
        setError(null);
        startTransition(async () => {
            const res = await updateDocumentExpiry({
                employeeId,
                documentType,
                expiry: draftExpiry,
                number: documentType === "MEDICAL_INSURANCE" || documentType === "ILOE_INSURANCE"
                    ? undefined
                    : draftNumber,
            });
            if (!res.success) {
                setError(res.message);
                return;
            }
            setEditing(false);
            router.refresh();
        });
    }

    if (editing) {
        return (
            <div className="rounded-lg border-2 border-indigo-400 dark:border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/30 p-2 -m-2 shadow-sm space-y-1.5">
                <div className="flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-indigo-600 dark:text-indigo-300">
                    <CalendarDays className="h-2.5 w-2.5" />
                    {label}
                </div>
                <input
                    ref={inputRef}
                    type="date"
                    value={draftExpiry}
                    onChange={(e) => setDraftExpiry(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Escape") cancel();
                        if (e.key === "Enter") save();
                    }}
                    className="w-full rounded border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-slate-950 px-1.5 py-1 text-[11px] font-semibold tabular-nums outline-none focus:ring-2 focus:ring-indigo-500"
                    aria-label={`${label} expiry date`}
                />
                {documentType !== "MEDICAL_INSURANCE" && documentType !== "ILOE_INSURANCE" && (
                    <input
                        type="text"
                        value={draftNumber}
                        onChange={(e) => setDraftNumber(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Escape") cancel();
                            if (e.key === "Enter") save();
                        }}
                        placeholder="Document no."
                        className="w-full rounded border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-slate-950 px-1.5 py-1 text-[11px] font-mono outline-none focus:ring-2 focus:ring-indigo-500"
                        aria-label={`${label} document number`}
                    />
                )}
                {error && <p className="text-[9px] font-bold text-rose-600">{error}</p>}
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={save}
                        disabled={isPending}
                        className="inline-flex items-center gap-1 rounded bg-indigo-600 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                        {isPending ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Check className="h-2.5 w-2.5" />}
                        Save
                    </button>
                    <button
                        type="button"
                        onClick={cancel}
                        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold text-slate-500 hover:bg-slate-200/70 dark:hover:bg-slate-700/60"
                    >
                        <X className="h-2.5 w-2.5" />
                        Cancel
                    </button>
                </div>
            </div>
        );
    }

    const formatted = expiry
        ? new Date(expiry).toLocaleDateString("en-GB", {
              day: "2-digit",
              month: "short",
              year: "2-digit",
          })
        : null;

    return (
        <button
            type="button"
            onClick={open}
            disabled={!canEdit}
            title={canEdit ? `Edit ${label}` : `${label} — requires visa management permission`}
            className={`group/cell relative w-full rounded px-1 py-0.5 -mx-1 text-left transition-colors ${
                canEdit
                    ? "cursor-pointer hover:bg-indigo-50/80 dark:hover:bg-indigo-950/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    : "cursor-default"
            }`}
        >
            {!expiry ? (
                <span className="text-[11px] text-slate-300 dark:text-slate-600 leading-none">—</span>
            ) : (
                <span className="flex flex-col gap-0.5">
                    {number && (
                        <span className="font-mono text-[10px] font-bold text-slate-700 dark:text-slate-200 leading-none truncate">
                            {number}
                        </span>
                    )}
                    <span className="flex items-center gap-1 whitespace-nowrap">
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium tabular-nums">
                            {formatted}
                        </span>
                        <span
                            className={`px-1 py-px rounded text-[8px] font-black uppercase leading-none ${status.color}`}
                        >
                            {status.label}
                        </span>
                    </span>
                </span>
            )}

            {/* The edit affordance only appears on hover, so the grid stays calm
                until the pointer is actually over a cell. */}
            <Pencil className="absolute right-0 top-0 h-2.5 w-2.5 text-indigo-500 opacity-0 transition-opacity group-hover/cell:opacity-100" />
        </button>
    );
}