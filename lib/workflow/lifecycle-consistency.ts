/**
 * Lifecycle-state consistency diagnostics.
 *
 * WHY THIS EXISTS
 * `Employee` carries three overlapping representations of employment state:
 *
 *   - `lifecycle`       String  @default("PRE_JOINING")   schema.prisma:578
 *   - `currentStatus`   String  @default("ACTIVE")        schema.prisma:536
 *   - `isActive`        Boolean @default(true)             schema.prisma:537
 *
 * The only CHECK constraint on the table, `Employee_active_requires_employment_data`,
 * is about COMPLETENESS (an ACTIVE row must carry job data). It says nothing about
 * the three columns agreeing with each other, and nothing in the database makes
 * them agree. So the disagreement is not theoretical:
 *
 *   - `saveEmployee` writes all three, but `lifecycle` is derived from
 *     `currentStatus` because the entry form cannot express PROBATION or
 *     CONFIRMED (`lifecycleOnSave`, lib/employees/lifecycle-stage.ts). A save
 *     therefore cannot tell the recruitment machine that a probationer was
 *     confirmed — but it also cannot silently drop the stage.
 *   - The employee edit dialog exposes that `currentStatus` select
 *     (app/employees/employee-list.tsx), so the divergence is one HR click away.
 *   - The paths that END employment all write the three columns together: the
 *     live exit (app/lib/actions/exit.ts:1231-1241), the retention archive
 *     (lib/employees/retention.ts:359) and the offboarding workflow
 *     (lib/workflow/offboarding.ts). Nothing enforces that, so this module is
 *     what notices when a write path forgets.
 *
 * `isActive` is the field with teeth: it selects the payroll run
 * (app/lib/actions/payroll.ts:65), attendance, leave accrual and compliance
 * scans. A departed employee who is still `isActive` is still being paid.
 * EVERY path that ends employment clears it in the same write that moves the
 * status — the live exit (app/lib/actions/exit.ts:1239) and the retention
 * archive (lib/employees/retention.ts:361) both do — so a row reported here as
 * `TERMINAL_STATUS_STILL_ACTIVE` or `TERMINATED_LIFECYCLE_STILL_ACTIVE` is a row
 * some write path left behind, never a legitimate one. That is the whole reason
 * these two rules are worth the read: they cannot fire on the exit path, so
 * firing means a bug.
 *
 * This module is READ-ONLY by construction: it issues `findMany`/`SELECT`
 * against `pg_constraint` and nothing else. There is no repair path here on
 * purpose — choosing the correct value is a business decision, and a module
 * that can fix drift can also cause it.
 *
 * The point is to convert "these three fields might disagree" into a number
 * that can be watched, so blocker 2.5 stops being a claim.
 */

import { EMPLOYEE_LIFECYCLE } from "@/lib/workflow/recruitment-machine";
import { KNOWN_ROLES } from "@/lib/auth/roles";

/* ------------------------------------------------------------------ */
/* Vocabularies                                                        */
/* ------------------------------------------------------------------ */

const L = EMPLOYEE_LIFECYCLE;

/** Every `lifecycle` value the state machine can produce. */
export const KNOWN_LIFECYCLE_VALUES: readonly string[] = Object.values(L);

/**
 * `currentStatus` values the employee entry/update form can produce.
 * Mirrors `app/lib/validation.ts:83` and `:201` — the Zod enum, NOT the
 * database column, because the column is unconstrained.
 */
export const ENTRY_FORM_STATUS_VALUES: readonly string[] = ["PRE_JOINING", "ACTIVE", "ON_LEAVE", "RESIGNED", "TERMINATED", "OFFBOARDED"];

/** Terminal `lifecycle` stages: employment has ended, unambiguously. */
export const TERMINAL_LIFECYCLE_STAGES: readonly string[] = [L.RESIGNED, L.TERMINATED, L.EXITED];

/** `lifecycle` stages where the person is employed and working. */
export const EMPLOYED_LIFECYCLE_STAGES: readonly string[] = [L.ACTIVE, L.PROBATION, L.CONFIRMED];

/** `currentStatus` values that mean "no longer on the workforce". */
export const TERMINAL_STATUS_VALUES: readonly string[] = ["RESIGNED", "TERMINATED", "OFFBOARDED"];

/* ------------------------------------------------------------------ */
/* Finding shapes                                                      */
/* ------------------------------------------------------------------ */

export type Severity = "critical" | "warning";

export type DivergenceCode =
    /** `lifecycle` says the employment ended, `isActive` still says employed. */
    | "TERMINATED_LIFECYCLE_STILL_ACTIVE"
    /** `lifecycle` says the employment ended, `currentStatus` still says working. */
    | "TERMINATED_LIFECYCLE_STATUS_WORKING"
    /** `lifecycle` says employed, `currentStatus` says they left. */
    | "EMPLOYED_LIFECYCLE_STATUS_TERMINAL"
    /** `currentStatus` says they left, `isActive` still says employed. */
    | "TERMINAL_STATUS_STILL_ACTIVE"
    /** One column says "on leave", the other does not. */
    | "ON_LEAVE_STAGE_MISMATCH"
    /** A staged record that has not joined is still counted as an active employee. */
    | "PRE_JOINING_MARKED_ACTIVE"
    /** A `lifecycle` value no state machine transition can produce. */
    | "UNKNOWN_LIFECYCLE_VALUE"
    /** A `currentStatus` the entry form's Zod enum would refuse. */
    | "STATUS_OUTSIDE_ENTRY_FORM";

export interface EmployeeStateRow {
    id: string;
    employeeCode: string | null;
    firstName: string;
    lastName: string;
    lifecycle: string;
    currentStatus: string;
    isActive: boolean;
}

export interface Divergence {
    code: DivergenceCode;
    severity: Severity;
    employeeId: string;
    employeeCode: string | null;
    name: string;
    lifecycle: string;
    currentStatus: string;
    isActive: boolean;
    /** What the row claims, and why those three columns cannot all be true. */
    detail: string;
}

export type RoleDefectCode = "UNKNOWN_ROLE" | "NON_CANONICAL_ROLE";

export interface UserRoleRow {
    id: string;
    email: string;
    role: string;
}

export interface RoleDefect {
    code: RoleDefectCode;
    severity: Severity;
    userId: string;
    email: string;
    role: string;
    detail: string;
}

export interface ConsistencySummary {
    employeesExamined: number;
    usersExamined: number;
    critical: number;
    warning: number;
    /** `critical + warning`, deduplicated per (row, code). */
    total: number;
    byCode: Record<string, number>;
}

/* ------------------------------------------------------------------ */
/* Classification (pure)                                               */
/* ------------------------------------------------------------------ */

function inSet(value: string, set: readonly string[]): boolean {
    return set.includes(value);
}

function describe(row: EmployeeStateRow): { employeeCode: string | null; name: string } {
    return {
        employeeCode: row.employeeCode,
        name: `${row.firstName} ${row.lastName}`.trim(),
    };
}

function finding(
    row: EmployeeStateRow,
    code: DivergenceCode,
    severity: Severity,
    detail: string
): Divergence {
    return {
        code,
        severity,
        employeeId: row.id,
        ...describe(row),
        lifecycle: row.lifecycle,
        currentStatus: row.currentStatus,
        isActive: row.isActive,
        detail,
    };
}

/**
 * Classify one employee row. Returns an empty array when the three columns
 * agree; a rule fires on each independent contradiction, so one row can
 * report more than one finding.
 */
export function classifyEmployeeState(row: EmployeeStateRow): Divergence[] {
    const out: Divergence[] = [];
    const lifecycleKnown = inSet(row.lifecycle, KNOWN_LIFECYCLE_VALUES);
    const statusKnown = inSet(row.currentStatus, ENTRY_FORM_STATUS_VALUES);
    const lifecycleTerminal = inSet(row.lifecycle, TERMINAL_LIFECYCLE_STAGES);
    const lifecycleEmployed = inSet(row.lifecycle, EMPLOYED_LIFECYCLE_STAGES);
    const statusTerminal = inSet(row.currentStatus, TERMINAL_STATUS_VALUES);
    const statusWorking = row.currentStatus === "ACTIVE" || row.currentStatus === "ON_LEAVE";

    if (!lifecycleKnown) {
        out.push(
            finding(
                row,
                "UNKNOWN_LIFECYCLE_VALUE",
                "warning",
                `lifecycle="${row.lifecycle}" is not a stage LIFECYCLE_TRANSITIONS can produce, so no transition guard applies to this row.`
            )
        );
    }

    if (!statusKnown) {
        out.push(
            finding(
                row,
                "STATUS_OUTSIDE_ENTRY_FORM",
                "warning",
                `currentStatus="${row.currentStatus}" is not in the employee form's Zod enum, so the edit dialog cannot round-trip it (app/lib/validation.ts:83).`
            )
        );
    }

    if (lifecycleTerminal && row.isActive) {
        out.push(
            finding(
                row,
                "TERMINATED_LIFECYCLE_STILL_ACTIVE",
                "critical",
                `lifecycle=${row.lifecycle} but isActive=true, so the row still reaches payroll (app/lib/actions/payroll.ts:65), attendance and accrual.`
            )
        );
    }

    if (lifecycleTerminal && statusWorking) {
        out.push(
            finding(
                row,
                "TERMINATED_LIFECYCLE_STATUS_WORKING",
                "critical",
                `lifecycle=${row.lifecycle} contradicts currentStatus=${row.currentStatus}.`
            )
        );
    }

    if (lifecycleEmployed && statusTerminal) {
        out.push(
            finding(
                row,
                "EMPLOYED_LIFECYCLE_STATUS_TERMINAL",
                "critical",
                `lifecycle=${row.lifecycle} but currentStatus=${row.currentStatus}. A full save derives lifecycle from currentStatus, preserving only PROBATION/CONFIRMED (lib/employees/lifecycle-stage.ts), so this pair means the stage was moved by the lifecycle machine or by a write older than that rule.`
            )
        );
    }

    if (statusTerminal && row.isActive) {
        out.push(
            finding(
                row,
                "TERMINAL_STATUS_STILL_ACTIVE",
                "critical",
                `currentStatus=${row.currentStatus} but isActive=true. The live exit (app/lib/actions/exit.ts:1239) and the retention archive (lib/employees/retention.ts:361) both clear isActive in the same write that moves the status, so this row was left behind by a path that moved only the status. This is a departed employee still being paid.`
            )
        );
    }

    // NOTICE_PERIOD is a legitimate partner of currentStatus="ON_LEAVE": that is
    // exactly the pair `initiateOffboarding` writes (lib/workflow/offboarding.ts)
    // and LIFECYCLE_TRANSITIONS permits from every employed stage. Treating it as
    // a mismatch would report a row the application now writes on purpose.
    const leaveFromLifecycle = row.lifecycle === L.ON_LEAVE || row.lifecycle === L.NOTICE_PERIOD;
    const leaveFromStatus = row.currentStatus === "ON_LEAVE";
    if (leaveFromLifecycle !== leaveFromStatus) {
        out.push(
            finding(
                row,
                "ON_LEAVE_STAGE_MISMATCH",
                "warning",
                `lifecycle=${row.lifecycle} but currentStatus=${row.currentStatus}. lifecycle=ON_LEAVE belongs with currentStatus="ON_LEAVE"; NOTICE_PERIOD pairs with it too, which is what the offboarding workflow writes (lib/workflow/offboarding.ts).`
            )
        );
    }

    if (row.lifecycle === L.PRE_JOINING && (row.isActive || row.currentStatus === "ACTIVE")) {
        out.push(
            finding(
                row,
                "PRE_JOINING_MARKED_ACTIVE",
                "critical",
                `lifecycle=PRE_JOINING but isActive=${row.isActive} and currentStatus=${row.currentStatus}. The schema default is isActive=true/currentStatus="ACTIVE", which contradicts the provisional-entry contract "it must never be treated as an active employee" (app/lib/validation.ts:173).`
            )
        );
    }

    return out;
}

export function classifyUserRole(row: UserRoleRow): RoleDefect[] {
    if (inSet(row.role, KNOWN_ROLES)) return [];

    // `toRole()` upper-cases before matching (lib/auth/roles.ts:66), so a
    // case-variant still resolves to a real role at runtime. It is not equal
    // to it, though: any `role === "ADMIN"` comparison in the codebase misses.
    const upper = row.role.trim().toUpperCase();
    if (inSet(upper, KNOWN_ROLES)) {
        return [
            {
                code: "NON_CANONICAL_ROLE",
                severity: "warning",
                userId: row.id,
                email: row.email,
                role: row.role,
                detail: `"${row.role}" resolves to ${upper} only because toRole() upper-cases it (lib/auth/roles.ts:64). A strict equality check would not match.`,
            },
        ];
    }

    return [
        {
            code: "UNKNOWN_ROLE",
            severity: "critical",
            userId: row.id,
            email: row.email,
            role: row.role,
            detail: `"${row.role}" is not a known role. toRole() collapses it to STAFF (lib/auth/roles.ts:64-69), so the account silently holds least privilege and no error is raised.`,
        },
    ];
}

/* ------------------------------------------------------------------ */
/* Reporting (pure)                                                    */
/* ------------------------------------------------------------------ */

export function summarize(
    employeesExamined: number,
    usersExamined: number,
    divergences: readonly Divergence[],
    roleDefects: readonly RoleDefect[]
): ConsistencySummary {
    const byCode: Record<string, number> = {};
    for (const d of divergences) byCode[d.code] = (byCode[d.code] ?? 0) + 1;
    for (const d of roleDefects) byCode[d.code] = (byCode[d.code] ?? 0) + 1;

    const all = [...divergences, ...roleDefects];
    return {
        employeesExamined,
        usersExamined,
        critical: all.filter((f) => f.severity === "critical").length,
        warning: all.filter((f) => f.severity === "warning").length,
        total: all.length,
        byCode,
    };
}

export interface ConsistencyReport {
    summary: ConsistencySummary;
    divergences: Divergence[];
    roleDefects: RoleDefect[];
    /**
     * Whether the database itself constrains `User.role`. `false` means the
     * only thing keeping the column to the known vocabulary is application
     * code. Measured from `pg_constraint`, not assumed.
     */
    userRoleConstraintPresent: boolean | null;
}

/* ------------------------------------------------------------------ */
/* Read-only collection                                                */
/* ------------------------------------------------------------------ */

/** The narrow slice of the Prisma client this module needs. */
export interface ConsistencyReadClient {
    employee: { findMany(args: unknown): Promise<EmployeeStateRow[]> };
    user: { findMany(args: unknown): Promise<UserRoleRow[]> };
    $queryRawUnsafe<T>(query: string): Promise<T>;
}

/**
 * Collect the report. Issues exactly two `SELECT`s and one catalogue query;
 * there is no code path in this module that can write.
 */
export async function collectConsistencyReport(
    db: ConsistencyReadClient
): Promise<ConsistencyReport> {
    const employees = await db.employee.findMany({
        select: {
            id: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
            lifecycle: true,
            currentStatus: true,
            isActive: true,
        },
        orderBy: { id: "asc" },
    });

    const users = await db.user.findMany({
        select: { id: true, email: true, role: true },
        orderBy: { id: "asc" },
    });

    // `pg_constraint` is a catalogue read. A CHECK on "User" mentioning the
    // role column is the only thing that would stop a bad write at the source.
    const roleConstraints = await db.$queryRawUnsafe<{ conname: string; definition: string }[]>(
        `SELECT conname, pg_get_constraintdef(oid) AS definition
           FROM pg_constraint
          WHERE conrelid = 'public."User"'::regclass
            AND contype = 'c'
            AND pg_get_constraintdef(oid) ILIKE '%role%'`
    );

    const divergences = employees.flatMap(classifyEmployeeState);
    const roleDefects = users.flatMap(classifyUserRole);

    return {
        summary: summarize(employees.length, users.length, divergences, roleDefects),
        divergences,
        roleDefects,
        userRoleConstraintPresent: roleConstraints.length > 0,
    };
}
