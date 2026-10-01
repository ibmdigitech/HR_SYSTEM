/**
 * Regression guard: the transform leak between the shared dialog primitive and
 * the mobile navigation drawer.
 *
 * WHAT HAPPENED
 * -------------
 * `components/ui/dialog.tsx` centres every panel with the transform triple
 * `left-[50%] top-[50%] translate-x-[-50%] translate-y-[-50%]`. The drawer in
 * `components/layout/Header.tsx` overrode `left` with `left-0` (and `fixed`
 * with `absolute`) but never touched the companion `translate-*` classes.
 * Because `cn` is tailwind-merge, `left-0` won and `translate-x-[-50%]`
 * survived. The panel was therefore anchored at `left: 0` and then shifted
 * LEFT by half its own width: off-screen. `top-[50%]` plus `translate-y-[-50%]`
 * re-centred a `h-screen` panel, clipping it off the top and bottom.
 *
 * WHY THIS IS A SOURCE-LEVEL TEST, NOT A RENDER TEST
 * --------------------------------------------------
 * The drawer is a client component rendered through a Radix `DialogPortal`
 * into `document.body`; the vitest environment here is `node`, with no DOM and
 * no layout engine. Even in jsdom, jsdom computes no geometry — it would not
 * catch a misplaced panel, only the presence of a class name.
 *
 * So this suite pins the guarantee at the level where the bug actually lives:
 * it extracts the real base class string and the real caller class strings out
 * of the real source files, resolves them through the real `tailwind-merge`
 * exactly the way `cn` does at render time, and asserts on the RESULT. That is
 * strictly stronger than asserting the source contains a substring: if someone
 * changes the base, or the caller, or the merge semantics, these assertions
 * move with it.
 *
 * WHAT IS NOT PROVEN HERE
 * -----------------------
 * Nothing in this file proves the panel is *pixel* correct in a browser. Class
 * string reasoning is not the same as seeing it render: real verification of
 * the on-screen position still needs a real viewport at 375px.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { twMerge } from "tailwind-merge";

const ROOT = process.cwd();
const DIALOG = join(ROOT, "components", "ui", "dialog.tsx");
const HEADER = join(ROOT, "components", "layout", "Header.tsx");
const NAVIGATION = join(ROOT, "components", "layout", "NavigationLinks.tsx");

function read(file: string): string {
    return readFileSync(file, "utf8");
}

/** Every `className="..."` string passed to a `<DialogContent>` in a source file. */
function dialogContentClassNames(source: string): string[] {
    const out: string[] = [];
    const re = /<DialogContent\b[^>]*?className="([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) out.push(m[1]);
    return out;
}

/**
 * The class string the SHARED base contributes to every dialog. It lives on the
 * `DialogPrimitive.Content` element inside a `cn(...)` call, as a plain
 * double-quoted literal, so the first string literal on the line that carries
 * the centring `left-[50%]` is exactly it.
 */
function baseClassName(): string {
    const source = read(DIALOG);
    const line = source
        .split(/\r?\n/)
        .find((l) => l.includes('"fixed left-[50%]'));
    expect(line, "dialog.tsx no longer carries the centring base classes").toBeDefined();
    const match = (line as string).match(/"([^"]+)"/);
    expect(match, "could not extract the base class string").not.toBeNull();
    return (match as RegExpMatchArray)[1];
}

/** Reproduce render-time class resolution: `cn` is `twMerge(clsx(...))`. */
function resolve(callerClassName: string): string {
    return twMerge(baseClassName(), callerClassName);
}

function drawerClassName(): string {
    const names = dialogContentClassNames(read(HEADER));
    const drawer = names.find((c) => c.includes("max-w-[320px]"));
    expect(drawer, "could not find the mobile drawer DialogContent in Header.tsx").toBeDefined();
    return drawer as string;
}

/** Every `<DialogContent>` caller in the app, keyed by a readable label. */
function allCallers(): { label: string; className: string }[] {
    const out: { label: string; className: string }[] = [];
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
            if (entry === "node_modules" || entry.startsWith(".")) continue;
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) {
                walk(full);
                continue;
            }
            if (!full.endsWith(".tsx")) continue;
            for (const className of dialogContentClassNames(read(full))) {
                const rel = full.slice(ROOT.length + 1).replace(/\\/g, "/");
                out.push({ label: rel, className });
            }
        }
    };
    walk(join(ROOT, "app"));
    walk(join(ROOT, "components"));
    return out;
}

describe("mobile drawer — the base's centring transforms are fully reset", () => {
    it("does not inherit the base's centring translate (THE reported regression)", () => {
        const merged = resolve(drawerClassName());

        // These two are the bug. `left-0` alone is harmless; `left-0` plus an
        // inherited `translate-x-[-50%]` is what pushed the panel off-screen.
        expect(merged, "drawer still inherits the base's -50% X shift").not.toContain("translate-x-[-50%]");
        expect(merged, "drawer still inherits the base's -50% Y shift").not.toContain("translate-y-[-50%]");
    });

    it("is anchored to the left edge of the viewport, not centred", () => {
        const merged = resolve(drawerClassName());

        expect(merged).toContain("fixed");
        expect(merged).not.toContain("absolute");
        expect(merged).toContain("left-0");
        expect(merged).not.toContain("left-[50%]");
        expect(merged).not.toContain("top-[50%]");
        // Both resets present: `translate-y-0` matters while `inset-y-0` pins
        // the panel, and either one alone is a latent half-offset.
        expect(merged).toContain("translate-x-0");
        expect(merged).toContain("translate-y-0");
    });

    it("fills the dynamic viewport height without being re-centred", () => {
        const merged = resolve(drawerClassName());

        expect(merged).toContain("inset-y-0");
        expect(merged).toContain("h-[100dvh]");
        // The base's cap must be beaten, or the panel is 2rem short of the
        // viewport top and bottom.
        expect(merged).not.toContain("max-h-[calc(100dvh_-_2rem)]");
        expect(merged).toContain("max-h-[100dvh]");
    });

    it("declares both resets in the caller's own source", () => {
        const source = drawerClassName();

        expect(source).toMatch(/translate-x-0/);
        expect(source).toMatch(/translate-y-0/);
    });

    it("the PRE-FIX class string really did leak the transform (the guard has teeth)", () => {
        // If this ever stops producing a broken result, the assertions above
        // have gone vacuous and this file is no longer protecting anything.
        const preFix =
            "w-[85vw] max-w-[320px] h-screen max-h-screen p-0 m-0 border-0 rounded-none " +
            "sm:rounded-none absolute left-0 data-[state=closed]:slide-out-to-left " +
            "data-[state=open]:slide-in-from-left z-50 flex flex-col bg-slate-900 dark:bg-slate-950";

        const merged = twMerge(baseClassName(), preFix);

        expect(merged).toContain("translate-x-[-50%]");
        expect(merged).toContain("translate-y-[-50%]");
        expect(merged).toContain("top-[50%]");
        // And the fixed class string must NOT reproduce those.
        expect(twMerge(baseClassName(), drawerClassName())).not.toContain("translate-x-[-50%]");
    });
});

describe("mobile drawer — scroll ownership and dismissal", () => {
    it("the panel does not scroll itself; only its inner region does", () => {
        const merged = resolve(drawerClassName());

        // The base sets `overflow-y-auto` on EVERY dialog. The drawer manages
        // its own scroll through a `flex-1 overflow-y-auto` child, so leaving
        // the outer panel scrollable risks a double scrollbar.
        expect(merged).not.toContain("overflow-y-auto");
        expect(merged).toContain("overflow-y-hidden");
        expect(read(HEADER)).toMatch(/flex-1 overflow-y-auto/);
    });

    it("is a flex column, so the inner scroll region can claim the leftover height", () => {
        const merged = resolve(drawerClassName());

        expect(merged).toContain("flex");
        // The base is `grid`; twMerge drops it in favour of the caller's flex.
        expect(merged).not.toContain("grid");
    });

    it("body scroll stays locked while open (Radix owns it, and we do not opt out)", () => {
        // `RemoveScroll` is part of `DialogPrimitive.Content` itself, so the
        // guarantee rides on the base using the Radix element rather than a
        // plain div. The base's own `overflow-y-auto` is on the panel and
        // cannot affect the document body.
        expect(read(DIALOG)).toMatch(/<DialogPrimitive\.Content/);
        expect(read(HEADER)).not.toMatch(/modal=\{false\}/);
    });

    it("every drawer link closes the drawer on tap", () => {
        const header = read(HEADER);
        const navigation = read(NAVIGATION);
        const drawer = header.slice(header.indexOf("max-w-[320px]"), header.indexOf("</DialogContent>"));

        expect(drawer).toMatch(/<NavigationLinks\b[^>]*onNavigate=\{\(\) => setMobileMenuOpen\(false\)\}/);
        expect(navigation).toMatch(/<Link\b[^>]*onClick=\{onNavigate\}/);
    });

    it("the overlay covers the whole viewport", () => {
        expect(read(DIALOG)).toMatch(/fixed inset-0/);
    });
});

describe("other dialog callers still position correctly", () => {
    it("the shared base keeps its centring for every non-drawer dialog", () => {
        const base = baseClassName();

        // The fix must be call-site only. If the base ever loses these, every
        // other dialog in the app silently jumps to the top-left corner.
        expect(base).toContain("fixed");
        expect(base).toContain("left-[50%]");
        expect(base).toContain("top-[50%]");
        expect(base).toContain("translate-x-[-50%]");
        expect(base).toContain("translate-y-[-50%]");
    });

    it("the centring dialogs inherit centring untouched", () => {
        const centred: [string, string][] = [
            [join("app", "requests", "request-client.tsx"), "max-w-md"],
            [join("app", "requests", "request-client.tsx"), "sm:max-w-sm"],
            [join("components", "payroll", "NewLoanForm.tsx"), "sm:max-w-[425px]"],
            [join("components", "payroll", "NewOvertimeForm.tsx"), "sm:max-w-[425px]"],
        ];

        for (const [file, marker] of centred) {
            const caller = dialogContentClassNames(read(join(ROOT, file))).find((c) => c.includes(marker));
            expect(caller, `${file} no longer has a DialogContent matching "${marker}"`).toBeDefined();

            const merged = twMerge(baseClassName(), caller as string);
            expect(merged, `${file} (${marker}) lost its centring`).toContain("left-[50%]");
            expect(merged, `${file} (${marker}) lost its centring`).toContain("translate-x-[-50%]");
            expect(merged, `${file} (${marker}) lost its centring`).toContain("top-[50%]");
        }
    });

    it("the full-bleed employee dialogs opt out of the base's scroll and height cap", () => {
        const names = dialogContentClassNames(read(join(ROOT, "app", "employees", "employee-list.tsx")));
        const fullBleed = names.filter((c) => c.includes("h-[100dvh]"));

        expect(fullBleed).toHaveLength(2);
        for (const caller of fullBleed) {
            const merged = twMerge(baseClassName(), caller);
            // A full-height panel that kept the base's `overflow-y-auto` would
            // scroll as a whole instead of via its own internal region.
            expect(merged).not.toContain("overflow-y-auto");
            expect(merged).toContain("overflow-y-hidden");
            expect(merged).toContain("h-[100dvh]");
            // Still centred: these are dialogs, not drawers.
            expect(merged).toContain("left-[50%]");
            expect(merged).toContain("translate-x-[-50%]");

            // Worth recording: tailwind-merge does NOT treat `max-h-none` as
            // conflicting with the base's `max-h-[calc(100dvh_-_2rem)]`, so
            // both strings survive on the element. That is safe here only
            // because the built stylesheet emits `.max-h-none` after
            // `.max-h-[calc(100dvh_-_2rem)]` at equal specificity, so `none`
            // wins and the full-bleed panel really is uncapped. Verified in
            // the production CSS; the drawer is unaffected either way, because
            // twMerge DOES drop the base's cap in favour of `max-h-[100dvh]`.
            expect(merged).toContain("max-h-none");
        }
    });

    it("no DialogContent caller anywhere overrides position while keeping the base shift", () => {
        // The general form of this bug. Any caller that replaces the base's
        // `left-[50%]` must also replace `translate-x-[-50%]`.
        const offenders: string[] = [];

        for (const { label, className } of allCallers()) {
            const merged = twMerge(baseClassName(), className);
            const repositions = /(^|\s)left-(?!\[50%\])/.test(merged);
            if (repositions && merged.includes("translate-x-[-50%]")) offenders.push(label);
        }

        expect(offenders, `these callers anchor left but keep the -50% X shift: ${offenders.join(", ")}`).toHaveLength(0);
    });
});
