/**
 * The employee read-path register (RET-001).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Adding `Employee.deletedAt` creates a leak in two directions at once:
 *
 *   FORWARD  — an archived employee keeps showing up in a directory, a search
 *              box or a headcount counter. Nobody can tell the row is archived,
 *              so HR acts on a record that is supposed to be out of circulation.
 *   BACKWARD — archived records become unreachable, and an archive with no way
 *              back is a slow delete with extra steps.
 *
 * The forward direction is the one that gets missed, because it is not a single
 * call site. An employee row is read by ~40 queries across the application, and
 * only some of them filter. This module is the checked-in audit of all of them:
 * what each one is for, whether it excludes archived rows today, and — where it
 * does not — the exact change required.
 *
 * It is data, not logic. `tests/employee-retention-readpaths.test.ts` asserts
 * that every file named here still exists and that every unfixed entry still
 * names a real query, so the register cannot quietly rot into a false claim that
 * the job is done.
 *
 * HOW TO FIX AN ENTRY
 * -------------------
 * Two of the fixes are one-liners and one is a single well-placed change. None
 * of them is hard; they are merely spread across files this change did not own.
 *
 *   Per-query:   import { NOT_ARCHIVED } from "@/lib/employees/retention";
 *                where: { ...existing, ...NOT_ARCHIVED }
 *
 *   Once for    `scopeEmployeeWhere()` in `lib/auth/scope.ts` is applied by
 *   all search:  THIRTEEN separate queries in `app/api/search/route.ts`. Making
 *                it return `{ ...where, deletedAt: null }` fixes all of them at
 *                the choke point they already pass through. That is the single
 *                highest-value edit in this file — but `lib/auth/**` is owned
 *                elsewhere, so it is reported rather than applied.
 *
 * WHY THE REGISTER IS NOT A FILTER
 * -------------------------------
 * These are findings about code this change does not own. Encoding them as an
 * enforced filter here would mean either editing those files (out of scope, and
 * a collision risk with agents working in them now) or quietly building a
 * mechanism the next reader would mistake for the actual fix.
 */

/** How a read path treats an archived employee. */
export type ArchiveVisibility =
    /** Correctly excludes archived rows. */
    | "EXCLUDES"
    /** Currently SERVES archived rows. This is the bug. */
    | "LEAKS"
    /**
     * Deliberately includes them — a diagnostic, a history view or an
     * identifier lookup. Recorded so a later reader does not "fix" it.
     */
    | "INTENTIONAL";

export interface EmployeeReadPath {
    /** Repo-relative, forward slashes. */
    file: string;
    /** 1-indexed line of the `prisma.employee.*` call as audited. */
    line: number;
    /** The Prisma call itself. */
    call: string;
    /** What the query is for. */
    purpose: string;
    visibility: ArchiveVisibility;
    /** Why it is safe, or the exact change required. */
    note: string;
    /** Set where this change applied the fix itself. */
    fixedHere?: boolean;
}

export const EMPLOYEE_READ_PATHS: readonly EmployeeReadPath[] = [
    {
        file: "app/lib/actions/employees.ts",
        line: 1152,
        call: "prisma.employee.findMany({ where: { deletedAt: { not: null } }, orderBy: { deletedAt: 'desc' } })",
        purpose: "getArchivedEmployees — the retrieval path for archived records.",
        visibility: "INTENTIONAL",
        note:
            "The one listing that is SUPPOSED to serve archived rows; that is its entire job, and without it an " +
            "archive becomes a place records go to be lost. The mirror image of every entry above. Each row " +
            "carries its own purge-eligibility verdict so the retention rule is visible to a reviewer rather " +
            "than buried in a server action.",
        fixedHere: true,
    },

    /* ---- FIXED IN THIS CHANGE ---- */
    {
        file: "app/lib/actions/employees.ts",
        line: 1243,
        call: "prisma.employee.findMany({ where: { isActive: true, ...NOT_ARCHIVED } })",
        purpose: "Active-employee picker (server action).",
        visibility: "EXCLUDES",
        note:
            "Already excluded archived rows via `isActive: true`, because archive sets isActive=false. " +
            "The explicit `deletedAt: null` was added anyway so the query states the invariant in tombstone " +
            "terms and cannot be un-hidden by a future change to isActive semantics.",
        fixedHere: true,
    },
    {
        file: "app/api/employees/route.ts",
        line: 14,
        call: "prisma.employee.findMany({ where: NOT_ARCHIVED, ... })",
        purpose: "The employee directory API consumed by HR tooling.",
        visibility: "EXCLUDES",
        note:
            "WAS A LEAK: the query carried no `where` at all and returned every row in the table, so an " +
            "archived employee kept appearing here with name, roll number and government ID. Now filtered. " +
            "`isActive` deliberately NOT added: this endpoint has always returned inactive employees (HR uses " +
            "it to inspect someone who has left) and narrowing it would be an unrequested behaviour change.",
        fixedHere: true,
    },

    /* ---- SAFE BY CONSTRUCTION: already filtered on isActive ---- */
    {
        file: "app/attendance/page.tsx",
        line: 40,
        call: "prisma.employee.findMany({ where: { isActive: true }, include: { shift: true } })",
        purpose: "Attendance marking roster.",
        visibility: "EXCLUDES",
        note: "Filters isActive:true and archive sets isActive=false. No change needed.",
    },
    {
        file: "app/visa/page.tsx",
        line: 72,
        call: "prisma.employee.findMany({ where: { isActive: true } })",
        purpose: "Visa and document-expiry tracker.",
        visibility: "EXCLUDES",
        note: "Filters isActive:true. Correct — an archived employee's visas must stop generating reminders.",
    },
    {
        file: "app/payroll/overtime/page.tsx",
        line: 28,
        call: "prisma.employee.findMany({ where: { isActive: true } })",
        purpose: "Overtime approval list.",
        visibility: "EXCLUDES",
        note: "Filters isActive:true. Correct — no overtime may be raised against an archived row.",
    },
    {
        file: "app/lib/actions/letters.ts",
        line: 63,
        call: "prisma.employee.findMany({ where: { isActive: true }, ... })",
        purpose: "Letter-generation employee picker.",
        visibility: "EXCLUDES",
        note: "Filters isActive:true. Correct — no new letters for an archived record.",
    },
    {
        file: "app/lib/actions/shifts.ts",
        line: 167,
        call: "prisma.employee.findMany({ where: { isActive: true, shiftId: null } })",
        purpose: "Unassigned-employee list for shift assignment.",
        visibility: "EXCLUDES",
        note:
            "Filters isActive:true, and archive sets isActive=false, so archived employees are already " +
            "excluded. No change required.",
    },
    {
        file: "app/lib/actions/payroll.ts",
        line: 61,
        call: "prisma.employee.findMany({ include: { salaryStructure: true } }) then .filter(e => e.isActive && ...)",
        purpose: "Payroll run.",
        visibility: "EXCLUDES",
        note:
            "The query is unfiltered but every consumer filters `e.isActive` in JavaScript before using the " +
            "row. Works, but it loads every archived employee including their salary structure on every run. " +
            "Push the predicate into the `where` for efficiency; the security property already holds.",
    },

    /* ---- DASHBOARD COUNTERS ---- */
    {
        file: "app/dashboard/page.tsx",
        line: 45,
        call: "prisma.employee.count({ where: { isActive: true } })",
        purpose: "Total headcount counter.",
        visibility: "EXCLUDES",
        note: "Filters isActive:true, so the headcount drops when an employee is archived. Correct.",
    },
    {
        file: "app/dashboard/page.tsx",
        line: 47,
        call: "prisma.employee.count({ where: { isActive: true, OR: [passportExpiry, emiratesIdExpiry, visaExpiry] } })",
        purpose: "\"Documents expiring soon\" counter.",
        visibility: "EXCLUDES",
        note: "Filters isActive:true. Correct — an archived employee must stop generating compliance nudges.",
    },
    {
        file: "app/dashboard/page.tsx",
        line: 60,
        call: "prisma.employee.groupBy({ by: ['department'], where: { isActive: true } })",
        purpose: "Headcount-by-department aggregate.",
        visibility: "EXCLUDES",
        note: "Filters isActive:true. Correct — the aggregate excludes archived rows.",
    },

    /* ---- DELIBERATELY UNFILTERED ---- */
    {
        file: "lib/workflow/lifecycle-consistency.ts",
        line: 369,
        call: "db.employee.findMany({ select: { id, employeeCode, firstName, lastName, lifecycle, currentStatus, isActive } })",
        purpose: "Lifecycle-divergence diagnostic.",
        visibility: "INTENTIONAL",
        note:
            "MUST see archived rows. This is a health check over the whole table; a filter would hide exactly " +
            "the divergent rows it exists to report. Do not add NOT_ARCHIVED here.",
    },
    {
        file: "lib/workflow/recruitment.ts",
        line: 489,
        call: "prisma.employee.findMany({ where: { id: { in: params.interviewerIds } } })",
        purpose: "Validates interviewer ids before creating an interview.",
        visibility: "INTENTIONAL",
        note:
            "Id-addressed, not a listing — it only answers 'do these specific people exist'. An archived " +
            "employee named as an interviewer is a data-entry error, not a disclosure. Acceptable as-is.",
    },
    {
        file: "lib/workflow/letters.ts",
        line: 321,
        call: "prisma.employee.findMany({ where: { id: { in: params.employeeIds } } })",
        purpose: "Bulk letter generation, name lookup for the supplied ids.",
        visibility: "INTENTIONAL",
        note: "Id-addressed name lookup over ids the caller already holds. Not a listing. Acceptable as-is.",
    },

    /* ---- LEAKS: no isActive filter and no currentStatus filter ---- */
    {
        file: "app/employees/page.tsx",
        line: 13,
        call: "prisma.employee.findMany({ orderBy: { firstName: 'asc' } })",
        purpose: "THE EMPLOYEE DIRECTORY. Supplies `initialEmployees` to EmployeeList.",
        visibility: "LEAKS",
        note:
            "THE HEADLINE LEAK. No `where` at all, so every archived employee renders in the directory, in " +
            "both the card list and the table, with a status badge that says ACTIVE or RESIGNED and nothing " +
            "that says archived. FIX: `where: NOT_ARCHIVED`. The `managers` query at line 18 needs the same. " +
            "File is owned by another agent (`app/employees/**`), so REPORTED, not applied.",
    },
    {
        file: "app/api/search/route.ts",
        line: 374,
        call: "prisma.employee.findMany({ where: scopeEmployeeWhere(ctx.subject, { OR: [name, email, rollNumber, ...] }) })",
        purpose: "Global search — the employee domain.",
        visibility: "LEAKS",
        note:
            "A name typed into the Cmd+K box matches an archived employee, and the hit links to a detail page " +
            "for them. Fixed ONCE, not here: `scopeEmployeeWhere()` is already called by 13 queries in this " +
            "file, so changing it to return `{ ...where, deletedAt: null }` covers all of them. Highest-value " +
            "single edit in the register. `lib/auth/**` is owned elsewhere, so REPORTED, not applied.",
    },
    {
        file: "app/attendance/shifts/page.tsx",
        line: 165,
        call: "prisma.employee.findMany({ where: unassignedQuery })",
        purpose: "Unassigned-employee list in the shift builder.",
        visibility: "LEAKS",
        note:
            "`unassignedQuery` filters department and shiftId but not isActive, so archived employees appear " +
            "in the list an HR user drags people into shifts from. FIX: add `...NOT_ARCHIVED`.",
    },
    {
        file: "lib/attendance/import.ts",
        line: 242,
        call: "prisma.employee.findMany({ select: { id, employeeCode, rollNumber, department, shiftId } })",
        purpose: "Builds the punch-to-employee map for a biometric import.",
        visibility: "LEAKS",
        note:
            "Worst consequence of the leaks: an archived employee's fingerprint still resolves to a live " +
            "attendance row, so a terminated person can accrue attendance — and therefore payroll — after " +
            "their record was archived. FIX: `where: NOT_ARCHIVED`.",
    },
    {
        file: "app/recruitment/requisitions/new/page.tsx",
        line: 27,
        call: "prisma.employee.findMany({ where: { currentStatus: { in: ['ACTIVE', 'ON_LEAVE'] } }, take: 200 })",
        purpose: "Hiring-manager picker on a new requisition.",
        visibility: "LEAKS",
        note:
            "Filters currentStatus, which archive deliberately does NOT touch (an archive is a data-custody " +
            "decision; RESIGNED is an HR fact). So an archived-but-still-ACTIVE row is offered as a hiring " +
            "manager. FIX: `where: { currentStatus: { in: [...] }, ...NOT_ARCHIVED }`.",
    },
    {
        file: "lib/recruitment/queries.ts",
        line: 299,
        call: "prisma.employee.findMany({ where: { currentStatus: { in: ['ACTIVE', 'ON_LEAVE'] } } })",
        purpose: "Requisition approval — resolves a requested hiring manager's name.",
        visibility: "LEAKS",
        note: "Same currentStatus-only filter as above. FIX: add NOT_ARCHIVED.",
    },
    {
        file: "lib/workflow/accrual.ts",
        line: 88,
        call: "prisma.employee.findMany({ where: { currentStatus: 'ACTIVE' }, select: { id, department } })",
        purpose: "Monthly leave-accrual run.",
        visibility: "LEAKS",
        note:
            "Credits leave to archived employees. Harmless financially (an archived row accruing leave is " +
            "never paid out) but it is wrong, it inflates the balance columns HR reads, and it means a " +
            "restored employee has accrued a balance they never actually earned. FIX: add NOT_ARCHIVED.",
    },
    {
        file: "lib/workflow/payroll.ts",
        line: 111,
        call: "prisma.employee.findMany({ where: { currentStatus: 'ACTIVE' }, select: { ... } })",
        purpose: "Payroll calculation.",
        visibility: "LEAKS",
        note:
            "HIGHEST FINANCIAL IMPACT of the leaks: an archived employee with currentStatus=ACTIVE is still " +
            "in the payroll run. FIX: add NOT_ARCHIVED.",
    },
    {
        file: "lib/workflow/compliance.ts",
        line: 141,
        call: "prisma.employee.findMany({ where: { currentStatus: { in: ['ACTIVE', 'ON_LEAVE'] } } })",
        purpose: "Compliance report — document and visa status.",
        visibility: "LEAKS",
        note: "Sends compliance nudges for archived employees. FIX: add NOT_ARCHIVED.",
    },
    {
        file: "lib/workflow/compliance.ts",
        line: 289,
        call: "prisma.employee.findMany({ where: { currentStatus: { in: ['ACTIVE', 'ON_LEAVE'] } } })",
        purpose: "Compliance report — expiry projection.",
        visibility: "LEAKS",
        note: "Same query shape, second call site. FIX: add NOT_ARCHIVED.",
    },
    {
        file: "lib/workflow/shifts.ts",
        line: 67,
        call: "prisma.employee.findMany({ where: { id, shiftId: { not: null }, currentStatus: { in: [...] } } })",
        purpose: "Reads a single employee's existing shift assignment.",
        visibility: "LEAKS",
        note:
            "Id-addressed, so the disclosure risk is low, but it lets an archived row keep a shift " +
            "assignment that still counts towards roster totals in the shift builder. FIX: add NOT_ARCHIVED.",
    },

    /* ---- LOCKED BY EXISTING TESTS: report only ---- */
    {
        file: "app/api/employees/[id]/route.ts",
        line: 80,
        call: "prisma.employee.findFirst({ where: { AND: [{ id }, scopeEmployeeWhere(subject)] }, select: FULL_SELECT })",
        purpose: "GET /api/employees/[id] — the employee profile.",
        visibility: "LEAKS",
        note:
            "An archived employee is reachable by direct URL. FIX: `{ AND: [{ id }, scopeEmployeeWhere(subject), { deletedAt: null }] }`. " +
            "NOT APPLIED — and this is a deliberate decision, not an oversight. That exact shape is asserted " +
            "by `tests/employee-detail-idor.test.ts:80` (`where.AND).toHaveLength(2)`) and by five exact " +
            "`toEqual` assertions in `tests/employee-detail-route.test.ts` (lines 168, 178, 190, 199, 222). " +
            "Those two files belong to another agent and are off-limits here, so any edit breaks seven " +
            "existing assertions. The owner should add the third conjunct and update both files together.",
    },
    {
        file: "app/employees/[id]/page.tsx",
        line: 215,
        call: "prisma.employee.findFirst({ where, select: FULL_SELECT })  // where built at :207",
        purpose: "/employees/[id] — the rendered profile page.",
        visibility: "LEAKS",
        note:
            "Same exclusion needed as the route, and the fix is the identical one-liner. NOT APPLIED: " +
            "`tests/employee-detail-page.test.ts:173` asserts the file contains exactly two `where,` tokens, " +
            "and line 162 requires the literal string `scopeEmployeeWhere(subject, { id })` to appear before " +
            "the query. Both assertions live in a file this change does not own. The route (line 70) and the " +
            "page must be fixed together with their tests.",
    },

    /* ---- MUST NOT BE "FIXED": filtered out on purpose ---- */
    {
        file: "app/lib/actions/employees.ts",
        line: 62,
        call: "prisma.employee.findFirst({ where: { employeeCode: { startsWith: 'EMP-' } }, orderBy: { employeeCode: 'desc' } })",
        purpose: "generateEmployeeCode — allocates the next EMP-NNN code.",
        visibility: "INTENTIONAL",
        note:
            "MUST include archived rows. `Employee.employeeCode` is `@unique`, so skipping an archived " +
            "employee's code would eventually hand a new hire a code that already exists and the insert " +
            "would fail with P2002. An archived employee holding EMP-003 must still push the next code to " +
            "EMP-004. Do NOT add NOT_ARCHIVED here.",
    },
    {
        file: "app/lib/actions/employees.ts",
        line: 262,
        call: "prisma.employee.findFirst({ where: { OR: [{ email }, { rollNumber }] } })",
        purpose: "Advisory duplicate detection in upsertEmployee.",
        visibility: "INTENTIONAL",
        note:
            "MUST include archived rows. `Employee.email` and `Employee.rollNumber` are both `@unique` and " +
            "the tombstone does not release them, so a new hire reusing an archived employee's email is " +
            "refused by the database either way. Filtering archived rows here would not permit the duplicate — " +
            "it would just replace a clear 'already in use by another employee' message with an opaque P2002. " +
            "Reuse after an erasure is a data-migration decision, not a query filter. Do NOT add NOT_ARCHIVED.",
    },
];

/** Counts by visibility, for the report and for the register's own test. */
export function summariseReadPaths(): Record<ArchiveVisibility, number> {
    const out: Record<ArchiveVisibility, number> = { EXCLUDES: 0, LEAKS: 0, INTENTIONAL: 0 };
    for (const path of EMPLOYEE_READ_PATHS) out[path.visibility] += 1;
    return out;
}

/** Every entry that still needs a change, with the reason. */
export function outstandingReadPaths(): readonly EmployeeReadPath[] {
    return EMPLOYEE_READ_PATHS.filter((p) => p.visibility === "LEAKS");
}
