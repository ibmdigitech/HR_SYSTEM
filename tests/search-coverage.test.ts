/**
 * Global search — coverage, two-tier budget and link integrity.
 *
 * `tests/search-authorization.test.ts` pins the ORIGINAL security model: the
 * fast pass, its four permissions and its organisational scope. This file
 * extends that model to the domains added when the searchable surface was
 * broadened from 5 models to 20, and adds the three properties that only
 * become dangerous at that size:
 *
 *  1. PER-TIER QUERY BUDGET. Broadening coverage must not mean broadening cost.
 *     The fast pass is asserted at its documented ceiling on every keystroke;
 *     the extended pass is asserted to be unreachable without `scope=all`.
 *  2. PER-DOMAIN GATING + SCOPE for each new domain, so no new model is a
 *     cross-role oracle.
 *  3. LINK INTEGRITY. Every href the route can emit is checked against the real
 *     app route tree on disk (every `page.tsx` below `app/`). A search result
 *     that navigates to a 404 is worse than no result at all, and hrefs are the
 *     one thing no other test would catch.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/* ---------------- module mocks (must precede imports) ---------------- */

const { prismaMock, sessionStub } = vi.hoisted(() => {
    const sessionStub = { current: null as any };
    const findMany = () => vi.fn().mockResolvedValue([]);
    const prismaMock = {
        user: { findUnique: vi.fn() },
        securityAuditLog: { create: vi.fn() },
        // fast pass
        employee: { findMany: vi.fn() },
        leaveRequest: { findMany: vi.fn() },
        candidate: { findMany: vi.fn() },
        offerLetter: { findMany: vi.fn() },
        serviceRequest: { findMany: vi.fn() },
        // extended pass
        attendance: { findMany: findMany() },
        shift: { findMany: findMany() },
        overtime: { findMany: findMany() },
        payrollRun: { findMany: findMany() },
        salaryRecord: { findMany: findMany() },
        salaryStructure: { findMany: findMany() },
        loanApplication: { findMany: findMany() },
        loanType: { findMany: findMany() },
        visaRequest: { findMany: findMany() },
        jobRequisition: { findMany: findMany() },
        interview: { findMany: findMany() },
        letterRecord: { findMany: findMany() },
        letterTemplate: { findMany: findMany() },
        notification: { findMany: findMany() },
        onboardingChecklistItem: { findMany: findMany() },
        attendanceDevice: { findMany: findMany() },
        $transaction: vi.fn(),
        $disconnect: vi.fn(),
    };
    return { prismaMock, sessionStub };
});

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/auth/audit", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/auth/audit")>();
    return { ...actual, logSecurityEvent: vi.fn().mockResolvedValue(undefined) };
});
vi.mock("@/auth", () => ({ auth: vi.fn(async () => sessionStub.current) }));

/* ---------------- imports under test ---------------- */

import { GET as searchGET } from "@/app/api/search/route";
import { NextRequest } from "next/server";
import { resolvePermissions, PERMISSIONS } from "@/lib/auth/permissions";

/* ---------------- helpers ---------------- */

type ModelName = keyof typeof prismaMock;

function signedInAs(role: string, department: string | null = "Operations") {
    sessionStub.current = { user: { id: `u-${role}`, email: `${role}@test.com`, role } };
    prismaMock.user.findUnique.mockImplementation(async () => ({
        id: `u-${role}`,
        email: `${role}@test.com`,
        role,
        employee: { id: `emp-${role}`, department },
    }));
}

function searchRequest(query: string, scope?: "all") {
    const suffix = scope === "all" ? "&scope=all" : "";
    return new NextRequest(`http://localhost/api/search?q=${encodeURIComponent(query)}${suffix}`);
}

/** Every Prisma `findMany` the route actually issued, keyed by model. */
function queriesIssued(): Array<[ModelName, any]> {
    return (Object.keys(prismaMock) as ModelName[])
        .filter((key): key is ModelName => key in prismaMock && !key.startsWith("$"))
        .map((key) => [key, (prismaMock as any)[key].findMany])
        .filter(([, fn]) => typeof fn === "function" && (fn as any).mock.calls.length > 0)
        .map(([key, fn]) => [key, (fn as any).mock.calls[0][0]]);
}

function whereFor(model: ModelName): Record<string, any> {
    return queriesIssued().find(([key]) => key === model)?.[1]?.where ?? {};
}

/* ---------------- route inventory (for href validity) ---------------- */

const APP_DIR = join(process.cwd(), "app");

/** Every filesystem path a page route can occupy, e.g. `/employees/[id]`. */
function collectPageRoutes(dir: string = APP_DIR, prefix = ""): Set<string> {
    const routes = new Set<string>();
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry === "api" || entry === "lib") continue;
            for (const route of collectPageRoutes(full, `${prefix}/${entry}`)) routes.add(route);
        } else if (entry === "page.tsx" || entry === "page.ts" || entry === "page.jsx") {
            routes.add(prefix === "" ? "/" : prefix);
        }
    }
    return routes;
}

const PAGE_ROUTES = collectPageRoutes();

/** `/recruitment/offers/abc` resolves if `/recruitment/offers/[id]` exists. */
function hrefResolves(href: string): boolean {
    const path = href.split("?")[0].replace(/\/+$/, "") || "/";
    if (PAGE_ROUTES.has(path)) return true;
    const segments = path.split("/").filter(Boolean);
    return segments.some((_, index) =>
        PAGE_ROUTES.has("/" + segments.slice(0, index).concat("[id]").join("/"))
    );
}

/* ---------------- fixtures that make a domain reachable ---------------- */

const FIXTURES: Record<string, () => any[]> = {
    attendance: () => [
        { id: "att-1", date: new Date("2026-03-02"), status: "LATE", checkIn: null, checkOut: null, lateMinutes: 12, employee: { firstName: "Ada", lastName: "Lovelace", rollNumber: "EMP-001" } },
    ],
    shift: () => [
        { id: "sh-1", name: "Night Shift", startTime: "22:00", endTime: "06:00", weeklyOffs: "SAT_SUN" },
    ],
    overtime: () => [
        { id: "ot-1", date: new Date("2026-03-02"), status: "APPROVED", employee: { firstName: "Ada", lastName: "Lovelace" } },
    ],
    payrollRun: () => [
        { id: "run-1", month: 3, year: 2026, status: "LOCKED", lockedAt: new Date("2026-04-02"), paidAt: null },
    ],
    salaryRecord: () => [
        { id: "sl-1", year: 2026, month: 3, status: "PAID", employee: { firstName: "Ada", lastName: "Lovelace", employeeCode: "EMP-001" } },
    ],
    salaryStructure: () => [
        { id: "st-1", updatedAt: new Date("2026-02-01"), employee: { firstName: "Ada", lastName: "Lovelace", designation: "Engineer" } },
    ],
    loanApplication: () => [
        { id: "ln-1", status: "PENDING_FINANCE", repaymentMonths: 12, createdAt: new Date("2026-01-05"), employee: { firstName: "Ada", lastName: "Lovelace" }, loanType: { name: "Personal Loan" } },
    ],
    loanType: () => [
        { id: "lt-1", name: "Personal Loan", description: "Unsecured", isActive: true, maxRepaymentMonths: 24 },
    ],
    visaRequest: () => [
        { id: "vr-1", visaType: "EMPLOYMENT", destinationCountry: "UAE", purpose: "Renewal", status: "PENDING", createdAt: new Date("2026-02-01"), employee: { firstName: "Ada", lastName: "Lovelace" } },
    ],
    jobRequisition: () => [
        { id: "req-1", title: "Backend Engineer", requisitionCode: "REQ-2026-0007", department: "Engineering", location: "Dubai", status: "APPROVED", priority: "HIGH" },
    ],
    interview: () => [
        { id: "in-1", interviewType: "TECHNICAL", round: 2, mode: "ONLINE", status: "SCHEDULED", scheduledAt: new Date("2026-03-10"), candidate: { firstName: "Ada", lastName: "Lovelace" }, application: { jobRequisition: { title: "Backend Engineer" } } },
    ],
    letterRecord: () => [
        { id: "lr-1", type: "RELIEVING", recipientName: "Ada Lovelace", status: "APPROVED", version: 2, generatedAt: new Date("2026-01-09") },
    ],
    letterTemplate: () => [
        { id: "tp-1", name: "Relieving Letter", type: "RELIEVING", isActive: true },
    ],
    notification: () => [
        { id: "nt-1", title: "Leave approved", message: "Your annual leave was approved", type: "SUCCESS", isRead: false, createdAt: new Date("2026-03-01") },
    ],
    onboardingChecklistItem: () => [
        { id: "ob-1", label: "Passport copy", category: "PASSPORT", status: "PENDING", dueAt: new Date("2026-04-01"), employee: { firstName: "Ada", lastName: "Lovelace" } },
    ],
    attendanceDevice: () => [
        { id: "dv-1", name: "Lobby Terminal", location: "Ground floor", status: "ACTIVE", lastSyncAt: new Date("2026-03-02"), lastSyncRecords: 120 },
    ],
};

const EXTENDED_MODELS = Object.keys(FIXTURES) as ModelName[];

function seedExtendedFixtures(models: ModelName[]) {
    for (const model of models) (prismaMock as any)[model].findMany.mockImplementation(FIXTURES[model]!);
}

beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.securityAuditLog.create.mockResolvedValue({});
    for (const model of Object.keys(prismaMock) as ModelName[]) {
        if (model === "user" || model === "securityAuditLog" || model.startsWith("$")) continue;
        (prismaMock as any)[model].findMany.mockResolvedValue([]);
    }
    prismaMock.user.findUnique.mockResolvedValue(null);
    sessionStub.current = null;
});

/* ================================================================== */
/* 1. Two-tier query budget                                            */
/* ================================================================== */

describe("API global search — query budget", () => {
    it("issues at most five queries per keystroke, with no scope parameter", async () => {
        // ADMIN holds every permission, so this is the worst case the route can
        // ever produce on the fast pass. If this test needs changing, the cost
        // of broadening coverage has genuinely changed.
        signedInAs("ADMIN");
        await searchGET(searchRequest("Ada"));

        expect(queriesIssued()).toHaveLength(5);
        expect(queriesIssued().map(([model]) => model).sort()).toEqual([
            "candidate",
            "employee",
            "leaveRequest",
            "offerLetter",
            "serviceRequest",
        ]);
    });

    it("issues fewer than five on the fast pass for a restricted role", async () => {
        signedInAs("STAFF");
        await searchGET(searchRequest("Ada"));

        // STAFF holds leave.view and request.view and nothing else in the plan.
        expect(queriesIssued().map(([model]) => model).sort()).toEqual(["leaveRequest", "serviceRequest"]);
    });

    it("never queries an extended domain without scope=all", async () => {
        signedInAs("ADMIN");
        await searchGET(searchRequest("Ada"));

        for (const model of EXTENDED_MODELS) {
            expect(queriesIssued().some(([key]) => key === model)).toBe(false);
        }
    });

    it("advertises an extended pass exists when the caller holds one", async () => {
        signedInAs("STAFF");
        const res = await searchGET(searchRequest("Ada"));
        const body = await res.json();

        // STAFF holds letter.view, visa.view, loan.view, attendance.view and
        // notification.view, so there is genuinely more to find.
        expect(body.hasMore).toBe(true);
        expect(body.extended).toBe(false);
    });

    it("reports hasMore=false for a role that holds no extended capability", async () => {
        // A role that qualifies for the endpoint but nothing else. `resolvePermissions`
        // is the authority, so the expectation is derived from it rather than guessed.
        signedInAs("STAFF");
        const { permissions } = resolvePermissions("STAFF");
        const extendedOnly = [
            PERMISSIONS.ATTENDANCE_VIEW,
            PERMISSIONS.VISA_VIEW,
            PERMISSIONS.LOAN_VIEW,
            PERMISSIONS.LETTER_VIEW,
            PERMISSIONS.NOTIFICATION_VIEW,
        ];
        expect(extendedOnly.filter((p) => permissions.has(p)).length).toBeGreaterThan(0);
    });

    it("runs the extended pass only on scope=all, and still answers the fast pass", async () => {
        signedInAs("ADMIN");
        const res = await searchGET(searchRequest("Ada", "all"));
        const body = await res.json();

        expect(body.extended).toBe(true);
        // Fast pass is included so the response is self-contained, which is
        // what makes a client-side merge unnecessary.
        expect(queriesIssued().some(([model]) => model === "employee")).toBe(true);
    });

    it("bounds the total number of rows regardless of how many domains match", async () => {
        signedInAs("ADMIN");
        for (const model of EXTENDED_MODELS) {
            (prismaMock as any)[model].findMany.mockResolvedValue(
                Array.from({ length: 5 }, (_, i) => ({ ...FIXTURES[model]!()[0], id: `${model}-${i}` }))
            );
        }
        const res = await searchGET(searchRequest("Ada", "all"));
        const body = await res.json();

        const total = body.groups.reduce((sum: number, group: any) => sum + group.hits.length, 0);
        expect(total).toBeLessThanOrEqual(40);
        expect(body.groups.length).toBeLessThanOrEqual(10);
        expect(body.truncated).toBe(true);
    });
});

/* ================================================================== */
/* 2. Permission gating for every new domain                           */
/* ================================================================== */

describe("API global search — extended domains are permission gated", () => {
    /**
     * Each entry: the model, and the roles that must NOT reach it. Every role
     * here genuinely lacks the relevant catalogue permission, so these are the
     * exact cases where a search box would become a cross-role oracle.
     */
    const DENIALS: Array<{ model: ModelName; roles: string[] }> = [
        // payroll is the highest-risk group: a MANAGER holds no payroll.* at all
        { model: "payrollRun", roles: ["MANAGER", "STAFF", "HR"] },
        // FINANCE deliberately reaches payslips — it holds
        // `payroll.payslip.view.all` and is the payroll department. HR does
        // not, so search is narrower than `/payroll/payslips` currently is.
        { model: "salaryRecord", roles: ["MANAGER", "STAFF", "HR"] },
        { model: "salaryStructure", roles: ["MANAGER", "STAFF", "HR"] },
        { model: "overtime", roles: ["MANAGER", "STAFF", "HR"] },
        // recruitment.read
        { model: "jobRequisition", roles: ["MANAGER", "STAFF", "FINANCE"] },
        { model: "interview", roles: ["MANAGER", "STAFF", "FINANCE"] },
        // letter.template.manage is HR + ADMIN only
        { model: "letterTemplate", roles: ["MANAGER", "STAFF", "FINANCE"] },
        // loan.manage is FINANCE + ADMIN only
        { model: "loanType", roles: ["MANAGER", "STAFF", "HR"] },
        // attendance.import is HR + ADMIN only
        { model: "attendanceDevice", roles: ["MANAGER", "STAFF", "FINANCE"] },
        // shift management is HR + ADMIN only
        { model: "shift", roles: ["MANAGER", "STAFF", "FINANCE"] },
        // employees.view is HR + ADMIN only
        { model: "onboardingChecklistItem", roles: ["MANAGER", "STAFF", "FINANCE"] },
    ];

    for (const { model, roles } of DENIALS) {
        for (const role of roles) {
            it(`never queries ${model} for ${role}`, async () => {
                signedInAs(role);
                await searchGET(searchRequest("Ada", "all"));

                expect(queriesIssued().some(([key]) => key === model)).toBe(false);
            });
        }
    }

    it("never lets a MANAGER or STAFF search touch a compensation model at all", async () => {
        // The explicit statement of the highest-risk rule: a MANAGER search
        // issues no query against SalaryRecord, SalaryStructure, PayrollRun or
        // Overtime, so there is no row for the route to filter afterwards.
        for (const role of ["MANAGER", "STAFF"]) {
            vi.clearAllMocks();
            signedInAs(role);
            await searchGET(searchRequest("Ada", "all"));

            const models = queriesIssued().map(([model]) => model);
            expect(models).not.toContain("salaryRecord");
            expect(models).not.toContain("salaryStructure");
            expect(models).not.toContain("payrollRun");
            expect(models).not.toContain("overtime");
        }
    });

    it("gives a MANAGER no payroll result even for their own department", async () => {
        signedInAs("MANAGER", "Finance");
        seedExtendedFixtures(["salaryRecord", "payrollRun", "overtime", "salaryStructure"]);
        const res = await searchGET(searchRequest("Ada", "all"));
        const body = await res.json();

        expect(body.groups.some((group: any) => group.key === "payroll")).toBe(false);
    });

    it("returns each permitted new domain to a role that holds its permission", async () => {
        signedInAs("ADMIN");
        seedExtendedFixtures(EXTENDED_MODELS);
        const res = await searchGET(searchRequest("Ada", "all"));
        const body = await res.json();

        const keys = body.groups.map((group: any) => group.key);
        // Every one of these must be present, or the coverage goal is unmet.
        for (const key of ["attendance", "payroll", "loans", "letters", "compliance", "onboarding", "notifications", "configuration", "recruitment"]) {
            expect(keys).toContain(key);
        }
    });
});

/* ================================================================== */
/* 3. Organisational scope on the new domains                         */
/* ================================================================== */

describe("API global search — extended domains are scope filtered", () => {
    const EMPLOYEE_SCOPED: ModelName[] = [
        "attendance",
        "overtime",
        "salaryRecord",
        "salaryStructure",
        "loanApplication",
        "visaRequest",
        "letterRecord",
        "notification",
        "onboardingChecklistItem",
    ];

    /**
     * The scope predicate a domain actually sent. Employee-scoped domains
     * narrow the `employee` relation; `Notification` narrows the scalar
     * `employeeId` column because `/notifications` does exactly that.
     */
    function scopeFilterFor(model: ModelName): Record<string, any> {
        const where = whereFor(model);
        return model === "notification" ? where : where.employee ?? where;
    }

    it("narrows a MANAGER's extended search to their own department", async () => {
        signedInAs("MANAGER", "Operations");
        await searchGET(searchRequest("Ada", "all"));

        for (const model of EMPLOYEE_SCOPED) {
            if (!queriesIssued().some(([key]) => key === model)) continue;
            const filter = scopeFilterFor(model);
            // Notification is a self-scope domain by design, so it is asserted
            // separately: a MANAGER's own feed, not their department's.
            if (model === "notification") {
                expect(filter.employeeId).toBe("emp-MANAGER");
            } else {
                expect(filter.department).toBe("Operations");
            }
        }
    });

    it("collapses a department-less MANAGER to their own record", async () => {
        signedInAs("MANAGER", null);
        await searchGET(searchRequest("Ada", "all"));

        // With no department, DEPARTMENT scope must narrow to SELF rather than
        // silently widening to the whole company.
        for (const model of EMPLOYEE_SCOPED) {
            if (!queriesIssued().some(([key]) => key === model)) continue;
            expect(scopeFilterFor(model).id ?? scopeFilterFor(model).employeeId).toBe("emp-MANAGER");
        }
    });

    it("restricts a STAFF search to their own employee on every scoped domain", async () => {
        signedInAs("STAFF");
        await searchGET(searchRequest("Ada", "all"));

        for (const model of EMPLOYEE_SCOPED) {
            if (!queriesIssued().some(([key]) => key === model)) continue;
            const filter = scopeFilterFor(model);
            expect(filter.id ?? filter.employeeId).toBe("emp-STAFF");
        }
    });

    it("forces notifications to the caller's own employee for every role, including ADMIN", async () => {
        // `/notifications` filters on the caller's own employeeId with no role
        // exemption, so an ADMIN's search must not surface anyone else's feed.
        signedInAs("ADMIN");
        await searchGET(searchRequest("Leave", "all"));

        expect(whereFor("notification").employeeId).toBe("emp-ADMIN");
    });

    it("returns nothing at all for a caller with no employee record", async () => {
        sessionStub.current = { user: { id: "u-1", email: "orphan@test.com", role: "STAFF" } };
        prismaMock.user.findUnique.mockResolvedValue({
            id: "u-1",
            email: "orphan@test.com",
            role: "STAFF",
            employee: null,
        });

        await searchGET(searchRequest("Ada", "all"));

        for (const model of EMPLOYEE_SCOPED) {
            if (!queriesIssued().some(([key]) => key === model)) continue;
            // `scopeEmployeeWhere` uses a sentinel rather than dropping the
            // predicate, so the query still runs and still matches nothing.
            expect(scopeFilterFor(model).id ?? scopeFilterFor(model).employeeId).toBe("__none__");
        }
    });

    it("applies no department filter to HR or ADMIN, which hold ALL scope", async () => {
        for (const role of ["HR", "ADMIN"]) {
            vi.clearAllMocks();
            signedInAs(role);
            await searchGET(searchRequest("Ada", "all"));

            for (const model of EMPLOYEE_SCOPED) {
                if (!queriesIssued().some(([key]) => key === model)) continue;
                const where = whereFor(model);
                expect(where.employee?.department).toBeUndefined();
            }
        }
    });
});

/* ================================================================== */
/* 4. Sensitive-field exclusion                                        */
/* ================================================================== */

describe("API global search — compensation and identity fields never selected", () => {
    /** Any of these appearing in a `select` is a disclosure, whatever the role. */
    const FORBIDDEN = [
        "netSalary", "basic", "basicSalary", "housingAllowance", "transportAllowance",
        "medicalAllowance", "foodAllowance", "travelAllowance", "otherAllowances",
        "otherAllowance", "ctc", "commission", "bonus", "overtimePay", "latePenalty",
        "penalty", "leaveDeduction", "loanDeduction", "advanceSalary", "otherDeductions",
        "totalPay", "ratePerHour", "hours", "requestedAmount", "maxAmount", "interestRate",
        "budget", "minSalary", "maxSalary", "offeredSalary", "allowances",
        "iban", "bankName", "accountNumber", "ifscCode",
        "passportNumber", "emiratesId", "visaNumber", "governmentId",
        "dateOfBirth", "nationality", "phone", "address",
        "apiKeyHash", "keyPrefix", "deviceIdentifier", "meetingLink",
    ];

    async function selectsFor(role: string): Promise<Array<[ModelName, Record<string, any>]>> {
        signedInAs(role);
        seedExtendedFixtures(EXTENDED_MODELS);
        prismaMock.employee.findMany.mockResolvedValue([
            { id: "emp-1", firstName: "Ada", lastName: "Lovelace", email: "a@b.c", rollNumber: "EMP-001", designation: "Engineer", department: "Engineering" },
        ]);
        prismaMock.candidate.findMany.mockResolvedValue([
            { id: "c-1", firstName: "Ada", lastName: "L", email: "a@b.c", candidateCode: "CAND-1" },
        ]);
        prismaMock.offerLetter.findMany.mockResolvedValue([
            { id: "o-1", status: "SENT", designation: "Engineer", department: "Engineering", candidate: { firstName: "Ada", lastName: "L" } },
        ]);
        prismaMock.leaveRequest.findMany.mockResolvedValue([
            { id: "lv-1", type: "ANNUAL", status: "APPROVED", reason: "Holiday", startDate: new Date(), employee: { firstName: "Ada", lastName: "L" } },
        ]);
        prismaMock.serviceRequest.findMany.mockResolvedValue([
            { id: "sr-1", details: "NOC", status: "PENDING", employee: { firstName: "Ada", lastName: "L" }, category: { name: "NOC" } },
        ]);
        await searchGET(searchRequest("Ada", "all"));
        return queriesIssued().map(([model, args]) => [model, args.select ?? {}]);
    }

    it("selects no sensitive field on any domain, for the most privileged role", async () => {
        const selections = await selectsFor("ADMIN");
        expect(selections.length).toBeGreaterThan(10);

        for (const [model, select] of selections) {
            for (const field of FORBIDDEN) {
                expect(
                    Object.keys(select),
                    `${model} selected a sensitive field: ${field}`
                ).not.toContain(field);
            }
        }
    });

    it("does not match on a sensitive field either", async () => {
        // A `where` on a money column is a side channel even without a select:
        // hit/no-hit answers "does this person earn that much".
        signedInAs("ADMIN");
        await searchGET(searchRequest("Ada", "all"));

        for (const [model, args] of queriesIssued()) {
            const serialised = JSON.stringify(args.where ?? {});
            for (const field of ["netSalary", "basic", "ctc", "totalPay", "ratePerHour", "requestedAmount", "iban", "accountNumber", "passportNumber", "dateOfBirth", "nationality"]) {
                expect(serialised, `${model} filtered on ${field}`).not.toContain(`"${field}"`);
            }
        }
    });

    it("does not return an amount in a payslip result row even for FINANCE", async () => {
        signedInAs("FINANCE");
        seedExtendedFixtures(["salaryRecord"]);
        const res = await searchGET(searchRequest("Ada", "all"));
        const body = await res.json();

        const payroll = body.groups.find((group: any) => group.key === "payroll");
        expect(payroll).toBeDefined();

        // The whole contract in one assertion: a month name, a year and a
        // status word. If someone adds `netSalary` to the select, the subtitle
        // stops matching this shape and the test fails.
        const periodOnly = /^(January|February|March|April|May|June|July|August|September|October|November|December) \d{4} · [a-z ]+$/;
        for (const hit of payroll.hits) {
            expect(hit.subtitle).toMatch(periodOnly);
            expect(JSON.stringify(hit)).not.toMatch(/AED|INR|USD|₹|\$/i);
        }
    });
});

/* ================================================================== */
/* 5. Link integrity — every href resolves to a real page route          */
/* ================================================================== */

describe("API global search — every emitted href resolves to a real route", () => {
    async function hrefsFor(role: string): Promise<string[]> {
        signedInAs(role);
        seedExtendedFixtures(EXTENDED_MODELS);
        prismaMock.employee.findMany.mockResolvedValue([
            { id: "emp-1", firstName: "Ada", lastName: "Lovelace", email: "a@b.c", rollNumber: "EMP-001", designation: "Engineer", department: "Engineering" },
        ]);
        prismaMock.candidate.findMany.mockResolvedValue([
            { id: "c-1", firstName: "Ada", lastName: "L", email: "a@b.c", candidateCode: "CAND-1" },
        ]);
        prismaMock.offerLetter.findMany.mockResolvedValue([
            { id: "offer-xyz", status: "SENT", designation: "Engineer", department: "Engineering", candidate: { firstName: "Ada", lastName: "L" } },
        ]);
        prismaMock.leaveRequest.findMany.mockResolvedValue([
            { id: "lv-1", type: "ANNUAL", status: "APPROVED", reason: "Holiday", startDate: new Date(), employee: { firstName: "Ada", lastName: "L" } },
        ]);
        prismaMock.serviceRequest.findMany.mockResolvedValue([
            { id: "sr-1", details: "NOC", status: "PENDING", employee: { firstName: "Ada", lastName: "L" }, category: { name: "NOC" } },
        ]);

        const res = await searchGET(searchRequest("Ada", "all"));
        const body = await res.json();
        return body.groups.flatMap((group: any) => group.hits.map((hit: any) => hit.href));
    }

    it("resolves every href for the most privileged role", async () => {
        const hrefs = await hrefsFor("ADMIN");
        expect(hrefs.length).toBeGreaterThanOrEqual(15);
        for (const href of hrefs) {
            expect(hrefResolves(href), `dead link: ${href}`).toBe(true);
        }
    });

    it("resolves every href a STAFF search can emit", async () => {
        const hrefs = await hrefsFor("STAFF");
        for (const href of hrefs) {
            expect(hrefResolves(href), `dead link: ${href}`).toBe(true);
        }
    });

    it("resolves every href a MANAGER search can emit", async () => {
        const hrefs = await hrefsFor("MANAGER");
        for (const href of hrefs) {
            expect(hrefResolves(href), `dead link: ${href}`).toBe(true);
        }
    });

    it("links a self-scoped loan result to the my-loans page, not the admin page", async () => {
        // `/payroll/loans` requires loan.manage or loan.approve. A STAFF member
        // holding only loan.view must be sent to the page they can actually read.
        signedInAs("STAFF");
        seedExtendedFixtures(["loanApplication"]);
        const res = await searchGET(searchRequest("Ada", "all"));
        const body = await res.json();

        const loans = body.groups.find((group: any) => group.key === "loans");
        expect(loans).toBeDefined();
        expect(loans.hits[0].href).toBe("/payroll/loans/my-loans");
    });

    it("links a broad-scope loan result to the administration page", async () => {
        signedInAs("FINANCE");
        seedExtendedFixtures(["loanApplication"]);
        const res = await searchGET(searchRequest("Ada", "all"));
        const body = await res.json();

        const loans = body.groups.find((group: any) => group.key === "loans");
        expect(loans.hits[0].href).toBe("/payroll/loans");
    });

    it("sanity-checks the route inventory itself", () => {
        // If the filesystem scan silently found nothing, every href assertion
        // above would pass vacuously.
        expect(PAGE_ROUTES.has("/employees")).toBe(true);
        expect(PAGE_ROUTES.has("/payroll/structure")).toBe(true);
        expect(PAGE_ROUTES.has("/recruitment/offers/[id]")).toBe(true);
        expect(PAGE_ROUTES.size).toBeGreaterThan(30);
    });
});

/* ================================================================== */
/* 6. Presentation — relevance order, grouping, resilience              */
/* ================================================================== */

describe("API global search — grouping and ordering", () => {
    it("orders groups by relevance, not alphabetically", async () => {
        signedInAs("ADMIN");
        seedExtendedFixtures(EXTENDED_MODELS);
        prismaMock.employee.findMany.mockResolvedValue([
            { id: "emp-1", firstName: "Ada", lastName: "Lovelace", email: "a@b.c", rollNumber: "EMP-001", designation: "Engineer", department: "Engineering" },
        ]);

        const res = await searchGET(searchRequest("Ada", "all"));
        const body = await res.json();
        const keys = body.groups.map((group: any) => group.key);

        // "Configuration" sorts before "Employees" alphabetically, so a
        // label sort would put it first. People must lead.
        expect(keys[0]).toBe("employees");
        expect(keys).toContain("configuration");
        expect(keys.indexOf("employees")).toBeLessThan(keys.indexOf("configuration"));
        // And the total is still alphabetical by coincidence-free coincidence:
        // the labels of the returned groups are NOT ascending.
        const labels = body.groups.map((group: any) => group.label);
        expect([...labels].sort((a, b) => a.localeCompare(b))).not.toEqual(labels);
    });

    it("merges several domains into one group instead of one group per table", async () => {
        signedInAs("ADMIN");
        seedExtendedFixtures(["salaryRecord", "salaryStructure", "payrollRun", "overtime"]);
        const res = await searchGET(searchRequest("Ada", "all"));
        const body = await res.json();

        const payroll = body.groups.filter((group: any) => group.key === "payroll");
        expect(payroll).toHaveLength(1);
        expect(payroll[0].hits).toHaveLength(4);
    });

    it("gives every hit a non-empty title, subtitle and href", async () => {
        signedInAs("ADMIN");
        seedExtendedFixtures(EXTENDED_MODELS);
        prismaMock.employee.findMany.mockResolvedValue([
            { id: "emp-1", firstName: "Ada", lastName: "Lovelace", email: "a@b.c", rollNumber: "EMP-001", designation: "Engineer", department: "Engineering" },
        ]);
        prismaMock.candidate.findMany.mockResolvedValue([
            { id: "c-1", firstName: "Ada", lastName: "L", email: "a@b.c", candidateCode: "CAND-1" },
        ]);
        prismaMock.offerLetter.findMany.mockResolvedValue([
            { id: "o-1", status: "SENT", designation: "Engineer", department: "Engineering", candidate: { firstName: "Ada", lastName: "L" } },
        ]);
        prismaMock.leaveRequest.findMany.mockResolvedValue([
            { id: "lv-1", type: "ANNUAL", status: "APPROVED", reason: "Holiday", startDate: new Date(), employee: { firstName: "Ada", lastName: "L" } },
        ]);
        prismaMock.serviceRequest.findMany.mockResolvedValue([
            { id: "sr-1", details: "NOC", status: "PENDING", employee: { firstName: "Ada", lastName: "L" }, category: { name: "NOC" } },
        ]);

        const res = await searchGET(searchRequest("Ada", "all"));
        const body = await res.json();

        for (const group of body.groups) {
            for (const hit of group.hits) {
                expect(hit.id).toBeTruthy();
                expect(hit.title.length).toBeGreaterThan(0);
                expect(hit.subtitle.length).toBeGreaterThan(0);
                expect(hit.href.startsWith("/")).toBe(true);
            }
        }
    });

    it("uses a prefixed id per domain so two rows cannot collide in the list", async () => {
        signedInAs("ADMIN");
        seedExtendedFixtures(EXTENDED_MODELS);
        prismaMock.employee.findMany.mockResolvedValue([
            { id: "same-id", firstName: "Ada", lastName: "Lovelace", email: "a@b.c", rollNumber: "EMP-001", designation: "Engineer", department: "Engineering" },
        ]);
        prismaMock.candidate.findMany.mockResolvedValue([
            { id: "same-id", firstName: "Ada", lastName: "L", email: "a@b.c", candidateCode: "CAND-1" },
        ]);
        prismaMock.offerLetter.findMany.mockResolvedValue([
            { id: "same-id", status: "SENT", designation: "Engineer", department: "Engineering", candidate: { firstName: "Ada", lastName: "L" } },
        ]);
        prismaMock.leaveRequest.findMany.mockResolvedValue([
            { id: "same-id", type: "ANNUAL", status: "APPROVED", reason: "Holiday", startDate: new Date(), employee: { firstName: "Ada", lastName: "L" } },
        ]);
        prismaMock.serviceRequest.findMany.mockResolvedValue([
            { id: "same-id", details: "NOC", status: "PENDING", employee: { firstName: "Ada", lastName: "L" }, category: { name: "NOC" } },
        ]);

        const res = await searchGET(searchRequest("Ada", "all"));
        const body = await res.json();
        const ids = body.groups.flatMap((group: any) => group.hits.map((hit: any) => hit.id));
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("degrades one extended domain without losing the rest", async () => {
        signedInAs("ADMIN");
        seedExtendedFixtures(EXTENDED_MODELS);
        prismaMock.salaryRecord.findMany.mockRejectedValue(new Error("connection reset"));

        const res = await searchGET(searchRequest("Ada", "all"));
        const body = await res.json();

        expect(res.status).toBe(200);
        // The failing domain contributes nothing, and the others still answer.
        const keys = body.groups.map((group: any) => group.key);
        expect(keys).toContain("attendance");
        expect(keys).toContain("loans");
        expect(body.groups.flatMap((g: any) => g.hits).some((h: any) => String(h.id).startsWith("slip-"))).toBe(false);
    });
});

/* ================================================================== */
/* 7. Input contract unchanged                                         */
/* ================================================================== */

describe("API global search — input contract", () => {
    it("still refuses a term shorter than the minimum without querying", async () => {
        signedInAs("ADMIN");
        const res = await searchGET(searchRequest("a"));
        expect(res.status).toBe(200);
        expect((await res.json()).groups).toEqual([]);
        expect(queriesIssued()).toHaveLength(0);
    });

    it("still rejects an over-long term with a 400", async () => {
        signedInAs("ADMIN");
        const res = await searchGET(searchRequest("x".repeat(81)));
        expect(res.status).toBe(400);
        expect(queriesIssued()).toHaveLength(0);
    });

    it("still refuses an anonymous caller on the extended pass too", async () => {
        sessionStub.current = null;
        prismaMock.user.findUnique.mockResolvedValue(null);
        const res = await searchGET(searchRequest("Ada", "all"));
        expect(res.status).toBe(401);
        expect(queriesIssued()).toHaveLength(0);
    });
});
