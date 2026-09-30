/**
 * Page-level wiring for the letter and exit-case approval queues.
 *
 * `tests/approvals-queue-letters.test.ts` pins the filter logic. This file pins
 * the parts that decide whether the section exists at all, which are the parts
 * that broke for leave: the count in the header, the tab, and the actions.
 *
 * The page is a server component, so it is not imported here. What is asserted
 * is the source, read as text — which is deliberate. These are exactly the
 * mistakes that survive review: a `totalPending` that silently omits a queue
 * (so the header says "all caught up" while work is waiting), a tab gated on a
 * hardcoded role pair that excludes SUPER_ADMIN, a filter that reaches for a
 * column nothing writes, and a read-only row with no way to act on it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PERMISSIONS, hasPermission } from "@/lib/auth/permissions";
import { ROLES } from "@/lib/auth/roles";

const PAGE = readFileSync(join(process.cwd(), "app/dashboard/approvals/page.tsx"), "utf8");
const FILTERS = readFileSync(join(process.cwd(), "app/dashboard/approvals/queue-filters.ts"), "utf8");
const LETTER_ACTIONS = readFileSync(
    join(process.cwd(), "app/dashboard/approvals/letter-queue-actions.tsx"),
    "utf8"
);
const EXIT_ACTIONS = readFileSync(
    join(process.cwd(), "app/dashboard/approvals/exit-queue-actions.tsx"),
    "utf8"
);

/**
 * Source with comments removed.
 *
 * These files DISCUSS the mistakes they are guarded against — the page's own
 * comment quotes the legacy `managerStatus` / `hrStatus` columns, the hardcoded
 * `"HR" || "ADMIN"` pair and the `animate-*` plugin classes it must not use.
 * Grepping the raw text therefore matches the explanation of the rule instead of
 * a violation of it, and a test that can be satisfied by deleting a comment is
 * not a test.
 */
function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const PAGE_CODE = stripComments(PAGE);
const FILTERS_CODE = stripComments(FILTERS);
const LETTER_ACTIONS_CODE = stripComments(LETTER_ACTIONS);
const EXIT_ACTIONS_CODE = stripComments(EXIT_ACTIONS);

/**
 * The rendered body of one tab, so an assertion cannot match a neighbouring
 * section. Anchored on `<TabsContent`, not on `value="..."` — the trigger with
 * the same value comes first in the file.
 */
function section(value: string): string {
    const start = PAGE_CODE.indexOf(`<TabsContent value="${value}"`);
    expect(start, `no tab content with value="${value}"`).toBeGreaterThan(-1);
    const end = PAGE_CODE.indexOf("</TabsContent>", start);
    expect(end, `tab "${value}" is never closed`).toBeGreaterThan(start);
    return PAGE_CODE.slice(start, end);
}

describe("approvals page — letter queue wiring", () => {
    it("queries letters through the tested filter, not an inline where", () => {
        expect(PAGE_CODE).toContain("buildLetterQueueWhere({ role: userRole })");
        expect(PAGE_CODE).toMatch(/prisma\.letter\.findMany\(\{\s*where: letterQueueWhere/);
    });

    it("does not hardcode a letter status in the page", () => {
        // The status lives in exactly one place — the filter, next to the
        // comment explaining which route it has to match. Scoped to the letters
        // section because the service and visa queries legitimately filter on
        // their own PENDING status.
        const letters = section("letters");
        expect(letters).not.toMatch(/status:\s*["']/);
        expect(PAGE_CODE).not.toContain("LETTER_STATUS");
    });

    it("includes the letter count in the header total", () => {
        // A queue omitted from `totalPending` is how the leave total was wrong:
        // the page said zero while work was waiting.
        const total = PAGE_CODE.slice(PAGE_CODE.indexOf("const totalPending"));
        const expression = total.slice(0, total.indexOf(";"));
        expect(expression).toContain("pendingLetters.length");
        expect(expression).toContain("pendingExitCases.length");
    });

    it("gates the letter tab and its stat card on the queue, not on a role pair", () => {
        expect(PAGE_CODE).toContain("{letterQueueWhere && (");
        expect(PAGE_CODE).not.toMatch(/userRole\s*===\s*["']HR["']\s*\|\|\s*userRole\s*===\s*["']ADMIN["']/);
    });

    it("renders a working Approve control, not a dead row", () => {
        const letters = section("letters");
        expect(letters).toContain("<LetterApproveButton");
        expect(letters).toContain("letterId={letter.id}");
    });

    it("does not render a Reject control for letters, because none exists", () => {
        // No letter rejection endpoint exists anywhere in the product. A reject
        // control here would be a button that cannot succeed, so the markers of
        // one (the destructive variant, the X icon) must be absent.
        const letters = section("letters");
        expect(letters).not.toContain("XCircle");
        expect(letters).not.toContain('variant="destructive"');
    });

    it("posts to the audited approval route from the button", () => {
        expect(LETTER_ACTIONS_CODE).toContain("/api/letters/${letterId}/approve");
        expect(LETTER_ACTIONS_CODE).toContain('method: "POST"');
    });
});

describe("approvals page — exit queue wiring", () => {
    it("queries ExitCase directly, never through app/exits", () => {
        expect(PAGE_CODE).toMatch(/prisma\.exitCase\.findMany\(\{\s*where: exitQueueWhere/);
        expect(PAGE_CODE).not.toMatch(/from ["']@\/app\/exits/);
        expect(PAGE_CODE).not.toMatch(/from ["']\.\/exits/);
    });

    it("derives its statuses from the state machine, not a literal list", () => {
        expect(FILTERS_CODE).toContain("EXIT_TRANSITIONS");
        expect(FILTERS_CODE).toContain("EXIT_DECISION_STATES");
        expect(PAGE_CODE).not.toMatch(/status:\s*["']PENDING_APPROVAL["']/);
    });

    it("guards the section with the permission the exit actions use", () => {
        expect(FILTERS_CODE).toContain("PERMISSIONS.RESIGNATION_APPROVE");
        expect(FILTERS_CODE).toContain("PERMISSIONS.TERMINATION_APPROVE");
        // Both strings must actually be granted, or the queue is gated on a
        // permission nobody holds and is permanently empty.
        for (const role of [ROLES.HR, ROLES.ADMIN, ROLES.SUPER_ADMIN]) {
            expect(hasPermission(role, PERMISSIONS.RESIGNATION_APPROVE)).toBe(true);
            expect(hasPermission(role, PERMISSIONS.TERMINATION_APPROVE)).toBe(true);
        }
    });

    it("uses the real exit server actions rather than a second implementation", () => {
        expect(EXIT_ACTIONS_CODE).toContain("approveExitCase");
        expect(EXIT_ACTIONS_CODE).toContain("rejectExitCase");
        expect(EXIT_ACTIONS_CODE).toContain("decisionNote: trimmedNote");
        // No direct exitCase write anywhere in the queue: the guarded update and
        // the audit row live in the action, and a duplicate would race with it.
        expect(EXIT_ACTIONS_CODE).not.toContain("prisma");
    });

    it("requires a reason before a rejection can be submitted", () => {
        // `decideExit` refuses a note-less rejection, so the confirm button must
        // not offer the click that is guaranteed to fail.
        expect(EXIT_ACTIONS_CODE).toMatch(/disabled=\{disabled \|\| trimmedNote\.length === 0\}/);
        expect(EXIT_ACTIONS_CODE).toContain("Dialog");
    });

    it("explains an empty exit queue when cases exist but are not yet decidable", () => {
        expect(PAGE_CODE).toContain("exitCasesAwaitingRouting");
        expect(PAGE_CODE).toContain("EXIT_STATUS.REQUESTED");
    });
});

describe("approvals page — nothing regressed", () => {
    it("keeps the three existing queues querying the same models", () => {
        expect(PAGE_CODE).toContain("prisma.leaveRequest.findMany");
        expect(PAGE_CODE).toContain("prisma.serviceRequest.findMany");
        expect(PAGE_CODE).toContain("prisma.visaRequest.findMany");
    });

    it("still delegates the leave filter to the tested leave-queue module", () => {
        expect(PAGE_CODE).toContain("buildLeaveQueueWhere");
        expect(PAGE_CODE).not.toContain("managerStatus");
        expect(PAGE_CODE).not.toContain("hrStatus");
    });

    it("keeps every section's approve/reject controls wired to a real action", () => {
        expect(PAGE_CODE).toContain("approveLeaveManager");
        expect(PAGE_CODE).toContain("approveLeaveHR");
        expect(PAGE_CODE).toContain("approveStaffRequest");
        expect(PAGE_CODE).toContain("updateVisaStatus");
    });

    it("reads the staff request's category from the relation the query includes", () => {
        // `serviceType` is not a field on ServiceRequest — the relation is
        // `category`. Reading it was undefined on every row and threw as soon
        // as a PENDING request existed, 500-ing the page and every other queue
        // on it. The `any[]` row type is what let it compile.
        expect(PAGE_CODE).not.toContain("serviceType");
        expect(section("staff")).toContain("request.category.name");
    });

    it("guards the letter row's nullable employee and candidate relations", () => {
        // An offer letter is issued before the person is an Employee, so
        // `letter.employee` is genuinely null. An unguarded read crashes the
        // queue on the first candidate letter.
        const letters = section("letters");
        expect(letters).toContain("letter.employee");
        expect(letters).toContain("letter.candidate");
        expect(letters).not.toMatch(/letter\.employee\.firstName\[0\]/);
    });

    it("gives every queue an empty state that explains itself", () => {
        expect(PAGE_CODE.match(/<EmptyState/g)?.length).toBeGreaterThanOrEqual(5);
        // No section may render an EmptyState with nothing beyond the heading:
        // an unexplained empty box is indistinguishable from a broken filter.
        // The terminator has to be a lone `/>` on its own line, or the lazy
        // match stops at the `/>` inside the icon prop and asserts nothing.
        const usages = [...PAGE_CODE.matchAll(/<EmptyState[\s\S]*?\n\s*\/>/g)];
        expect(usages.length).toBeGreaterThanOrEqual(5);
        for (const usage of usages) {
            expect(usage[0]).toContain("hint=");
        }
    });

    it("avoids the uninstalled animation plugin's classes in the new components", () => {
        for (const source of [LETTER_ACTIONS_CODE, EXIT_ACTIONS_CODE]) {
            expect(source).not.toMatch(/animate-/);
        }
    });
});
