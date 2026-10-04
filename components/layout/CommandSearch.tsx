"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2, CornerDownLeft, Layers, Compass } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { navPaletteEntries } from "@/components/layout/NavigationLinks";
import type { SearchGroup, SearchHit } from "@/app/api/search/route";

/** Matches the server's MIN_QUERY_LENGTH so the UI never queries a term it will reject. */
const MIN_QUERY_LENGTH = 2;
/** Keystrokes to wait after the last one before querying. */
const DEBOUNCE_MS = 250;

type Status = "idle" | "loading" | "ready" | "error";

interface CommandSearchProps {
    /** The signed-in role, used to hide nav destinations the caller cannot open. */
    role?: string | null;
    /** Focus the field on mount — the small-screen "tap the magnifier" path. */
    autoFocus?: boolean;
    /** Called when the palette should stand down, so the caller can collapse it. */
    onDismiss?: () => void;
}

/**
 * Header search.
 *
 * Replaces a decorative input that had no state and no handler. Behaviour:
 *  - Cmd/Ctrl + K focuses the field from anywhere.
 *  - Nav destinations are matched locally, against the SAME permission-filtered
 *    list the drawer renders (`navPaletteEntries`), so the two can never
 *    disagree and the palette never offers a link that 403s.
 *  - Everything else queries `/api/search`, which is permission- and
 *    scope-gated server-side.
 *  - Arrow keys move the active hit, Enter opens it, Escape closes the panel.
 *  - Results are flattened to a single list so one arrow key steps across group
 *    boundaries instead of trapping the user inside the first group.
 *
 * ── WHY NAVIGATION IS MATCHED ON THE CLIENT ────────────────────────────────────
 * The nav list is a static constant already in the bundle, so routing it
 * through the API would buy nothing and cost a round-trip on every keystroke —
 * and would put eighteen always-successful destinations behind the debounce,
 * so typing "pay" would show nothing for 250ms for a result the browser already
 * knows. The two halves stay visibly separate: "Navigation" is instant and
 * icon-led, record groups arrive from the route.
 *
 * ── WHY THERE IS A "Search all records" ROW ────────────────────────────────────
 * The route answers two questions. Every keystroke runs a four-domain fast
 * pass — people, leave, requests, recruitment — because those are what a
 * header search is for. Everything else (attendance, payroll, loans, letters,
 * visa, onboarding, notifications, configuration) is an EXTENDED pass that the
 * server refuses to run until it is asked, because fanning ~16 more statements
 * out on every character typed is a worse product than one that returns less.
 * The row below the results is that ask, and it is the only way to reach the
 * extended groups. Without it the coverage work would be invisible.
 */
export function CommandSearch({ role, autoFocus, onDismiss }: CommandSearchProps) {
    const router = useRouter();
    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const [term, setTerm] = useState("");
    const [status, setStatus] = useState<Status>("idle");
    const [recordGroups, setRecordGroups] = useState<SearchGroup[]>([]);
    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);
    // Server said there are domains the fast pass skipped.
    const [hasMore, setHasMore] = useState(false);
    /** The extended pass has already been folded into `recordGroups` for `term`. */
    const [extendedFor, setExtendedFor] = useState<string | null>(null);
    const [expanding, setExpanding] = useState(false);

    const listboxId = useId();

    const query = term.trim().toLowerCase();

    /**
     * Navigation matches on title and href, so "rec" finds Recruitment and
     * "/payroll" finds Payroll. Permission filtering happens inside
     * `navPaletteEntries`, which is the drawer list, not a copy of it.
     */
    const navEntries = useMemo(() => {
        if (query.length < MIN_QUERY_LENGTH) return [];
        return navPaletteEntries(role).filter(
            (entry) =>
                entry.title.toLowerCase().includes(query) ||
                entry.href.toLowerCase().includes(query)
        );
    }, [query, role]);

    const navHits = useMemo<SearchHit[]>(
        () => navEntries.map(({ id, title, subtitle, href }) => ({ id, title, subtitle, href })),
        [navEntries]
    );

    /** Icons are kept off the `SearchHit` shape, which is the route's contract. */
    const navIcons = useMemo(
        () => new Map(navEntries.map((entry) => [entry.href, entry.icon] as const)),
        [navEntries]
    );

    /** Navigation leads: it is instant, free and always relevant to the query. */
    const groups = useMemo<SearchGroup[]>(
        () =>
            navHits.length
                ? [{ key: "navigation", label: "Navigation", hits: navHits }, ...recordGroups]
                : recordGroups,
        [navHits, recordGroups]
    );

    const flatHits = useMemo(() => groups.flatMap((group) => group.hits), [groups]);

    /**
     * Result count for the live region. Deliberately not a count of characters:
     * it is the number of things Enter can reach right now, which is the only
     * number a screen-reader user needs to decide whether to keep typing.
     */
    const announcement = useMemo(() => {
        if (query.length < MIN_QUERY_LENGTH) return "";
        if (status === "loading") return "Searching…";
        const total = flatHits.length;
        if (total === 0) return `No results for ${term.trim()}`;
        const sections = groups.length;
        return `${total} result${total === 1 ? "" : "s"} in ${sections} section${sections === 1 ? "" : "s"}`;
    }, [groups, flatHits.length, query, status, term]);

    /**
     * The action row is addressed as the flat index one past the last hit, so
     * it is reachable with the same arrow keys and lives in the same a11y
     * ordering as the results rather than being a click-only affordance.
     */
    const actionIndex = flatHits.length;
    const showAction = hasMore && extendedFor !== term.trim() && status === "ready";
    const activeIsAction = showAction && activeIndex === actionIndex;
    const lastNavigable = showAction ? actionIndex : flatHits.length - 1;

    // Reset the cursor whenever the result set changes, otherwise Enter can
    // activate a stale index that no longer exists in the new list.
    useEffect(() => {
        setActiveIndex(0);
    }, [groups]);

    // A new term invalidates the extended results already on screen.
    useEffect(() => {
        setExtendedFor(null);
    }, [term]);

    // Debounced fetch of the fast pass. An in-flight request is discarded when
    // the term changes or the component unmounts, so a slow earlier response
    // cannot overwrite a newer one.
    useEffect(() => {
        const searchTerm = term.trim();
        if (searchTerm.length < MIN_QUERY_LENGTH) {
            setRecordGroups([]);
            setStatus("idle");
            setHasMore(false);
            return;
        }

        const controller = new AbortController();
        setStatus("loading");

        const timer = window.setTimeout(async () => {
            try {
                const response = await fetch(`/api/search?q=${encodeURIComponent(searchTerm)}`, {
                    signal: controller.signal,
                    headers: { Accept: "application/json" },
                });
                if (!response.ok) throw new Error(`Search failed (${response.status})`);
                const data = (await response.json()) as {
                    groups?: SearchGroup[];
                    hasMore?: boolean;
                };
                setRecordGroups(Array.isArray(data.groups) ? data.groups : []);
                setHasMore(data.hasMore === true);
                setStatus("ready");
            } catch (error) {
                if (controller.signal.aborted) return;
                console.error("command search failed", error);
                setRecordGroups([]);
                setHasMore(false);
                setStatus("error");
            }
        }, DEBOUNCE_MS);

        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [term]);

    /**
     * Deliberate second pass. Fired once per term: `extendedFor` guards it so
     * re-opening the panel, or re-activating the row, does not re-hit the
     * database. A failure degrades to the fast results already on screen.
     */
    const runExtendedSearch = useCallback(async () => {
        const searchTerm = term.trim();
        if (searchTerm.length < MIN_QUERY_LENGTH) return;
        setExpanding(true);
        try {
            const response = await fetch(
                `/api/search?q=${encodeURIComponent(searchTerm)}&scope=all`,
                { headers: { Accept: "application/json" } }
            );
            if (!response.ok) throw new Error(`Search failed (${response.status})`);
            const data = (await response.json()) as { groups?: SearchGroup[] };
            setRecordGroups(Array.isArray(data.groups) ? data.groups : []);
            setExtendedFor(searchTerm);
        } catch (error) {
            console.error("command search (all records) failed", error);
        } finally {
            setExpanding(false);
        }
    }, [term]);

    // Cmd/Ctrl + K focuses the field. The listener is on `document` because the
    // shortcut must work while focus is inside a table or dialog.
    useEffect(() => {
        function onKeyDown(event: KeyboardEvent) {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
                event.preventDefault();
                inputRef.current?.focus();
                inputRef.current?.select();
            }
        }
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, []);

    // Close on an outside click. `pointerdown` fires before blur, so the panel
    // does not flicker closed and immediately reopen.
    useEffect(() => {
        if (!open) return;
        function onPointerDown(event: PointerEvent) {
            if (!containerRef.current?.contains(event.target as Node)) {
                setOpen(false);
                onDismiss?.();
            }
        }
        document.addEventListener("pointerdown", onPointerDown);
        return () => document.removeEventListener("pointerdown", onPointerDown);
    }, [open, onDismiss]);

    // Keep the active row visible. With a dozen groups the list scrolls, and
    // arrow-key navigation must not walk the highlight off the bottom of it.
    useEffect(() => {
        if (!open || term.trim().length < MIN_QUERY_LENGTH) return;
        const node = document.getElementById(`${listboxId}-${activeIndex}`);
        node?.scrollIntoView({ block: "nearest" });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeIndex, groups]);

    const go = useCallback(
        (hit: SearchHit) => {
            setOpen(false);
            setTerm("");
            onDismiss?.();
            router.push(hit.href);
        },
        [onDismiss, router]
    );

    function move(delta: number) {
        setOpen(true);
        setActiveIndex((index) => {
            if (lastNavigable < 0) return 0;
            return (index + delta + lastNavigable + 1) % (lastNavigable + 1);
        });
    }

    function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
        if (event.key === "Escape") {
            setOpen(false);
            inputRef.current?.blur();
            onDismiss?.();
            return;
        }
        if (flatHits.length === 0 && !showAction) return;

        if (event.key === "ArrowDown") {
            event.preventDefault();
            move(1);
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            move(-1);
        } else if (event.key === "Enter") {
            event.preventDefault();
            if (activeIsAction) {
                void runExtendedSearch();
            } else {
                const hit = flatHits[activeIndex];
                if (hit) go(hit);
            }
        }
    }

    // Track which flat index each group starts at so the active highlight can
    // be compared without searching the array on every render.
    const groupOffsets = useMemo(() => {
        const offsets: number[] = [];
        let cursor = 0;
        for (const group of groups) {
            offsets.push(cursor);
            cursor += group.hits.length;
        }
        return offsets;
    }, [groups]);

    const showPanel = open && term.trim().length >= MIN_QUERY_LENGTH;

    return (
        <div ref={containerRef} className="group relative w-full min-w-0 max-w-md">
            <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-4 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-indigo-500"
            />
            <Input
                ref={inputRef}
                type="search"
                role="combobox"
                aria-expanded={showPanel}
                aria-controls={listboxId}
                aria-autocomplete="list"
                aria-activedescendant={
                    showPanel && (flatHits[activeIndex] || activeIsAction)
                        ? `${listboxId}-${activeIndex}`
                        : undefined
                }
                aria-label="Search navigation, people, leave, payroll, recruitment, letters and requests"
                placeholder="Quick search (⌘ + K)"
                title="Search — press ⌘K (Ctrl+K on Windows and Linux)"
                autoFocus={autoFocus}
                value={term}
                onChange={(event) => {
                    setTerm(event.target.value);
                    setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                onKeyDown={onKeyDown}
                className="h-11 rounded-2xl border-0 bg-slate-100/50 pl-12 pr-11 font-medium transition-all hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:bg-slate-900/50 dark:hover:bg-slate-900"
            />
            {(status === "loading" || expanding) && (
                <Loader2
                    aria-hidden="true"
                    className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400"
                />
            )}

            {/* Result counts, announced politely. `role="status"` already carries
                `aria-live="polite"`, and `sr-only` keeps it off the layout while
                the visible list below carries the same information visually. */}
            <p role="status" aria-live="polite" className="sr-only">
                {announcement}
            </p>

            {showPanel && (
                <div
                    className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-50 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950"
                    onKeyDown={(event) => {
                        // Keep arrows working once focus is inside the list.
                        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                            event.preventDefault();
                            event.stopPropagation();
                            move(event.key === "ArrowDown" ? 1 : -1);
                        }
                    }}
                >
                    <ul
                        id={listboxId}
                        role="listbox"
                        aria-label="Search results"
                        className="max-h-[26rem] overflow-y-auto overscroll-contain p-2"
                    >
                        {flatHits.length === 0 && status === "ready" && (
                            <li className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                                <Search aria-hidden="true" className="h-6 w-6 text-slate-300 dark:text-slate-700" />
                                <span className="text-sm font-bold text-slate-600 dark:text-slate-300">
                                    No results for “{term.trim()}”
                                </span>
                                <span className="text-xs text-slate-400">
                                    Try an employee name, a document reference or a page
                                    name.
                                </span>
                            </li>
                        )}
                        {flatHits.length === 0 && status === "error" && (
                            <li className="px-4 py-6 text-center text-sm text-rose-500">
                                Search is unavailable right now.
                            </li>
                        )}

                        {groups.map((group, groupIndex) => (
                            <li key={group.key} role="presentation">
                                <p className="sticky top-0 z-10 flex items-center gap-1.5 bg-white/95 px-3 pb-1 pt-3 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 backdrop-blur dark:bg-slate-950/95">
                                    {group.key === "navigation" && (
                                        <Compass
                                            aria-hidden="true"
                                            className="h-3 w-3 text-indigo-400"
                                        />
                                    )}
                                    {group.label}
                                </p>
                                <ul role="presentation">
                                    {group.hits.map((hit, hitIndex) => {
                                        const flatIndex = groupOffsets[groupIndex] + hitIndex;
                                        const isActive = flatIndex === activeIndex;
                                        const NavIcon = navIcons.get(hit.href);
                                        return (
                                            <li key={hit.id} role="presentation">
                                                <button
                                                    type="button"
                                                    id={`${listboxId}-${flatIndex}`}
                                                    role="option"
                                                    aria-selected={isActive}
                                                    onMouseEnter={() => setActiveIndex(flatIndex)}
                                                    onClick={() => go(hit)}
                                                    className={cn(
                                                        "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                                                        isActive
                                                            ? "bg-indigo-600 text-white"
                                                            : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900"
                                                    )}
                                                >
                                                    <span className="flex min-w-0 items-center gap-3">
                                                        {NavIcon && (
                                                            <NavIcon
                                                                aria-hidden="true"
                                                                className={cn(
                                                                    "h-4 w-4 shrink-0",
                                                                    isActive
                                                                        ? "text-white/90"
                                                                        : "text-indigo-500"
                                                                )}
                                                            />
                                                        )}
                                                        <span className="min-w-0">
                                                            <span className="block truncate text-sm font-bold">
                                                                {hit.title}
                                                            </span>
                                                            <span
                                                                className={cn(
                                                                    "block truncate text-xs",
                                                                    isActive
                                                                        ? "text-white/70"
                                                                        : "text-slate-500"
                                                                )}
                                                            >
                                                                {hit.subtitle}
                                                            </span>
                                                        </span>
                                                    </span>
                                                    {isActive && (
                                                        <CornerDownLeft
                                                            aria-hidden="true"
                                                            className="h-3.5 w-3.5 shrink-0 text-white/70"
                                                        />
                                                    )}
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </li>
                        ))}

                        {showAction && (
                            <li role="presentation" className="mt-1 border-t border-slate-200 dark:border-slate-800 pt-1">
                                <button
                                    type="button"
                                    id={`${listboxId}-${actionIndex}`}
                                    role="option"
                                    aria-selected={activeIsAction}
                                    disabled={expanding}
                                    onMouseEnter={() => setActiveIndex(actionIndex)}
                                    onClick={() => void runExtendedSearch()}
                                    className={cn(
                                        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors disabled:opacity-60",
                                        activeIsAction
                                            ? "bg-indigo-600 text-white"
                                            : "text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50"
                                    )}
                                >
                                    <Layers aria-hidden="true" className="h-4 w-4 shrink-0" />
                                                    <span className="min-w-0">
                                                        <span className="block truncate text-sm font-bold">
                                                            {expanding
                                                                ? "Searching all records…"
                                                                : "Search all records"}
                                                        </span>
                                                        <span
                                                            className={cn(
                                                                "block truncate text-xs",
                                                                activeIsAction
                                                                    ? "text-white/70"
                                                                    : "text-slate-500"
                                                            )}
                                                        >
                                                            Attendance, payroll, loans, letters, visa and
                                                            more
                                                        </span>
                                                    </span>
                                                </button>
                            </li>
                        )}
                    </ul>
                </div>
            )}
        </div>
    );
}
