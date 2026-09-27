/**
 * Security-audit redaction tests.
 *
 * The audit log is append-only and long-lived. If a secret ever reaches it,
 * the database becomes a credential store. These tests pin the redaction
 * contract.
 */
import { describe, it, expect } from "vitest";
import { redact, MAX_VALUE_LENGTH } from "@/lib/auth/audit";
import { SECURITY_ACTION } from "@/lib/auth/audit";

describe("redact", () => {
    it("replaces sensitive keys regardless of case", () => {
        const input = {
            password: "hunter2",
            PASSWORD: "hunter2",
            token: "abc",
            accessToken: "abc",
            refresh_token: "abc",
            sessionToken: "abc",
            cookie: "sid=1",
            authorization: "Bearer x",
            secret: "s",
            authSecret: "s",
            clientSecret: "s",
            apiKey: "k",
            databaseUrl: "postgres://...",
            directUrl: "postgres://...",
        };
        const out = redact(input) as Record<string, unknown>;
        for (const key of Object.keys(input)) {
            expect(out[key]).toBe("[redacted]");
        }
    });

    it("keeps non-sensitive operational detail intact", () => {
        const out = redact({
            action: "SEED_EXECUTED",
            templatesUpserted: 3,
            imported: 12,
            role: "ADMIN",
        }) as Record<string, unknown>;
        expect(out.action).toBe("SEED_EXECUTED");
        expect(out.templatesUpserted).toBe(3);
        expect(out.role).toBe("ADMIN");
    });

    it("truncates long strings so the log cannot be flooded", () => {
        const out = redact({ note: "x".repeat(MAX_VALUE_LENGTH + 200) }) as Record<string, string>;
        expect(out.note.length).toBe(MAX_VALUE_LENGTH + "...[truncated]".length);
        expect(out.note).toContain("[truncated]");
    });

    it("caps array length", () => {
        const out = redact({ list: Array.from({ length: 500 }, (_, i) => i) }) as { list: number[] };
        expect(out.list.length).toBe(50);
    });

    it("bounds recursion depth instead of overflowing", () => {
        let deep: Record<string, unknown> = { value: "leaf" };
        for (let i = 0; i < 20; i++) deep = { nested: deep };
        const out = JSON.stringify(redact(deep));
        expect(out).toContain("[deep]");
    });

    it("handles primitives and nullish values", () => {
        expect(redact(null)).toBeNull();
        expect(redact(undefined)).toBeUndefined();
        expect(redact(42)).toBe(42);
        expect(redact(true)).toBe(true);
    });

    it("serialises dates deterministically", () => {
        const out = redact({ at: new Date("2026-01-02T03:04:05.000Z") }) as { at: string };
        expect(out.at).toBe("2026-01-02T03:04:05.000Z");
    });

    it("redacts secrets nested inside arrays of objects", () => {
        const out = redact({ users: [{ email: "a@b.c", password: "p" }] }) as {
            users: { email: string; password: string }[];
        };
        expect(out.users[0].email).toBe("a@b.c");
        expect(out.users[0].password).toBe("[redacted]");
    });
});

describe("security action vocabulary", () => {
    it("covers the events the brief requires", () => {
        for (const key of [
            "ROLE_CHANGED",
            "PERMISSION_OVERRIDE_CHANGED",
            "USER_DISABLED",
            "USER_ENABLED",
            "SESSION_TERMINATED",
            "ACCESS_DENIED",
            "AUTH_FAILURE",
            "SEED_EXECUTED",
            "SEED_DENIED",
            "ATTENDANCE_IMPORT",
            "ATTENDANCE_IMPORT_DENIED",
        ]) {
            expect(Object.values(SECURITY_ACTION)).toContain(key);
        }
    });
});
