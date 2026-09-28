import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shared page hero.
 *
 * Every module previously hand-rolled the same dark gradient banner, and every
 * one of them was too tall: `p-8 md:p-12`, a `text-4xl md:text-6xl` heading
 * and a 500px blur orb. On a laptop that pushed the actual content below the
 * fold, so the first thing a user saw was decoration.
 *
 * This component makes the banner compact by default and identical across
 * pages, so the content starts higher on every screen. `eyebrow`, `title` and
 * `accent` compose a two-tone heading, which is what the originals did with a
 * `<br />` between spans.
 */
export function PageHero({
    eyebrow,
    eyebrowIcon: EyebrowIcon,
    title,
    accent,
    description,
    actions,
    /** `compact` (default) trims vertical padding and type size. */
    size = "compact",
    /** Accent colour for the gradient orb and highlighted text. */
    tone = "indigo",
    className,
}: {
    eyebrow: string;
    eyebrowIcon?: LucideIcon;
    /** First line of the heading. */
    title: string;
    /** Second line, rendered in the accent gradient. */
    accent?: string;
    description?: string;
    actions?: ReactNode;
    size?: "compact" | "regular";
    tone?: "indigo" | "rose";
    className?: string;
}) {
    const compact = size === "compact";

    const orbTone =
        tone === "rose"
            ? "bg-rose-500/10"
            : "bg-indigo-500/10";
    const secondOrbTone =
        tone === "rose"
            ? "bg-orange-500/10"
            : "bg-violet-500/10";
    const accentText =
        tone === "rose"
            ? "from-rose-400 to-orange-400"
            : "from-indigo-400 to-violet-400";

    return (
        <div
            className={cn(
                "relative overflow-hidden bg-gradient-to-br from-indigo-900 via-indigo-950 to-slate-900 rounded-3xl shadow-xl",
                compact ? "p-5 sm:p-6" : "p-8 md:p-12",
                "rounded-[2rem] sm:rounded-[2rem]",
                className
            )}
        >
            {/* Decorative orbs. Sized and offset so they cannot widen the box —
                a fixed 500px element inside a rounded banner was part of the
                original horizontal-overflow problem. */}
            <div
                aria-hidden="true"
                className={cn(
                    "pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full blur-3xl",
                    orbTone
                )}
            />
            <div
                aria-hidden="true"
                className={cn(
                    "pointer-events-none absolute -bottom-24 -left-24 h-56 w-56 rounded-full blur-3xl",
                    secondOrbTone
                )}
            />

            <div className="relative z-10 flex min-w-0 flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                    <div
                        className={cn(
                            "inline-flex items-center gap-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/10 text-indigo-200 text-[10px] font-bold uppercase tracking-widest",
                            compact ? "mb-2 px-2.5 py-0.5" : "mb-6 px-3 py-1 text-xs"
                        )}
                    >
                        {EyebrowIcon && <EyebrowIcon className="h-3 w-3" aria-hidden="true" />}
                        {eyebrow}
                    </div>

                    <h1
                        className={cn(
                            "font-black tracking-tight text-white leading-[1.1]",
                            compact
                                ? "text-2xl sm:text-3xl lg:text-4xl mb-1.5"
                                : "text-4xl md:text-6xl mb-4"
                        )}
                    >
                        {title}
                        {accent && (
                            <>
                                <br />
                                <span
                                    className={cn(
                                        "text-transparent bg-clip-text bg-gradient-to-r",
                                        accentText
                                    )}
                                >
                                    {accent}
                                </span>
                            </>
                        )}
                    </h1>

                    {description && (
                        <p
                            className={cn(
                                "text-slate-300 font-medium leading-relaxed max-w-2xl",
                                compact ? "text-xs sm:text-sm" : "text-base"
                            )}
                        >
                            {description}
                        </p>
                    )}
                </div>

                {actions && (
                    <div className="flex shrink-0 flex-col sm:flex-row gap-2 w-full md:w-auto">
                        {actions}
                    </div>
                )}
            </div>
        </div>
    );
}
