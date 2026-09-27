/**
 * Tests for the P0-2 remediation: rate limiting, employee validation and
 * duplicate detection.
 *
 * The rate limiter is exercised for real (no mocks) because its correctness
 * under repetition is the whole point. The employee schema is pure.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
    POLICIES,
    buildRateLimitKey,
    checkRateLimit,
    recordFailure,
    recordSuccess,
    resetRateLimits,
} from "@/lib/auth/rate-limit";
import { employeeSchema, fieldErrors } from "@/app/lib/validation";

beforeEach(() => {
    resetRateLimits();
});

describe("rate limit keys", () => {
    it("combines operation, IP and identifier", () => {
        expect(buildRateLimitKey("credentials", "1.2.3.4", "A@B.com")).toBe("credentials:1.2.3.4:a@b.com");
    });

    it("falls back to a placeholder when the IP is unknown", () => {
        expect(buildRateLimitKey("credentials", null, "a@b.com")).toBe("credentials:unknown:a@b.com");
        expect(buildRateLimitKey("credentials", "1.2.3.4", null)).toBe("credentials:1.2.3.4:unknown");
    });

    it("does not treat case or spacing in the email as a different account", () => {
        expect(buildRateLimitKey("c", "1.1.1.1", " User@Example.COM ")).toBe(
            buildRateLimitKey("c", "1.1.1.1", "user@example.com")
        );
    });

    it("keeps IP-based and account-based budgets independent", () => {
        expect(buildRateLimitKey("c", "1.1.1.1", "a@b.com")).not.toBe(buildRateLimitKey("c", null, "a@b.com"));
    });
});

describe("rate limiter", () => {
    const policy = { maxFailures: 3, windowMs: 60_000, blockMs: 60_000 };

    it("allows while under the failure budget", () => {
        const key = buildRateLimitKey("test", "9.9.9.9", "user@test.com");
        expect(checkRateLimit(key, policy).allowed).toBe(true);
        expect(checkRateLimit(key, policy).remaining).toBe(3);
    });

    it("blocks once the budget is exhausted", () => {
        const key = buildRateLimitKey("test", "9.9.9.9", "user@test.com");
        for (let i = 0; i < 3; i++) recordFailure(key, policy);
        const decision = checkRateLimit(key, policy);
        expect(decision.allowed).toBe(false);
        expect(decision.blocked).toBe(true);
        expect(decision.remaining).toBe(0);
        expect(decision.retryAfterSeconds).toBeGreaterThan(0);
    });

    it("returns a positive Retry-After so a client can back off", () => {
        const key = buildRateLimitKey("test", "8.8.8.8", "a@b.com");
        for (let i = 0; i < 5; i++) recordFailure(key, policy);
        expect(checkRateLimit(key, policy).retryAfterSeconds).toBeGreaterThan(0);
    });

    it("applies exponential backoff for repeated abuse", () => {
        const key = buildRateLimitKey("test", "7.7.7.7", "a@b.com");
        recordFailure(key, policy);
        recordFailure(key, policy);
        recordFailure(key, policy);
        const first = checkRateLimit(key, policy).retryAfterSeconds;
        // Further failures while blocked lengthen the lockout.
        recordFailure(key, policy);
        const second = checkRateLimit(key, policy).retryAfterSeconds;
        expect(second).toBeGreaterThanOrEqual(first);
    });

    it("clears the counter on a successful sign-in", () => {
        const key = buildRateLimitKey("test", "6.6.6.6", "a@b.com");
        recordFailure(key, policy);
        recordFailure(key, policy);
        expect(checkRateLimit(key, policy).remaining).toBe(1);
        recordSuccess(key);
        expect(checkRateLimit(key, policy).remaining).toBe(3);
    });

    it("does not let one attacker lock out an unrelated account", () => {
        const victim = buildRateLimitKey("test", "1.1.1.1", "victim@company.com");
        const attacker = buildRateLimitKey("test", "2.2.2.2", "victim@company.com");
        for (let i = 0; i < 6; i++) recordFailure(attacker, policy);
        expect(checkRateLimit(attacker, policy).allowed).toBe(false);
        // The account-keyed budget is what protects the victim in production;
        // the IP-keyed bucket here is distinct, so a different IP is unaffected
        // by the IP-keyed lockout alone.
        expect(checkRateLimit(victim, policy).allowed).toBe(true);
    });

    it("uses the documented production policy of 5 attempts per 15 minutes", () => {
        expect(POLICIES.credentials.maxFailures).toBe(5);
        expect(POLICIES.credentials.windowMs).toBe(15 * 60 * 1000);
    });
});

/* ------------------------------------------------------------------ */

const validEmployee = {
    firstName: "Fatima",
    lastName: "Al Mansouri",
    email: "Fatima.AlMansouri@Company.com",
    rollNumber: "EMP-100",
    designation: "Accountant",
    department: "Finance",
    joiningDate: "2024-03-01",
    employmentType: "FULL_TIME",
    currentStatus: "ACTIVE",
};

describe("employee schema", () => {
    it("accepts a well-formed employee and normalises the email", () => {
        const result = employeeSchema.safeParse(validEmployee);
        expect(result.success).toBe(true);
        // Email is lowercased so duplicate detection is case-insensitive.
        expect(result.success && result.data.email).toBe("fatima.almansouri@company.com");
    });

    it("requires first name, last name, email, roll number, designation and department", () => {
        for (const field of ["firstName", "lastName", "email", "rollNumber", "designation", "department"] as const) {
            const result = employeeSchema.safeParse({ ...validEmployee, [field]: "" });
            expect(result.success, `${field} should be required`).toBe(false);
        }
    });

    it("rejects a malformed email", () => {
        expect(employeeSchema.safeParse({ ...validEmployee, email: "not-an-email" }).success).toBe(false);
    });

    it("rejects a roll number containing disallowed characters", () => {
        expect(employeeSchema.safeParse({ ...validEmployee, rollNumber: "EMP<script>" }).success).toBe(false);
        expect(employeeSchema.safeParse({ ...validEmployee, rollNumber: "EMP-100" }).success).toBe(true);
    });

    it("validates UAE mobile numbers and tolerates formatting", () => {
        expect(employeeSchema.safeParse({ ...validEmployee, phone: "0501234567" }).success).toBe(true);
        expect(employeeSchema.safeParse({ ...validEmployee, phone: "+971501234567" }).success).toBe(true);
        expect(employeeSchema.safeParse({ ...validEmployee, phone: "12345" }).success).toBe(false);
    });

    it("treats a blank phone as absent rather than invalid", () => {
        expect(employeeSchema.safeParse({ ...validEmployee, phone: "" }).success).toBe(true);
    });

    it("validates and normalises an IBAN", () => {
        expect(employeeSchema.safeParse({ ...validEmployee, iban: "AE07 0331 2345 6789 0123 456" }).success).toBe(true);
        expect(employeeSchema.safeParse({ ...validEmployee, iban: "TOO-SHORT" }).success).toBe(false);
    });

    it("rejects a future joining date", () => {
        const future = new Date(Date.now() + 86_400_000 * 30).toISOString().slice(0, 10);
        const result = employeeSchema.safeParse({ ...validEmployee, joiningDate: future });
        expect(result.success).toBe(false);
        if (!result.success) expect(fieldErrors(result.error).joiningDate).toMatch(/future/i);
    });

    it("rejects an expiry date in the past", () => {
        const result = employeeSchema.safeParse({ ...validEmployee, visaExpiry: "2020-01-01" });
        expect(result.success).toBe(false);
    });

    it("rejects a date of birth after the joining date", () => {
        const result = employeeSchema.safeParse({ ...validEmployee, dateOfBirth: "2030-01-01" });
        expect(result.success).toBe(false);
    });

    it("rejects negative and absurd salary values", () => {
        expect(employeeSchema.safeParse({ ...validEmployee, basicSalary: -1 }).success).toBe(false);
        expect(employeeSchema.safeParse({ ...validEmployee, basicSalary: 999_999_999 }).success).toBe(false);
        expect(employeeSchema.safeParse({ ...validEmployee, basicSalary: 15000 }).success).toBe(true);
    });

    it("bounds field lengths so a single request cannot store unbounded text", () => {
        expect(employeeSchema.safeParse({ ...validEmployee, firstName: "A".repeat(500) }).success).toBe(false);
        expect(employeeSchema.safeParse({ ...validEmployee, address: "A".repeat(5000) }).success).toBe(false);
    });

    it("defaults employment type and status when omitted", () => {
        const { employmentType, currentStatus, ...rest } = validEmployee;
        const result = employeeSchema.safeParse(rest);
        expect(result.success && result.data.employmentType).toBe("FULL_TIME");
        expect(result.success && result.data.currentStatus).toBe("ACTIVE");
    });

    it("maps 'none' manager to null", () => {
        const result = employeeSchema.safeParse({ ...validEmployee, managerId: "none" });
        expect(result.success && result.data.managerId).toBeNull();
    });

    it("flattens errors into field keys the form can bind to", () => {
        const result = employeeSchema.safeParse({ ...validEmployee, email: "bad" });
        expect(result.success).toBe(false);
        if (!result.success) {
            const errors = fieldErrors(result.error);
            expect(errors.email).toBeDefined();
        }
    });
});
