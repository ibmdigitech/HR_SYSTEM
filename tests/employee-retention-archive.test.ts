/**
 * Archive, restore and purge — asserted on the ARGUMENTS SENT TO PRISMA.
 *
 * Every test here checks the object that reached `prisma.employee.*`, not the
 * value that came back. That distinction is the whole point: an archive is a
 * database-level claim ("this row is not in circulation"), so a test that only
 * checked `result.success` would pass even if the write had silently done
 * nothing.
 *
 * The two properties that matter most and are easiest to lose:
 *
 *   1. `deletedAt` AND `isActive = false` are set in ONE `updateMany`, in ONE
 *      `data` object. Split into two statements there is a window in which a row
 *      is archived but still served by every `isActive: true` listing.
 *   2. The guard `deletedAt: null` lives in the write's own `where`. That is what
 *      makes archiving idempotent under concurrency, and it is why the read that
 *      precedes the write is never the guard.
 *
 * Prisma, `auth()` and `revalidatePath` are mocked, so these are DB-free.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/* ---------------- module mocks (must precede imports) ---------------- */

const { prismaMock, sessionStub } = vi.hoisted(() => {
    const sessionStub = { current: null as { user: { id: string; email: string; role: string } } | null };
    const db: Record<string, any> = {
        user: { findUnique: vi.fn() },
        employee: {
            findUnique: vi.fn(),
            findMany: vi.fn(),
            updateMany: vi.fn(),
            delete: vi.fn(),
            deleteMany: vi.fn(),
        },
        auditLog: { create: vi.fn() },
        securityAuditLog: { create: vi.fn() },
    };
    db.$transaction = vi.fn(async (arg: any) => (typeof arg === "function" ? arg(db) : Promise.all(arg)));
    return { prismaMock: db, sessionStub };
});

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/auth", () => ({ auth: vi.fn(async () => sessionStub.current) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/audit", async (importOriginal) => {
    // Real action vocabulary so `SECURITY_ACTION.USER_DISABLED` exists; the write
    // itself is captured, not performed.
    const actual = await importOriginal<typeof import("@/lib/auth/audit")>();
    return { ...actual, logSecurityEvent: vi.fn().mockResolvedValue(undefined) };
});

/* ---------------- imports under test ---------------- */

import {
    archiveEmployee,
    deleteEmployee,
    getActiveEmployees,
    getArchivedEmployees,
    purgeEmployee,
    restoreEmployee,
} from "@/app/lib/actions/employees";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logSecurityEvent } from "@/lib/auth/audit";

/* ---------------- helpers ---------------- */

/** The guard re-reads the User row from the database, so both are modelled. */
function signedInAs(role: string, employeeId: string | null = null) {
    const email = `${role.toLowerCase()}@retention.test`;
    sessionStub.current = { user: { id: `u-${role}`, email, role } };
    prismaMock.user.findUnique.mockResolvedValue({
        id: `u-${role}`,
        email,
        role,
        employee: employeeId ? { id: employeeId, department: "Operations" } : null,
    });
    return email;
}

/** An employee row as `archiveEmployee` reads it. */
function employeeRow(overrides: Record<string, unknown> = {}) {
    return {
        id: "emp-1",
        employeeCode: "EMP-001",
        firstName: "Amina",
        lastName: "Rashid",
        email: "amina@example.test",
        department: "Operations",
        designation: "Analyst",
        currentStatus: "ACTIVE",
        isActive: true,
        deletedAt: null,
        ...overrides,
    };
}

/** The arguments the action actually sent to `prisma.employee.updateMany`. */
function updateManyArgs(): Array<Record<string, any>> {
    return (prismaMock.employee.updateMany as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
}

const ARCHIVED_LONG_AGO = new Date("2019-06-01T00:00:00.000Z"); // > 5 years before the fixed "now"
const ARCHIVED_RECENTLY = new Date("2025-03-01T00:00:00.000Z"); // < 5 years before it

beforeEach(() => {
    vi.clearAllMocks();
    signedInAs("ADMIN");
    prismaMock.employee.findUnique.mockResolvedValue(employeeRow());
    prismaMock.employee.findMany.mockResolvedValue([]);
    prismaMock.employee.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.employee.delete.mockResolvedValue({});
    prismaMock.auditLog.create.mockResolvedValue({});
    vi.mocked(logSecurityEvent).mockResolvedValue(undefined);
});

/* ================================================================== */
/* ARCHIVE                                                             */
/* ================================================================== */

describe("archiveEmployee", () => {
    it("sets deletedAt AND isActive=false in ONE guarded write", async () => {
        const result = await archiveEmployee("emp-1");

        expect(result.success).toBe(true);
        expect(result.code).toBe("ARCHIVED");

        expect(prismaMock.employee.updateMany).toHaveBeenCalledTimes(1);
        const args = updateManyArgs()[0];

        // The guard: exists AND not already archived.
        expect(args.where).toEqual({ id: "emp-1", deletedAt: null });
        // The write: both columns, one object, one statement.
        expect(Object.keys(args.data).sort()).toEqual(["deletedAt", "isActive"]);
        expect(args.data.isActive).toBe(false);
        expect(args.data.deletedAt).toBeInstanceOf(Date);
    });

    it("never calls prisma.employee.delete — the whole point of the change", async () => {
        await archiveEmployee("emp-1");
        expect(prismaMock.employee.delete).not.toHaveBeenCalled();
        expect(prismaMock.employee.deleteMany).not.toHaveBeenCalled();
    });

    it("keeps the permission the old hard delete used — employees.delete, unchanged", async () => {
        // Verified against the grant table, not assumed: EMPLOYEES_DELETE is in
        // ADMIN_GRANTS only, so this is ADMIN and SUPER_ADMIN.
        const admin = await archiveEmployee("emp-1");
        expect(admin.success).toBe(true);

        signedInAs("HR");
        prismaMock.employee.updateMany.mockClear();
        const hr = await archiveEmployee("emp-1");
        expect(hr.success).toBe(false);
        expect(hr.code).toBe("PERMISSION_DENIED");
        // Refused at the guard, before any write was attempted.
        expect(prismaMock.employee.updateMany).not.toHaveBeenCalled();
    });

    it("refuses HR, FINANCE, MANAGER and STAFF identically", async () => {
        for (const role of ["HR", "FINANCE", "MANAGER", "STAFF"]) {
            signedInAs(role);
            prismaMock.employee.updateMany.mockClear();
            const result = await archiveEmployee("emp-1");
            expect(result.code, `${role} must not be able to archive`).toBe("PERMISSION_DENIED");
            expect(prismaMock.employee.updateMany).not.toHaveBeenCalled();
        }
    });

    it("records a denied attempt in the security log", async () => {
        signedInAs("STAFF");
        await archiveEmployee("emp-1");
        // Two events land here: `requirePermission` logs its own denial, and the
        // action logs the refusal in its own vocabulary. Both are wanted.
        const denials = vi
            .mocked(logSecurityEvent)
            .mock.calls.map((c) => c[0])
            .filter((e) => e.outcome === "DENIED" && e.detail?.target === "archiveEmployee");
        expect(denials.length).toBeGreaterThanOrEqual(1);
        expect(denials[0]?.detail).toMatchObject({ required: PERMISSIONS.EMPLOYEES_DELETE });
    });
});

describe("archiveEmployee is idempotent", () => {
    it("is a clear no-op when the employee is already archived", async () => {
        prismaMock.employee.findUnique.mockResolvedValue(employeeRow({ deletedAt: ARCHIVED_RECENTLY }));

        const result = await archiveEmployee("emp-1");

        // SUCCESS, not an error. A double-click is not a failure an operator can
        // act on, and reporting it as one is how "delete failed" tickets happen.
        expect(result.success).toBe(true);
        expect(result.code).toBe("ALREADY_ARCHIVED");
        expect(result.message).toContain("already archived");

        // And crucially: no second write, because the guard would not match.
        expect(prismaMock.employee.updateMany).not.toHaveBeenCalled();
        expect(prismaMock.employee.delete).not.toHaveBeenCalled();
    });

    it("does not write a second audit row for a no-op", async () => {
        prismaMock.employee.findUnique.mockResolvedValue(employeeRow({ deletedAt: ARCHIVED_RECENTLY }));
        await archiveEmployee("emp-1");
        expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    });

    it("treats a lost concurrency race as the same no-op", async () => {
        // The pre-read said "not archived", but between the read and the write
        // another request archived it, so the guarded write matched zero rows.
        prismaMock.employee.updateMany.mockResolvedValue({ count: 0 });

        const result = await archiveEmployee("emp-1");

        expect(result.success).toBe(true);
        expect(result.code).toBe("ALREADY_ARCHIVED");
        expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    });

    it("archiving twice in sequence is one write and one audit row", async () => {
        // First call: not archived, write matches one row.
        await archiveEmployee("emp-1");
        // Second call: the row now reads as archived.
        prismaMock.employee.findUnique.mockResolvedValue(employeeRow({ deletedAt: new Date() }));
        await archiveEmployee("emp-1");

        expect(prismaMock.employee.updateMany).toHaveBeenCalledTimes(1);
        expect(prismaMock.employee.delete).not.toHaveBeenCalled();
        expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1);
    });
});

describe("archiveEmployee — not found and audit", () => {
    it("reports a missing employee without writing anything", async () => {
        prismaMock.employee.findUnique.mockResolvedValue(null);
        const result = await archiveEmployee("emp-nope");
        expect(result.success).toBe(false);
        expect(result.code).toBe("NOT_FOUND");
        expect(prismaMock.employee.updateMany).not.toHaveBeenCalled();
    });

    it("writes the per-employee audit row with a precise action, not a vague one", async () => {
        await archiveEmployee("emp-1");
        expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1);
        const audit = prismaMock.auditLog.create.mock.calls[0][0].data;
        expect(audit.employeeId).toBe("emp-1");
        expect(audit.action).toBe("EMPLOYEE_ARCHIVED");
        expect(audit.details).toContain("Amina Rashid");
        expect(audit.details).toContain("retained, not deleted");
        expect(audit.changedBy).toContain("@retention.test");
    });

    it("still returns success when the audit row write fails", async () => {
        // An audit gap must be loud, but it must not undo a completed archive.
        prismaMock.auditLog.create.mockRejectedValue(new Error("audit table unavailable"));
        const result = await archiveEmployee("emp-1");
        expect(result.success).toBe(true);
        expect(prismaMock.employee.updateMany).toHaveBeenCalledTimes(1);
    });

    it("returns a write failure without claiming success", async () => {
        prismaMock.employee.updateMany.mockRejectedValue(new Error("connection reset"));
        const result = await archiveEmployee("emp-1");
        expect(result.success).toBe(false);
        expect(result.code).toBe("WRITE_FAILED");
        expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    });
});

describe("the legacy deleteEmployee entry point", () => {
    it("archives instead of deleting, because the UI still calls this name", async () => {
        // app/employees/employee-list.tsx:338 calls deleteEmployee(id). That file
        // belongs to another agent, so the name had to survive — but the
        // behaviour underneath it did not.
        const result = await deleteEmployee("emp-1");
        expect(result.success).toBe(true);
        expect(prismaMock.employee.updateMany).toHaveBeenCalledTimes(1);
        expect(updateManyArgs()[0].where).toEqual({ id: "emp-1", deletedAt: null });
        expect(prismaMock.employee.delete).not.toHaveBeenCalled();
    });
});

/* ================================================================== */
/* RESTORE                                                             */
/* ================================================================== */

describe("restoreEmployee — the counterpart an archive needs", () => {
    it("exists, is exported, and is not the delete in disguise", () => {
        expect(typeof restoreEmployee).toBe("function");
    });

    it("clears the tombstone and reinstates isActive in ONE guarded write", async () => {
        prismaMock.employee.findUnique.mockResolvedValue(employeeRow({ deletedAt: ARCHIVED_RECENTLY, isActive: false }));

        const result = await restoreEmployee("emp-1");

        expect(result.success).toBe(true);
        expect(result.code).toBe("RESTORED");
        expect(prismaMock.employee.updateMany).toHaveBeenCalledTimes(1);
        const args = updateManyArgs()[0];
        expect(args.where).toEqual({ id: "emp-1", deletedAt: { not: null } });
        expect(args.data).toEqual({ deletedAt: null, isActive: true });
        expect(prismaMock.employee.delete).not.toHaveBeenCalled();
    });

    it("is idempotent, guarded the same way as the archive", async () => {
        prismaMock.employee.findUnique.mockResolvedValue(employeeRow());
        const result = await restoreEmployee("emp-1");
        expect(result.success).toBe(true);
        expect(result.code).toBe("NOT_ARCHIVED");
        expect(result.message).toMatch(/not archived/i);
        expect(prismaMock.employee.updateMany).not.toHaveBeenCalled();
    });

    it("requires the same permission as the archive", async () => {
        prismaMock.employee.findUnique.mockResolvedValue(employeeRow({ deletedAt: ARCHIVED_RECENTLY }));
        signedInAs("HR");
        prismaMock.employee.updateMany.mockClear();
        const result = await restoreEmployee("emp-1");
        expect(result.code).toBe("PERMISSION_DENIED");
        expect(prismaMock.employee.updateMany).not.toHaveBeenCalled();
    });

    it("audits the restore", async () => {
        prismaMock.employee.findUnique.mockResolvedValue(employeeRow({ deletedAt: ARCHIVED_RECENTLY }));
        await restoreEmployee("emp-1");
        const audit = prismaMock.auditLog.create.mock.calls[0][0].data;
        expect(audit.action).toBe("EMPLOYEE_RESTORED");
    });
});

/* ================================================================== */
/* PURGE                                                               */
/* ================================================================== */

describe("purgeEmployee — retained, but fenced in three ways", () => {
    beforeEach(() => {
        signedInAs("SUPER_ADMIN");
    });

    const CONFIRM = { confirm: true, reason: "Data subject erasure request DSAR-2026-014" };

    it("is refused outright for an ADMIN, who CAN archive", async () => {
        // Archive needs EMPLOYEES_DELETE, which ADMIN holds. Purge must be a
        // strictly higher bar, so an ADMIN is refused.
        signedInAs("ADMIN");
        const result = await purgeEmployee({ id: "emp-1", ...CONFIRM });
        expect(result.success).toBe(false);
        expect(result.code).toBe("PERMISSION_DENIED");
        expect(prismaMock.employee.delete).not.toHaveBeenCalled();
    });

    it("refuses an HR caller before touching the database", async () => {
        signedInAs("HR");
        prismaMock.employee.findUnique.mockClear();
        const result = await purgeEmployee({ id: "emp-1", ...CONFIRM });
        expect(result.code).toBe("PERMISSION_DENIED");
        expect(prismaMock.employee.findUnique).not.toHaveBeenCalled();
    });

    it("requires explicit confirmation — there is no default", async () => {
        const result = await purgeEmployee({ id: "emp-1", reason: CONFIRM.reason });
        expect(result.success).toBe(false);
        expect(result.code).toBe("CONFIRMATION_REQUIRED");
        expect(prismaMock.employee.delete).not.toHaveBeenCalled();
    });

    it("requires a written reason worth keeping in an audit log", async () => {
        const result = await purgeEmployee({ id: "emp-1", confirm: true, reason: "because" });
        expect(result.code).toBe("REASON_REQUIRED");
        expect(prismaMock.employee.delete).not.toHaveBeenCalled();
    });

    it("REFUSES before the retention period has elapsed, and names the date", async () => {
        prismaMock.employee.findUnique.mockResolvedValue(employeeRow({ deletedAt: ARCHIVED_RECENTLY }));

        const result = await purgeEmployee({ id: "emp-1", ...CONFIRM });

        expect(result.success).toBe(false);
        expect(result.code).toBe("RETENTION_NOT_ELAPSED");
        expect(result.message).toMatch(/retention has not elapsed/i);
        expect(result.message).toContain("2030-03-01");
        // THE assertion: nothing was destroyed.
        expect(prismaMock.employee.delete).not.toHaveBeenCalled();
    });

    it("REFUSES a row that is not archived — purge is not a shortcut around archive", async () => {
        prismaMock.employee.findUnique.mockResolvedValue(employeeRow({ deletedAt: null }));
        const result = await purgeEmployee({ id: "emp-1", ...CONFIRM });
        expect(result.success).toBe(false);
        expect(result.code).toBe("NOT_ARCHIVED");
        expect(prismaMock.employee.delete).not.toHaveBeenCalled();
    });

    it("PERMITS the hard delete once the full period has passed", async () => {
        prismaMock.employee.findUnique.mockResolvedValue(employeeRow({ deletedAt: ARCHIVED_LONG_AGO }));

        const result = await purgeEmployee({ id: "emp-1", ...CONFIRM });

        expect(result.success).toBe(true);
        expect(result.code).toBe("PURGED");
        expect(prismaMock.employee.delete).toHaveBeenCalledTimes(1);
        expect(prismaMock.employee.delete).toHaveBeenCalledWith({ where: { id: "emp-1" } });
    });

    it("logs the attempt to the foreign-key-free table BEFORE the delete", async () => {
        prismaMock.employee.findUnique.mockResolvedValue(employeeRow({ deletedAt: ARCHIVED_LONG_AGO }));
        await purgeEmployee({ id: "emp-1", ...CONFIRM });

        const call = vi.mocked(logSecurityEvent).mock.calls.at(-1)?.[0];
        expect(call?.detail).toMatchObject({ lifecycleAction: "EMPLOYEE_PURGE_ATTEMPTED", retentionYears: 5 });
        expect(call?.detail?.reason).toBe(CONFIRM.reason);
    });

    it("reports a blocked erase honestly rather than destroying the audit trail", async () => {
        // AuditLog_employeeId_fkey is ON DELETE RESTRICT, so the database refuses
        // this for every employee with history. The action must NOT cascade-delete
        // audit rows to force it through — that is the trail retention protects.
        prismaMock.employee.findUnique.mockResolvedValue(employeeRow({ deletedAt: ARCHIVED_LONG_AGO }));
        prismaMock.employee.delete.mockRejectedValue(Object.assign(new Error("foreign key violation"), { code: "P2003" }));

        const result = await purgeEmployee({ id: "emp-1", ...CONFIRM });

        expect(result.success).toBe(false);
        expect(result.code).toBe("P2003");
        expect(result.message).toMatch(/nothing was deleted/i);
        expect(result.message).toMatch(/must be made by a human/i);
        // The attempt is still on the record.
        expect(vi.mocked(logSecurityEvent).mock.calls.at(-1)?.[0]?.detail).toMatchObject({
            lifecycleAction: "EMPLOYEE_PURGE_ATTEMPTED",
        });
    });

    it("refuses to read the row at all when the permission check fails", async () => {
        signedInAs("STAFF");
        prismaMock.employee.findUnique.mockClear();
        await purgeEmployee({ id: "emp-1", ...CONFIRM });
        expect(prismaMock.employee.findUnique).not.toHaveBeenCalled();
    });
});

/* ================================================================== */
/* THE LISTINGS THIS CHANGE OWNS                                      */
/* ================================================================== */

describe("getActiveEmployees excludes archived rows", () => {
    it("carries BOTH the tombstone filter and isActive", async () => {
        signedInAs("HR");
        await getActiveEmployees();
        const where = prismaMock.employee.findMany.mock.calls[0][0].where;
        expect(where.deletedAt).toBeNull();
        expect(where.isActive).toBe(true);
    });

    it("still requires employees.view", async () => {
        signedInAs("STAFF");
        prismaMock.employee.findMany.mockClear();
        const result = await getActiveEmployees();
        expect(result.success).toBe(false);
        expect(prismaMock.employee.findMany).not.toHaveBeenCalled();
        expect(PERMISSIONS.EMPLOYEES_VIEW).toBe("employees.view");
    });
});

describe("getArchivedEmployees — the retrieval direction", () => {
    beforeEach(() => {
        signedInAs("HR");
    });

    it("asks for exactly the archived rows and nothing else", async () => {
        await getArchivedEmployees();
        expect(prismaMock.employee.findMany).toHaveBeenCalledTimes(1);
        expect(prismaMock.employee.findMany.mock.calls[0][0].where).toEqual({ deletedAt: { not: null } });
    });

    it("reports each row's own purge eligibility, so the rule is visible", async () => {
        prismaMock.employee.findMany.mockResolvedValue([
            employeeRow({ id: "e1", deletedAt: ARCHIVED_RECENTLY, isActive: false }),
            employeeRow({ id: "e2", deletedAt: ARCHIVED_LONG_AGO, isActive: false }),
        ]);

        const result = await getArchivedEmployees();
        expect(result.success).toBe(true);
        const byId = Object.fromEntries((result as { data: any[] }).data.map((r) => [r.id, r]));

        expect(byId.e1.purgeEligible).toBe(false);
        expect(byId.e1.daysUntilPurgeEligible).toBeGreaterThan(0);
        expect(byId.e1.retentionYears).toBe(5);

        expect(byId.e2.purgeEligible).toBe(true);
        expect(byId.e2.daysUntilPurgeEligible).toBe(0);
        expect(byId.e2.purgeAfterIso).toBe("2024-06-01T00:00:00.000Z");
    });

    it("is readable by HR, who cannot archive — reading is less privileged", async () => {
        const result = await getArchivedEmployees();
        expect(result.success).toBe(true);
    });

    it("is refused to STAFF, who cannot read the directory at all", async () => {
        signedInAs("STAFF");
        prismaMock.employee.findMany.mockClear();
        const result = await getArchivedEmployees();
        expect(result.success).toBe(false);
        expect(prismaMock.employee.findMany).not.toHaveBeenCalled();
    });
});
