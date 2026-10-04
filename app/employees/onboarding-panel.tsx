"use client";

import * as React from "react";
import {
    Check,
    Circle,
    Loader2,
    FileCheck2,
    ShieldCheck,
    Package,
    BellRing,
    PartyPopper,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { FieldError } from "@/components/common/FieldError";
import { TableSkeleton } from "@/components/common/Skeletons";
import {
    advanceOnboardingItem,
    alertManagerOfHire,
    initialiseOnboardingChecklist,
    issueAssets,
    loadOnboardingSummary,
} from "@/app/lib/actions/onboarding";

/**
 * Employee onboarding panel (P1.1).
 *
 * Implements the audit findings for `/employees` that were still open:
 *   UI_UX_AUDIT  "No client-side validation feedback"   -> per-item inline errors
 *   UI_UX_AUDIT  "No loading skeleton"                   -> TableSkeleton while loading
 *   UI_UX_AUDIT  "No empty state"                       -> explicit empty state
 *   PAGE-006/007 (fixed earlier)                        -> mobile-safe dialog
 *
 * Covers FLOW-004 … FLOW-007. The employee record itself is created by the
 * existing `upsertEmployee` action; this panel continues the process after the
 * record exists.
 */

type ItemStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "WAIVED" | "BLOCKED";

interface ChecklistItem {
    id: string;
    category: string;
    label: string;
    required: boolean;
    status: ItemStatus;
    documentRef: string | null;
    notes: string | null;
}

interface AvailableAsset {
    id: string;
    assetTag: string;
    name: string;
    category: string | null;
}

interface Summary {
    items: ChecklistItem[];
    progress: { total: number; completed: number; requiredOutstanding: number; percent: number; ready: boolean };
    availableAssets: AvailableAsset[];
    employee: { id: string; firstName: string; lastName: string; employeeCode: string; department: string | null } | null;
}

const CATEGORY_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
    OFFER_LETTER: FileCheck2,
    APPOINTMENT_LETTER: FileCheck2,
    PASSPORT: ShieldCheck,
    EMIRATES_ID: ShieldCheck,
    VISA: ShieldCheck,
    MEDICAL_INSURANCE: ShieldCheck,
    ILOE_INSURANCE: ShieldCheck,
    EQUIPMENT: Package,
    ACCESS: ShieldCheck,
};

const STATUS_STYLE: Record<ItemStatus, string> = {
    PENDING: "bg-slate-100 text-slate-500 dark:bg-slate-900 dark:text-slate-400",
    IN_PROGRESS: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    COMPLETED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    WAIVED: "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
    BLOCKED: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
};

const DOCUMENT_CATEGORIES = new Set([
    "PASSPORT",
    "EMIRATES_ID",
    "VISA",
    "MEDICAL_INSURANCE",
    "ILOE_INSURANCE",
    "OFFER_LETTER",
    "APPOINTMENT_LETTER",
]);

export default function OnboardingPanel({
    employeeId,
    onClose,
}: {
    employeeId: string;
    onClose: () => void;
}) {
    const [summary, setSummary] = React.useState<Summary | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [busyItem, setBusyItem] = React.useState<string | null>(null);
    const [itemErrors, setItemErrors] = React.useState<Record<string, string>>({});
    const [docRefs, setDocRefs] = React.useState<Record<string, string>>({});
    const [selectedAssets, setSelectedAssets] = React.useState<string[]>([]);
    const [assetsOpen, setAssetsOpen] = React.useState(false);
    const [banner, setBanner] = React.useState<{ kind: "ok" | "err"; text: string } | null>(null);

    const load = React.useCallback(async () => {
        setLoading(true);
        try {
            const data = await loadOnboardingSummary(employeeId);
            if (data) setSummary(data as Summary);
        } catch (error) {
            console.error("onboarding load failed", error);
            setBanner({ kind: "err", text: "Could not load the onboarding record." });
        } finally {
            setLoading(false);
        }
    }, [employeeId]);

    React.useEffect(() => {
        load();
    }, [load]);

    async function initialise() {
        setBanner(null);
        const res = await initialiseOnboardingChecklist(employeeId);
        setBanner({ kind: res.success ? "ok" : "err", text: res.message });
        if (res.success) await load();
    }

    async function advance(item: ChecklistItem, to: ItemStatus) {
        setBusyItem(item.id);
        setItemErrors((e) => ({ ...e, [item.id]: "" }));

        const needsDoc = to === "COMPLETED" && DOCUMENT_CATEGORIES.has(item.category);
        const ref = docRefs[item.id]?.trim() || item.documentRef || "";

        if (needsDoc && !ref) {
            setItemErrors((e) => ({
                ...e,
                [item.id]: "Attach a document reference (file name or reference number) to complete this.",
            }));
            setBusyItem(null);
            return;
        }

        const res = await advanceOnboardingItem({ itemId: item.id, to, documentRef: ref || undefined });
        if (!res.success) {
            setItemErrors((e) => ({ ...e, [item.id]: res.message }));
        } else {
            setBanner({ kind: "ok", text: res.message });
        }
        setBusyItem(null);
        await load();
    }

    async function assign() {
        if (selectedAssets.length === 0) return;
        const res = await issueAssets({ employeeId, assetIds: selectedAssets });
        setBanner({ kind: res.success ? "ok" : "err", text: res.message });
        if (res.success) {
            setSelectedAssets([]);
            setAssetsOpen(false);
            await load();
        }
    }

    async function notifyManager() {
        const res = await alertManagerOfHire(employeeId);
        setBanner({ kind: res.success ? "ok" : "err", text: res.message });
    }

    // Audit: "No loading skeleton for table rows" -> a real skeleton, not a spinner.
    if (loading) {
        return (
            <div className="p-6 space-y-6">
                <div className="h-8 w-56 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
                <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 animate-pulse" />
                <TableSkeleton rows={5} />
            </div>
        );
    }

    const progress = summary?.progress;
    const empty = !summary || summary.items.length === 0;

    return (
        <div className="flex h-full min-h-0 flex-col">
            <DialogHeader className="shrink-0 p-6 pb-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
                <DialogTitle className="flex items-center gap-2 text-lg font-black tracking-tight">
                    <PartyPopper className="h-5 w-5 text-indigo-600" />
                    Onboarding
                </DialogTitle>
                <DialogDescription className="text-xs">
                    {summary?.employee
                        ? `${summary.employee.firstName} ${summary.employee.lastName} · ${summary.employee.employeeCode} · ${summary.employee.department ?? "Unassigned"}`
                        : "Track document collection, equipment and access provisioning."}
                </DialogDescription>
            </DialogHeader>

            <ScrollArea className="flex-1 min-h-0 px-6 py-5">
                <ScrollBar className="w-2.5 bg-slate-200/60 dark:bg-slate-700/60" />

                {banner && (
                    <div
                        role="status"
                        className={cn(
                            "mb-4 rounded-xl px-4 py-3 text-xs font-bold",
                            banner.kind === "ok"
                                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                                : "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
                        )}
                    >
                        {banner.text}
                    </div>
                )}

                {progress && progress.total > 0 && (
                    <div className="mb-5 space-y-2">
                        <div className="flex items-center justify-between text-xs font-black uppercase tracking-widest">
                            <span className="text-slate-500">Progress</span>
                            <span className="text-slate-700 dark:text-slate-300">
                                {progress.completed}/{progress.total} · {progress.percent}%
                            </span>
                        </div>
                        <Progress value={progress.percent} className="h-2" />
                        {progress.requiredOutstanding > 0 ? (
                            <p className="text-[11px] font-bold text-amber-600 dark:text-amber-400">
                                {progress.requiredOutstanding} required item(s) outstanding
                            </p>
                        ) : (
                            <p className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                                All required items complete
                            </p>
                        )}
                    </div>
                )}

                {/* Audit: "No empty state" — explicit, with the action to fix it. */}
                {empty ? (
                    <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 p-10 text-center space-y-4">
                        <Circle className="h-10 w-10 mx-auto text-slate-300 dark:text-slate-700" />
                        <div>
                            <p className="font-black text-slate-800 dark:text-white">No checklist yet</p>
                            <p className="text-xs text-slate-500 mt-1">
                                Create the document and provisioning checklist to start tracking this hire.
                            </p>
                        </div>
                        <Button onClick={initialise} className="rounded-xl font-black uppercase text-[10px] tracking-widest">
                            Create checklist
                        </Button>
                    </div>
                ) : (
                    <ul className="space-y-2.5">
                        {summary!.items.map((item) => {
                            const Icon = CATEGORY_ICON[item.category] ?? Circle;
                            const needsDoc = DOCUMENT_CATEGORIES.has(item.category);
                            const resolved = item.status === "COMPLETED" || item.status === "WAIVED";

                            return (
                                <li
                                    key={item.id}
                                    className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-4 transition-colors duration-150 hover:border-indigo-300 hover:bg-indigo-50/50 dark:hover:border-indigo-800 dark:hover:bg-indigo-950/30"
                                >
                                    <div className="flex items-start gap-3">
                                        <Icon className="h-4 w-4 mt-0.5 shrink-0 text-slate-400" />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center justify-between gap-2 flex-wrap">
                                                <p className="text-sm font-black text-slate-800 dark:text-white">
                                                    {item.label}
                                                    {item.required && (
                                                        <span className="text-rose-500 ml-0.5" aria-hidden="true">
                                                            *
                                                        </span>
                                                    )}
                                                </p>
                                                <Badge className={cn("text-[9px] font-black uppercase", STATUS_STYLE[item.status])}>
                                                    {item.status.replace(/_/g, " ")}
                                                </Badge>
                                            </div>

                                            {(needsDoc || item.documentRef) && (
                                                <div className="mt-2">
                                                    <Input
                                                        value={docRefs[item.id] ?? item.documentRef ?? ""}
                                                        onChange={(e) =>
                                                            setDocRefs((r) => ({ ...r, [item.id]: e.target.value }))
                                                        }
                                                        placeholder="Document reference (file name / number)"
                                                        aria-invalid={itemErrors[item.id] ? "true" : undefined}
                                                        className="h-9 text-xs bg-slate-50 dark:bg-slate-900"
                                                    />
                                                    <FieldError id={`onb-${item.id}`} error={itemErrors[item.id]} />
                                                </div>
                                            )}

                                            {!resolved && (
                                                <div className="mt-2.5 flex flex-wrap gap-2">
                                                    <Button
                                                        size="sm"
                                                        disabled={busyItem === item.id}
                                                        onClick={() => advance(item, "COMPLETED")}
                                                        className="h-8 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-[10px] font-black uppercase tracking-widest"
                                                    >
                                                        {busyItem === item.id ? (
                                                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                                        ) : (
                                                            <Check className="h-3 w-3 mr-1" />
                                                        )}
                                                        Complete
                                                    </Button>
                                                    {item.required && (
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            disabled={busyItem === item.id}
                                                            onClick={() => advance(item, "WAIVED")}
                                                            className="h-8 rounded-lg text-[10px] font-black uppercase tracking-widest"
                                                        >
                                                            Waive
                                                        </Button>
                                                    )}
                                                </div>
                                            )}

                                            {resolved && item.documentRef && (
                                                <p className="mt-1.5 text-[11px] text-slate-500">Ref: {item.documentRef}</p>
                                            )}
                                        </div>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </ScrollArea>

            {/* Actions */}
            <div className="shrink-0 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 p-4 space-y-3">
                {!empty && summary!.availableAssets.length > 0 && (
                    <div>
                        {!assetsOpen ? (
                            <Button
                                variant="outline"
                                onClick={() => setAssetsOpen(true)}
                                className="w-full h-10 rounded-xl text-[10px] font-black uppercase tracking-widest"
                            >
                                <Package className="h-3.5 w-3.5 mr-2" />
                                Issue equipment ({summary!.availableAssets.length} available)
                            </Button>
                        ) : (
                            <div className="space-y-2">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                                    Select property to issue
                                </p>
                                <div className="max-h-32 overflow-y-auto space-y-1">
                                    {summary!.availableAssets.map((a) => (
                                        <label key={a.id} className="flex items-center gap-2 text-xs cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={selectedAssets.includes(a.id)}
                                                onChange={(e) =>
                                                    setSelectedAssets((s) =>
                                                        e.target.checked ? [...s, a.id] : s.filter((x) => x !== a.id)
                                                    )
                                                }
                                            />
                                            <span className="font-mono text-[11px]">{a.assetTag}</span>
                                            <span className="text-slate-500">{a.name}</span>
                                        </label>
                                    ))}
                                </div>
                                <div className="flex gap-2">
                                    <Button
                                        onClick={assign}
                                        disabled={selectedAssets.length === 0}
                                        className="flex-1 h-9 rounded-lg text-[10px] font-black uppercase tracking-widest"
                                    >
                                        Assign {selectedAssets.length || ""}
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        onClick={() => setAssetsOpen(false)}
                                        className="h-9 rounded-lg text-[10px] font-black uppercase tracking-widest"
                                    >
                                        Cancel
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                <div className="flex gap-2">
                    <Button
                        variant="outline"
                        onClick={notifyManager}
                        className="flex-1 h-10 rounded-xl text-[10px] font-black uppercase tracking-widest"
                    >
                        <BellRing className="h-3.5 w-3.5 mr-2" />
                        Notify manager
                    </Button>
                    <Button onClick={onClose} className="flex-1 h-10 rounded-xl text-[10px] font-black uppercase tracking-widest">
                        Done
                    </Button>
                </div>
            </div>
        </div>
    );
}
