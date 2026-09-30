/**
 * Employee detail page — the lifecycle-stage contract.
 *
 * The detail page closes UI gap 8.7: the directory badge shows
 * `Employee.currentStatus`, which is NOT the authoritative field, and the
 * authoritative `Employee.lifecycle` stage was rendered nowhere. The obvious
 * wrong fix is to add a fourth status badge, which would make three
 * disagreeing columns on one screen instead of two.
 *
 * Rendering an async server component is out of scope for this suite, so the
 * contract is pinned at the two places it can actually break:
 *  - the stage vocabulary, which is imported and therefore testable directly;
 *  - the page's own source, which is inspected for the ordering and labelling
 *    that rendering tests would otherwise be needed for. Source guards of this
 *    shape are already an established pattern here (see auth-lockout.test.ts,
 *    sec-027-regression.test.ts, lifecycle-consistency.test.ts).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { LIFECYCLE_STAGE, UNKNOWN_STAGE } from "@/app/employees/[id]/lifecycle-stage";
import { PROFILE_SELECT, RESTRICTED_SELECT, FULL_SELECT } from "@/app/employees/[id]/employee-select";
import { EMPLOYEE_LIFECYCLE } from "@/lib/workflow/recruitment-machine";
import { ENTRY_FORM_STATUS_VALUES } from "@/lib/workflow/lifecycle-consistency";

const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

const PAGE = read("app", "employees", "[id]", "page.tsx");
const ROUTE = read("app", "api", "employees", "[id]", "route.ts");

/* ------------------------------------------------------------------ */
/* The stage vocabulary is keyed on `lifecycle`, not on `currentStatus`  */
/* ------------------------------------------------------------------ */

describe("detail page stage vocabulary", () => {
    it("covers every stage LIFECYCLE_TRANSITIONS can produce", () => {
        // A stage added to the state machine without a presentation entry
        // would render the fallback — an unstyled badge and a wrong note.
        for (const stage of Object.values(EMPLOYEE_LIFECYCLE)) {
            expect(LIFECYCLE_STAGE[stage]).toBeDefined();
            expect(LIFECYCLE_STAGE[stage].badge).toBeTruthy();
            expect(LIFECYCLE_STAGE[stage].note).toBeTruthy();
        }
    });

    it("is keyed on lifecycle stages, not on the entry form's currentStatus enum", () => {
        // `ON_LEAVE` is both, but the rest of the two vocabularies do not
        // overlap. If the map were keyed on currentStatus, PRE_JOINING and
        // NOTICE_PERIOD would have no entry and a resigned employee would be
        // styled as if still on notice.
        expect(Object.keys(LIFECYCLE_STAGE)).not.toContain("OFFBOARDED");
        for (const stage of ["PRE_JOINING", "PROBATION", "CONFIRMED", "NOTICE_PERIOD", "EXITED"]) {
            expect(LIFECYCLE_STAGE[stage]).toBeDefined();
        }
    });

    it("keeps the two vocabularies genuinely different", () => {
        // Guards the guard: a regression that collapses `lifecycle` onto
        // `currentStatus` would make the assertions above vacuous.
        const onlyInLifecycle = Object.values(EMPLOYEE_LIFECYCLE).filter(
            (s) => !ENTRY_FORM_STATUS_VALUES.includes(s)
        );
        expect(onlyInLifecycle.length).toBeGreaterThan(0);
        expect(Object.keys(LIFECYCLE_STAGE).length).toBeGreaterThan(ENTRY_FORM_STATUS_VALUES.length);
    });

    it("has a neutral fallback for a value no transition can produce", () => {
        expect(UNKNOWN_STAGE.badge).toBeTruthy();
        expect(UNKNOWN_STAGE.note).toBeTruthy();
    });
});

/* ------------------------------------------------------------------ */
/* Field selection is one shared, disjoint pair                         */
/* ------------------------------------------------------------------ */

describe("detail surface field selection", () => {
    const SENSITIVE = [
        "basicSalary",
        "housingAllowance",
        "transportAllowance",
        "otherAllowance",
        "bankName",
        "accountNumber",
        "iban",
        "ifscCode",
        "governmentId",
        "dateOfBirth",
        "nationality",
        "passportNumber",
        "emiratesId",
        "visaNumber",
    ];

    it("keeps every sensitive column out of the always-visible profile", () => {
        for (const field of SENSITIVE) {
            expect(PROFILE_SELECT).not.toHaveProperty(field);
        }
    });

    it("keeps the two selects disjoint so a restricted column can never be smuggled in", () => {
        for (const field of Object.keys(RESTRICTED_SELECT)) {
            expect(PROFILE_SELECT).not.toHaveProperty(field);
        }
    });

    it("carries the three competing state columns so a divergence is detectable", () => {
        // The page runs `classifyEmployeeState` to SHOW a disagreement. It
        // cannot do that without all three columns.
        expect(PROFILE_SELECT.lifecycle).toBe(true);
        expect(PROFILE_SELECT.currentStatus).toBe(true);
        expect(PROFILE_SELECT.isActive).toBe(true);
    });

    it("exposes document expiry without exposing document numbers", () => {
        expect(PROFILE_SELECT.passportExpiry).toBe(true);
        expect(PROFILE_SELECT.emiratesIdExpiry).toBe(true);
        expect(PROFILE_SELECT.visaExpiry).toBe(true);
        expect(RESTRICTED_SELECT.passportNumber).toBe(true);
        expect(PROFILE_SELECT).not.toHaveProperty("passportNumber");
    });

    it("merges the two sets into one full select without pulling in anything else", () => {
        expect(FULL_SELECT).toEqual({ ...PROFILE_SELECT, ...RESTRICTED_SELECT });
    });

    it("is imported by both the page and the route rather than re-declared", () => {
        // Two copies of a select is how a page and its API drift apart.
        expect(PAGE).toMatch(/from "\.\/employee-select"/);
        expect(ROUTE).toMatch(/from "@\/app\/employees\/\[id\]\/employee-select"/);
        for (const file of [PAGE, ROUTE]) {
            expect(file).not.toMatch(/basicSalary:\s*true/);
            expect(file).not.toMatch(/accountNumber:\s*true/);
        }
    });
});

/* ------------------------------------------------------------------ */
/* Server-side authorization happens before anything is rendered        */
/* ------------------------------------------------------------------ */

describe("detail page authorization ordering", () => {
    it("requires a session through the shared page guard", () => {
        expect(PAGE).toMatch(/requirePageUser/);
    });

    it("checks the capability before it touches the database", () => {
        const capability = PAGE.indexOf("canReadProfile");
        const denial = PAGE.indexOf("<UnauthorizedState />");
        const query = PAGE.indexOf("prisma.employee.findFirst");
        expect(capability).toBeGreaterThan(-1);
        expect(denial).toBeGreaterThan(-1);
        expect(query).toBeGreaterThan(-1);
        // The unauthorized return must precede the first query, or the page
        // would confirm a record exists to a caller that may not see it.
        expect(denial).toBeLessThan(query);
    });

    it("applies organisational scope inside the where clause, not after the fetch", () => {
        const whereIndex = PAGE.indexOf("scopeEmployeeWhere(subject, { id })");
        const queryIndex = PAGE.indexOf("prisma.employee.findFirst");
        expect(whereIndex).toBeGreaterThan(-1);
        expect(whereIndex).toBeLessThan(queryIndex);
        // And no branch quietly looks the record up by bare id.
        expect(PAGE).not.toMatch(/where:\s*\{\s*id\s*\}/);
    });

    it("applies the same scope to both select branches", () => {
        const branches = PAGE.match(/prisma\.employee\.findFirst\(/g) ?? [];
        expect(branches.length).toBe(2);
        expect(PAGE.match(/where,/g) ?? []).toHaveLength(2);
    });

    it("has a distinct not-found state and it never uses a 403", () => {
        expect(PAGE).toMatch(/NotFoundState/);
        // A 403 here would confirm the record exists to a cross-department
        // reader. The page renders the same answer for missing and out-of-scope.
        expect(PAGE).not.toMatch(/notFound\(|status:\s*403/);
    });
});

/* ------------------------------------------------------------------ */
/* The stage is presented as authoritative, and the other columns       */
/* are not promoted to a status of their own                            */
/* ------------------------------------------------------------------ */

describe("detail page lifecycle presentation", () => {
    it("labels the lifecycle stage as the authoritative one", () => {
        expect(PAGE).toMatch(/Lifecycle stage/);
        expect(PAGE).toMatch(/authoritative/i);
        expect(PAGE).toMatch(/Employee\.lifecycle/);
    });

    it("renders the badge from the lifecycle value, not from currentStatus", () => {
        expect(PAGE).toMatch(/employee\.lifecycle\.replace/);
        // A badge whose text is `currentStatus` is the competing badge this
        // page exists to avoid.
        expect(PAGE).not.toMatch(/\{employee\.currentStatus\}/);
    });

    it("surfaces currentStatus only as divergence evidence", () => {
        expect(PAGE).toMatch(/classifyEmployeeState/);
        expect(PAGE).toMatch(/Non-authoritative column values/);
    });

    it("links back to the directory from both terminal states", () => {
        const backLinks = PAGE.match(/href="\/employees"/g) ?? [];
        expect(backLinks.length).toBeGreaterThanOrEqual(3);
    });
});
