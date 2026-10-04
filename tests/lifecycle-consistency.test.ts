/**
 * Lifecycle-state consistency — diagnostics and regression guards.
 *
 * `Employee` holds three overlapping representations of employment state
 * (`lifecycle`, `currentStatus`, `isActive`) and no constraint makes them agree.
 * These tests do two things:
 *
 *   1. Prove the classifier that measures the divergence is correct, by
 *      asserting on synthetic rows whose correct classification is
 *      unambiguous.
 *   2. Guard the *write paths* that were verified to create divergence, so the
 *      day one of them is fixed the guard fails loudly instead of the drift
 *      quietly persisting. Every structural claim is anchored to a file:line
 *      recorded in the assertion message.
 *
 * The live-database block at the end is the measurable baseline for blocker
 * 2.5: it asserts what the divergence count is TODAY, against real rows.
 */
import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import prisma from "@/lib/prisma";
import {
    classifyEmployeeState,
    classifyUserRole,
    collectConsistencyReport,
    summarize,
    ENTRY_FORM_STATUS_VALUES,
    KNOWN_LIFECYCLE_VALUES,
    type EmployeeStateRow,
    type UserRoleRow,
} from "@/lib/workflow/lifecycle-consistency";
import { archiveGuard, archiveWrite, restoreWrite } from "@/lib/employees/retention";
import { lifecycleOnSave } from "@/lib/employees/lifecycle-stage";

afterAll(async () => {
    await prisma.$disconnect();
});

const source = (relativePath: string) =>
    readFileSync(new URL(relativePath, import.meta.url), "utf8");

/**
 * Removes block and line comments before a source-level assertion runs.
 *
 * Needed because this module documents its own former defect in prose, and a
 * mention of `prisma.employee.delete(` inside a doc comment is not a call.
 * Without this, "count the hard deletes" counts the documentation too.
 */
function stripComments(code: string): string {
    return code
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function employee(overrides: Partial<EmployeeStateRow> = {}): EmployeeStateRow {
    return {
        id: "emp-1",
        employeeCode: "EMP-001",
        firstName: "Test",
        lastName: "Subject",
        lifecycle: "ACTIVE",
        currentStatus: "ACTIVE",
        isActive: true,
        ...overrides,
    };
}

function user(overrides: Partial<UserRoleRow> = {}): UserRoleRow {
    return { id: "u-1", email: "person@example.com", role: "HR", ...overrides };
}

const codes = (rows: ReturnType<typeof classifyEmployeeState>) => rows.map((d) => d.code).sort();

/* ================================================================== */
/* A consistent row is silent                                         */
/* ================================================================== */

describe("a row whose three columns agree reports nothing", () => {
    it("is silent for an ordinary active employee", () => {
        expect(classifyEmployeeState(employee())).toEqual([]);
    });

    it("is silent for a properly exited employee", () => {
        expect(
            classifyEmployeeState(
                employee({ lifecycle: "EXITED", currentStatus: "TERMINATED", isActive: false })
            )
        ).toEqual([]);
    });

    it("is silent for a probationer who is on leave in both columns", () => {
        expect(classifyEmployeeState(employee({ lifecycle: "ON_LEAVE", currentStatus: "ON_LEAVE" }))).toEqual([]);
    });
});

/* ================================================================== */
/* Each confirmed divergence has its own rule                          */
/* ================================================================== */

describe("lifecycle is terminal but the row is still an active employee", () => {
    it("flags the active flag, which is what payroll and attendance read", () => {
        const found = classifyEmployeeState(
            employee({ lifecycle: "TERMINATED", currentStatus: "TERMINATED", isActive: true })
        );
        expect(codes(found)).toContain("TERMINATED_LIFECYCLE_STILL_ACTIVE");
        expect(found.every((d) => d.severity === "critical")).toBe(true);
    });

    it("flags a terminal lifecycle that still claims to be working", () => {
        const found = classifyEmployeeState(employee({ lifecycle: "RESIGNED", currentStatus: "ACTIVE" }));
        expect(codes(found)).toEqual(
            expect.arrayContaining(["TERMINATED_LIFECYCLE_STATUS_WORKING", "TERMINATED_LIFECYCLE_STILL_ACTIVE"])
        );
    });

    it("flags a terminal currentStatus with no lifecycle change behind it", () => {
        // This is the shape the mounted edit dialog produces: HR picks
        // "Resigned" in the status select (app/employees/employee-list.tsx:765)
        // and saveEmployee writes currentStatus alone
        // (app/lib/actions/employees.ts:123).
        const found = classifyEmployeeState(employee({ lifecycle: "ACTIVE", currentStatus: "RESIGNED" }));
        expect(codes(found)).toEqual(
            expect.arrayContaining(["EMPLOYED_LIFECYCLE_STATUS_TERMINAL", "TERMINAL_STATUS_STILL_ACTIVE"])
        );
    });

    it("does not flag a terminal currentStatus that also deactivated the row", () => {
        const found = classifyEmployeeState(
            employee({ lifecycle: "RESIGNED", currentStatus: "TERMINATED", isActive: false })
        );
        expect(found).toEqual([]);
    });
});

describe("staged entry", () => {
    it("flags a PRE_JOINING record that the schema defaults mark as an active employee", () => {
        // schema.prisma:536-537,578 default currentStatus="ACTIVE",
        // isActive=true, lifecycle="PRE_JOINING" — which contradicts the
        // provisional-entry contract at app/lib/validation.ts:173.
        const found = classifyEmployeeState(
            employee({ lifecycle: "PRE_JOINING", currentStatus: "ACTIVE", isActive: true })
        );
        expect(codes(found)).toEqual(["PRE_JOINING_MARKED_ACTIVE"]);
        expect(found[0].severity).toBe("critical");
    });

    it("is silent once a staged record is both inactive and not ACTIVE", () => {
        expect(
            classifyEmployeeState(
                employee({ lifecycle: "PRE_JOINING", currentStatus: "RESIGNED", isActive: false })
            )
        ).toEqual([]);
    });
});

describe("offboarding moves the status the lifecycle never sees", () => {
    it("flags the ON_LEAVE status written at offboarding initiation", () => {
        // `initiateOffboarding` now writes lifecycle=NOTICE_PERIOD alongside it
        // (lib/workflow/offboarding.ts), so only a row that keeps a SUBSTANTIVE
        // stage — ACTIVE, PROBATION, CONFIRMED — is still a mismatch.
        const found = classifyEmployeeState(employee({ lifecycle: "ACTIVE", currentStatus: "ON_LEAVE" }));
        expect(codes(found)).toEqual(["ON_LEAVE_STAGE_MISMATCH"]);
        expect(found[0].detail).toContain("lib/workflow/offboarding.ts");
    });

    it("is silent for the NOTICE_PERIOD pair the offboarding workflow writes", () => {
        // The shape `initiateOffboarding` produces: employed, on notice, still
        // paid. Flagging it would report an intended state as drift.
        expect(
            classifyEmployeeState(
                employee({ lifecycle: "NOTICE_PERIOD", currentStatus: "ON_LEAVE", isActive: true })
            )
        ).toEqual([]);
    });

    it("accepts OFFBOARDED, which the entry form's Zod enum does accept", () => {
        // This test used to assert the opposite. It was written when the form's
        // enum (app/lib/validation.ts:83) was ["ACTIVE","ON_LEAVE","RESIGNED",
        // "TERMINATED"] and OFFBOARDING genuinely left a row the edit dialog
        // could not reopen without silently rewriting the status.
        //
        // Both enums now carry all six values, so a completed offboarding is
        // reachable from the form and OFFBOARDED must NOT be reported as outside
        // it. `ENTRY_FORM_STATUS_VALUES` mirrors the Zod enum, so flagging it
        // here would have been a false positive against real HR data.
        const found = classifyEmployeeState(
            employee({ lifecycle: "EXITED", currentStatus: "OFFBOARDED", isActive: false })
        );
        expect(codes(found)).toEqual([]);
    });
});

describe("values outside the declared vocabularies", () => {
    it("flags a lifecycle value no transition in LIFECYCLE_TRANSITIONS can produce", () => {
        const found = classifyEmployeeState(employee({ lifecycle: "SABATONICAL" }));
        expect(codes(found)).toEqual(["UNKNOWN_LIFECYCLE_VALUE"]);
        expect(found[0].severity).toBe("warning");
    });

    it("keeps the vocabularies the classifier trusts in step with the code", () => {
        expect(KNOWN_LIFECYCLE_VALUES).toContain("NOTICE_PERIOD");
        // Must stay equal to BOTH Zod enums at app/lib/validation.ts:83
        // (employeeSchema) and :220 (employeeSchemaProvisional). The mirror is
        // the whole point of this list, so it is pinned in full rather than by
        // sampling — a silent drop of one value is exactly the drift that made
        // this assertion fail while the code was correct.
        expect(ENTRY_FORM_STATUS_VALUES).toEqual([
            "PRE_JOINING",
            "ACTIVE",
            "ON_LEAVE",
            "RESIGNED",
            "TERMINATED",
            "OFFBOARDED",
        ]);
    });
});

/* ================================================================== */
/* Roles                                                               */
/* ================================================================== */

describe("user role classification", () => {
    it("is silent for every known role", () => {
        for (const role of ["SUPER_ADMIN", "ADMIN", "HR", "FINANCE", "MANAGER", "STAFF"]) {
            expect(classifyUserRole(user({ role }))).toEqual([]);
        }
    });

    it("flags an unknown role as critical, because toRole() silently demotes it", () => {
        const found = classifyUserRole(user({ role: "SUPERADMIN" }));
        expect(found).toHaveLength(1);
        expect(found[0].code).toBe("UNKNOWN_ROLE");
        expect(found[0].severity).toBe("critical");
        expect(found[0].detail).toContain("STAFF");
    });

    it("separates a case-variant that resolves from a value that does not exist", () => {
        const found = classifyUserRole(user({ role: "admin" }));
        expect(found).toHaveLength(1);
        expect(found[0].code).toBe("NON_CANONICAL_ROLE");
        expect(found[0].severity).toBe("warning");
    });
});

/* ================================================================== */
/* Summarising                                                         */
/* ================================================================== */

describe("summarize", () => {
    it("counts severity and code, and reports zeroes for a clean database", () => {
        const clean = summarize(3, 3, [], []);
        expect(clean).toEqual({
            employeesExamined: 3,
            usersExamined: 3,
            critical: 0,
            warning: 0,
            total: 0,
            byCode: {},
        });
    });

    it("totals critical and warning across both finding kinds", () => {
        const report = summarize(
            1,
            1,
            classifyEmployeeState(employee({ lifecycle: "ACTIVE", currentStatus: "RESIGNED" })),
            classifyUserRole(user({ role: "root" }))
        );
        expect(report.critical).toBe(3);
        expect(report.warning).toBe(0);
        expect(report.total).toBe(3);
        expect(report.byCode).toEqual({
            EMPLOYED_LIFECYCLE_STATUS_TERMINAL: 1,
            TERMINAL_STATUS_STILL_ACTIVE: 1,
            UNKNOWN_ROLE: 1,
        });
    });
});

/* ================================================================== */
/* The collector is read-only                                         */
/* ================================================================== */

describe("collectConsistencyReport", () => {
    it("issues only reads and reports the constraint it found", async () => {
        const calls: string[] = [];
        const fake = {
            employee: {
                async findMany() {
                    calls.push("employee.findMany");
                    return [
                        {
                            id: "e1",
                            employeeCode: "EMP-001",
                            firstName: "A",
                            lastName: "B",
                            lifecycle: "ACTIVE",
                            currentStatus: "ACTIVE",
                            isActive: true,
                        },
                    ];
                },
            },
            user: {
                async findMany() {
                    calls.push("user.findMany");
                    return [{ id: "u1", email: "a@b.com", role: "STAFF" }];
                },
            },
            async $queryRawUnsafe<T>() {
                calls.push("$queryRawUnsafe");
                return [] as T;
            },
        };

        const report = await collectConsistencyReport(fake);

        expect(calls).toEqual(["employee.findMany", "user.findMany", "$queryRawUnsafe"]);
        expect(report.summary.total).toBe(0);
        expect(report.userRoleConstraintPresent).toBe(false);
    });

    it("reports a role CHECK constraint when the catalogue has one", async () => {
        const fake = {
            employee: { async findMany() { return []; } },
            user: { async findMany() { return []; } },
            async $queryRawUnsafe<T>() {
                return [
                    { conname: "User_role_check", definition: 'CHECK (role = ANY (ARRAY[...]))' },
                ] as T;
            },
        };
        expect((await collectConsistencyReport(fake)).userRoleConstraintPresent).toBe(true);
    });
});

/* ================================================================== */
/* Structural regression guards                                        */
/* ================================================================== */

describe("the write paths that create divergence", () => {
    it("a full save preserves the stages the entry form cannot express", () => {
        // The defect this inverts: lifecycle was derived from currentStatus, and
        // the status enum has no PROBATION/CONFIRMED member, so saving a
        // probationer's profile rewrote the stage as "ACTIVE".
        expect(lifecycleOnSave("PROBATION", "ACTIVE")).toBe("PROBATION");
        expect(lifecycleOnSave("CONFIRMED", "ACTIVE")).toBe("CONFIRMED");
        // ON_LEAVE is a temporary overlay, not a departure.
        expect(lifecycleOnSave("PROBATION", "ON_LEAVE")).toBe("PROBATION");
        // A status that genuinely changes the employment state still wins.
        expect(lifecycleOnSave("PROBATION", "RESIGNED")).toBe("RESIGNED");
        expect(lifecycleOnSave("PROBATION", "TERMINATED")).toBe("TERMINATED");
        expect(lifecycleOnSave("PROBATION", "OFFBOARDED")).toBe("EXITED");
        expect(lifecycleOnSave("PROBATION", "PRE_JOINING")).toBe("PRE_JOINING");
        // Nothing to preserve: a new record, or a stage that is derivable.
        expect(lifecycleOnSave(null, "ACTIVE")).toBe("ACTIVE");
        expect(lifecycleOnSave(undefined, "PRE_JOINING")).toBe("PRE_JOINING");
        expect(lifecycleOnSave("ACTIVE", "ACTIVE")).toBe("ACTIVE");

        // And the action really routes its write through the rule.
        expect(source("../app/lib/actions/employees.ts")).toContain(
            "lifecycleOnSave(existingLifecycle, currentStatus)"
        );
    });

    it("the offboarding workflow writes all three axes together, on both edges", () => {
        const code = source("../lib/workflow/offboarding.ts");
        // Initiation: still employed (isActive untouched) but on notice. The
        // order below is the order in the file, so this cannot be satisfied by
        // two writes in different places.
        expect(code).toMatch(/currentStatus: "ON_LEAVE",\s*\n\s*lifecycle: "NOTICE_PERIOD"/);
        // Completion: the shape the live exit already writes
        // (app/lib/actions/exit.ts:1231-1241).
        expect(code).toMatch(
            /currentStatus: "OFFBOARDED",\s*\n\s*lifecycle: "EXITED",\s*\n\s*isActive: false/
        );
    });

    it("a full save is the only app/ read of Employee.lifecycle, and it reads to preserve", () => {
        // Blocker 2.5 rested on lifecycle being invisible to every read path.
        // `upsertEmployee` and `restoreEmployee` now read it — one to preserve
        // the stage across a full save, one to refuse reactivating a departed
        // employee — so the guard is narrowed from "nothing reads it" to "no
        // component and no operational query reads it".
        for (const file of [
            "../app/employees/employee-list.tsx",
            "../app/employees/page.tsx",
            "../app/dashboard/page.tsx",
            "../app/lib/actions/payroll.ts",
            "../app/attendance/page.tsx",
        ]) {
            const code = source(file);
            // Allow the word inside a comment or prose; forbid a real read.
            expect(code, `${file} must not read Employee.lifecycle`).not.toMatch(
                /(currentStatus\s*:|select\s*:|where\s*:)[\s\S]{0,400}?\blifecycle\b/
            );
        }

        const employees = source("../app/lib/actions/employees.ts");
        expect(employees).toContain("lifecycleOnSave(existingLifecycle, currentStatus)");
        expect(employees).toContain("isTerminalEmploymentState(target)");
    });

    it("no longer hard-deletes: the only DELETE is inside purgeEmployee, behind its gates", () => {
        // This test USED to assert the opposite — that `deleteEmployee` was still
        // a hard delete — as a deliberate pin so blocker 6.5 could not be claimed
        // by accident. Retention has now been implemented, so the pin has done
        // its job and is inverted into something stronger: rather than pinning
        // the defect, it pins the INVARIANT. A hard delete may exist in this
        // module, but exactly one, and only behind the purge gates.
        //
        // Comments are stripped first. This module documents the old defect in
        // prose, and counting a mention inside a comment as a live DELETE made
        // this assertion count 3 instead of 1.
        const code = stripComments(source("../app/lib/actions/employees.ts"));

        expect(code.match(/prisma\.employee\.delete\(/g) ?? []).toHaveLength(1);

        // The legacy alias must delegate to the archive, not delete.
        const alias = stripComments(
            code.slice(code.indexOf("export async function deleteEmployee"))
        );
        expect(alias).toContain("archiveEmployee");
        expect(alias).not.toContain("prisma.employee.delete(");

        // Guard ordering inside the purge: authorisation, then retention
        // eligibility, and only then the DELETE. Reordering so the delete comes
        // first fails here.
        //
        // The body is delimited by the next top-level `export`, not by the
        // first `\n}`: this function's parameter is a multi-line object literal,
        // and any line that happens to start with `}` at column 0 inside it
        // truncates the slice before the guards are reached.
        const purgeStart = code.indexOf("export async function purgeEmployee");
        const purgeEnd = code.indexOf("\nexport ", purgeStart + 1);
        const purgeBody = code.slice(purgeStart, purgeEnd === -1 ? undefined : purgeEnd);

        const iSuperAdmin = purgeBody.indexOf("requireSuperAdmin");
        const iEligibility = purgeBody.indexOf("purgeEligibility");
        const iDelete = purgeBody.indexOf("prisma.employee.delete(");
        expect(iSuperAdmin, "purge must require SUPER_ADMIN").toBeGreaterThan(-1);
        expect(iEligibility, "purge must check retention eligibility").toBeGreaterThan(iSuperAdmin);
        expect(iDelete, "the delete must come last").toBeGreaterThan(iEligibility);
    });

    it("archives with a guarded write, not a delete (behavioural, not source-shaped)", () => {
        // The archive rule is expressed as pure exported helpers, so assert what
        // they RETURN rather than how the call site is written. That survives a
        // refactor of the calling code and cannot be satisfied by a comment.
        // `archiveGuard` guards on `deletedAt: null`, which is what makes a
        // second archive a no-op instead of an error or a second tombstone.
        expect(archiveGuard("emp-1")).toEqual({ id: "emp-1", deletedAt: null });

        // `deletedAt` and `isActive` are set in ONE object, so there is never a
        // window in which a row is archived but still flagged active.
        expect(archiveWrite(new Date("2026-01-01T00:00:00.000Z"))).toEqual({
            deletedAt: new Date("2026-01-01T00:00:00.000Z"),
            isActive: false,
        });

        // Restore is the mirror image, guarded the same way. The `isActive` value is the
        // caller's decision, so it is asserted both ways: true for a row whose
        // employment continues, false for one archived after a terminal exit.
        expect(restoreWrite(true)).toEqual({ deletedAt: null, isActive: true });
        expect(restoreWrite(false)).toEqual({ deletedAt: null, isActive: false });
    });
});

/* ================================================================== */
/* Live baseline                                                       */
/* ================================================================== */

describe("live database baseline", () => {
    it("has no CHECK constraint on User.role, so an invalid role is writable", async () => {
        const report = await collectConsistencyReport(prisma);
        expect(report.userRoleConstraintPresent).toBe(false);
    });

    it("has the completeness CHECK on Employee but no agreement CHECK", async () => {
        const constraints = await prisma.$queryRawUnsafe<{ conname: string }[]>(
            `SELECT conname FROM pg_constraint
              WHERE conrelid = 'public."Employee"'::regclass AND contype = 'c'`
        );
        const names = constraints.map((c) => c.conname);
        // Proves 2.3: completeness is enforced.
        expect(names).toContain("Employee_active_requires_employment_data");
        // Proves the limit of 2.5: that CHECK is about completeness only. It
        // constrains `lifecycle` against three other columns, never
        // `lifecycle` against `currentStatus` or `isActive`.
        expect(names.filter((n) => /agreement|consistent|state_match/i.test(n))).toEqual([]);
    });

    it("reports zero lifecycle divergence across every current employee row", async () => {
        const report = await collectConsistencyReport(prisma);
        expect(report.divergences, JSON.stringify(report.divergences, null, 2)).toEqual([]);
        expect(report.summary.critical).toBe(0);
    });

    it("reports every current user role as known", async () => {
        const report = await collectConsistencyReport(prisma);
        expect(report.roleDefects, JSON.stringify(report.roleDefects, null, 2)).toEqual([]);
    });

    it("leaves no rows behind", async () => {
        expect(await prisma.employee.count({ where: { email: "lifecycle.proof@example.invalid" } })).toBe(0);
    });
});
