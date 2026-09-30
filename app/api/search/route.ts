/**
 * Global search.
 *
 * The header's search field was decorative: an `<Input>` with no state, no
 * handler and no query, advertising a "Cmd + K" shortcut that did not exist.
 * This route is the server half of the real implementation.
 *
 * Design rules:
 *  - Every domain is gated individually by the caller's resolved permissions.
 *    A result is only ever returned for a surface the caller may already
 *    browse, so search cannot become a side channel that reveals records the
 *    corresponding page would refuse.
 *  - Employee results are filtered through the caller's organisational scope
 *    (`scopeEmployeeWhere`), so a MANAGER's search results are limited to their
 *    own department exactly like the employee list is. An out-of-scope employee
 *    is absent from the result set entirely — never present-but-redacted, which
 *    would still confirm the record exists.
 *  - Each domain is queried independently. A failure in one degrades that
 *    group rather than failing the whole search, because a broken optional
 *    filter must not make the header unusable.
 *
 * ── COVERAGE AND COST ────────────────────────────────────────────────────────
 * The schema has 62 models. Searching all of them on every debounced keystroke
 * would mean ~20 round-trips per character typed, which is a worse product than
 * one that returns less. Search is therefore split into two passes:
 *
 *   FAST PASS      runs on every keystroke. Four domains, at most FIVE database
 *                  queries (Recruitment is two models behind one permission).
 *                  This is deliberately the same query count the route had
 *                  before coverage was broadened, so per-keystroke load did not
 *                  regress while the searchable surface grew.
 *
 *   EXTENDED PASS  runs only when the user explicitly asks for it (the
 *                  "Search all records" row in the dropdown, or `?scope=all`).
 *                  Sixteen further domains, at most SIXTEEN more queries, plus
 *                  the fast pass so the response is self-contained — 21 in
 *                  total, once, on an explicit click, never per keystroke.
 *                  It is executed through a concurrency cap so twenty-one
 *                  parallel statements cannot exhaust the connection pool.
 *
 * A domain is only in the plan when its permission is held, so the real query
 * count is far lower for a restricted role: STAFF and MANAGER never reach
 * 5 queries on the fast pass, and a FINANCE account reaches 1.
 *
 * ── PERMISSION CHOICES ───────────────────────────────────────────────────────
 * Every gate below is an EXISTING catalogue entry from
 * `lib/auth/permissions.ts`; no permission is invented here. Where a domain's
 * natural permission does not exist, the closest existing capability is used
 * and the reason is stated at the gate. The three highest-risk domains
 * (SalaryRecord, SalaryStructure, Overtime) never select a single amount,
 * allowance, rate, IBAN or bank field — see the comment on each.
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { authorizeAnyPermission } from "@/lib/auth/guards";
import { resolvePermissions, PERMISSIONS } from "@/lib/auth/permissions";
import { scopeEmployeeWhere, scopeKindForRole, type AuthorizationSubject } from "@/lib/auth/scope";

/** Below this length a term matches too much to be useful and costs a table scan. */
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 80;

/** `take` for every domain in both passes. Small on purpose: a dropdown, not a report. */
const PER_GROUP_LIMIT = 5;

/** Hard ceiling on rows rendered in the dropdown, applied after relevance ordering. */
const MAX_TOTAL_HITS = 40;

/** Groups rendered at most, so a broad term cannot produce an unusable list. */
const MAX_GROUPS = 10;

/** At most this many extended-pass statements are in flight at once. */
const EXTENDED_CONCURRENCY = 6;

export interface SearchHit {
    id: string;
    title: string;
    subtitle: string;
    href: string;
}

export interface SearchGroup {
    key: string;
    label: string;
    hits: SearchHit[];
}

export interface SearchResponse {
    groups: SearchGroup[];
    /** True when the caller holds at least one permission the fast pass skipped. */
    hasMore: boolean;
    /** True when this response already contains the extended pass. */
    extended: boolean;
    /** True when MAX_TOTAL_HITS or MAX_GROUPS discarded results. */
    truncated: boolean;
}

/* ------------------------------------------------------------------ */
/* Group registry — order is RELEVANCE, not alphabetical              */
/* ------------------------------------------------------------------ */

interface GroupSpec {
    key: string;
    label: string;
    order: number;
}

/**
 * A fixed relevance order. The dropdown used to sort by `label`, which put
 * "Attendance" above "Employees" for no reason a reader could infer. People are
 * what people search for, so people lead; configuration trails.
 */
const GROUPS = {
    employees: { key: "employees", label: "Employees", order: 10 },
    recruitment: { key: "recruitment", label: "Recruitment", order: 20 },
    leaves: { key: "leaves", label: "Leave Requests", order: 30 },
    requests: { key: "requests", label: "Staff Requests", order: 40 },
    attendance: { key: "attendance", label: "Attendance", order: 50 },
    payroll: { key: "payroll", label: "Payroll", order: 60 },
    loans: { key: "loans", label: "Loans", order: 70 },
    letters: { key: "letters", label: "Letters", order: 80 },
    compliance: { key: "compliance", label: "Compliance", order: 90 },
    onboarding: { key: "onboarding", label: "Onboarding", order: 100 },
    notifications: { key: "notifications", label: "Notifications", order: 110 },
    configuration: { key: "configuration", label: "Configuration", order: 120 },
} as const satisfies Record<string, GroupSpec>;

type GroupKey = keyof typeof GROUPS;

const GROUP_BY_KEY = GROUPS as Record<GroupKey, GroupSpec>;

/* ------------------------------------------------------------------ */
/* Text / formatting helpers                                          */
/* ------------------------------------------------------------------ */

/**
 * Postgres `contains` is case-sensitive, so every text match is folded with
 * `mode: "insensitive"`. Trimming and collapsing the term keeps a stray space
 * from turning into a leading wildcard.
 */
function textMatch(term: string) {
    return { contains: term, mode: "insensitive" as const };
}

/** Name/code predicates every employee-scoped domain shares. */
function nameMatch(term: string) {
    return {
        OR: [
            { firstName: textMatch(term) },
            { lastName: textMatch(term) },
            { employeeCode: textMatch(term) },
        ],
    };
}

function truncate(value: string | null | undefined, max = 80): string {
    if (!value) return "";
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function humanStatus(value: string | null | undefined): string {
    if (!value) return "";
    return value.replace(/_/g, " ").toLowerCase();
}

function formatDate(value: Date | string | null | undefined): string {
    if (!value) return "—";
    const date = typeof value === "string" ? new Date(value) : value;
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

const MONTH_NAMES: Record<string, number> = {
    jan: 1, january: 1,
    feb: 2, february: 2,
    mar: 3, march: 3,
    apr: 4, april: 4,
    may: 5,
    jun: 6, june: 6,
    jul: 7, july: 7,
    aug: 8, august: 8,
    sep: 9, sept: 9, september: 9,
    oct: 10, october: 10,
    nov: 11, november: 11,
    dec: 12, december: 12,
};

const MONTH_LABELS = [
    "", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
];

/**
 * `PayrollRun.month`/`year` are integers, so `contains` cannot reach them. A
 * payroll period is the single most-typed thing an HR manager looks for, so a
 * month name ("march") or a bare year ("2026") is translated into the two
 * equality predicates it stands for.
 */
function periodPredicates(term: string): Array<{ month?: number; year?: number }> {
    const out: Array<{ month?: number; year?: number }> = [];
    const month = MONTH_NAMES[term.toLowerCase().replace(/[^a-z]/g, "")];
    if (month) out.push({ month });

    const numeric = Number.parseInt(term, 10);
    if (Number.isInteger(numeric) && String(numeric) === term.trim()) {
        if (numeric >= 1 && numeric <= 12) out.push({ month: numeric });
        if (numeric >= 2000 && numeric <= 2100) out.push({ year: numeric });
    }
    return out;
}

/* ------------------------------------------------------------------ */
/* Request context                                                     */
/* ------------------------------------------------------------------ */

interface SearchContext {
    subject: AuthorizationSubject;
    permissions: ReadonlySet<string>;
    /** `true` for `/notifications`, which lists only the caller's own rows. */
    selfOnly: boolean;
    can: (permission: string) => boolean;
    canAny: (permissions: readonly string[]) => boolean;
}

interface Contribution {
    group: GroupSpec;
    hits: SearchHit[];
}

type Domain = (
    term: string,
    ctx: SearchContext
) => Promise<Contribution[]>;

interface DomainPlan {
    domain: Domain;
    /** `fast` runs per keystroke; `extended` only on an explicit request. */
    tier: "fast" | "extended";
    /** Precomputed so `hasMore` costs nothing and needs no extra queries. */
    enabled: (ctx: SearchContext) => boolean;
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export async function GET(request: NextRequest) {
    // `anyAuthenticated` is satisfied by the base grant every signed-in account
    // holds (notification.view), so this rejects anonymous callers without
    // locking out a legitimately restricted user from searching their own data.
    const auth = await authorizeAnyPermission([PERMISSIONS.NOTIFICATION_VIEW]);
    if (!auth.ok) {
        return NextResponse.json({ error: auth.error, groups: [] }, { status: auth.status });
    }

    const { user, subject } = auth;

    const raw = request.nextUrl.searchParams.get("q") ?? "";
    const term = raw.trim().replace(/\s+/g, " ");
    if (term.length < MIN_QUERY_LENGTH) {
        return NextResponse.json(emptyResponse());
    }
    if (term.length > MAX_QUERY_LENGTH) {
        return NextResponse.json({ ...emptyResponse(), error: "Query too long" }, { status: 400 });
    }

    const wantExtended = request.nextUrl.searchParams.get("scope") === "all";

    const { permissions } = resolvePermissions(user.role);
    const ctx: SearchContext = {
        subject,
        permissions,
        selfOnly: scopeKindForRole(user.role) === "SELF",
        can: (permission) => permissions.has(permission),
        canAny: (required) => required.some((permission) => permissions.has(permission)),
    };

    const fastPlan = PLAN.filter((entry) => entry.tier === "fast" && entry.enabled(ctx));
    const extendedPlan = wantExtended ? PLAN.filter((e) => e.tier === "extended" && e.enabled(ctx)) : [];

    const sink = new Map<GroupKey, SearchHit[]>();

    // Fast pass: small enough to run unbounded.
    await Promise.all(
        fastPlan.map((entry) => runDomain(entry.domain, term, ctx, sink))
    );

    if (extendedPlan.length > 0) {
        // Extended pass: deliberately one click, deliberately capped so the
        // pool is never asked for twenty-one concurrent statements.
        await runBatched(
            extendedPlan.map((entry) => () => runDomain(entry.domain, term, ctx, sink)),
            EXTENDED_CONCURRENCY
        );
    }

    const { groups, truncated } = assemble(sink);

    return NextResponse.json({
        groups,
        hasMore: PLAN.some((entry) => entry.tier === "extended" && entry.enabled(ctx)),
        extended: extendedPlan.length > 0,
        truncated,
    } satisfies SearchResponse);
}

function emptyResponse(): SearchResponse {
    return { groups: [], hasMore: false, extended: false, truncated: false };
}

/** Runs one domain and folds whatever it produced into the sink. */
async function runDomain(
    domain: Domain,
    term: string,
    ctx: SearchContext,
    sink: Map<GroupKey, SearchHit[]>
) {
    try {
        const contributions = await domain(term, ctx);
        for (const { group, hits } of contributions) {
            if (hits.length === 0) continue;
            const existing = sink.get(group.key as GroupKey);
            if (existing) existing.push(...hits);
            else sink.set(group.key as GroupKey, hits);
        }
    } catch (error) {
        console.error(`search: ${domain.name} group failed`, error);
    }
}

async function runBatched(tasks: Array<() => Promise<void>>, size: number) {
    for (let i = 0; i < tasks.length; i += size) {
        await Promise.all(tasks.slice(i, i + size).map((task) => task()));
    }
}

/** Orders by relevance, then bounds both the group count and the row count. */
function assemble(sink: Map<GroupKey, SearchHit[]>): { groups: SearchGroup[]; truncated: boolean } {
    const entries = [...sink.entries()]
        .map(([key, hits]) => ({ key, spec: GROUP_BY_KEY[key], hits }))
        .sort((a, b) => a.spec.order - b.spec.order || a.spec.label.localeCompare(b.spec.label))
        .slice(0, MAX_GROUPS);

    const groups: SearchGroup[] = [];
    let total = 0;
    let truncated = false;

    for (const { key, spec, hits } of entries) {
        if (total >= MAX_TOTAL_HITS) {
            truncated = true;
            break;
        }
        const room = MAX_TOTAL_HITS - total;
        const taken = hits.slice(0, room);
        if (taken.length < hits.length) truncated = true;
        if (taken.length === 0) continue;
        total += taken.length;
        groups.push({ key, label: spec.label, hits: taken });
    }

    return { groups, truncated };
}

/* ================================================================== */
/* FAST PASS — every keystroke                                          */
/* ================================================================== */

const searchEmployees: Domain = async function searchEmployees(term, ctx) {
    const rows = await prisma.employee.findMany({
        where: scopeEmployeeWhere(ctx.subject, {
            OR: [
                { firstName: textMatch(term) },
                { lastName: textMatch(term) },
                { email: textMatch(term) },
                { rollNumber: textMatch(term) },
                { designation: textMatch(term) },
                { department: textMatch(term) },
                { employeeCode: textMatch(term) },
            ],
        }),
        select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            rollNumber: true,
            designation: true,
            department: true,
        },
        take: PER_GROUP_LIMIT,
        orderBy: { firstName: "asc" },
    });

    // A term spanning both name columns ("Ada Lovelace") must still rank
    // above a one-column partial match, so full-name hits lead the group.
    const fullName = new RegExp(escapeRegExp(term), "i");
    rows.sort((a, b) => {
        const aFull = fullName.test(`${a.firstName} ${a.lastName}`) ? 0 : 1;
        const bFull = fullName.test(`${b.firstName} ${b.lastName}`) ? 0 : 1;
        return aFull - bFull;
    });

    if (rows.length === 0) return [];
    return [
        {
            group: GROUPS.employees,
            hits: rows.map((row) => ({
                id: row.id,
                title: `${row.firstName} ${row.lastName}`,
                subtitle:
                    [row.designation, row.department, row.rollNumber].filter(Boolean).join(" · ") ||
                    row.email,
                // The directory is the surface, not the detail page: the existing
                // route linked here and `tests/search-authorization.test.ts`
                // pins this exact href. This is also the one domain whose `id`
                // is returned unprefixed — it is a real `Employee.id`, and the
                // client keys the row on it. Every other domain prefixes so two
                // rows from different tables can never collide as a React key.
                href: "/employees",
            })),
        },
    ];
};

const searchLeave: Domain = async function searchLeave(term, ctx) {
    const rows = await prisma.leaveRequest.findMany({
        where: {
            employee: scopeEmployeeWhere(ctx.subject),
            OR: [
                { type: textMatch(term) },
                { reason: textMatch(term) },
                { status: textMatch(term) },
                { employee: { firstName: textMatch(term) } },
                { employee: { lastName: textMatch(term) } },
            ],
        },
        select: {
            id: true,
            type: true,
            status: true,
            reason: true,
            startDate: true,
            employee: { select: { firstName: true, lastName: true } },
        },
        take: PER_GROUP_LIMIT,
        orderBy: { createdAt: "desc" },
    });

    if (rows.length === 0) return [];
    return [
        {
            group: GROUPS.leaves,
            hits: rows.map((row) => ({
                id: `leave-${row.id}`,
                title: `${row.employee.firstName} ${row.employee.lastName} — ${row.type}`,
                subtitle: `${humanStatus(row.status)} · ${truncate(row.reason, 48)}`,
                href: "/leaves",
            })),
        },
    ];
};

const searchRecruitment: Domain = async function searchRecruitment(term, ctx) {
    const hits: SearchHit[] = [];

    const candidates = await prisma.candidate.findMany({
        where: {
            OR: [
                { firstName: textMatch(term) },
                { lastName: textMatch(term) },
                { email: textMatch(term) },
                { candidateCode: textMatch(term) },
                { skills: textMatch(term) },
            ],
        },
        select: { id: true, firstName: true, lastName: true, email: true, candidateCode: true },
        take: PER_GROUP_LIMIT,
        orderBy: { firstName: "asc" },
    });

    for (const candidate of candidates) {
        hits.push({
            id: `cand-${candidate.id}`,
            title: `${candidate.firstName} ${candidate.lastName}`,
            subtitle: candidate.candidateCode
                ? `${candidate.candidateCode} · ${candidate.email}`
                : candidate.email,
            href: "/recruitment",
        });
    }

    if (ctx.can(PERMISSIONS.RECRUITMENT_OFFER)) {
        const offers = await prisma.offerLetter.findMany({
            where: {
                candidate: {
                    OR: [
                        { firstName: textMatch(term) },
                        { lastName: textMatch(term) },
                        { email: textMatch(term) },
                    ],
                },
                OR: [
                    { status: textMatch(term) },
                    { designation: textMatch(term) },
                    { department: textMatch(term) },
                    { contractType: textMatch(term) },
                ],
            },
            // `offeredSalary` / `allowances` are deliberately absent: a result
            // row never needs a number, and the search box is not a payslip.
            select: {
                id: true,
                status: true,
                designation: true,
                department: true,
                candidate: { select: { firstName: true, lastName: true } },
            },
            take: PER_GROUP_LIMIT,
            orderBy: { createdAt: "desc" },
        });

        for (const offer of offers) {
            hits.push({
                id: `offer-${offer.id}`,
                title: `Offer — ${offer.candidate.firstName} ${offer.candidate.lastName}`,
                subtitle: [offer.designation, offer.department, offer.status]
                    .filter(Boolean)
                    .map(humanStatus)
                    .join(" · "),
                href: `/recruitment/offers/${offer.id}`,
            });
        }
    }

    if (hits.length === 0) return [];
    return [{ group: GROUPS.recruitment, hits: hits.slice(0, PER_GROUP_LIMIT) }];
};

const searchServiceRequests: Domain = async function searchServiceRequests(term, ctx) {
    const rows = await prisma.serviceRequest.findMany({
        where: {
            employee: scopeEmployeeWhere(ctx.subject),
            OR: [
                { details: textMatch(term) },
                { status: textMatch(term) },
                { category: { name: textMatch(term) } },
                { employee: { firstName: textMatch(term) } },
            ],
        },
        select: {
            id: true,
            details: true,
            status: true,
            employee: { select: { firstName: true, lastName: true } },
            category: { select: { name: true } },
        },
        take: PER_GROUP_LIMIT,
        orderBy: { createdAt: "desc" },
    });

    if (rows.length === 0) return [];
    return [
        {
            group: GROUPS.requests,
            hits: rows.map((row) => ({
                id: `req-${row.id}`,
                title: `${row.employee.firstName} ${row.employee.lastName} — ${row.category.name}`,
                subtitle: `${humanStatus(row.status)} · ${truncate(row.details, 48)}`,
                href: "/requests",
            })),
        },
    ];
};

/* ================================================================== */
/* EXTENDED PASS — only on an explicit "Search all records" action      */
/* ================================================================== */

const searchAttendance: Domain = async function searchAttendance(term, ctx) {
    const rows = await prisma.attendance.findMany({
        where: {
            employee: scopeEmployeeWhere(ctx.subject),
            OR: [
                { status: textMatch(term) },
                { employee: nameMatch(term) },
            ],
        },
        select: {
            id: true,
            date: true,
            status: true,
            checkIn: true,
            checkOut: true,
            lateMinutes: true,
            employee: { select: { firstName: true, lastName: true, rollNumber: true } },
        },
        take: PER_GROUP_LIMIT,
        orderBy: { date: "desc" },
    });

    if (rows.length === 0) return [];
    return [
        {
            group: GROUPS.attendance,
            hits: rows.map((row) => ({
                id: `att-${row.id}`,
                title: `${row.employee.firstName} ${row.employee.lastName} — ${humanStatus(row.status)}`,
                subtitle: [
                    formatDate(row.date),
                    row.lateMinutes > 0 ? `${row.lateMinutes} min late` : null,
                    row.employee.rollNumber,
                ]
                    .filter(Boolean)
                    .join(" · "),
                href: "/attendance",
            })),
        },
    ];
};

const searchShifts: Domain = async function searchShifts(term) {
    // PERMISSION CHOICE: a Shift is company configuration, not an employee
    // record, and it has no owner to scope by. `/attendance/shifts` shows a
    // STAFF member only their own shift, so a self-scoped caller is given the
    // shift-management capability instead — the same one `/settings/shifts`
    // demands. Search is therefore narrower than the page for everyone.
    const rows = await prisma.shift.findMany({
        where: {
            OR: [
                { name: textMatch(term) },
                { startTime: textMatch(term) },
                { endTime: textMatch(term) },
                { weeklyOffs: textMatch(term) },
            ],
        },
        select: { id: true, name: true, startTime: true, endTime: true, weeklyOffs: true },
        take: PER_GROUP_LIMIT,
        orderBy: { name: "asc" },
    });

    if (rows.length === 0) return [];
    return [
        {
            group: GROUPS.attendance,
            hits: rows.map((row) => ({
                id: `shift-${row.id}`,
                title: `Shift — ${row.name}`,
                subtitle: `${row.startTime}–${row.endTime} · off ${humanStatus(row.weeklyOffs)}`,
                href: "/attendance/shifts",
            })),
        },
    ];
};

const searchOvertime: Domain = async function searchOvertime(term, ctx) {
    // `/payroll/overtime` demands PAYROLL_VIEW or PAYROLL_OVERTIME_MANAGE.
    // `hours`, `ratePerHour` and `totalPay` are compensation and are neither
    // selected nor matched: this finds the record, never the money.
    const rows = await prisma.overtime.findMany({
        where: {
            employee: scopeEmployeeWhere(ctx.subject),
            OR: [{ status: textMatch(term) }, { employee: nameMatch(term) }],
        },
        select: {
            id: true,
            date: true,
            status: true,
            employee: { select: { firstName: true, lastName: true } },
        },
        take: PER_GROUP_LIMIT,
        orderBy: { date: "desc" },
    });

    if (rows.length === 0) return [];
    return [
        {
            group: GROUPS.payroll,
            hits: rows.map((row) => ({
                id: `ot-${row.id}`,
                title: `Overtime — ${row.employee.firstName} ${row.employee.lastName}`,
                subtitle: `${formatDate(row.date)} · ${humanStatus(row.status)}`,
                href: "/payroll/overtime",
            })),
        },
    ];
};

const searchPayrollRuns: Domain = async function searchPayrollRuns(term) {
    // Aggregates, no employee identity, so no scope applies — but `totalNet`
    // and `totalDeductions` are company money and are never selected.
    const periods = periodPredicates(term);
    const rows = await prisma.payrollRun.findMany({
        where: {
            OR: [
                { status: textMatch(term) },
                { notes: textMatch(term) },
                ...periods,
            ],
        },
        select: { id: true, month: true, year: true, status: true, lockedAt: true, paidAt: true },
        take: PER_GROUP_LIMIT,
        orderBy: [{ year: "desc" }, { month: "desc" }],
    });

    if (rows.length === 0) return [];
    return [
        {
            group: GROUPS.payroll,
            hits: rows.map((row) => ({
                id: `run-${row.id}`,
                title: `Payroll run — ${MONTH_LABELS[row.month] ?? row.month} ${row.year}`,
                subtitle: [
                    humanStatus(row.status),
                    row.paidAt ? `paid ${formatDate(row.paidAt)}` : null,
                    row.lockedAt ? `locked ${formatDate(row.lockedAt)}` : null,
                ]
                    .filter(Boolean)
                    .join(" · "),
                href: "/payroll",
            })),
        },
    ];
};

const searchPayslips: Domain = async function searchPayslips(term, ctx) {
    // HIGHEST-RISK DOMAIN. `/payroll/payslips` is readable by ADMIN and HR;
    // this gate uses `payroll.payslip.view.all` (FINANCE, ADMIN), which is
    // strictly narrower, and `scopeEmployeeWhere` is applied on top so a
    // department-scoped caller could never widen it later by accident. Not one
    // amount is selected: the row carries the person, the period and the
    // status, and nothing that a MANAGER or STAFF search could ever surface.
    const rows = await prisma.salaryRecord.findMany({
        where: {
            employee: scopeEmployeeWhere(ctx.subject),
            // `year`/`month` are integers, so a period term is translated into
            // equality predicates rather than left unmatched.
            OR: [{ status: textMatch(term) }, { employee: nameMatch(term) }, ...periodPredicates(term)],
        },
        select: {
            id: true,
            year: true,
            month: true,
            status: true,
            employee: { select: { firstName: true, lastName: true, employeeCode: true } },
        },
        take: PER_GROUP_LIMIT,
        orderBy: [{ year: "desc" }, { month: "desc" }],
    });

    if (rows.length === 0) return [];
    return [
        {
            group: GROUPS.payroll,
            hits: rows.map((row) => ({
                id: `slip-${row.id}`,
                title: `Payslip — ${row.employee.firstName} ${row.employee.lastName}`,
                subtitle: `${MONTH_LABELS[row.month] ?? row.month} ${row.year} · ${humanStatus(row.status)}`,
                href: "/payroll/payslips",
            })),
        },
    ];
};

const searchSalaryStructures: Domain = async function searchSalaryStructures(term, ctx) {
    // `/payroll/structure` demands PAYROLL_STRUCTURE_MANAGE (FINANCE, ADMIN).
    // The only searchable columns here are the employee's own name and code:
    // `ctc`, every allowance, `bankName` and `iban` are deliberately absent from
    // both the `select` and the `where`, so there is no path by which this
    // domain can leak a package or an account.
    const rows = await prisma.salaryStructure.findMany({
        where: { employee: scopeEmployeeWhere(ctx.subject, nameMatch(term)) },
        select: {
            id: true,
            updatedAt: true,
            employee: { select: { firstName: true, lastName: true, designation: true } },
        },
        take: PER_GROUP_LIMIT,
        orderBy: { updatedAt: "desc" },
    });

    if (rows.length === 0) return [];
    return [
        {
            group: GROUPS.payroll,
            hits: rows.map((row) => ({
                id: `struct-${row.id}`,
                title: `Salary structure — ${row.employee.firstName} ${row.employee.lastName}`,
                subtitle: [row.employee.designation, `updated ${formatDate(row.updatedAt)}`]
                    .filter(Boolean)
                    .join(" · "),
                href: "/payroll/structure",
            })),
        },
    ];
};

const searchLoans: Domain = async function searchLoans(term, ctx) {
    // PERMISSION CHOICE: `/payroll/loans` demands LOAN_MANAGE or LOAN_APPROVE
    // (FINANCE, ADMIN) but `/payroll/loans/my-loans` is any signed-in employee
    // and shows only their own. `LOAN_VIEW` plus `scopeEmployeeWhere` covers
    // both cases with one gate: a self-scoped caller sees exactly what
    // my-loans shows and links there, a broad caller sees the full list and
    // links to the administration page. `requestedAmount` is not selected.
    const rows = await prisma.loanApplication.findMany({
        where: {
            employee: scopeEmployeeWhere(ctx.subject),
            OR: [
                { status: textMatch(term) },
                { reason: textMatch(term) },
                { loanType: { name: textMatch(term) } },
                { employee: nameMatch(term) },
            ],
        },
        select: {
            id: true,
            status: true,
            repaymentMonths: true,
            createdAt: true,
            employee: { select: { firstName: true, lastName: true } },
            loanType: { select: { name: true } },
        },
        take: PER_GROUP_LIMIT,
        orderBy: { createdAt: "desc" },
    });

    if (rows.length === 0) return [];
    return [
        {
            group: GROUPS.loans,
            hits: rows.map((row) => ({
                id: `loan-${row.id}`,
                title: `${row.loanType.name} — ${row.employee.firstName} ${row.employee.lastName}`,
                subtitle: `${humanStatus(row.status)} · ${row.repaymentMonths} months · raised ${formatDate(row.createdAt)}`,
                href: ctx.selfOnly ? "/payroll/loans/my-loans" : "/payroll/loans",
            })),
        },
    ];
};

const searchLoanTypes: Domain = async function searchLoanTypes(term) {
    // `/payroll/loans/types` demands LOAN_MANAGE, mirrored exactly.
    // `maxAmount` and `interestRate` are product pricing, not anyone's pay,
    // but they are amounts: the result row does not need them.
    const rows = await prisma.loanType.findMany({
        where: {
            OR: [{ name: textMatch(term) }, { description: textMatch(term) }],
        },
        select: { id: true, name: true, description: true, isActive: true, maxRepaymentMonths: true },
        take: PER_GROUP_LIMIT,
        orderBy: { name: "asc" },
    });

    if (rows.length === 0) return [];
    return [
        {
            group: GROUPS.loans,
            hits: rows.map((row) => ({
                id: `ltype-${row.id}`,
                title: `Loan type — ${row.name}`,
                subtitle: [
                    truncate(row.description, 48),
                    `up to ${row.maxRepaymentMonths} months`,
                    row.isActive ? null : "inactive",
                ]
                    .filter(Boolean)
                    .join(" · "),
                href: "/payroll/loans/types",
            })),
        },
    ];
};

const searchVisaRequests: Domain = async function searchVisaRequests(term, ctx) {
    // PERMISSION CHOICE: `visa.view` is held by STAFF, MANAGER, HR and ADMIN.
    // `/visa` is closed to STAFF and FINANCE (it redirects), so a self-scoped
    // caller's own request would land on a redirect rather than on data. Scope
    // still applies, so a MANAGER sees only their own department. The link is
    // `/visa` in every case: it is a real route, and for STAFF it resolves to
    // the staff self-service page the route itself redirects to.
    const rows = await prisma.visaRequest.findMany({
        where: {
            employee: scopeEmployeeWhere(ctx.subject),
            OR: [
                { visaType: textMatch(term) },
                { destinationCountry: textMatch(term) },
                { purpose: textMatch(term) },
                { status: textMatch(term) },
                { notes: textMatch(term) },
                { employee: nameMatch(term) },
            ],
        },
        select: {
            id: true,
            visaType: true,
            destinationCountry: true,
            purpose: true,
            status: true,
            createdAt: true,
            employee: { select: { firstName: true, lastName: true } },
        },
        take: PER_GROUP_LIMIT,
        orderBy: { createdAt: "desc" },
    });

    if (rows.length === 0) return [];
    return [
        {
            group: GROUPS.compliance,
            hits: rows.map((row) => ({
                id: `visa-${row.id}`,
                title: `Visa — ${row.employee.firstName} ${row.employee.lastName}`,
                subtitle: `${row.visaType} · ${row.destinationCountry} · ${humanStatus(row.status)}`,
                href: "/visa",
            })),
        },
    ];
};

const searchRequisitions: Domain = async function searchRequisitions(term) {
    // `/recruitment` is gated on RECRUITMENT_VIEW by `lib/recruitment/queries.ts`
    // (the page also allows MANAGER, so this gate is narrower). `budget`,
    // `minSalary` and `maxSalary` are not selected.
    const rows = await prisma.jobRequisition.findMany({
        where: {
            OR: [
                { title: textMatch(term) },
                { requisitionCode: textMatch(term) },
                { department: textMatch(term) },
                { location: textMatch(term) },
                { requiredSkills: textMatch(term) },
                { requiredExperience: textMatch(term) },
                { requiredEducation: textMatch(term) },
                { reason: textMatch(term) },
                { status: textMatch(term) },
                { priority: textMatch(term) },
            ],
        },
        select: {
            id: true,
            title: true,
            requisitionCode: true,
            department: true,
            location: true,
            status: true,
            priority: true,
        },
        take: PER_GROUP_LIMIT,
        orderBy: { createdAt: "desc" },
    });

    if (rows.length === 0) return [];
    return [
        {
            group: GROUPS.recruitment,
            hits: rows.map((row) => ({
                id: `requisition-${row.id}`,
                title: row.title,
                subtitle: [
                    row.requisitionCode,
                    row.department,
                    row.location,
                    humanStatus(row.status),
                ]
                    .filter(Boolean)
                    .join(" · "),
                href: "/recruitment",
            })),
        },
    ];
};

const searchInterviews: Domain = async function searchInterviews(term) {
    // `listInterviews` / `getInterviewDetail` in `lib/recruitment/queries.ts`
    // both require RECRUITMENT_VIEW. `meetingLink` is not selected: it is a
    // join credential for an external call.
    const rows = await prisma.interview.findMany({
        where: {
            OR: [
                { interviewType: textMatch(term) },
                { mode: textMatch(term) },
                { status: textMatch(term) },
                { location: textMatch(term) },
                { candidate: { firstName: textMatch(term) } },
                { candidate: { lastName: textMatch(term) } },
                { application: { jobRequisition: { title: textMatch(term) } } },
            ],
        },
        select: {
            id: true,
            interviewType: true,
            round: true,
            mode: true,
            status: true,
            scheduledAt: true,
            candidate: { select: { firstName: true, lastName: true } },
            application: { select: { jobRequisition: { select: { title: true } } } },
        },
        take: PER_GROUP_LIMIT,
        orderBy: { scheduledAt: "desc" },
    });

    if (rows.length === 0) return [];
    return [
        {
            group: GROUPS.recruitment,
            hits: rows.map((row) => ({
                id: `int-${row.id}`,
                title: `Interview — ${row.candidate.firstName} ${row.candidate.lastName}`,
                subtitle: [
                    `round ${row.round}`,
                    humanStatus(row.interviewType),
                    row.application?.jobRequisition.title,
                    formatDate(row.scheduledAt),
                ]
                    .filter(Boolean)
                    .join(" · "),
                href: `/recruitment/interviews/${row.id}`,
            })),
        },
    ];
};

const searchLetterRecords: Domain = async function searchLetterRecords(term, ctx) {
    // `getLetterHistory` in `lib/workflow/letters.ts` requires LETTER_VIEW,
    // which is a base grant, so this mirrors that gate and adds the scope the
    // endpoint does not have — a STAFF member reaches only their own letters
    // even though LETTER_VIEW alone would match every row. `details` is never
    // selected: a generated letter's body text routinely states a salary.
    const rows = await prisma.letterRecord.findMany({
        where: {
            employee: scopeEmployeeWhere(ctx.subject, {
                OR: [
                    { type: textMatch(term) },
                    { recipientName: textMatch(term) },
                    { status: textMatch(term) },
                    { documentKey: textMatch(term) },
                    { rejectedReason: textMatch(term) },
                ],
            }),
        },
        select: { id: true, type: true, recipientName: true, status: true, version: true, generatedAt: true },
        take: PER_GROUP_LIMIT,
        orderBy: { generatedAt: "desc" },
    });

    if (rows.length === 0) return [];
    return [
        {
            group: GROUPS.letters,
            hits: rows.map((row) => ({
                id: `letter-${row.id}`,
                title: `${humanStatus(row.type)} letter — ${row.recipientName}`,
                subtitle: `${humanStatus(row.status)} · v${row.version} · ${formatDate(row.generatedAt)}`,
                href: "/letters",
            })),
        },
    ];
};

const searchLetterTemplates: Domain = async function searchLetterTemplates(term) {
    // `/dashboard/settings/templates` demands LETTER_TEMPLATE_MANAGE, mirrored
    // exactly. `content_en` / `content_ar` are never selected or matched.
    const rows = await prisma.letterTemplate.findMany({
        where: { OR: [{ name: textMatch(term) }, { type: textMatch(term) }] },
        select: { id: true, name: true, type: true, isActive: true },
        take: PER_GROUP_LIMIT,
        orderBy: { name: "asc" },
    });

    if (rows.length === 0) return [];
    return [
        {
            group: GROUPS.letters,
            hits: rows.map((row) => ({
                id: `ltpl-${row.id}`,
                title: `Template — ${row.name}`,
                subtitle: [humanStatus(row.type), row.isActive ? null : "inactive"]
                    .filter(Boolean)
                    .join(" · "),
                href: "/dashboard/settings/templates",
            })),
        },
    ];
};

const searchNotifications: Domain = async function searchNotifications(term, ctx) {
    // FORCED SELF SCOPE. `/notifications` filters on the caller's own
    // employeeId for every role without exception, so an ADMIN's search must
    // not return somebody else's notification. The predicate is inside the
    // `where`, so another person's notification is absent rather than hidden.
    const rows = await prisma.notification.findMany({
        where: {
            employeeId: ctx.subject.employeeId ?? "__none__",
            OR: [
                { title: textMatch(term) },
                { message: textMatch(term) },
                { type: textMatch(term) },
            ],
        },
        select: { id: true, title: true, message: true, type: true, isRead: true, createdAt: true },
        take: PER_GROUP_LIMIT,
        orderBy: { createdAt: "desc" },
    });

    if (rows.length === 0) return [];
    return [
        {
            group: GROUPS.notifications,
            hits: rows.map((row) => ({
                id: `notif-${row.id}`,
                title: row.title,
                subtitle: `${humanStatus(row.type)} · ${row.isRead ? "read" : "unread"} · ${truncate(row.message, 40)}`,
                href: "/notifications",
            })),
        },
    ];
};

const searchOnboardingChecklist: Domain = async function searchOnboardingChecklist(term, ctx) {
    // The checklist is rendered by `OnboardingPanel` on `/employees`, which
    // itself requires EMPLOYEES_VIEW, so that is the gate and the scope. There
    // is no dedicated URL for a single checklist item; `/employees` is where the
    // panel is opened from, so that is the real destination.
    const rows = await prisma.onboardingChecklistItem.findMany({
        where: {
            employee: scopeEmployeeWhere(ctx.subject),
            OR: [
                { label: textMatch(term) },
                { category: textMatch(term) },
                { status: textMatch(term) },
                { notes: textMatch(term) },
                { employee: nameMatch(term) },
            ],
        },
        select: {
            id: true,
            label: true,
            category: true,
            status: true,
            dueAt: true,
            employee: { select: { firstName: true, lastName: true } },
        },
        take: PER_GROUP_LIMIT,
        orderBy: { createdAt: "desc" },
    });

    if (rows.length === 0) return [];
    return [
        {
            group: GROUPS.onboarding,
            hits: rows.map((row) => ({
                id: `onb-${row.id}`,
                title: `${row.label} — ${row.employee.firstName} ${row.employee.lastName}`,
                subtitle: [
                    humanStatus(row.category),
                    humanStatus(row.status),
                    row.dueAt ? `due ${formatDate(row.dueAt)}` : null,
                ]
                    .filter(Boolean)
                    .join(" · "),
                href: "/employees",
            })),
        },
    ];
};

const searchAttendanceDevices: Domain = async function searchAttendanceDevices(term) {
    // `/attendance/machine-integration` demands ATTENDANCE_IMPORT, mirrored
    // exactly. `deviceIdentifier`, `apiKeyHash` and `keyPrefix` are credentials
    // or credential fragments and are never selected or matched.
    const rows = await prisma.attendanceDevice.findMany({
        where: { OR: [{ name: textMatch(term) }, { location: textMatch(term) }, { status: textMatch(term) }] },
        select: { id: true, name: true, location: true, status: true, lastSyncAt: true, lastSyncRecords: true },
        take: PER_GROUP_LIMIT,
        orderBy: { name: "asc" },
    });

    if (rows.length === 0) return [];
    return [
        {
            group: GROUPS.configuration,
            hits: rows.map((row) => ({
                id: `device-${row.id}`,
                title: `Device — ${row.name}`,
                subtitle: [
                    row.location,
                    humanStatus(row.status),
                    row.lastSyncAt
                        ? `last sync ${formatDate(row.lastSyncAt)} (${row.lastSyncRecords})`
                        : "never synced",
                ]
                    .filter(Boolean)
                    .join(" · "),
                href: "/attendance/machine-integration",
            })),
        },
    ];
};

/* ================================================================== */
/* Plan                                                                */
/* ================================================================== */

/**
 * The plan is data, not control flow: `enabled` is a pure predicate over the
 * already-resolved permission set, so "which domains will run" is decided
 * before any query is issued and can be asserted in a test without a database.
 *
 * `tier` decides WHEN a domain runs, never WHETHER: an enabled extended domain
 * is skipped only because the user has not asked for the extended pass yet.
 */
const PLAN: DomainPlan[] = [
    // ---- fast: every keystroke ----
    {
        domain: searchEmployees,
        tier: "fast",
        enabled: (ctx) => ctx.can(PERMISSIONS.EMPLOYEES_VIEW),
    },
    {
        domain: searchLeave,
        tier: "fast",
        enabled: (ctx) => ctx.can(PERMISSIONS.LEAVE_VIEW),
    },
    {
        domain: searchRecruitment,
        tier: "fast",
        enabled: (ctx) => ctx.can(PERMISSIONS.RECRUITMENT_VIEW),
    },
    {
        domain: searchServiceRequests,
        tier: "fast",
        enabled: (ctx) => ctx.can(PERMISSIONS.REQUEST_VIEW),
    },

    // ---- extended: explicit "Search all records" ----
    {
        domain: searchAttendance,
        tier: "extended",
        enabled: (ctx) => ctx.can(PERMISSIONS.ATTENDANCE_VIEW),
    },
    {
        domain: searchShifts,
        tier: "extended",
        enabled: (ctx) => ctx.canAny([PERMISSIONS.ATTENDANCE_MANAGE, PERMISSIONS.ATTENDANCE_SHIFT_MANAGE]),
    },
    {
        domain: searchOvertime,
        tier: "extended",
        enabled: (ctx) => ctx.canAny([PERMISSIONS.PAYROLL_VIEW, PERMISSIONS.PAYROLL_OVERTIME_MANAGE]),
    },
    {
        domain: searchPayrollRuns,
        tier: "extended",
        enabled: (ctx) => ctx.can(PERMISSIONS.PAYROLL_VIEW),
    },
    {
        domain: searchPayslips,
        tier: "extended",
        // The compensation gate. `payroll.payslip.view.all` is FINANCE + ADMIN
        // only, so a MANAGER or STAFF search cannot reach a SalaryRecord at all
        // — not even their own, because `scopeEmployeeWhere` alone would have
        // allowed that, and "my own payslip" is still a payslip the header
        // search has no business surfacing.
        enabled: (ctx) => ctx.can(PERMISSIONS.PAYROLL_PAYSLIP_VIEW_ALL),
    },
    {
        domain: searchSalaryStructures,
        tier: "extended",
        enabled: (ctx) => ctx.can(PERMISSIONS.PAYROLL_STRUCTURE_MANAGE),
    },
    {
        domain: searchLoans,
        tier: "extended",
        enabled: (ctx) => ctx.can(PERMISSIONS.LOAN_VIEW),
    },
    {
        domain: searchLoanTypes,
        tier: "extended",
        enabled: (ctx) => ctx.can(PERMISSIONS.LOAN_MANAGE),
    },
    {
        domain: searchVisaRequests,
        tier: "extended",
        enabled: (ctx) => ctx.can(PERMISSIONS.VISA_VIEW),
    },
    {
        domain: searchRequisitions,
        tier: "extended",
        enabled: (ctx) => ctx.can(PERMISSIONS.RECRUITMENT_VIEW),
    },
    {
        domain: searchInterviews,
        tier: "extended",
        enabled: (ctx) => ctx.can(PERMISSIONS.RECRUITMENT_VIEW),
    },
    {
        domain: searchLetterRecords,
        tier: "extended",
        enabled: (ctx) => ctx.can(PERMISSIONS.LETTER_VIEW),
    },
    {
        domain: searchLetterTemplates,
        tier: "extended",
        enabled: (ctx) => ctx.can(PERMISSIONS.LETTER_TEMPLATE_MANAGE),
    },
    {
        domain: searchNotifications,
        tier: "extended",
        enabled: (ctx) => ctx.can(PERMISSIONS.NOTIFICATION_VIEW),
    },
    {
        domain: searchOnboardingChecklist,
        tier: "extended",
        enabled: (ctx) => ctx.can(PERMISSIONS.EMPLOYEES_VIEW),
    },
    {
        domain: searchAttendanceDevices,
        tier: "extended",
        enabled: (ctx) => ctx.can(PERMISSIONS.ATTENDANCE_IMPORT),
    },
];
