/**
 * Business travel and yearly air ticket entitlement.
 *
 * TWO SEPARATE FACTS, OFTEN CONFLATED
 *
 * `SalaryStructure.travelAllowance` is a MONTHLY cash amount paid with payroll.
 * An air ticket entitlement is a NUMBER OF RETURN FLIGHTS per employee per year,
 * and the two are independent: an employee can be owed two business-class
 * tickets a year and receive no travel allowance at all. They are stored in
 * different columns on different tables and this module never reads the payroll
 * one.
 *
 * THE ENTITLEMENT YEAR IS ANCHORED TO THE VISA, NOT THE CALENDAR
 *
 * The user's requirement is that the allowance resets with the visa renewal, so
 * the window is derived from `Employee.airTicketAnchorDate` (falling back to the
 * visa issue date). For an anchor of 15 September the window runs
 *
 *     15 Sep 2026 00:00  ->  15 Sep 2027 00:00   (exclusive)
 *
 * that is, 15 September to 14 September INCLUSIVE. This is the off-by-one that
 * silently issues a third ticket, so it is stated here, in the schema comment on
 * `AirTicketEntitlement.windowEnd`, and in the tests:
 *
 *   - `windowEnd` stores the last INCLUDED day (14 Sep), so a human reading the
 *     column sees the window they expect.
 *   - containment is tested against `windowEndExclusive` (15 Sep), not against
 *     `windowEnd`. Testing `on <= windowEnd` looks equivalent and is not: a
 *     timestamped row on 15 Sep 10:00 would fall inside both windows.
 *   - the window is resolved from the DEPARTURE DATE, not from "now". A ticket
 *     is flown on departure, so a trip departing after the next anchor belongs
 *     to that next window and is entitled against that window's own allowance.
 *     Resolving from "now" instead would let a request raised the day before the
 *     anchor consume an entitlement that had already reset, or the reverse.
 *
 * THE CAP IS A DATABASE FACT
 *
 * Two guards, because each covers a different race:
 *   1. `AirTicketEntitlement(employeeId, windowKey)` is UNIQUE, so one employee
 *      cannot accumulate two ledgers for one window and have two allowances.
 *   2. The increment on COMPLETED is a compare-and-swap on `usedTickets`, so
 *      two concurrent completions cannot both consume the last ticket.
 *
 * A read-then-write check is not enough, and the refusal message below is the
 * user-visible half of a check that the database also enforces.
 *
 * A TRIP CANNOT BE COMPLETED WITH NOTHING TO SHOW FOR IT
 *
 * `TravelDocument` files the ticket and the boarding pass against one journey,
 * and `advanceTravelRequest` refuses COMPLETED until a BOARDING_PASS exists. A
 * ticket is deliberately only a WARNING, because an employee can legitimately
 * fly on a ticket the travel office arranged outside this system; the boarding
 * pass is the artefact that says the employee actually flew, and it has no
 * equivalent. The gate is checked before the state machine runs so the
 * transition table still answers an illegal transition first.
 *
 * APPROVING SPENDS MONEY, SO TWO GATES GUARD IT
 *
 * A ticket COUNT is not a budget. Two economy tickets to the same city cost
 * very different amounts in different seasons, so the count says nothing about
 * what the company may commit. `Employee.annualTravelBudget` is the monetary cap
 * per entitlement window, on the SAME window as the ticket count so the two
 * reset together, and `grantTravelAmount` is how HR says what this particular
 * trip will cost. APPROVED is refused twice over:
 *
 *   1. NO GRANTED AMOUNT. HR reviews the quote and grants a figure before
 *      approving, so a trip can never be approved against a number the traveller
 *      typed and nobody checked.
 *   2. AN UNVERIFIED DOCUMENT. `TravelDocument.verifiedAt` is set only by a human
 *      looking at the file, and re-uploading CLEARS it — the same trap
 *      `recordDocumentReceived` documents for employee documents. A scan that
 *      was replaced is a new claim and inherits nobody's sign-off.
 *
 * A grant ABOVE the remaining budget needs a recorded override rather than a
 * silent pass, and `budgetVariance` stores the difference between what was
 * quoted and what was granted so a moved price is visible without arithmetic.
 *
 * MONEY IS DECIMAL, EXCEPT THE ONE COLUMN THAT IS NOT
 *
 * `approvedAmount`, `budgetVariance` and `annualTravelBudget` are `Decimal`:
 * budget arithmetic sums across a window and a `Float` sum drifts by fractions of
 * a fils, which is a rounding dispute with an audit trail. `estimatedCost` stays
 * `Float` because it is the traveller's quote typed into a form and is only ever
 * read, never summed; it is converted to `Decimal` once, at the grant, so the
 * variance is computed in exact arithmetic.
 */

import prisma from "@/lib/prisma";
import { Prisma } from "@/prisma/generated/client";
import { requireSubject, AuthorizationError } from "@/lib/auth/guards";
import { PERMISSIONS, hasPermission } from "@/lib/auth/permissions";
import { logSecurityEvent, SECURITY_ACTION } from "@/lib/auth/audit";
import {
    canActOnEmployeeRecord,
    scopeEmployeeWhere,
    type AuthorizationSubject,
} from "@/lib/auth/scope";
import { notifyInApp } from "@/lib/workflow/notifications";
import {
    TRAVEL_REQUEST_STATUS,
    TRAVEL_REQUEST_TRANSITIONS,
    assertTransition,
    InvalidTransitionError,
} from "@/lib/workflow/state-machine";

/* ------------------------------------------------------------------ */
/* Vocabularies                                                        */
/* ------------------------------------------------------------------ */

export const AIR_TICKET_TRAVEL_CLASSES = ["ECONOMY", "PREMIUM_ECONOMY", "BUSINESS"] as const;
export type AirTicketTravelClass = (typeof AIR_TICKET_TRAVEL_CLASSES)[number];

export const TICKET_COST_RESPONSIBILITY = ["COMPANY", "EMPLOYEE"] as const;
export type TicketCostResponsibility = (typeof TICKET_COST_RESPONSIBILITY)[number];

/** Cabin ordering, so "requested above the entitlement" is a comparison. */
const CLASS_RANK: Record<AirTicketTravelClass, number> = {
    ECONOMY: 1,
    PREMIUM_ECONOMY: 2,
    BUSINESS: 3,
};

export function isTravelClass(value: unknown): value is AirTicketTravelClass {
    return typeof value === "string" && (AIR_TICKET_TRAVEL_CLASSES as readonly string[]).includes(value);
}

export function isTicketCostResponsibility(value: unknown): value is TicketCostResponsibility {
    return typeof value === "string" && (TICKET_COST_RESPONSIBILITY as readonly string[]).includes(value);
}

/** A request that holds a ticket: anything not yet refused, cancelled or flown. */
const COMMITTING_STATUSES: readonly string[] = [
    TRAVEL_REQUEST_STATUS.REQUESTED,
    TRAVEL_REQUEST_STATUS.PENDING_APPROVAL,
    TRAVEL_REQUEST_STATUS.APPROVED,
];

/**
 * A request that still holds GRANTED MONEY: anything not refused or cancelled.
 *
 * Wider than `COMMITTING_STATUSES` on purpose. A granted amount commits the
 * company the moment HR records it, which is before approval, so REQUESTED and
 * PENDING_APPROVAL rows with an amount are money already promised. Excluding
 * them would let HR hand out more than the window holds by approving late.
 */
const MONEY_HOLDING_STATUSES: readonly string[] = [
    TRAVEL_REQUEST_STATUS.REQUESTED,
    TRAVEL_REQUEST_STATUS.PENDING_APPROVAL,
    TRAVEL_REQUEST_STATUS.APPROVED,
    TRAVEL_REQUEST_STATUS.COMPLETED,
];

/** Refuse an amount past this. Same ceiling as `estimatedCost`. */
const MAX_TRAVEL_AMOUNT = 10_000_000;

/**
 * The states a caller may move a request to, checked at the action boundary
 * before any database work happens. It is the union of every target in
 * TRAVEL_REQUEST_TRANSITIONS; `assertTransition` is still the authority on which
 * of those is legal from the request's CURRENT state.
 */
export const TRAVEL_REQUEST_DECISIONS = [
    TRAVEL_REQUEST_STATUS.PENDING_APPROVAL,
    TRAVEL_REQUEST_STATUS.APPROVED,
    TRAVEL_REQUEST_STATUS.REJECTED,
    TRAVEL_REQUEST_STATUS.COMPLETED,
    TRAVEL_REQUEST_STATUS.CANCELLED,
] as const;

/* ------------------------------------------------------------------ */
/* Entitlement window (pure)                                           */
/* ------------------------------------------------------------------ */

export type AnchorSource = "EXPLICIT" | "VISA_ISSUE_DATE" | "CALENDAR_YEAR_FALLBACK";

export interface EntitlementWindow {
    /** `yyyy-MM-dd` of `start`. The stable identity of the window. */
    key: string;
    /** Inclusive first day, 00:00 local. */
    start: Date;
    /** Inclusive LAST day, 00:00 local. For a 15 Sep anchor: 14 Sep. */
    end: Date;
    /** First instant of the next window. Use this for containment tests. */
    endExclusive: Date;
    anchor: Date;
    anchorSource: AnchorSource;
}

const MS_PER_DAY = 86_400_000;

function atStartOfDay(value: Date): Date {
    const copy = new Date(value.getTime());
    copy.setHours(0, 0, 0, 0);
    return copy;
}

/** Days in a month, 1-indexed by the JavaScript month value. */
function daysInMonth(year: number, month: number): number {
    return new Date(year, month + 1, 0).getDate();
}

/**
 * Places an anchor's month/day into `year`, clamping the day to the last day of
 * that month.
 *
 * The clamp is not cosmetic. `new Date(2026, 8, 31)` is 1 October, so an
 * unclamped 31-day anchor silently becomes a 1st-of-month anchor in every
 * shorter month, moving each window start by a month and handing out an extra
 * ticket per rollover. A 29 February anchor becomes 28 February in common
 * years, which keeps the window contiguous instead of skipping 2027 entirely.
 */
function anchorInYear(anchor: Date, year: number): Date {
    const month = anchor.getMonth();
    const day = Math.min(anchor.getDate(), daysInMonth(year, month));
    const placed = new Date(year, month, day);
    placed.setHours(0, 0, 0, 0);
    return placed;
}

function isoDay(value: Date): string {
    const year = String(value.getFullYear()).padStart(4, "0");
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

export interface AnchorInputs {
    airTicketAnchorDate: Date | null;
    visaIssueDate: Date | null;
}

/**
 * Resolves which date the entitlement year hangs from.
 *
 * EXPLICIT is the HR-entered anchor and wins. VISA_ISSUE_DATE is the next best
 * thing and is why the issue date had to be persisted: the row only ever held
 * `visaExpiry`, and a window cannot be derived from an expiry alone without
 * inventing a visa length, which this codebase refuses to do anywhere else.
 *
 * The CALENDAR_YEAR_FALLBACK keeps the cap enforceable for an employee whose
 * visa dates HR has not entered. It is reported rather than hidden, because an
 * entitlement that resets on 1 January is a different promise from one that
 * resets with the visa, and the operator needs to see which one is in force.
 */
export function resolveAnchor(inputs: AnchorInputs, reference: Date): { anchor: Date; source: AnchorSource } {
    if (inputs.airTicketAnchorDate) {
        return { anchor: atStartOfDay(inputs.airTicketAnchorDate), source: "EXPLICIT" };
    }
    if (inputs.visaIssueDate) {
        return { anchor: atStartOfDay(inputs.visaIssueDate), source: "VISA_ISSUE_DATE" };
    }
    const fallback = new Date(reference.getFullYear(), 0, 1);
    fallback.setHours(0, 0, 0, 0);
    return { anchor: fallback, source: "CALENDAR_YEAR_FALLBACK" };
}

/**
 * The entitlement window containing `on`.
 *
 * For an anchor of 15 Sep and a reference of 14 Sep the current window is the
 * one that STARTED on 15 Sep the previous year and ends on 14 Sep now: the last
 * day belongs to the window it closes, not to the one it opens.
 */
export function entitlementWindow(inputs: AnchorInputs, on: Date): EntitlementWindow {
    const reference = atStartOfDay(on);
    const { anchor, source } = resolveAnchor(inputs, reference);

    // The anchor anniversary in the reference year; if `on` is before it, the
    // live window opened on the previous year's anniversary.
    const thisYear = anchorInYear(anchor, reference.getFullYear());
    const start = thisYear <= reference ? thisYear : anchorInYear(anchor, reference.getFullYear() - 1);

    const endExclusive = anchorInYear(start, start.getFullYear() + 1);
    const end = new Date(endExclusive.getTime() - MS_PER_DAY);

    return { key: isoDay(start), start, end, endExclusive, anchor, anchorSource: source };
}

/** Human-readable window, e.g. `15 Sep 2026 to 14 Sep 2027`. */
export function windowLabel(window: EntitlementWindow): string {
    const fmt = (d: Date) =>
        d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    return `${fmt(window.start)} to ${fmt(window.end)}`;
}

/* ------------------------------------------------------------------ */
/* Result shape                                                        */
/* ------------------------------------------------------------------ */

export interface TravelActionResult {
    success: boolean;
    message: string;
    requestId?: string;
    status?: string;
}

const CONCURRENT = "CONCURRENT_MODIFICATION";

/* ------------------------------------------------------------------ */
/* Money                                                               */
/* ------------------------------------------------------------------ */

/**
 * Parses an amount from the trust boundary into an exact decimal.
 *
 * Returns null rather than throwing so the caller can produce the refusal
 * message. `Number(value)` is done in JavaScript first because that is what the
 * browser sent, and `new Prisma.Decimal(number)` then converts through the
 * number's shortest decimal representation — so 0.1 becomes exactly 0.1 rather
 * than the binary approximation, which is the whole reason the columns are
 * Decimal. NaN and Infinity are refused rather than stored.
 */
function moneyDecimal(value: number): Prisma.Decimal | null {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    return new Prisma.Decimal(value);
}

/**
 * Converts a stored decimal to a plain number for a Server Component prop.
 *
 * A `Prisma.Decimal` is a class instance with its own prototype, and React
 * refuses to serialise anything but plain objects across the server/client
 * boundary. So every value handed to a client component goes through here, and
 * the rounding happens once, at display, instead of in the ledger.
 */
export function toAmountNumber(value: Prisma.Decimal | number | null | undefined): number | null {
    if (value === null || value === undefined) return null;
    return typeof value === "number" ? value : value.toNumber();
}

/** Sums decimals exactly, for a window total read in one pass. */
function sumAmounts(values: readonly Prisma.Decimal[]): Prisma.Decimal {
    return values.reduce<Prisma.Decimal>((total, value) => total.add(value), new Prisma.Decimal(0));
}

/** AED for a message, so an operator is never shown a raw `0.1` or `1e+21`. */
export function formatAmount(value: Prisma.Decimal | number | null | undefined): string {
    const amount = toAmountNumber(value);
    if (amount === null) return "--";
    return new Intl.NumberFormat("en-AE", { maximumFractionDigits: 2 }).format(amount);
}

/* ------------------------------------------------------------------ */
/* Authorization                                                       */
/* ------------------------------------------------------------------ */

/**
 * Permission check that keeps the subject.
 *
 * `requirePermission` returns the user, but the cancel path also needs the
 * subject's employee and department for the IDOR check, and calling both guards
 * would re-read the session twice. This is the same test as
 * `requirePermission` — resolve against the server-side role, never a value from
 * the browser — with the same denial audit event.
 */
function assertTravelPermission(subject: AuthorizationSubject, permission: string): void {
    if (!hasPermission(subject.role, permission)) {
        void logSecurityEvent({
            action: SECURITY_ACTION.ACCESS_DENIED,
            actorEmail: subject.email,
            actorRole: subject.role,
            target: `permission:${permission}`,
            outcome: "DENIED",
            detail: { requiredPermission: permission },
        });
        throw new AuthorizationError(`Missing permission: ${permission}`, permission);
    }
}

function toResult(error: unknown, context: string): TravelActionResult {
    if (error instanceof AuthorizationError) return { success: false, message: error.message };
    if (error instanceof InvalidTransitionError) {
        return { success: false, message: `Not permitted: ${error.message}` };
    }
    if (error instanceof Error && error.message === CONCURRENT) {
        return { success: false, message: "This request changed a moment ago. Reload and try again." };
    }
    console.error(`[${context}]`, error);
    return { success: false, message: "Could not update business travel. Nothing was changed." };
}

/* ------------------------------------------------------------------ */
/* Entitlement reads                                                   */
/* ------------------------------------------------------------------ */

export interface EntitlementSummary {
    employeeId: string;
    employeeName: string;
    employeeCode: string | null;
    department: string | null;
    /** Tickets the window grants. */
    entitled: number;
    /**
     * The employee's CURRENT contract figure, which can differ from `entitled`
     * when HR changed it after this window had already opened. A window is a
     * historical fact, so `entitled` is what will actually be granted for this
     * window and this is what a future window will use. The entitlement editor
     * shows this one, not `entitled`, or saving an unchanged form would
     * silently rewrite the contract.
     */
    contractedTickets: number;
    /** Tickets consumed (requests completed). */
    used: number;
    /** Requests holding a ticket but not yet completed, rejected or cancelled. */
    committed: number;
    /** entitled - used - committed, floored at zero. */
    remaining: number;
    travelClass: AirTicketTravelClass | null;
    /**
     * The monetary cap for this window, as a plain number because it crosses the
     * server/client boundary. null means HR has not agreed one — which is NOT
     * unlimited, but means every grant is an override.
     */
    annualTravelBudget: number | null;
    /** Approved amounts already granted against this window, excluding nothing. */
    budgetGranted: number;
    /**
     * annualTravelBudget - budgetGranted. null when no cap is set. Not floored at
     * zero: a negative figure here is the fact the operator needs, because it is
     * the amount already over-committed.
     */
    budgetRemaining: number | null;
    windowKey: string;
    windowLabel: string;
    windowStart: Date;
    windowEnd: Date;
    anchor: Date;
    anchorSource: AnchorSource;
    /** True when the window is not actually tied to a visa date. */
    anchorIsVisaLinked: boolean;
    // Visa context, shown beside the entitlement so renewal and entitlement are
    // read together rather than in two places.
    visaNumber: string | null;
    visaExpiry: Date | null;
    visaIssueDate: Date | null;
}

const EMPLOYEE_SELECT = {
    id: true,
    firstName: true,
    lastName: true,
    employeeCode: true,
    department: true,
    airTicketEntitlementPerYear: true,
    airTicketTravelClass: true,
    airTicketAnchorDate: true,
    annualTravelBudget: true,
    visaIssueDate: true,
    visaExpiry: true,
    visaNumber: true,
    deletedAt: true,
} as const;

type EntitlementEmployee = {
    id: string;
    firstName: string;
    lastName: string;
    employeeCode: string | null;
    department: string | null;
    airTicketEntitlementPerYear: number;
    airTicketTravelClass: string | null;
    airTicketAnchorDate: Date | null;
    annualTravelBudget: Prisma.Decimal | null;
    visaIssueDate: Date | null;
    visaExpiry: Date | null;
    visaNumber: string | null;
    deletedAt: Date | null;
};

type LedgerRow = { entitledTickets: number; usedTickets: number };
type CommitRow = { employeeId: string; entitlementId: string | null };

function summarise(
    employee: EntitlementEmployee,
    window: EntitlementWindow,
    ledger: LedgerRow | undefined,
    committed: number,
    granted: Prisma.Decimal
): EntitlementSummary {
    const entitled = ledger?.entitledTickets ?? employee.airTicketEntitlementPerYear;
    const used = ledger?.usedTickets ?? 0;
    // An entitlement can be reduced by HR mid-window; the window's remaining
    // must not report a negative number to the operator.
    const remaining = Math.max(0, entitled - used - committed);
    const budget = employee.annualTravelBudget;
    return {
        employeeId: employee.id,
        employeeName: `${employee.firstName} ${employee.lastName}`.trim(),
        employeeCode: employee.employeeCode,
        department: employee.department,
        entitled,
        contractedTickets: employee.airTicketEntitlementPerYear,
        used,
        committed,
        remaining,
        travelClass: isTravelClass(employee.airTicketTravelClass) ? employee.airTicketTravelClass : null,
        annualTravelBudget: toAmountNumber(budget),
        budgetGranted: granted.toNumber(),
        budgetRemaining: budget ? budget.minus(granted).toNumber() : null,
        windowKey: window.key,
        windowLabel: windowLabel(window),
        windowStart: window.start,
        windowEnd: window.end,
        anchor: window.anchor,
        anchorSource: window.anchorSource,
        anchorIsVisaLinked: window.anchorSource !== "CALENDAR_YEAR_FALLBACK",
        visaNumber: employee.visaNumber,
        visaExpiry: employee.visaExpiry,
        visaIssueDate: employee.visaIssueDate,
    };
}

/** Entitlement, usage and remaining for one employee in the current window. */
export async function getEntitlementSummary(
    employeeId: string,
    on: Date = new Date()
): Promise<EntitlementSummary | null> {
    const employee = await prisma.employee.findUnique({
        where: { id: employeeId },
        select: EMPLOYEE_SELECT,
    });
    if (!employee) return null;

    const window = entitlementWindow(employee, on);
    const ledger = await prisma.airTicketEntitlement.findUnique({
        where: { employeeId_windowKey: { employeeId, windowKey: window.key } },
        select: { id: true, entitledTickets: true, usedTickets: true },
    });
    // A request always creates the window's ledger row, so no ledger means no
    // request has been raised in this window and nothing is committed against it.
    const committed = ledger
        ? await prisma.businessTravelRequest.count({
              where: {
                  employeeId,
                  entitlementId: ledger.id,
                  status: { in: [...COMMITTING_STATUSES] },
              },
          })
        : 0;

    const granted = await grantedAmountInWindow(prisma, employeeId, window.key);

    return summarise(employee, window, ledger ?? undefined, committed, granted);
}

/**
 * Approved money already committed in one entitlement window.
 *
 * Aggregated in the DATABASE rather than summed in JavaScript: the sum is the
 * number the over-budget check refuses on, and a `Decimal` sum in SQL is exact
 * where a JS accumulation of the same rows is only as exact as the driver
 * returns them.
 */
async function grantedAmountInWindow(
    db: Pick<TravelDb, "businessTravelRequest">,
    employeeId: string,
    windowKey: string | null,
    /** Excluded from the sum, so re-granting a request does not count itself. */
    excludeRequestId?: string
): Promise<Prisma.Decimal> {
    if (!windowKey) return new Prisma.Decimal(0);
    const totals = await db.businessTravelRequest.aggregate({
        where: {
            employeeId,
            entitlementWindowKey: windowKey,
            approvedAmount: { not: null },
            status: { in: [...MONEY_HOLDING_STATUSES] },
            ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}),
        },
        _sum: { approvedAmount: true },
    });
    return totals._sum.approvedAmount ?? new Prisma.Decimal(0);
}

/**
 * The entitlement register for the travel page.
 *
 * Three queries regardless of headcount: employees, then the ledgers for the
 * distinct window keys those employees resolve to, then the live requests. A
 * per-employee loop would issue two queries each, which is the difference
 * between one round trip and two hundred.
 */
export async function getEntitlementRegister(
    subject: AuthorizationSubject,
    on: Date = new Date()
): Promise<EntitlementSummary[]> {
    const employees = await prisma.employee.findMany({
        where: scopeEmployeeWhere(subject, {
            isActive: true,
            deletedAt: null,
        }) as Prisma.EmployeeWhereInput,
        select: EMPLOYEE_SELECT,
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    });
    if (employees.length === 0) return [];

    const windows = new Map(employees.map((e) => [e.id, entitlementWindow(e, on)]));
    const ledgerKeys = [...new Set([...windows.values()].map((w) => w.key))];
    const employeeIds = employees.map((e) => e.id);

    const [ledgers, live] = await Promise.all([
        prisma.airTicketEntitlement.findMany({
            where: { employeeId: { in: employeeIds }, windowKey: { in: ledgerKeys } },
            select: { id: true, employeeId: true, entitledTickets: true, usedTickets: true },
        }),
        prisma.businessTravelRequest.findMany({
            where: { employeeId: { in: employeeIds }, status: { in: [...COMMITTING_STATUSES] } },
            select: { employeeId: true, entitlementId: true },
        }),
    ]);

    const ledgerByEmployee = new Map(ledgers.map((l) => [l.employeeId, l]));
    const commits = new Map<string, CommitRow[]>();
    for (const row of live) {
        const bucket = commits.get(row.employeeId) ?? [];
        bucket.push(row);
        commits.set(row.employeeId, bucket);
    }

    // Granted money per employee per window, grouped here rather than with one
    // aggregate per employee: a register of two hundred employees is one extra
    // query, not two hundred.
    const grantedRows = await prisma.businessTravelRequest.findMany({
        where: {
            employeeId: { in: employeeIds },
            entitlementWindowKey: { in: ledgerKeys },
            approvedAmount: { not: null },
            status: { in: [...MONEY_HOLDING_STATUSES] },
        },
        select: { employeeId: true, entitlementWindowKey: true, approvedAmount: true },
    });
    const grantedBuckets = new Map<string, Prisma.Decimal[]>();
    for (const row of grantedRows) {
        if (row.approvedAmount === null) continue;
        // Keyed by employee AND window: a trip granted against last year's
        // window must not be charged to this year's budget.
        const key = `${row.employeeId}|${row.entitlementWindowKey ?? ""}`;
        const bucket = grantedBuckets.get(key) ?? [];
        bucket.push(row.approvedAmount);
        grantedBuckets.set(key, bucket);
    }

    return employees.map((employee) => {
        const window = windows.get(employee.id)!;
        const ledger = ledgerByEmployee.get(employee.id);
        const employeeCommits = commits.get(employee.id) ?? [];
        // A committed request that predates the current window is counted against
        // the window it was granted under, which may not be the live one.
        const committed = ledger
            ? employeeCommits.filter((c) => c.entitlementId === ledger.id).length
            : 0;
        const granted = sumAmounts(grantedBuckets.get(`${employee.id}|${window.key}`) ?? []);
        return summarise(employee, window, ledger, committed, granted);
    });
}

/* ------------------------------------------------------------------ */
/* Ledger helper                                                       */
/* ------------------------------------------------------------------ */

/**
 * Returns the ledger row for a window, creating it if this is the first request
 * of the window.
 *
 * `update: {}` is deliberate: once a window has opened its entitlement is a
 * historical fact. Raising the employee's entitlement today must not silently
 * grant extra tickets in a window that is already half spent, which is what an
 * upsert that rewrote `entitledTickets` would do.
 */
async function ensureLedger(
    tx: PrismaTx,
    employee: EntitlementEmployee,
    window: EntitlementWindow
) {
    return tx.airTicketEntitlement.upsert({
        where: { employeeId_windowKey: { employeeId: employee.id, windowKey: window.key } },
        create: {
            employeeId: employee.id,
            windowKey: window.key,
            windowStart: window.start,
            windowEnd: window.end,
            entitledTickets: employee.airTicketEntitlementPerYear,
            anchorSnapshot: window.anchor,
            anchorSource: window.anchorSource,
        },
        update: {},
    });
}

/** Minimal transaction surface, so a test double need not be the whole client. */
type PrismaTx = {
    airTicketEntitlement: typeof prisma.airTicketEntitlement;
    businessTravelRequest: typeof prisma.businessTravelRequest;
    auditLog: typeof prisma.auditLog;
};

/* ------------------------------------------------------------------ */
/* 1. REQUEST                                                          */
/* ------------------------------------------------------------------ */

export interface RequestTravelInput {
    employeeId: string;
    purpose: string;
    destinationCountry: string;
    destinationCity?: string;
    /** `yyyy-MM-dd` or an ISO timestamp. */
    departureDate: string;
    returnDate?: string;
    estimatedCost?: number;
    travelClass?: string;
    ticketCostBorneBy?: string;
}

/**
 * Carries the ledger figures and the window out of the transaction, so the
 * refusal can name the allowance and the date it returns instead of a code.
 */
class QuotaExceededError extends Error {
    readonly window: EntitlementWindow | null;
    constructor(message: string, window: EntitlementWindow | null = null) {
        super(message);
        this.name = "QuotaExceededError";
        this.window = window;
    }
}

/**
 * The database surface this workflow needs. Declared so the core functions can
 * be driven against the real client from a script as well as from a session,
 * and so a test double does not have to implement the whole client.
 */
export type TravelDb = Pick<
    typeof prisma,
    | "employee"
    | "airTicketEntitlement"
    | "businessTravelRequest"
    | "travelDocument"
    | "auditLog"
    | "$transaction"
>;

/**
 * Raises a business travel request. Entry point: loads the session, then defers
 * to `requestTravelCore`, which owns every rule.
 */
export async function requestTravel(input: RequestTravelInput): Promise<TravelActionResult> {
    const subject = await requireSubject();
    return requestTravelCore(prisma, subject, input);
}

/**
 * Raises a business travel request for a known actor.
 *
 * THE CAP IS CHECKED HERE AND ENFORCED BY THE DATABASE LATER. This check exists
 * to give a good refusal message; the guarantee that a third ticket cannot be
 * issued comes from the unique ledger row plus the compare-and-swap increment in
 * `advanceTravelRequestCore`.
 */
export async function requestTravelCore(
    db: TravelDb,
    subject: AuthorizationSubject,
    input: RequestTravelInput
): Promise<TravelActionResult> {
    try {
        assertTravelPermission(subject, PERMISSIONS.TRAVEL_REQUEST);

        // IDOR: an employee may raise a request only for themselves unless HR
        // holds TRAVEL_REQUEST_ANY. The employee id arrives from the browser, so
        // it is checked here and never inferred from the form.
        const requestingForSelf = subject.employeeId === input.employeeId;
        if (!requestingForSelf) {
            assertTravelPermission(subject, PERMISSIONS.TRAVEL_REQUEST_ANY);
        }

        const employee = await db.employee.findUnique({
            where: { id: input.employeeId },
            select: EMPLOYEE_SELECT,
        });
        if (!employee) return { success: false, message: "Employee not found." };
        if (requestingForSelf && !canActOnEmployeeRecord(subject, { employeeId: employee.id })) {
            return { success: false, message: "You may only request travel for your own record." };
        }
        if (employee.deletedAt) {
            return { success: false, message: "This employee record has been archived." };
        }

        const purpose = input.purpose?.trim();
        const country = input.destinationCountry?.trim();
        if (!purpose || purpose.length < 3) {
            return { success: false, message: "Give a purpose of at least 3 characters." };
        }
        if (purpose.length > 1000) {
            return { success: false, message: "Purpose must be 1,000 characters or fewer." };
        }
        if (!country || country.length < 2 || country.length > 80) {
            return { success: false, message: "Enter a destination country." };
        }

        const departure = new Date(input.departureDate);
        if (Number.isNaN(departure.getTime())) {
            return { success: false, message: "Enter a valid departure date." };
        }
        // A trip cannot start in the past, and a departure more than a year out
        // is not a business trip this module can price.
        const today = atStartOfDay(new Date());
        if (atStartOfDay(departure) < today) {
            return { success: false, message: "The departure date cannot be in the past." };
        }
        if (departure.getTime() > today.getTime() + 366 * MS_PER_DAY) {
            return { success: false, message: "The departure date cannot be more than a year away." };
        }

        let returnDate: Date | null = null;
        if (input.returnDate) {
            returnDate = new Date(input.returnDate);
            if (Number.isNaN(returnDate.getTime())) {
                return { success: false, message: "Enter a valid return date." };
            }
            if (returnDate.getTime() < departure.getTime()) {
                return { success: false, message: "The return date cannot be before the departure date." };
            }
        }

        const estimatedCost = input.estimatedCost ?? 0;
        if (!Number.isFinite(estimatedCost) || estimatedCost < 0 || estimatedCost > 10_000_000) {
            return { success: false, message: "Estimated cost must be a non-negative amount." };
        }

        const travelClass = input.travelClass ?? "ECONOMY";
        if (!isTravelClass(travelClass)) {
            return { success: false, message: "Choose a valid travel class." };
        }
        const bearer = input.ticketCostBorneBy ?? "COMPANY";
        if (!isTicketCostResponsibility(bearer)) {
            return { success: false, message: "Choose who bears the ticket cost." };
        }

        const window = entitlementWindow(employee, departure);

        if (employee.airTicketEntitlementPerYear <= 0) {
            return {
                success: false,
                message:
                    "No yearly air ticket entitlement is recorded for this employee. HR must set the entitlement before travel can be requested.",
            };
        }

        const created = await db.$transaction(async (tx) => {
            const ledger = await ensureLedger(tx, employee, window);

            const committed = await tx.businessTravelRequest.count({
                where: {
                    employeeId: employee.id,
                    entitlementId: ledger.id,
                    status: { in: [...COMMITTING_STATUSES] },
                },
            });
            const available = ledger.entitledTickets - ledger.usedTickets - committed;
            if (available <= 0) {
                throw new QuotaExceededError(
                    `${ledger.entitledTickets} ticket(s) entitled, ${ledger.usedTickets} used and ${committed} already requested, so none are left`,
                    window
                );
            }

            const request = await tx.businessTravelRequest.create({
                data: {
                    employeeId: employee.id,
                    purpose,
                    destinationCountry: country,
                    destinationCity: input.destinationCity?.trim() || null,
                    departureDate: departure,
                    returnDate,
                    estimatedCost,
                    travelClass,
                    ticketCostBorneBy: bearer,
                    status: TRAVEL_REQUEST_STATUS.REQUESTED,
                    visaNumberSnapshot: employee.visaNumber,
                    visaExpirySnapshot: employee.visaExpiry,
                    visaIssueSnapshot: employee.visaIssueDate,
                    entitlementId: ledger.id,
                    entitlementWindowKey: window.key,
                    entitlementWindowStart: window.start,
                    entitlementWindowEnd: window.end,
                    requestedBy: subject.email,
                },
                select: { id: true, status: true },
            });

            await tx.auditLog.create({
                data: {
                    employeeId: employee.id,
                    action: "TRAVEL_REQUESTED",
                    details:
                        `Business travel requested: ${purpose} to ${destinationLabel(input)}, departing ${departure.toDateString()}. ` +
                        `Window ${windowLabel(window)}: ${ledger.entitledTickets - ledger.usedTickets - committed} of ${ledger.entitledTickets} ticket(s) available before this request.`,
                    changedBy: subject.email,
                },
            });

            return { request, ledger, available };
        });

        await notifyInApp({
            employeeId: employee.id,
            title: "Business travel request submitted",
            message: `${purpose} to ${destinationLabel(input)}. HR will review it; ${created.available} ticket(s) remain in the window ${windowLabel(window)}.`,
            type: "INFO",
            link: "/travel",
        });

        return {
            success: true,
            message: `Travel request submitted for review. ${created.available} ticket(s) remain in the window ${windowLabel(window)}.`,
            requestId: created.request.id,
            status: created.request.status,
        };
    } catch (error) {
        if (error instanceof QuotaExceededError) {
            // Refuse with the window dates, so the employee knows when it returns.
            const label = error.window ? windowLabel(error.window) : "the current entitlement window";
            return {
                success: false,
                message:
                    `This request would exceed the air ticket entitlement for ${label}: ${error.message}. ` +
                    "Raise the ticket with HR if the trip must go ahead before the next window opens.",
            };
        }
        return toResult(error, "REQUEST_TRAVEL_FAILED");
    }
}

function destinationLabel(input: RequestTravelInput): string {
    return [input.destinationCity?.trim(), input.destinationCountry?.trim()]
        .filter(Boolean)
        .join(", ");
}

/* ------------------------------------------------------------------ */
/* 2. ADVANCE                                                          */
/* ------------------------------------------------------------------ */

export interface AdvanceTravelRequestInput {
    requestId: string;
    to: string;
    note?: string;
}

/** Entry point: loads the session, then defers to `advanceTravelRequestCore`. */
export async function advanceTravelRequest(input: AdvanceTravelRequestInput): Promise<TravelActionResult> {
    const subject = await requireSubject();
    return advanceTravelRequestCore(prisma, subject, input);
}

/** Moves a request through its state machine for a known actor. */
export async function advanceTravelRequestCore(
    db: TravelDb,
    subject: AuthorizationSubject,
    input: AdvanceTravelRequestInput
): Promise<TravelActionResult> {
    try {
        const isDecision =
            input.to === TRAVEL_REQUEST_STATUS.APPROVED ||
            input.to === TRAVEL_REQUEST_STATUS.REJECTED ||
            input.to === TRAVEL_REQUEST_STATUS.COMPLETED;

        // Deciding a request is a different capability from raising one. The
        // transition table's actor list narrows this again per target state.
        assertTravelPermission(subject, isDecision ? PERMISSIONS.TRAVEL_APPROVE : PERMISSIONS.TRAVEL_REQUEST);

        const request = await db.businessTravelRequest.findUnique({
            where: { id: input.requestId },
            select: {
                id: true,
                status: true,
                employeeId: true,
                purpose: true,
                travelClass: true,
                departureDate: true,
                destinationCountry: true,
                destinationCity: true,
                requestedBy: true,
                estimatedCost: true,
                approvedAmount: true,
                amountGrantedBy: true,
                entitlementId: true,
                entitlementWindowKey: true,
                entitlement: { select: { entitledTickets: true, usedTickets: true } },
                employee: { select: EMPLOYEE_SELECT },
            },
        });
        if (!request) return { success: false, message: "Travel request not found." };

        // Scope: cancelling is a SELF-permitted action, so the requester's own
        // employee id is compared here rather than trusting the caller.
        if (!isDecision && !canActOnEmployeeRecord(subject, { employeeId: request.employeeId })) {
            return { success: false, message: "You may only cancel your own travel request." };
        }

        try {
            assertTransition("TRAVEL_REQUEST", TRAVEL_REQUEST_TRANSITIONS, request.status, input.to, {
                actorRole: subject.role,
                actorId: subject.userId,
                data: { requestedBy: request.requestedBy, actorEmail: subject.email },
            });
        } catch (error) {
            if (error instanceof InvalidTransitionError) {
                return { success: false, message: `Not permitted: ${error.message}` };
            }
            throw error;
        }

        // Approving a cabin above the employee's entitled cabin is refused, so a
        // premium-economy entitlement cannot quietly become a business-class
        // flight. HR holds TRAVEL_ENTITLEMENT_MANAGE and may still approve it as
        // a documented exception.
        if (input.to === TRAVEL_REQUEST_STATUS.APPROVED) {
            const entitledClass = request.employee.airTicketTravelClass;
            const requestedRank = CLASS_RANK[request.travelClass as AirTicketTravelClass] ?? 0;
            const entitledRank = isTravelClass(entitledClass) ? CLASS_RANK[entitledClass] : 0;
            const isException = hasPermission(subject.role, PERMISSIONS.TRAVEL_ENTITLEMENT_MANAGE);
            if (requestedRank > entitledRank && !isException) {
                return {
                    success: false,
                    message:
                        `This request asks for ${request.travelClass.replaceAll("_", " ")} but the employee's entitlement is ` +
                        `${entitledClass ? entitledClass.replaceAll("_", " ") : "not set"}. Only HR can approve an upgrade above the entitlement.`,
                };
            }
        }

        // True when APPROVED is allowed with no document on file at all, so the
        // success message can say so rather than leaving the operator to infer
        // that the gate was skipped.
        let documentsUnfiledAtApproval = false;

        /**
         * THE APPROVAL GATES.
         *
         * Approving spends company money, so two things must be true first, and
         * both are checked after the state machine and before any write: an
         * illegal transition is still reported as illegal, and a refused
         * approval grants nothing.
         *
         * 1. AN AMOUNT WAS GRANTED. `estimatedCost` is the traveller's quote, so
         *    approving against it means committing a figure nobody in HR looked
         *    at. `grantTravelAmount` records what the company agreed to pay.
         * 2. EVERY FILED DOCUMENT IS VERIFIED. An unverified scan is not
         *    evidence. No document at all is ALLOWED here — a traveller who has
         *    not booked yet has nothing to file — so the rule is stated in the
         *    refusal rather than left to be guessed at.
         */
        if (input.to === TRAVEL_REQUEST_STATUS.APPROVED) {
            if (request.approvedAmount === null) {
                return {
                    success: false,
                    message:
                        "Amount must be granted and documents verified before this trip can be approved. " +
                        `No approved amount has been granted for this request yet: the AED ${formatAmount(request.estimatedCost)} shown is the traveller's own estimate. ` +
                        "HR must review the quote and grant the amount to approve.",
                };
            }

            const filedDocuments = await db.travelDocument.findMany({
                where: { requestId: request.id, kind: { in: [...TRAVEL_DOCUMENT_KINDS] } },
                select: { kind: true, verifiedAt: true, verifiedBy: true },
            });
            const unverified = filedDocuments.filter((doc) => doc.verifiedAt === null);
            if (unverified.length > 0) {
                const names = unverified
                    .map((doc) => DOCUMENT_LABELS[doc.kind as TravelDocumentKind] ?? doc.kind)
                    .join(", ");
                return {
                    success: false,
                    message:
                        `Amount must be granted and documents verified before this trip can be approved. ` +
                        `The following filed document(s) are not verified: ${names}. ` +
                        "Open the file, check it against the booking, then mark it verified. " +
                        "A document that has not been filed yet does NOT block approval — only the ones above do.",
                };
            }
            documentsUnfiledAtApproval = true;
        }

        /**
         * THE COMPLETION GATE.
         *
         * Checked here, after the state machine and before any write, so an
         * illegal transition is still reported as illegal and a refused
         * completion consumes no ticket. A boarding pass is required because it
         * is the only artefact that proves the employee flew; a ticket is only
         * warned about, because an employee can legitimately fly on a ticket the
         * travel office arranged outside this system and there is nothing to file
         * in that case.
         */
        let ticketMissing = false;
        if (input.to === TRAVEL_REQUEST_STATUS.COMPLETED) {
            const filed = await db.travelDocument.findMany({
                where: { requestId: request.id, kind: { in: [...TRAVEL_DOCUMENT_KINDS] } },
                select: { kind: true },
            });
            const filedKinds = new Set(filed.map((doc) => doc.kind));
            if (!filedKinds.has(TRAVEL_DOCUMENT_KIND.BOARDING_PASS)) {
                return {
                    success: false,
                    message:
                        "Attach the boarding pass before recording this trip as flown: no boarding pass is filed against this request. " +
                        "Upload it on the request, then record the ticket as issued.",
                };
            }
            ticketMissing = !filedKinds.has(TRAVEL_DOCUMENT_KIND.TICKET);
        }

        await db.$transaction(async (tx) => {
            // Compare-and-swap on the status: a second click on an already
            // decided request matches no rows and the whole transaction aborts.
            const changed = await tx.businessTravelRequest.updateMany({
                where: { id: request.id, status: request.status },
                data: {
                    status: input.to,
                    ...(isDecision ? { reviewedBy: subject.email, reviewedAt: new Date() } : {}),
                    ...(input.to === TRAVEL_REQUEST_STATUS.COMPLETED ? { completedAt: new Date() } : {}),
                    ...(input.note?.trim() ? { decisionNote: input.note.trim().slice(0, 1000) } : {}),
                },
            });
            if (changed.count === 0) throw new Error(CONCURRENT);

            let ticketsConsumed = 0;
            if (input.to === TRAVEL_REQUEST_STATUS.COMPLETED) {
                ticketsConsumed = await consumeTicket(tx, request);
            }

            await tx.auditLog.create({
                data: {
                    employeeId: request.employeeId,
                    action: `TRAVEL_${input.to}`,
                    details:
                        `Travel request moved ${request.status} -> ${input.to} ` +
                        `(${request.purpose}, ${request.destinationCity ? `${request.destinationCity}, ` : ""}${request.destinationCountry}, ` +
                        `departing ${request.departureDate.toDateString()}, ${request.travelClass.replaceAll("_", " ")}). ` +
                        (ticketsConsumed > 0 ? `Consumed ticket ${ticketsConsumed} of the window's allowance.` : "") +
                        (request.approvedAmount
                            ? `Approved amount AED ${formatAmount(request.approvedAmount)} granted by ${request.amountGrantedBy ?? "an earlier approver"}. `
                            : "") +
                        (ticketMissing ? "Completed with a boarding pass on file but no ticket." : "") +
                        (input.note?.trim() ? `Note: ${input.note.trim().slice(0, 1000)}` : ""),
                    changedBy: subject.email,
                },
            });
        });

        await notifyInApp({
            employeeId: request.employeeId,
            title: `Business travel ${input.to.replaceAll("_", " ").toLowerCase()}`,
            message: `${request.purpose} to ${[request.destinationCity, request.destinationCountry].filter(Boolean).join(", ")} is now ${input.to.replaceAll("_", " ").toLowerCase()}.`,
            type:
                input.to === TRAVEL_REQUEST_STATUS.REJECTED
                    ? "WARNING"
                    : input.to === TRAVEL_REQUEST_STATUS.COMPLETED
                      ? "SUCCESS"
                      : "INFO",
            link: "/travel",
        });

        await logSecurityEvent({
            action: SECURITY_ACTION.ACCESS_DENIED,
            actorEmail: subject.email,
            actorRole: subject.role,
            target: `businessTravelRequest:${request.id}`,
            outcome: "SUCCESS",
            detail: { change: `travel_${input.to}` },
        });

        return {
            success: true,
            message:
                `Travel request ${input.to.replaceAll("_", " ").toLowerCase()}.` +
                (documentsUnfiledAtApproval
                    ? " No documents were filed yet, which is allowed at approval — attach and verify the ticket before the trip flies."
                    : "") +
                (ticketMissing
                    ? " No ticket is filed against this request — attach one if the company issued it, so the file is complete."
                    : ""),
            requestId: request.id,
            status: input.to,
        };
    } catch (error) {
        if (error instanceof TicketWindowExhaustedError) {
            return { success: false, message: error.message };
        }
        return toResult(error, "ADVANCE_TRAVEL_REQUEST_FAILED");
    }
}

class TicketWindowExhaustedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "TicketWindowExhaustedError";
    }
}

/**
 * Consumes one ticket from the request's own entitlement window.
 *
 * Two compare-and-swap writes, not a read-modify-write:
 *   - the request status, so the same request cannot be completed twice;
 *   - `usedTickets`, so two different requests cannot both take the last ticket.
 *
 * `usedTickets` is compared against the value read inside this transaction, so a
 * concurrent completion fails the write instead of overwriting it.
 */
async function consumeTicket(
    tx: PrismaTx,
    request: {
        id: string;
        employeeId: string;
        entitlementId: string | null;
        entitlementWindowKey: string | null;
        entitlement: { entitledTickets: number; usedTickets: number } | null;
    }
): Promise<number> {
    const ledger = request.entitlement;
    if (!ledger || !request.entitlementId) {
        throw new TicketWindowExhaustedError(
            "This request has no entitlement window recorded, so no ticket could be counted. HR must re-submit it."
        );
    }

    if (ledger.usedTickets >= ledger.entitledTickets) {
        throw new TicketWindowExhaustedError(
            `The window ${request.entitlementWindowKey} has already used all ${ledger.entitledTickets} of its ticket(s). ` +
            "The entitlement must be raised before this trip can be recorded."
        );
    }

    const bumped = await tx.airTicketEntitlement.updateMany({
        where: { id: request.entitlementId, usedTickets: ledger.usedTickets },
        data: { usedTickets: { increment: 1 } },
    });
    if (bumped.count === 0) {
        throw new Error(CONCURRENT);
    }

    return ledger.usedTickets + 1;
}

/* ------------------------------------------------------------------ */
/* 3. GRANT THE APPROVED AMOUNT                                        */
/* ------------------------------------------------------------------ */

/**
 * The states in which an amount may still be granted.
 *
 * Deliberately NOT a new state. A `AMOUNT_GRANTED` status would have to be
 * registered in the transition table, added to the approval queue's filter and
 * given its own colour and label on every surface that reads a travel status.
 * The grant is an attribute of a request that is already under review, not a
 * place in its lifecycle, so it changes nothing about where a request sits.
 */
const GRANTABLE_STATUSES: readonly string[] = [
    TRAVEL_REQUEST_STATUS.REQUESTED,
    TRAVEL_REQUEST_STATUS.PENDING_APPROVAL,
];

export interface GrantTravelAmountInput {
    requestId: string;
    /** AED. Must be finite and not negative. */
    approvedAmount: number;
    /** Why this figure. Recorded in the audit row beside the grant. */
    note?: string;
    /**
     * Record a deliberate exception to the annual budget.
     *
     * Not a silent cap: an over-budget grant is refused outright without it, so
     * an approver has to say "yes, this one goes over" and the audit row says so
     * in words. It does not raise the budget, and it does not exempt the next
     * request — the window total still includes this grant.
     */
    overrideBudget?: boolean;
}

/** Entry point: loads the session, then defers to `grantTravelAmountCore`. */
export async function grantTravelAmount(input: GrantTravelAmountInput): Promise<TravelActionResult> {
    const subject = await requireSubject();
    return grantTravelAmountCore(prisma, subject, input);
}

/**
 * Records what the company has agreed to pay for one trip.
 *
 * THE ESTIMATE IS NOT THE AMOUNT. `estimatedCost` is what the traveller believes
 * the trip costs; this is what HR has committed, and APPROVED is refused until
 * it exists. The two are allowed to disagree and `budgetVariance` records by how
 * much, because "we agreed more than the quote" and "we agreed less" are both
 * facts the finance file needs and neither can be recovered from the other
 * column later.
 */
export async function grantTravelAmountCore(
    db: TravelDb,
    subject: AuthorizationSubject,
    input: GrantTravelAmountInput
): Promise<TravelActionResult> {
    try {
        // Granting money is an approver's act. `travel.approve` is the same
        // capability that approves the trip, so the two cannot be separated.
        assertTravelPermission(subject, PERMISSIONS.TRAVEL_APPROVE);

        if (!input.requestId || input.requestId.length > 64) {
            return { success: false, message: "Travel request not found." };
        }

        // Refused before anything is read: a negative or non-finite amount is
        // not a number HR could have meant, and coercing it to 0 would quietly
        // approve the trip at no cost.
        const amount = moneyDecimal(Number(input.approvedAmount));
        if (amount === null) {
            return { success: false, message: "Enter the approved amount as a number." };
        }
        if (amount.isNegative()) {
            return { success: false, message: "The approved amount cannot be negative." };
        }
        if (amount.gt(MAX_TRAVEL_AMOUNT)) {
            return {
                success: false,
                message: `The approved amount cannot be more than AED ${MAX_TRAVEL_AMOUNT.toLocaleString("en-AE")}.`,
            };
        }

        const request = await db.businessTravelRequest.findUnique({
            where: { id: input.requestId },
            select: {
                id: true,
                status: true,
                employeeId: true,
                purpose: true,
                destinationCountry: true,
                destinationCity: true,
                estimatedCost: true,
                approvedAmount: true,
                entitlementWindowKey: true,
                employee: { select: { id: true, annualTravelBudget: true } },
            },
        });
        if (!request) return { success: false, message: "Travel request not found." };

        // IDOR: `travel.approve` is held by managers and HR, but a manager's
        // approval right is scoped to their own department by `canActOnEmployeeRecord`.
        if (!canActOnEmployeeRecord(subject, { employeeId: request.employeeId })) {
            return { success: false, message: "You may only grant amounts for employees in your scope." };
        }

        if (!GRANTABLE_STATUSES.includes(request.status)) {
            const refusal =
                request.status === TRAVEL_REQUEST_STATUS.REJECTED || request.status === TRAVEL_REQUEST_STATUS.CANCELLED
                    ? `This trip is ${request.status.toLowerCase()}, so there is nothing to pay for.`
                    : `An amount can only be granted while the request is awaiting review. This one is ${request.status
                          .replaceAll("_", " ")
                          .toLowerCase()}.`;
            return { success: false, message: refusal };
        }

        const budget = request.employee.annualTravelBudget;
        const alreadyGranted = await grantedAmountInWindow(
            db,
            request.employeeId,
            request.entitlementWindowKey,
            request.id
        );
        const remaining = budget ? budget.minus(alreadyGranted) : null;

        /**
         * THE BUDGET GATE.
         *
         * Three ways to be over budget, all refused unless the caller passed
         * `overrideBudget`:
         *   - no window on the request, so no window total can be computed. A
         *     row like that predates the entitlement ledger; assuming it is
         *     within budget is how a cap stops being enforced at all.
         *   - no `annualTravelBudget` on the employee. HR has not agreed a
         *     figure, which is NOT the same as agreeing to anything.
         *   - the amount exceeds what is left of the cap for the window.
         */
        let overBudgetReason: string | null = null;
        if (!request.entitlementWindowKey) {
            overBudgetReason =
                "this request carries no entitlement window, so no window budget can be checked against it";
        } else if (!budget) {
            overBudgetReason =
                `no annual travel budget is recorded for this employee, so the AED ${formatAmount(amount)} requested is uncapped`;
        } else if (remaining && amount.gt(remaining)) {
            overBudgetReason =
                `AED ${formatAmount(remaining)} is left of the AED ${formatAmount(budget)} budget for window ` +
                `${request.entitlementWindowKey} after AED ${formatAmount(alreadyGranted)} already granted`;
        }

        if (overBudgetReason && !input.overrideBudget) {
            return {
                success: false,
                message:
                    `The approved amount of AED ${formatAmount(amount)} is above budget: ${overBudgetReason}. ` +
                    "Raise the employee's annual travel budget, lower the amount, or record the exception explicitly with the override option.",
            };
        }

        const note = input.note?.trim();
        if (note && note.length > 1000) {
            return { success: false, message: "Notes must be 1,000 characters or fewer." };
        }

        // The quote is a Float, so it is converted once, here, and the variance is
        // computed in exact decimal arithmetic rather than in binary floating
        // point where 0.1 + 0.2 is not 0.3.
        const variance = amount.minus(new Prisma.Decimal(request.estimatedCost));
        const grantedAt = new Date();
        const overrideUsed = overBudgetReason !== null;

        await db.$transaction(async (tx) => {
            await tx.businessTravelRequest.update({
                where: { id: request.id },
                data: {
                    approvedAmount: amount,
                    budgetVariance: variance,
                    amountGrantedBy: subject.email,
                    amountGrantedAt: grantedAt,
                },
            });

            await tx.auditLog.create({
                data: {
                    employeeId: request.employeeId,
                    action: "TRAVEL_AMOUNT_GRANTED",
                    details:
                        `Approved amount ${request.approvedAmount === null ? "none" : `AED ${formatAmount(request.approvedAmount)}`} -> AED ${formatAmount(amount)} ` +
                        `for ${request.purpose} to ${request.destinationCity ? `${request.destinationCity}, ` : ""}${request.destinationCountry} ` +
                        `(window ${request.entitlementWindowKey ?? "none"}, traveller's estimate AED ${formatAmount(request.estimatedCost)}, ` +
                        `variance AED ${formatAmount(variance)}). ` +
                        (overrideUsed
                            ? `OVER-BUDGET OVERRIDE RECORDED: ${overBudgetReason}. `
                            : `Within budget: AED ${formatAmount(remaining)} remained of AED ${formatAmount(budget)}. `) +
                        (note ? `Note: ${note.slice(0, 1000)}` : ""),
                    changedBy: subject.email,
                },
            });
        });

        await notifyInApp({
            employeeId: request.employeeId,
            title: "Travel amount granted",
            message:
                `HR has approved AED ${formatAmount(amount)} for ${request.purpose} to ` +
                `${[request.destinationCity, request.destinationCountry].filter(Boolean).join(", ")}.` +
                (variance.isNegative() ? " That is less than your estimate." : ""),
            type: "INFO",
            link: "/travel",
        });

        return {
            success: true,
            message:
                `Approved amount set to AED ${formatAmount(amount)}` +
                (variance.isZero() ? "." : `, ${variance.isNegative() ? "below" : "above"} the traveller's estimate by AED ${formatAmount(variance.abs())}.`) +
                (overrideUsed ? " Recorded as an over-budget exception." : ""),
            requestId: request.id,
            status: request.status,
        };
    } catch (error) {
        return toResult(error, "GRANT_TRAVEL_AMOUNT_FAILED");
    }
}

/* ------------------------------------------------------------------ */
/* 4. VERIFY A TRAVEL DOCUMENT                                         */
/* ------------------------------------------------------------------ */

export interface VerifyTravelDocumentInput {
    requestId: string;
    kind: string;
    /** true marks the scan verified; false withdraws a verification. */
    verified: boolean;
}

/** Entry point: loads the session, then defers to `verifyTravelDocumentCore`. */
export async function verifyTravelDocument(input: VerifyTravelDocumentInput): Promise<TravelActionResult> {
    const subject = await requireSubject();
    return verifyTravelDocumentCore(prisma, subject, input);
}

/**
 * Records that an approver has looked at a filed travel document.
 *
 * AN UPLOAD IS NOT A VERIFICATION. `uploadedBy` says who sent the file;
 * `verifiedBy` / `verifiedAt` say who checked it. Both are needed because the
 * traveller uploads their own ticket and the travel office files the one it
 * bought, and an approver has to be able to tell which of the two artefacts was
 * actually looked at — `OnboardingChecklistItem.verifiedBy` exists for the same
 * reason.
 *
 * A withdrawal is not a delete: the file stays on the request and the audit row
 * keeps both the earlier sign-off and the withdrawal, so the history of who
 * blessed what survives.
 */
export async function verifyTravelDocumentCore(
    db: TravelDb,
    subject: AuthorizationSubject,
    input: VerifyTravelDocumentInput
): Promise<TravelActionResult> {
    try {
        // Verifying is part of reviewing, so it takes the approval capability.
        assertTravelPermission(subject, PERMISSIONS.TRAVEL_APPROVE);

        if (!isTravelDocumentKind(input.kind)) {
            return { success: false, message: "Choose a valid document type: ticket or boarding pass." };
        }
        if (!input.requestId || input.requestId.length > 64) {
            return { success: false, message: "Travel request not found." };
        }

        const request = await db.businessTravelRequest.findUnique({
            where: { id: input.requestId },
            select: { id: true, status: true, employeeId: true, destinationCountry: true, destinationCity: true },
        });
        if (!request) return { success: false, message: "Travel request not found." };
        if (!canActOnEmployeeRecord(subject, { employeeId: request.employeeId })) {
            return { success: false, message: "You may only verify documents for employees in your scope." };
        }

        const label = DOCUMENT_LABELS[input.kind];
        const document = await db.travelDocument.findUnique({
            where: { requestId_kind: { requestId: request.id, kind: input.kind } },
            select: {
                id: true,
                fileName: true,
                uploadedBy: true,
                uploadedAt: true,
                verifiedBy: true,
                verifiedAt: true,
            },
        });
        if (!document) {
            return {
                success: false,
                message: `No ${label.toLowerCase()} is filed against this request, so there is nothing to verify.`,
            };
        }

        const at = new Date();
        await db.$transaction(async (tx) => {
            await tx.travelDocument.update({
                where: { id: document.id },
                data: input.verified
                    ? { verifiedBy: subject.email, verifiedAt: at }
                    : { verifiedBy: null, verifiedAt: null },
            });

            await tx.auditLog.create({
                data: {
                    employeeId: request.employeeId,
                    action: input.verified ? "TRAVEL_DOCUMENT_VERIFIED" : "TRAVEL_DOCUMENT_VERIFICATION_WITHDRAWN",
                    details:
                        `${label} ${input.verified ? "verified" : "verification withdrawn"} for travel request ` +
                        `${request.destinationCity ? `${request.destinationCity}, ` : ""}${request.destinationCountry} ` +
                        `(status ${request.status}). File ${document.fileName}, uploaded by ${document.uploadedBy}. ` +
                        (input.verified
                            ? `Checked and accepted by ${subject.email}.`
                            : document.verifiedBy
                              ? `Previously verified by ${document.verifiedBy}; that sign-off no longer applies.`
                              : "No prior verification to withdraw."),
                    changedBy: subject.email,
                },
            });
        });

        return {
            success: true,
            message: input.verified
                ? `${label} verified. This trip can be approved.`
                : `${label} verification withdrawn. The trip cannot be approved until it is verified again.`,
            requestId: request.id,
            status: request.status,
        };
    } catch (error) {
        return toResult(error, "VERIFY_TRAVEL_DOCUMENT_FAILED");
    }
}

/* ------------------------------------------------------------------ */
/* 5. MANAGE THE ENTITLEMENT                                           */
/* ------------------------------------------------------------------ */

/** Ticket counts this module will accept. 12 is well past any real UAE policy. */
const MAX_ENTITLED_TICKETS = 12;

export interface SetEntitlementInput {
    employeeId: string;
    /** Whole tickets per entitlement year, 0 to revoke the entitlement. */
    entitledPerYear: number;
    travelClass?: string | null;
    /** `yyyy-MM-dd`. Null clears the anchor and returns the window to the fallback. */
    anchorDate?: string | null;
    /**
     * Monetary cap per window, AED. Null clears the cap.
     *
     * UNLIKE THE TICKET COUNT, THIS APPLIES IMMEDIATELY. The count is
     * snapshotted into `AirTicketEntitlement` when a window opens so history
     * cannot be rewritten; the budget is read live off the employee, because the
     * question it answers is "may this employee spend more right now", and a
     * stale snapshot of a cap HR has just raised would refuse a legitimate trip.
     * Already-granted amounts are not revisited, so raising the cap frees
     * headroom rather than rewriting a past decision.
     */
    annualBudget?: number | null;
}

/**
 * Sets the entitlement contract.
 *
 * EXISTING WINDOWS ARE NOT REWRITTEN. A window that has already opened keeps the
 * entitlement it was opened with, so raising the count mid-window cannot mint
 * extra tickets retroactively; the new count applies from the next window. The
 * action reports that explicitly rather than letting HR believe it applied
 * immediately.
 */
export async function setEntitlement(input: SetEntitlementInput): Promise<TravelActionResult> {
    try {
        const subject = await requireSubject();
        assertTravelPermission(subject, PERMISSIONS.TRAVEL_ENTITLEMENT_MANAGE);

        const entitledPerYear = Number(input.entitledPerYear);
        if (!Number.isInteger(entitledPerYear) || entitledPerYear < 0 || entitledPerYear > MAX_ENTITLED_TICKETS) {
            return {
                success: false,
                message: `Entitlement must be a whole number of tickets between 0 and ${MAX_ENTITLED_TICKETS}.`,
            };
        }

        let travelClass: string | null = null;
        if (input.travelClass) {
            if (!isTravelClass(input.travelClass)) {
                return { success: false, message: "Choose a valid travel class." };
            }
            travelClass = input.travelClass;
        }

        let anchorDate: Date | null = null;
        if (input.anchorDate) {
            anchorDate = new Date(input.anchorDate);
            if (Number.isNaN(anchorDate.getTime())) {
                return { success: false, message: "Enter a valid anchor date." };
            }
            anchorDate = atStartOfDay(anchorDate);
        }

        // An empty field clears the cap rather than storing a zero: "no cap
        // agreed" and "a cap of nothing" are different states, and only the first
        // is what an untouched form means.
        let annualBudget: Prisma.Decimal | null = null;
        if (input.annualBudget !== undefined && input.annualBudget !== null) {
            const parsed = moneyDecimal(Number(input.annualBudget));
            if (parsed === null) {
                return { success: false, message: "The annual travel budget must be a number." };
            }
            if (parsed.isNegative()) {
                return { success: false, message: "The annual travel budget cannot be negative." };
            }
            if (parsed.gt(MAX_TRAVEL_AMOUNT)) {
                return {
                    success: false,
                    message: `The annual travel budget cannot be more than AED ${MAX_TRAVEL_AMOUNT.toLocaleString("en-AE")}.`,
                };
            }
            annualBudget = parsed;
        }

        const employee = await prisma.employee.findUnique({
            where: { id: input.employeeId },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                airTicketEntitlementPerYear: true,
                annualTravelBudget: true,
            },
        });
        if (!employee) return { success: false, message: "Employee not found." };

        await prisma.$transaction(async (tx) => {
            await tx.employee.update({
                where: { id: employee.id },
                data: {
                    airTicketEntitlementPerYear: entitledPerYear,
                    airTicketTravelClass: travelClass,
                    airTicketAnchorDate: anchorDate,
                    annualTravelBudget: annualBudget,
                },
            });
            await tx.auditLog.create({
                data: {
                    employeeId: employee.id,
                    action: "TRAVEL_ENTITLEMENT_UPDATED",
                    details:
                        `Air ticket entitlement ${employee.airTicketEntitlementPerYear} -> ${entitledPerYear} per year, ` +
                        `class ${travelClass ?? "none"}, anchor ${anchorDate ? anchorDate.toDateString() : "cleared (calendar-year window)"}, ` +
                        `annual travel budget ${employee.annualTravelBudget === null ? "none" : `AED ${formatAmount(employee.annualTravelBudget)}`} -> ` +
                        `${annualBudget === null ? "none (cleared, so every grant needs an override)" : `AED ${formatAmount(annualBudget)}`}. ` +
                        "Ticket count applies from the next entitlement window; windows already opened are unchanged. " +
                        "The budget applies immediately to the window currently open.",
                    changedBy: subject.email,
                },
            });
        });

        return {
            success: true,
            message:
                `Entitlement for ${employee.firstName} ${employee.lastName} saved. ` +
                "The ticket count applies from the next entitlement window; the annual budget applies now.",
        };
    } catch (error) {
        return toResult(error, "SET_ENTITLEMENT_FAILED");
    }
}

/* ------------------------------------------------------------------ */
/* 6. TRAVEL DOCUMENTS                                                 */
/* ------------------------------------------------------------------ */

export const TRAVEL_DOCUMENT_KINDS = ["TICKET", "BOARDING_PASS"] as const;
export type TravelDocumentKind = (typeof TRAVEL_DOCUMENT_KINDS)[number];

/**
 * The same two values by name, derived from the array above so the vocabulary
 * has one source of truth. `TRAVEL_REQUEST_STATUS` is shaped this way; the array
 * is kept because it is also the validation list a browser value is checked
 * against.
 */
export const TRAVEL_DOCUMENT_KIND = {
    TICKET: TRAVEL_DOCUMENT_KINDS[0],
    BOARDING_PASS: TRAVEL_DOCUMENT_KINDS[1],
} as const;

export function isTravelDocumentKind(value: unknown): value is TravelDocumentKind {
    return typeof value === "string" && (TRAVEL_DOCUMENT_KINDS as readonly string[]).includes(value);
}

/** What a kind is called in a message. */
const DOCUMENT_LABELS: Record<TravelDocumentKind, string> = {
    TICKET: "Ticket",
    BOARDING_PASS: "Boarding pass",
};

/**
 * Images and PDF only, matching the employee upload API's list. A boarding pass
 * arrives as a PDF or a phone photo; accepting an arbitrary binary here would
 * mean storing whatever the browser claims a file is.
 */
export const TRAVEL_DOCUMENT_MIME_TYPES = [
    "image/png",
    "image/jpeg",
    "image/jpg",
    "application/pdf",
] as const;

/** 10 MB, the ceiling the employee upload API already uses. */
export const MAX_TRAVEL_DOCUMENT_BYTES = 10 * 1024 * 1024;

const MIME_EXTENSIONS: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "application/pdf": ".pdf",
};

/**
 * Statuses a document may be filed against.
 *
 * A ticket exists only once the trip is agreed, and a boarding pass only once it
 * has been flown, so both are refused before APPROVED: a "ticket" attached to a
 * request nobody approved is evidence of nothing. COMPLETED is included so a
 * wrong scan can still be replaced after the fact — the alternative is a
 * permanently wrong document on a closed trip.
 */
const DOCUMENTABLE_STATUSES: readonly string[] = [
    TRAVEL_REQUEST_STATUS.APPROVED,
    TRAVEL_REQUEST_STATUS.COMPLETED,
];

/** `fileUrl` holds a data URL, so the bytes must survive the round trip intact. */
const DATA_URL = /^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/;

/**
 * The document fields the page renders.
 *
 * `fileUrl` is NOT among them and must not be added casually: it carries the
 * whole file as base64, so selecting it for a page that lists 100 requests would
 * pull megabytes of boarding passes into the RSC payload. The bytes are served
 * one at a time by `readTravelDocument` through the authorised file route.
 */
const TRAVEL_DOCUMENT_SELECT = {
    id: true,
    requestId: true,
    kind: true,
    fileName: true,
    fileType: true,
    fileBytes: true,
    reference: true,
    uploadedBy: true,
    uploadedAt: true,
    verifiedBy: true,
    verifiedAt: true,
} as const;

export type TravelDocumentSummary = {
    id: string;
    requestId: string;
    kind: string;
    fileName: string;
    fileType: string;
    fileBytes: number | null;
    reference: string | null;
    uploadedBy: string;
    uploadedAt: Date;
    /** Null until an approver has looked at the file. Gates APPROVED. */
    verifiedBy: string | null;
    verifiedAt: Date | null;
};

/** The full row including the bytes, for the authorised file route only. */
export interface TravelDocumentFile extends TravelDocumentSummary {
    fileUrl: string;
}

/**
 * The documents filed against one request, if the caller may see that request.
 *
 * A read helper returns an empty list rather than throwing: it is called while a
 * page renders, and a denied read must not turn the whole page into an error
 * page. The caller has already scoped the request rows, so the empty list is
 * simply "nothing you can see".
 */
export async function getTravelDocuments(
    subject: AuthorizationSubject,
    requestId: string
): Promise<TravelDocumentSummary[]> {
    if (!hasPermission(subject.role, PERMISSIONS.TRAVEL_VIEW)) return [];

    const request = await prisma.businessTravelRequest.findUnique({
        where: { id: requestId },
        select: { id: true, employeeId: true },
    });
    if (!request) return [];
    if (!canActOnEmployeeRecord(subject, { employeeId: request.employeeId })) return [];

    return prisma.travelDocument.findMany({
        where: { requestId: request.id },
        select: TRAVEL_DOCUMENT_SELECT,
        orderBy: { uploadedAt: "desc" },
    });
}

/**
 * The same read for many requests, in ONE query.
 *
 * The travel page lists up to 100 requests. Calling `getTravelDocuments` per
 * row is up to 101 round trips, so the batch form is what the page uses; it
 * filters to the rows the caller may act on before querying, which is the same
 * IDOR test applied to the single form.
 */
export async function getTravelDocumentMap(
    subject: AuthorizationSubject,
    rows: readonly { id: string; employeeId: string }[]
): Promise<Map<string, TravelDocumentSummary[]>> {
    const visible = new Map<string, TravelDocumentSummary[]>();
    if (!hasPermission(subject.role, PERMISSIONS.TRAVEL_VIEW) || rows.length === 0) return visible;

    const requestIds = rows
        .filter((row) => canActOnEmployeeRecord(subject, { employeeId: row.employeeId }))
        .map((row) => row.id);
    if (requestIds.length === 0) return visible;

    const documents = await prisma.travelDocument.findMany({
        where: { requestId: { in: requestIds } },
        select: TRAVEL_DOCUMENT_SELECT,
        orderBy: { uploadedAt: "desc" },
    });

    for (const row of rows) visible.set(row.id, []);
    for (const doc of documents) visible.get(doc.requestId)?.push(doc);
    return visible;
}

/**
 * One document WITH its bytes, for the file route. Returns null when the
 * document does not exist or the caller may not see it, so the route cannot
 * distinguish "forbidden" from "absent" and probe for ids.
 */
export async function readTravelDocument(
    subject: AuthorizationSubject,
    documentId: string
): Promise<TravelDocumentFile | null> {
    if (!hasPermission(subject.role, PERMISSIONS.TRAVEL_VIEW)) return null;

    const document = await prisma.travelDocument.findUnique({
        where: { id: documentId },
        select: {
            ...TRAVEL_DOCUMENT_SELECT,
            fileUrl: true,
            request: { select: { employeeId: true } },
        },
    });
    if (!document) return null;
    if (!canActOnEmployeeRecord(subject, { employeeId: document.request.employeeId })) return null;

    // The owner id has done its job above and must not travel to the route.
    return {
        id: document.id,
        requestId: document.requestId,
        kind: document.kind,
        fileName: document.fileName,
        fileType: document.fileType,
        fileBytes: document.fileBytes,
        reference: document.reference,
        uploadedBy: document.uploadedBy,
        uploadedAt: document.uploadedAt,
        verifiedBy: document.verifiedBy,
        verifiedAt: document.verifiedAt,
        fileUrl: document.fileUrl,
    };
}

export interface UploadTravelDocumentInput {
    requestId: string;
    kind: string;
    fileName: string;
    /**
     * The file as a `data:` URL. Passed rather than read from disk or a form
     * upload so this function is driven identically from a server action and
     * from a verification script.
     */
    dataUrl: string;
    /** Booking reference / PNR. Optional; the one field read without the file. */
    reference?: string;
}

/**
 * Files a ticket or a boarding pass against one travel request.
 *
 * WHO MAY FILE WHAT
 *
 * Both kinds are the TRAVELLER'S OWN evidence of their journey, so neither needs
 * a judgement and neither goes through maker-checker:
 *
 *  - Their own request: `travel.request`, the same permission that lets them
 *    raise the trip in the first place.
 *  - Somebody else's request: `travel.approve`, plus the IDOR scope test. This is
 *    HR filing a document the traveller sent them by another channel — the
 *    traveller never books their own flight, so a company-arranged ticket
 *    routinely exists only as a file HR received. It is an administrative act,
 *    not an approval, which is why it does not need a second pair of eyes.
 *
 * TICKET and BOARDING_PASS deliberately share this model. The distinction that
 * matters between them is the LIFECYCLE, not the author: a ticket is expected
 * once the trip is approved, a boarding pass by the time it is recorded as
 * flown, and `advanceTravelRequest` enforces the second one.
 */
export async function uploadTravelDocument(input: UploadTravelDocumentInput): Promise<TravelActionResult> {
    const subject = await requireSubject();
    return uploadTravelDocumentCore(prisma, subject, input);
}

/** Files a travel document for a known actor. Owns every rule. */
export async function uploadTravelDocumentCore(
    db: TravelDb,
    subject: AuthorizationSubject,
    input: UploadTravelDocumentInput
): Promise<TravelActionResult> {
    try {
        // The kind arrives from the browser and indexes the unique constraint, so
        // it is checked against the vocabulary rather than cast.
        if (!isTravelDocumentKind(input.kind)) {
            return { success: false, message: "Choose a valid document type: ticket or boarding pass." };
        }
        const kind = input.kind;

        const request = await db.businessTravelRequest.findUnique({
            where: { id: input.requestId },
            select: {
                id: true,
                status: true,
                employeeId: true,
                destinationCountry: true,
                destinationCity: true,
            },
        });
        if (!request) return { success: false, message: "Travel request not found." };

        const isOwnRequest = subject.employeeId !== null && subject.employeeId === request.employeeId;
        assertTravelPermission(subject, isOwnRequest ? PERMISSIONS.TRAVEL_REQUEST : PERMISSIONS.TRAVEL_APPROVE);
        // IDOR: same ownership test `requestTravel` uses. An employee may file
        // against their own request only; a manager may file against a colleague
        // in their department; HR may file against anyone.
        if (!canActOnEmployeeRecord(subject, { employeeId: request.employeeId })) {
            return { success: false, message: "You may only file travel documents for your own requests." };
        }

        if (!DOCUMENTABLE_STATUSES.includes(request.status)) {
            const refusal =
                request.status === TRAVEL_REQUEST_STATUS.REJECTED || request.status === TRAVEL_REQUEST_STATUS.CANCELLED
                    ? `This trip is ${request.status.toLowerCase()}, so there is no document to file.`
                    : `A ${DOCUMENT_LABELS[kind].toLowerCase()} can only be filed once the request is approved. ` +
                      `This one is ${request.status.replaceAll("_", " ").toLowerCase()}.`;
            return { success: false, message: refusal };
        }

        const match = DATA_URL.exec(input.dataUrl ?? "");
        if (!match) {
            return { success: false, message: "Attach a PNG, JPEG or PDF file." };
        }
        const fileType = match[1].toLowerCase();
        if (!(TRAVEL_DOCUMENT_MIME_TYPES as readonly string[]).includes(fileType)) {
            return { success: false, message: "Only PNG, JPEG or PDF files can be filed against a travel request." };
        }

        const payload = match[2];
        const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
        const fileBytes = Math.floor((payload.length * 3) / 4) - padding;
        if (fileBytes > MAX_TRAVEL_DOCUMENT_BYTES) {
            return {
                success: false,
                message: `That file is ${(fileBytes / (1024 * 1024)).toFixed(1)} MB. The limit is ${
                    MAX_TRAVEL_DOCUMENT_BYTES / (1024 * 1024)
                } MB.`,
            };
        }

        // The stored name never carries a path: it is only ever rendered back to
        // an operator, and a value like `..\..\x` in a filename column is a trap
        // for whatever later builds a filesystem path from it.
        const cleanedName = (input.fileName ?? "").replace(/[\\/:*?"<>|\r\n\t]/g, " ").trim();
        const fileName =
            cleanedName.length > 0 ? cleanedName.slice(0, 200) : `${kind.toLowerCase()}${MIME_EXTENSIONS[fileType]}`;

        const reference = input.reference?.trim();
        if (reference && reference.length > 100) {
            return { success: false, message: "The booking reference must be 100 characters or fewer." };
        }

        const previous = await db.travelDocument.findUnique({
            where: { requestId_kind: { requestId: request.id, kind } },
            select: { id: true, fileName: true, verifiedBy: true, verifiedAt: true },
        });

        // The upsert below REPLACES the file, so the verification must be cleared
        // with it. Leaving `verifiedBy` in place would let a swapped document
        // inherit the sign-off given to the one it replaced — the same trap
        // `recordDocumentReceived` documents for employee documents, and the
        // reason APPROVED can never be satisfied by a scan nobody has seen.
        const replacesVerified = Boolean(previous?.verifiedAt);

        await db.$transaction(async (tx) => {
            // Upsert on @@unique([requestId, kind]): a corrected boarding pass
            // replaces the wrong one instead of leaving two and making it
            // ambiguous which is authoritative.
            await tx.travelDocument.upsert({
                where: { requestId_kind: { requestId: request.id, kind } },
                create: {
                    requestId: request.id,
                    kind,
                    fileName,
                    fileUrl: input.dataUrl,
                    fileType,
                    fileBytes,
                    reference: reference || null,
                    uploadedBy: subject.email,
                },
                update: {
                    fileName,
                    fileUrl: input.dataUrl,
                    fileType,
                    fileBytes,
                    reference: reference || null,
                    uploadedBy: subject.email,
                    uploadedAt: new Date(),
                    // A NEW SCAN IS A NEW CLAIM. See above.
                    verifiedBy: null,
                    verifiedAt: null,
                },
                select: { id: true },
            });

            await tx.auditLog.create({
                data: {
                    employeeId: request.employeeId,
                    action: "TRAVEL_DOCUMENT_UPLOADED",
                    details:
                        `${DOCUMENT_LABELS[kind]} ${previous ? "replaced" : "filed"} for travel request ` +
                        `${request.destinationCity ? `${request.destinationCity}, ` : ""}${request.destinationCountry} ` +
                        `(status ${request.status}). ` +
                        `File: ${fileName}${reference ? `, reference ${reference}` : ""}.` +
                        (replacesVerified
                            ? ` Previous verification by ${previous?.verifiedBy} cleared: the replacement has not been checked yet.`
                            : ""),
                    changedBy: subject.email,
                },
            });
        });

        return {
            success: true,
            message: `${DOCUMENT_LABELS[kind]} ${previous ? "replaced" : "filed"}.` +
                (replacesVerified
                    ? " Its earlier verification was cleared — an approver must check the new file before this trip can be approved."
                    : "") +
                (kind === TRAVEL_DOCUMENT_KIND.TICKET
                    ? " The boarding pass is still needed before this trip can be recorded as flown."
                    : " This trip can now be recorded as flown."),
            requestId: request.id,
            status: request.status,
        };
    } catch (error) {
        return toResult(error, "UPLOAD_TRAVEL_DOCUMENT_FAILED");
    }
}