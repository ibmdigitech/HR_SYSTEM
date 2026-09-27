import { Inbox, SearchX, FolderOpen, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
    inbox: Inbox,
    search: SearchX,
    folder: FolderOpen,
    calendar: FolderOpen,
};

/**
 * Explicit empty state (P1 UI audit: "No empty state" was an open finding).
 *
 * An empty list must say WHY it is empty and what to do next — a blank region
 * reads as a broken screen. `variant` picks the icon; `action` is an optional
 * element (usually a link) rendered beneath the copy.
 */
export function EmptyState({
    title,
    description,
    variant = "inbox",
    action,
    className,
}: {
    title: string;
    description?: string;
    variant?: keyof typeof ICONS | string;
    action?: React.ReactNode;
    className?: string;
}) {
    const Icon = ICONS[variant] ?? Inbox;

    return (
        <div
            className={cn(
                "rounded-3xl border border-dashed border-slate-300 dark:border-slate-800 bg-white/50 dark:bg-slate-950/40 px-6 py-14 text-center",
                className
            )}
        >
            <div className="flex justify-center mb-4">
                <div className="p-3 rounded-2xl bg-slate-100 dark:bg-slate-900">
                    <Icon className="h-6 w-6 text-slate-400" aria-hidden="true" />
                </div>
            </div>
            <p className="text-sm font-black text-slate-800 dark:text-white">{title}</p>
            {description && (
                <p className="mt-1.5 text-xs text-slate-500 max-w-md mx-auto">{description}</p>
            )}
            {action && <div className="mt-5 flex justify-center">{action}</div>}
        </div>
    );
}
