/**
 * API authorization tests.
 *
 * These invoke the real route handlers with `auth()` mocked, so they verify the
 * actual 401/403/200 wiring rather than a description of it.
 *
 * `vi.mock("@/lib/prisma", ...)` and `vi.mock("@/auth", ...)` keep these tests
 * free of a database and a live session.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/* ---------------- module mocks (must precede imports) ---------------- */

// `vi.mock` factories are hoisted above module-level declarations, so the
// mock objects have to be created inside `vi.hoisted()` to be referenceable.
const { prismaMock, sessionStub } = vi.hoisted(() => {
    const sessionStub = { current: null as any };
    const prismaMock = {
        user: { findUnique: vi.fn(), count: vi.fn(), upsert: vi.fn() },
        securityAuditLog: { create: vi.fn() },
        employee: { findMany: vi.fn() },
        attendance: { findFirst: vi.fn(), create: vi.fn() },
        biometricLog: { create: vi.fn(), createMany: vi.fn() },
        letterTemplate: { upsert: vi.fn() },
        $transaction: vi.fn(),
        $disconnect: vi.fn(),
    };
    return { prismaMock, sessionStub };
});

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/auth/audit", async (importOriginal) => {
    // Exercise the real action vocabulary but never write to the database.
    const actual = await importOriginal<typeof import("@/lib/auth/audit")>();
    return { ...actual, logSecurityEvent: vi.fn().mockResolvedValue(undefined) };
});

vi.mock("@/auth", () => ({ auth: vi.fn(async () => sessionStub.current) }));

/* ---------------- imports under test ---------------- */

import { GET as seedGET, POST as seedPOST } from "@/app/api/seed/route";
import { POST as importPOST, GET as importGET } from "@/app/api/attendance/import/route";
import { NextRequest } from "next/server";
import { ROLES } from "@/lib/auth/roles";

/* ---------------- helpers ---------------- */

function makeSession(role: string, email = "user@test.com") {
    return {
        user: { id: `u-${role}`, email, role },
    };
}

/**
 * The centralized guard deliberately re-reads the User row from the database on
 * every request rather than trusting `session.user.role` from the JWT, so a
 * token issued before a demotion stops being authoritative. These tests must
 * therefore model BOTH the session and the database row.
 */
function signedInAs(role: string, email = "user@test.com") {
    sessionStub.current = makeSession(role, email);
    prismaMock.user.findUnique.mockImplementation(async () => ({
        id: `u-${role}`,
        email,
        role,
        employee: { id: `emp-${role}`, department: "Operations" },
    }));
}

function signedOut() {
    sessionStub.current = null;
    prismaMock.user.findUnique.mockResolvedValue(null);
}

function multipartRequest(file: File): NextRequest {
    const form = new FormData();
    form.append("file", file);
    return new Request("http://localhost/api/attendance/import", { method: "POST", body: form }) as unknown as NextRequest;
}

function csvFile(name = "a.csv", content = "EmployeeCode,Date,Time,PunchType\nEMP-1,2026-06-01,08:55,IN") {
    return new File([content], name, { type: "text/csv" });
}

/* ---------------- tests ---------------- */

beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.securityAuditLog.create.mockResolvedValue({});
    prismaMock.employee.findMany.mockResolvedValue([]);
    signedOut();
    // Default to a non-production environment; individual tests override.
    (process.env as Record<string, string>).NODE_ENV = "development";
});

describe("API-010 /api/seed", () => {
    it("returns 401 for an anonymous request", async () => {
        signedOut();
        const res = await seedGET(new NextRequest("http://localhost/api/seed?confirm=SEED"));
        expect(res.status).toBe(401);
    });

    it("returns 403 for STAFF even with a confirmation token", async () => {
        signedInAs(ROLES.STAFF);
        const res = await seedGET(new NextRequest("http://localhost/api/seed?confirm=SEED"));
        expect(res.status).toBe(403);
    });

    it("returns 403 for MANAGER", async () => {
        signedInAs(ROLES.MANAGER);
        const res = await seedGET(new NextRequest("http://localhost/api/seed?confirm=SEED"));
        expect(res.status).toBe(403);
    });

    it("returns 403 for HR (not implicitly a super admin)", async () => {
        signedInAs(ROLES.HR);
        const res = await seedGET(new NextRequest("http://localhost/api/seed?confirm=SEED"));
        expect(res.status).toBe(403);
    });

    it("returns 403 for ADMIN (SUPER_ADMIN is required)", async () => {
        signedInAs(ROLES.ADMIN);
        const res = await seedGET(new NextRequest("http://localhost/api/seed?confirm=SEED"));
        expect(res.status).toBe(403);
    });

    it("returns 400 for SUPER_ADMIN without an explicit confirmation", async () => {
        signedInAs(ROLES.SUPER_ADMIN);
        const res = await seedGET(new NextRequest("http://localhost/api/seed"));
        expect(res.status).toBe(400);
    });

    it("returns 404 in production, before touching the database", async () => {
        (process.env as Record<string, string>).NODE_ENV = "production";
        signedInAs(ROLES.SUPER_ADMIN);
        const res = await seedGET(new NextRequest("http://localhost/api/seed?confirm=SEED"));
        expect(res.status).toBe(404);
        // The body must not disclose that a seed capability exists.
        const body = await res.json();
        expect(JSON.stringify(body)).not.toMatch(/seed/i);
        // Nothing was written.
        expect(prismaMock.letterTemplate.upsert).not.toHaveBeenCalled();
    });

    it("returns 404 in production even when unauthenticated", async () => {
        (process.env as Record<string, string>).NODE_ENV = "production";
        signedOut();
        const res = await seedGET(new NextRequest("http://localhost/api/seed?confirm=SEED"));
        expect(res.status).toBe(404);
    });

    it("allows SUPER_ADMIN in development with confirmation", async () => {
        signedInAs(ROLES.SUPER_ADMIN);
        prismaMock.user.upsert.mockResolvedValue({
            id: "u1",
            email: "admin@company.com",
            role: "ADMIN",
        });
        prismaMock.letterTemplate.upsert.mockResolvedValue({});

        const res = await seedGET(new NextRequest("http://localhost/api/seed?confirm=SEED"));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.outcome).toBe("ALLOWED");
    });

    it("refuses a POST without confirmation", async () => {
        signedInAs(ROLES.SUPER_ADMIN);
        const res = await seedPOST(new NextRequest("http://localhost/api/seed", { method: "POST" }));
        expect(res.status).toBe(400);
    });
});

describe("API-021 /api/attendance/import", () => {
    it("returns 401 for an anonymous request", async () => {
        signedOut();
        const res = await importPOST(multipartRequest(csvFile()));
        expect(res.status).toBe(401);
    });

    it("returns 403 for STAFF", async () => {
        signedInAs(ROLES.STAFF);
        const res = await importPOST(multipartRequest(csvFile()));
        expect(res.status).toBe(403);
    });

    it("returns 403 for MANAGER (no attendance.import capability)", async () => {
        signedInAs(ROLES.MANAGER);
        const res = await importPOST(multipartRequest(csvFile()));
        expect(res.status).toBe(403);
    });

    it("returns 403 for FINANCE", async () => {
        signedInAs(ROLES.FINANCE);
        const res = await importPOST(multipartRequest(csvFile()));
        expect(res.status).toBe(403);
    });

    it("rejects a non-CSV file with 415 for an authorised role", async () => {
        signedInAs(ROLES.ADMIN);
        const res = await importPOST(multipartRequest(csvFile("payload.exe", "x")));
        expect(res.status).toBe(415);
    });

    it("rejects an oversized file with 413", async () => {
        signedInAs(ROLES.ADMIN);
        // A genuinely oversized payload: the size is recomputed when the File
        // is serialised into FormData, so stubbing `size` would not survive.
        const filler = "A".repeat(6 * 1024 * 1024);
        const big = csvFile("a.csv", `EmployeeCode,Date,Time,PunchType\nEMP-1,2026-06-01,08:55,IN\n${filler}`);
        expect(big.size).toBeGreaterThan(5 * 1024 * 1024);
        const res = await importPOST(multipartRequest(big));
        expect(res.status).toBe(413);
    });

    it("rejects a request with no file", async () => {
        signedInAs(ROLES.ADMIN);
        const form = new FormData();
        const req = new Request("http://localhost/api/attendance/import", { method: "POST", body: form }) as unknown as NextRequest;
        const res = await importPOST(req);
        expect(res.status).toBe(400);
    });

    it("rejects a CSV missing required columns", async () => {
        signedInAs(ROLES.ADMIN);
        const res = await importPOST(multipartRequest(csvFile("a.csv", "EmployeeCode,Date\nEMP-1,2026-06-01")));
        expect(res.status).toBe(500); // parse failure surfaces as a rolled-back import
    });

    it("returns 405 on GET for an authenticated user and 401 for anonymous", async () => {
        signedInAs(ROLES.ADMIN);
        expect((await importGET()).status).toBe(405);
        signedOut();
        expect((await importGET()).status).toBe(401);
    });

    it("never writes anything for a denied role", async () => {
        signedInAs(ROLES.STAFF);
        await importPOST(multipartRequest(csvFile()));
        expect(prismaMock.attendance.create).not.toHaveBeenCalled();
        expect(prismaMock.biometricLog.createMany).not.toHaveBeenCalled();
        expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it("does not leak a stack trace on failure", async () => {
        signedInAs(ROLES.ADMIN);
        prismaMock.$transaction.mockRejectedValueOnce(new Error("relation does not exist"));
        const res = await importPOST(multipartRequest(csvFile()));
        const body = await res.json();
        expect(res.status).toBe(500);
        expect(JSON.stringify(body)).not.toMatch(/at .*\.ts:\d+/);
    });
});
