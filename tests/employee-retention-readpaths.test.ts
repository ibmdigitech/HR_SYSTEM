/**
 * The read-path register (RET-001), and the source-level guard that the hard
 * delete has not crept back.
 *
 * TWO JOBS
 * --------
 * 1. `lib/employees/read-paths.ts` is a checked-in audit of every query that
 *    reads or counts Employee rows. It exists because archiving creates a leak in
 *    two directions at once and neither is visible from a single call site. The
 *    assertions here keep the register honest: every entry must name a file that
 *    exists and a `prisma.employee.*` call that is actually at that line. A
 *    register that has silently drifted is worse than no register.
 *
 * 2. The hard delete must not come back. `tests/lifecycle-consistency.test.ts`
 *    pinned the OLD behaviour by design and now fails — that pin is reported, not
 *    edited. This file is the replacement pin, asserting the NEW invariant from
 *    the other side: `prisma.employee.delete` may appear in the actions module
 *    exactly once, and only inside the retention-gated purge.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { existsSync } from "node:fs";
import {
    EMPLOYEE_READ_PATHS,
    outstandingReadPaths,
    summariseReadPaths,
} from "@/lib/employees/read-paths";

const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

/**
 * The body of an exported function.
 *
 * Sliced to the NEXT top-level `export`, not to the next `\n}`. A first attempt
 * used the latter and silently truncated `purgeEmployee`, whose parameter type is
 * a multi-line inline object literal containing a `\n}` — so the slice stopped
 * inside the signature and the "is the gate inside the purge?" assertions passed
 * vacuously on a 231-character prefix. Every top-level declaration in this module
 * starts with `export `, so that is the only unambiguous terminator.
 */
function bodyOf(source: string, signature: string): string {
    const start = source.indexOf(signature);
    expect(start, `${signature} not found`).toBeGreaterThan(-1);
    const next = source.indexOf("\nexport ", start + signature.length);
    return source.slice(start, next === -1 ? source.length : next);
}

/** Source with comments removed, so prose cannot be counted as code. */
function withoutComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n\r]*/g, "");
}

/* ================================================================== */
/* The register is real                                                */
/* ================================================================== */

describe("every entry in the read-path register names a real query", () => {
    it("has at least one entry per visibility class", () => {
        const summary = summariseReadPaths();
        expect(summary.EXCLUDES).toBeGreaterThan(0);
        expect(summary.LEAKS).toBeGreaterThan(0);
        expect(summary.INTENTIONAL).toBeGreaterThan(0);
    });

for (const entry of EMPLOYEE_READ_PATHS) {
        it(`${entry.file}:${entry.line} still points at an employee query`, () => {
            const parts = entry.file.split("/");
            const path = join(ROOT, ...parts);
            expect(existsSync(path), `${entry.file} does not exist`).toBe(true);

            // Line numbers drift every time anyone edits a file, so a tight
            // window makes this register a nuisance rather than a guard. Instead
            // the check is: does an employee query exist anywhere in this file,
            // and is the cited line close to one of them? That tolerates an
            // unrelated edit above the query while still failing if the entry
            // has gone stale and started pointing at the wrong function.
            const lines = read(...parts).split(/\r?\n/);
            const CALL = /employee\.(findMany|findFirst|count|groupBy|aggregate)\(/;
            const occurrences = lines
                .map((text, index) => ({ line: index + 1, matches: CALL.test(text) }))
                .filter((o) => o.matches)
                .map((o) => o.line);

            expect(
                occurrences.length,
                `${entry.file} contains no employee.${entry.call} query — is this entry obsolete?`
            ).toBeGreaterThan(0);

            const nearest = occurrences.reduce(
                (best, line) => (Math.abs(line - entry.line) < Math.abs(best - entry.line) ? line : best),
                occurrences[0]
            );
            expect(
                Math.abs(nearest - entry.line),
                `${entry.file}:${entry.line} is nearest to an employee query at line ${nearest}`
            ).toBeLessThanOrEqual(25);
        });
    }

    it("classifies every entry, with a note explaining each verdict", () => {
        for (const entry of EMPLOYEE_READ_PATHS) {
            expect(["EXCLUDES", "LEAKS", "INTENTIONAL"]).toContain(entry.visibility);
            expect(entry.note.length, `${entry.file} needs a reason`).toBeGreaterThan(40);
            expect(entry.purpose.length).toBeGreaterThan(5);
        }
    });

    it("gives every outstanding entry an actionable fix, not just a complaint", () => {
        for (const entry of outstandingReadPaths()) {
            expect(
                entry.note,
                `${entry.file} is marked LEAKS but does not say what to change`
            ).toMatch(/FIX:|fix |scopeEmployeeWhere/);
        }
    });

    it("marks exactly the queries this change fixed or added as fixed", () => {
        const fixed = EMPLOYEE_READ_PATHS.filter((p) => p.fixedHere);
        expect(fixed.map((f) => f.file).sort()).toEqual([
            "app/api/employees/route.ts",
            "app/lib/actions/employees.ts",
            "app/lib/actions/employees.ts",
        ]);
        for (const entry of fixed) {
            // Either it now excludes archived rows, or it is the archive listing
            // that is meant to include them. Both are correct; neither is a leak.
            expect(["EXCLUDES", "INTENTIONAL"]).toContain(entry.visibility);
        }
    });

    it("records the archive listing itself, so the retrieval direction is auditable", () => {
        const archiveListing = EMPLOYEE_READ_PATHS.find(
            (p) => p.call.includes("deletedAt: { not: null }") && p.file === "app/lib/actions/employees.ts"
        );
        expect(archiveListing, "getArchivedEmployees is missing from the register").toBeDefined();
        expect(archiveListing?.visibility).toBe("INTENTIONAL");
    });

    it("records the highest-impact leak: attendance import and payroll", () => {
        // Both credit money or time to a row that was archived. A register that
        // does not single these out is not prioritising.
        const files = outstandingReadPaths().map((p) => p.file);
        expect(files).toContain("lib/attendance/import.ts");
        expect(files).toContain("lib/workflow/payroll.ts");
    });
});

/* ================================================================== */
/* The hard delete has not come back                                  */
/* ================================================================== */

describe("the hard delete is gone from the archive path", () => {
    const actions = read("app", "lib", "actions", "employees.ts");

    it("deleteEmployee no longer deletes — it delegates to the archive", () => {
        const body = bodyOf(actions, "export async function deleteEmployee");
        expect(body).not.toContain("prisma.employee.delete");
        expect(body).not.toMatch(/\.delete\(/);
        expect(body).toContain("archiveEmployee");
    });

    it("archiveEmployee never issues a delete", () => {
        const body = bodyOf(actions, "export async function archiveEmployee");
        expect(body).not.toMatch(/\.delete\(|\.deleteMany\(/);
        // And it must be an update, not a bare no-op.
        expect(body).toContain("prisma.employee.updateMany");
    });

    it("restoreEmployee never issues a delete either", () => {
        const body = bodyOf(actions, "export async function restoreEmployee");
        expect(body).not.toMatch(/\.delete\(|\.deleteMany\(/);
        expect(body).toContain("prisma.employee.updateMany");
    });

    it("permits exactly ONE hard delete in the module, and it is inside the purge", () => {
        // Comments are stripped first: the module's header prose quotes
        // `prisma.employee.delete({ where: { id } })` while explaining what it
        // replaced, and counting that sentence would make this assertion a
        // measure of documentation rather than of code.
        const code = withoutComments(actions);
        const occurrences = code.match(/prisma\.employee\.delete\(/g) ?? [];
        expect(
            occurrences,
            `found ${occurrences.length} hard deletes; only the retention-gated purge may have one`
        ).toHaveLength(1);

        // It must be inside purgeEmployee, and purgeEmployee must check
        // eligibility before reaching it. Order matters: the eligibility check
        // appears earlier in the source than the delete.
        const purge = withoutComments(bodyOf(actions, "export async function purgeEmployee"));
        const eligibilityAt = purge.indexOf("purgeEligibility(");
        const deleteAt = purge.indexOf("prisma.employee.delete(");
        expect(eligibilityAt).toBeGreaterThan(-1);
        expect(deleteAt).toBeGreaterThan(eligibilityAt);
    });

    it("the purge is behind SUPER_ADMIN, confirmation, and a written reason", () => {
        const purge = withoutComments(bodyOf(actions, "export async function purgeEmployee"));
        expect(purge).toContain("requireSuperAdmin");
        expect(purge).toContain("CONFIRMATION_REQUIRED");
        expect(purge).toContain("REASON_REQUIRED");
        // In that order, so no gate can be skipped by reordering a later one.
        const superAt = purge.indexOf("requireSuperAdmin");
        const confirmAt = purge.indexOf("CONFIRMATION_REQUIRED");
        const eligibilityAt = purge.indexOf("purgeEligibility(");
        const deleteAt = purge.indexOf("prisma.employee.delete(");
        expect(superAt).toBeLessThan(confirmAt);
        expect(confirmAt).toBeLessThan(eligibilityAt);
        expect(eligibilityAt).toBeLessThan(deleteAt);
        // And the slice really is the whole function, not a prefix.
        expect(purge.length).toBeGreaterThan(2000);
    });

    it("the archive permission was not weakened to make the change land", () => {
        const body = bodyOf(actions, "export async function archiveEmployee");
        expect(body).toContain("PERMISSIONS.EMPLOYEES_DELETE");
        // The capability a weaker or different one would have used.
        expect(body).not.toContain("PERMISSIONS.EMPLOYEES_EDIT");
        expect(body).not.toContain("PERMISSIONS.EMPLOYEES_VIEW");
    });
});

/* ================================================================== */
/* The listings this change owns carry the filter                     */
/* ================================================================== */

describe("the two listings this change owns actually filter", () => {
    const actions = read("app", "lib", "actions", "employees.ts");

    it("GET /api/employees filters archived rows out of the directory", () => {
        const route = read("app", "api", "employees", "route.ts");
        expect(route).toContain("NOT_ARCHIVED");
        expect(route).toMatch(/where:\s*NOT_ARCHIVED/);
    });

    it("getActiveEmployees carries both the tombstone and the active flag", () => {
        const body = withoutComments(bodyOf(actions, "export async function getActiveEmployees"));
        // `NOT_ARCHIVED` is `{ deletedAt: null }`, exported from the retention
        // module so there is one definition of the predicate.
        expect(body).toContain("NOT_ARCHIVED");
        expect(body).toContain("isActive: true");
    });

    it("the archived listing asks for exactly the archived rows", () => {
        const body = withoutComments(bodyOf(actions, "export async function getArchivedEmployees"));
        expect(body).toContain("deletedAt: { not: null }");
        expect(body).toContain("purgeEligibility(");
    });
});
