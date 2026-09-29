/**
 * Credential scrubbing inside free-text values.
 *
 * Key-based redaction (`SENSITIVE_KEYS`) fires when a secret arrives under a
 * recognisable key. It cannot fire for a secret embedded in the TEXT of a
 * value, which is how driver errors actually present: Prisma and `pg` put the
 * full connection string in `error.message`.
 *
 * That path was live and unlogged-as-a-gap: a single failed query would have
 * written the production database password into `SecurityAuditLog` and stdout,
 * from where any log shipper would fan it out. The health endpoint had already
 * grown a private `sanitizeForLog` as a workaround, which was the symptom.
 */
import { describe, it, expect } from "vitest";
import { redact, scrubCredentials } from "@/lib/auth/audit";

describe("scrubCredentials", () => {
    it("removes the password from a connection string in free text", () => {
        const input = "Can't reach database server at postgresql://hr_app:s3cr3tP4ss@db:5433/hr_system";
        const out = scrubCredentials(input);

        expect(out).not.toContain("s3cr3tP4ss");
        expect(out).toContain("postgresql://***@db:5433/hr_system");
        // The host must survive: it is the diagnostic value of the message.
        expect(out).toContain("db:5433");
    });

    it("handles a postgres URL and a non-standard scheme", () => {
        expect(scrubCredentials("mysql://root:hunter2@10.0.0.5:3306/app")).not.toContain("hunter2");
        expect(scrubCredentials("redis://:letmein@cache:6379")).not.toContain("letmein");
    });

    it("removes key=value credentials", () => {
        expect(scrubCredentials("PGPASSWORD=hunter2")).not.toContain("hunter2");
        expect(scrubCredentials('password: "hunter2"')).not.toContain("hunter2");
        expect(scrubCredentials("api_key=abc123def456")).not.toContain("abc123def456");
    });

    it("removes bearer and basic auth tokens", () => {
        expect(scrubCredentials("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9")).not.toContain("eyJhbGciOiJIUzI1NiJ9");
        expect(scrubCredentials("Basic dXNlcjpwYXNzd29yZA==")).not.toContain("dXNlcjpwYXNzd29yZA==");
    });

    it("leaves ordinary diagnostic text untouched", () => {
        // The log exists to be read. Over-redaction destroys its only purpose.
        const message = "Employee cm123 not found while approving leave request lv456";
        expect(scrubCredentials(message)).toBe(message);
    });

    it("does not mangle a normal URL that carries no credentials", () => {
        const url = "see https://example.com/docs/getting-started for details";
        expect(scrubCredentials(url)).toBe(url);
    });
});

describe("redact applies scrubbing, not only key matching", () => {
    it("scrubs a credential nested in a non-sensitive key", () => {
        const out = redact({
            message: "connection failed: postgresql://hr_app:s3cr3tP4ss@db:5433/hr",
        }) as { message: string };

        expect(out.message).not.toContain("s3cr3tP4ss");
    });

    it("still redacts by key as before", () => {
        const out = redact({ password: "hunter2", token: "abc" }) as Record<string, string>;
        expect(out.password).toBe("[redacted]");
        expect(out.token).toBe("[redacted]");
    });

    it("scrubs inside arrays and nested objects", () => {
        const out = redact({
            errors: ["connect: postgresql://u:p4ssw0rd@host:5432/db"],
            context: { detail: { reason: "PGPASSWORD=p4ssw0rd" } },
        }) as any;

        expect(JSON.stringify(out)).not.toContain("p4ssw0rd");
    });

    it("scrubs before truncating, so a long message cannot leak a half-cut secret", () => {
        const padding = "x".repeat(600);
        const out = redact({
            message: `postgresql://hr_app:s3cr3tP4ss@db:5433/hr ${padding}`,
        }) as { message: string };

        expect(out.message).not.toContain("s3cr3tP4ss");
    });
});
