/**
 * Design regression guard for the employee directory redesign.
 *
 * WHAT IS AND IS NOT PROVEN HERE
 * ------------------------------
 * `app/employees/employee-list.tsx` is a client component rendered through the
 * App Router. This vitest environment is `node`: no DOM, no layout engine, no
 * viewport. Even in jsdom, jsdom computes no geometry — it would not catch a
 * clipped card, only the presence of a class name.
 *
 * So every assertion below is a SOURCE-LEVEL or STRUCTURAL assertion: it reads
 * the real file, slices out the real mobile view and the real table view, and
 * checks that the guarantees hold in the text that will be compiled. That is
 * the level at which the reported defects actually lived (a wrapper `div`, a
 * duplicated avatar, a dropped field), and it is strictly stronger than
 * eyeballing a screenshot: it cannot be satisfied by a comment, by dead markup
 * inside a dialog, or by a field that only exists on one view. JSX comments are
 * stripped first, so prose in a comment can never stand in for markup.
 *
 * It is NOT a proof that the page is pixel-correct on a phone. Class-string
 * reasoning is not the same as seeing it render. Real verification of the
 * 375px / 414px / 1024px / 1280px layouts still needs a real browser.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const LIST_FILE = join(ROOT, "app", "employees", "employee-list.tsx");
const AVATAR_FILE = join(ROOT, "app", "employees", "employee-avatar.tsx");

function read(file: string): string {
    return readFileSync(file, "utf8");
}

/** JSX comments, so an assertion can never be satisfied by prose in a comment. */
function stripComments(source: string): string {
    return source.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");
}

/** Every `className="..."` or ``className={`...`}`` literal in a source file. */
function classNames(source: string): string[] {
    const out: string[] = [];
    const re = /className=(?:"([^"]*)"|\{\s*`([^`]*)`\s*\})/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) out.push(m[1] ?? m[2] ?? "");
    return out;
}

const SOURCE = read(LIST_FILE);
const CODE = stripComments(SOURCE);

/* ------------------------------------------------------------------ */
/* Slice the two views apart.                                          */
/*                                                                     */
/* Anchors are chosen to sit in real CODE, never inside a comment — a   */
/* comment is stripped, so a comment-anchored slice silently yields -1 */
/* and the slice guards below fire instead of a confusing failure.      */
/* ------------------------------------------------------------------ */

const listStart = CODE.indexOf('<div className="w-full min-w-0">');
const mobileMarker = CODE.indexOf("xl:hidden", listStart);
const tableMarker = CODE.indexOf("xl:block", listStart);
const emptyStart = CODE.indexOf("filteredEmployees.length === 0", tableMarker);
const searchStart = CODE.indexOf('aria-label="Search employees by name');

function mustIndex(value: number, label: string): number {
    expect(value, `could not locate ${label} in employee-list.tsx`).toBeGreaterThan(-1);
    return value;
}

mustIndex(listStart, "the list container");
mustIndex(mobileMarker, "the mobile view breakpoint");
mustIndex(tableMarker, "the desktop view breakpoint");
mustIndex(emptyStart, "the empty state");
mustIndex(searchStart, "the search field");

/** Mobile: from the `<ul>` that carries `xl:hidden` up to the table. */
const MOBILE_VIEW = CODE.slice(
    CODE.lastIndexOf("<ul", mobileMarker),
    tableMarker
);
/** Desktop: from the card that carries `xl:block` up to the empty state. */
const TABLE_VIEW = CODE.slice(CODE.lastIndexOf("<div", tableMarker), emptyStart);
/** Everything from the list container on: no dialog markup, no filter bar. */
const LIST_REGION = CODE.slice(listStart);
/** The filter bar, from the search field up to the list container. */
const FILTER_BAR = CODE.slice(searchStart, listStart);

/* ================================================================== */
/* 1. The outer layer is gone                                          */
/* ================================================================== */

describe("employee directory — the reported outer layer", () => {
    it("no className anywhere in the file declares the old all-list wrapper", () => {
        // The reported defect, verbatim: one `bg-white/80 backdrop-blur-2xl
        // rounded-[3rem] shadow-2xl` container wrapped the ENTIRE list.
        const offenders = classNames(CODE).filter(
            (c) =>
                /rounded-\[3rem\]/.test(c) ||
                /backdrop-blur-2xl/.test(c) ||
                /bg-white\/80/.test(c)
        );

        expect(
            offenders,
            `the outer list wrapper survived as: ${offenders.join(" | ")}`
        ).toHaveLength(0);
    });

    it("the list container is a bare w-full min-w-0 block, not a surface", () => {
        const listDiv = /<div className="([^"]*)">/.exec(CODE.slice(listStart));
        expect(listDiv, "the list container div is gone").not.toBeNull();
        const className = (listDiv as RegExpExecArray)[1];

        expect(className).toContain("w-full");
        // `min-w-0`: a flex/grid child defaults to min-width:auto, so a wide
        // descendant could otherwise widen the page. `<main>` is
        // `overflow-x-hidden`, which CLIPS — a too-wide list is cut off, not
        // scrollable.
        expect(className).toContain("min-w-0");
        expect(className).not.toMatch(/rounded-/);
        expect(className).not.toMatch(/shadow/);
        expect(className).not.toMatch(/border/);
        expect(className).not.toMatch(/bg-/);
    });

    it("the guard has teeth: the PRE-REDESIGN wrapper class string is rejected", () => {
        // If the string below ever stops matching, every assertion above has
        // gone vacuous and this file protects nothing.
        const preRedesign =
            "bg-white/80 dark:bg-slate-950/80 backdrop-blur-2xl rounded-[3rem] " +
            "border border-slate-100 dark:border-slate-800/60 shadow-2xl overflow-hidden";

        expect(/rounded-\[3rem\]/.test(preRedesign)).toBe(true);
        expect(/backdrop-blur-2xl/.test(preRedesign)).toBe(true);
        expect(/bg-white\/80/.test(preRedesign)).toBe(true);

        const offenders = classNames(CODE).filter(
            (c) =>
                /rounded-\[3rem\]/.test(c) ||
                /backdrop-blur-2xl/.test(c) ||
                /bg-white\/80/.test(c)
        );
        expect(offenders).toHaveLength(0);
    });

    it("grouping is still present, per row and around the table", () => {
        // The brief: the giant wrapper goes, inner grouping stays.
        expect(MOBILE_VIEW).toMatch(/<article className="[^"]*rounded-2xl/);
        expect(MOBILE_VIEW).toMatch(/<article className="[^"]*border/);
        const card = /<div className="([^"]*xl:block[^"]*)">/.exec(TABLE_VIEW);
        expect(card, "the table card is gone").not.toBeNull();
        expect((card as RegExpExecArray)[1]).toMatch(/rounded-2xl/);
        expect((card as RegExpExecArray)[1]).toMatch(/border/);
    });

    it("the root no longer double-pads on top of app/employees/page.tsx", () => {
        // page.tsx already supplies `p-8 max-w-7xl mx-auto`. The old root
        // added `p-4 md:p-8` on top: 12 (layout main) + 32 (page) + 16 (here)
        // = 60px of horizontal padding on EACH side of a 375px screen.
        const root = /return \(\s*[\s\S]{0,1500}?<div className="([^"]*)">/.exec(CODE);
        expect(root, "could not locate the component root div").not.toBeNull();
        const className = (root as RegExpExecArray)[1];

        expect(className).not.toMatch(/(^|\s)p-\d/);
        expect(className).not.toMatch(/md:p-/);
        expect(className).toContain("w-full");
    });
});

/* ================================================================== */
/* 2. No data loss — field inventory, per view                         */
/* ================================================================== */

/**
 * Captured from the pre-redesign file. Every entry below was visible on that
 * view BEFORE the redesign and MUST still be present AFTER it. Dropping a
 * column to make something fit is the failure this list exists to catch.
 */
const MOBILE_FIELDS_BEFORE = [
    "employee.firstName",
    "employee.lastName",
    "employee.designation",
    "employee.rollNumber",
    "employee.department",
    "employee.joiningDate",
    "employee.currentStatus",
    "outstandingProvisionalFields",
    "setOnboardingId",
    "setSelectedEmployee",
    "handleDelete",
];

const TABLE_FIELDS_BEFORE = [
    "employee.firstName",
    "employee.lastName",
    "employee.rollNumber",
    "employee.designation",
    "employee.department",
    "employee.joiningDate",
    "employee.employmentType",
    "employee.currentStatus",
    "outstandingProvisionalFields",
    "setSelectedEmployee",
    "handleDelete",
];

describe("employee directory — no field is dropped from either view", () => {
    it("the mobile card view still renders every field it used to", () => {
        const missing = MOBILE_FIELDS_BEFORE.filter((f) => !MOBILE_VIEW.includes(f));
        expect(missing, `the mobile view lost: ${missing.join(", ")}`).toHaveLength(0);
    });

    it("the desktop table still renders every field it used to", () => {
        const missing = TABLE_FIELDS_BEFORE.filter((f) => !TABLE_VIEW.includes(f));
        expect(missing, `the table lost: ${missing.join(", ")}`).toHaveLength(0);
    });

    it("the photo still comes through, on BOTH views, through one component", () => {
        // `employee.photo` moved out of both views into the shared avatar, so
        // it is asserted in the avatar module and here as `<EmployeeAvatar`.
        expect(MOBILE_VIEW).toContain("<EmployeeAvatar");
        expect(TABLE_VIEW).toContain("<EmployeeAvatar");
        expect(read(AVATAR_FILE)).toContain("employee.photo");
    });

    it("the table keeps all six of its column headers", () => {
        for (const head of [
            "Profile",
            "Employee",
            "Position",
            "Employment",
            "Status",
            "Actions",
        ]) {
            expect(TABLE_VIEW, `the table lost its "${head}" column`).toContain(head);
        }
    });

    it("the mobile action set is still onboarding + edit + delete", () => {
        // 44px touch targets, each individually labelled. `inline-flex` is
        // counted so the avatar's own `h-11 w-11` is not counted as a button.
        expect(MOBILE_VIEW).toMatch(/aria-label=\{`Onboarding checklist for /);
        expect(MOBILE_VIEW).toMatch(/aria-label=\{`Edit /);
        expect(MOBILE_VIEW).toMatch(/aria-label=\{`Delete /);
        expect(MOBILE_VIEW.match(/inline-flex h-11 w-11/g)).toHaveLength(3);
    });

    it("the table's action set is still edit + delete", () => {
        expect(TABLE_VIEW).toMatch(/aria-label=\{`Edit /);
        expect(TABLE_VIEW).toMatch(/aria-label=\{`Delete /);
    });
});

/* ================================================================== */
/* 3. The detail link survived in BOTH views                           */
/* ================================================================== */

const DETAIL_LINKS = [
    ...CODE.matchAll(
        /<Link\s+href=\{`\/employees\/\$\{employee\.id\}`\}\s+className="([^"]*)"/g
    ),
];

describe("employee directory — the link to the detail page", () => {
    it("the name is still a <Link> to /employees/{id} in the mobile view", () => {
        expect(MOBILE_VIEW).toMatch(/<Link\s+href=\{`\/employees\/\$\{employee\.id\}`\}/);
    });

    it("the name is still a <Link> to /employees/{id} in the table", () => {
        expect(TABLE_VIEW).toMatch(/<Link\s+href=\{`\/employees\/\$\{employee\.id\}`\}/);
    });

    it("at least one detail link exists per view", () => {
        const href = /href=\{`\/employees\/\$\{employee\.id\}`\}/g;
        expect((MOBILE_VIEW.match(href) || []).length).toBeGreaterThanOrEqual(1);
        expect((TABLE_VIEW.match(href) || []).length).toBeGreaterThanOrEqual(1);
    });

    it("no detail link is hidden behind a viewport class", () => {
        // A link that only exists in one viewport is a regression: the record
        // becomes unreachable on the other.
        expect(DETAIL_LINKS.length).toBeGreaterThanOrEqual(3);
        for (const [, className] of DETAIL_LINKS) {
            expect(className, "a detail link is hidden behind a viewport class").not.toMatch(
                /(^|\s)(hidden|sm:hidden|md:hidden|lg:hidden|xl:hidden)(\s|$)/
            );
        }
    });
});

/* ================================================================== */
/* 4. One avatar implementation, used by both views                     */
/* ================================================================== */

describe("employee directory — the avatar is defined once", () => {
    it("the mobile card view renders <EmployeeAvatar>", () => {
        expect(MOBILE_VIEW).toContain("<EmployeeAvatar");
    });

    it("the desktop table renders <EmployeeAvatar>", () => {
        expect(TABLE_VIEW).toContain("<EmployeeAvatar");
    });

    it("both views import it from the same module", () => {
        expect(CODE).toMatch(/import \{ EmployeeAvatar \} from "\.\/employee-avatar"/);
    });

    it("employee-list.tsx no longer builds an avatar by hand", () => {
        // A second hand-rolled <Avatar>/<AvatarFallback> pair is exactly how
        // the two views drifted apart in the first place.
        expect(CODE).not.toContain("<Avatar");
        expect(CODE).not.toContain("<AvatarFallback");
        expect(CODE).not.toContain("<AvatarImage");
        expect(CODE).not.toMatch(/from-\w+-\d+ via-\w+-\d+ to-\w+-\d+/);
        expect(CODE).not.toMatch(/from-\w+-\d+ to-\w+-\d+ text-white/);
    });

    it("the palette is a list of complete literal class strings, not interpolations", () => {
        // Tailwind scans SOURCE TEXT. `from-${hue}-500` emits nothing and the
        // circle silently falls back to the default grey.
        const avatar = read(AVATAR_FILE);
        const block = /EMPLOYEE_AVATAR_PALETTES = \[([\s\S]*?)\] as const/.exec(avatar);
        expect(block, "EMPLOYEE_AVATAR_PALETTES is gone or no longer a literal array").not.toBeNull();

        const entries = (block as RegExpExecArray)[1].match(/"([^"]+)"/g) || [];
        expect(entries.length).toBeGreaterThanOrEqual(4);
        for (const entry of entries) {
            expect(entry, "an interpolated Tailwind class emits no CSS").not.toContain("${");
        }
    });
});

/* ================================================================== */
/* 5. The empty state survived                                         */
/* ================================================================== */

describe("employee directory — the empty state", () => {
    it("still exists, with its message and its recovery action", () => {
        expect(CODE).toContain("No records found");
        expect(CODE).toContain("Clear all filters");
        expect(CODE).toMatch(/filteredEmployees\.length === 0/);
    });

    it("sits OUTSIDE both views, so it shows at every width", () => {
        // A previous agent lost the "no employees" message while adding the
        // card view, by nesting it inside one of the two views. Proved by
        // ABSENCE from both slices plus structural closure: neither the
        // `xl:hidden` card list nor the `xl:block` table renders it, and each
        // view's markup is fully closed before the empty state begins.
        expect(MOBILE_VIEW).not.toContain("No records found");
        expect(TABLE_VIEW).not.toContain("No records found");

        // Exactly one list, closed after its last card.
        expect(MOBILE_VIEW.match(/<ul\b/g)).toHaveLength(1);
        expect(MOBILE_VIEW.match(/<\/ul>/g)).toHaveLength(1);
        expect(MOBILE_VIEW.lastIndexOf("</ul>")).toBeGreaterThan(
            MOBILE_VIEW.lastIndexOf("</article>")
        );

        // The table card closes after the table itself.
        expect(TABLE_VIEW.lastIndexOf("</div>")).toBeGreaterThan(
            TABLE_VIEW.lastIndexOf("</Table>")
        );
    });

    it("carries its own surface now that the list does not supply one", () => {
        const open = /\{filteredEmployees\.length === 0 && \(\s*<div className="([^"]*)"/.exec(CODE);
        expect(open, "the empty state lost its own surface").not.toBeNull();
        expect((open as RegExpExecArray)[1]).toMatch(/rounded-2xl/);
        expect((open as RegExpExecArray)[1]).toMatch(/border-dashed/);
    });
});

/* ================================================================== */
/* 6. Width discipline — the part `<main class="overflow-x-hidden">`    */
/*    turns from "scrollable" into "cut off"                            */
/* ================================================================== */

describe("employee directory — nothing can widen past the viewport", () => {
    it("the chip row WRAPS instead of scrolling", () => {
        // `<main>` is `overflow-x-hidden`, so a non-wrapping row is clipped,
        // not scrollable. `flex-wrap` is what makes it safe.
        expect(MOBILE_VIEW).toMatch(/<div className="[^"]*flex-wrap[^"]*">/);
    });

    it("every flex ROW in the card view is shrink-safe", () => {
        // A row flex container sizes to its max-content unless a child can
        // shrink; `min-w-0` on the child (or `shrink-0` on a deliberately
        // fixed cluster, or `w-full` on the container) is the guard.
        // `inline-flex` buttons and column stacks are excluded: a fixed-width
        // icon button and a cross-axis stretch need no such guard.
        const rows = (MOBILE_VIEW.match(/className="[^"]*\bflex\b[^"]*"/g) || []).filter(
            (c) => !/\bflex-col\b/.test(c) && !/\binline-flex\b/.test(c)
        );
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
            expect(row, `a card-view flex row can be widened by its content: ${row}`).toMatch(
                /\bmin-w-0\b|\bshrink-0\b|\bw-full\b/
            );
        }
    });

    it("every chip in the wrapping meta row is capped at the card width", () => {
        const chips =
            MOBILE_VIEW.match(/<span className="[^"]*(?:bg-slate-100|bg-amber-100)[^"]*"/g) || [];
        expect(chips.length).toBeGreaterThanOrEqual(3);
        for (const chip of chips) {
            expect(chip, `an uncapped chip can widen the card: ${chip}`).toContain("max-w-full");
        }
    });

    it("the card view's text containers truncate rather than push", () => {
        expect(MOBILE_VIEW).toMatch(/<li key=\{employee\.id\} className="min-w-0">/);
        expect(MOBILE_VIEW).toMatch(/<div className="min-w-0 flex-1">/);
        expect(MOBILE_VIEW).toMatch(/<ul className="[^"]*xl:hidden[^"]*">/);
        // The action row: the icon cluster is `shrink-0`, the link beside it
        // is `flex-1 min-w-0`, so the two cannot collide.
        expect(MOBILE_VIEW).toMatch(/<div className="mt-3 flex min-w-0 items-center gap-2">/);
        expect(MOBILE_VIEW).toMatch(/<div className="flex shrink-0 items-center gap-1\.5">/);
    });

    it("the table keeps a min-width and a shrinkable card around it", () => {
        // components/ui/table.tsx wraps every <Table> in `overflow-auto`, so
        // the desktop view is safe at any width. The card around it must be
        // `w-full min-w-0` or the table's min-width would widen the page.
        const card = /<div className="([^"]*xl:block[^"]*)">/.exec(TABLE_VIEW);
        expect(card, "the table card is gone").not.toBeNull();
        expect((card as RegExpExecArray)[1]).toContain("w-full");
        expect((card as RegExpExecArray)[1]).toContain("min-w-0");
        expect(TABLE_VIEW).toMatch(/<Table className="w-full min-w-\[\d+px\] table-fixed">/);
    });

    it("the filter bar can shrink on a phone", () => {
        expect(FILTER_BAR).toMatch(/min-w-0/);
        // One column on a phone, two from `sm`, inline from `lg`. A 2-column
        // grid at 375px gives each button ~125px, below the ~200px width of
        // the "Status: RESIGNED" label.
        expect(FILTER_BAR).toMatch(/grid-cols-1 gap-3 sm:grid-cols-2 lg:flex/);
    });
});

/* ================================================================== */
/* 7. Only transitions that actually emit CSS                           */
/* ================================================================== */

describe("employee directory — no dead animation utilities", () => {
    it("the list region uses no `animate-*` family utilities", () => {
        // This repo has no `tailwindcss-animate`, so `animate-in`,
        // `fade-in-0`, `zoom-in-95` and `slide-in-from-*` are dead CSS with
        // zero occurrences in the built stylesheet. (The edit dialog still
        // contains some from an earlier change; it is out of scope here and is
        // deliberately not asserted on.)
        for (const dead of [
            "animate-in",
            "fade-in-0",
            "zoom-in-95",
            "slide-in-from-",
            "animate-fade-in",
            "animate-fade-in-up",
        ]) {
            expect(LIST_REGION, `the list region uses the dead utility "${dead}"`).not.toContain(dead);
        }
    });

    it("the list region animates with transition-* + duration-* instead", () => {
        expect(LIST_REGION).toMatch(/transition-\w+/);
        expect(LIST_REGION).toMatch(/duration-\d+/);
    });
});

/* ================================================================== */
/* 8. The dialogs were not disturbed                                    */
/* ================================================================== */

describe("employee directory — the full-bleed dialogs are untouched", () => {
    it("both full-height dialogs keep their exact class strings", () => {
        // A previous agent deliberately preserved these; a redesign of the
        // LIST must not reach into the edit / onboarding dialogs.
        const fullBleed = classNames(CODE).filter((c) => c.includes("h-[100dvh]"));
        expect(fullBleed).toHaveLength(2);
        for (const caller of fullBleed) {
            expect(caller).toContain("max-w-[100vw]");
            expect(caller).toContain("max-h-none");
            expect(caller).toContain("overflow-y-hidden");
            expect(caller).toMatch(/sm:h-\[(?:88|85)dvh\]/);
            expect(caller).toContain("p-0");
        }
    });
});
