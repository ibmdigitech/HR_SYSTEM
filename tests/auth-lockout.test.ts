/**
 * Regression guard for the sign-in lockout caused by infrastructure failure.
 *
 * THE INCIDENT: while the database was briefly unreachable, a real
 * administrator's sign-in attempts were charged to the brute-force budget.
 * Five attempts exhausted the 15-minute window and the exponential backoff
 * stretched the penalty to `blockMs * 8` — a lockout of roughly two hours,
 * with the login page showing nothing but "Invalid email or password" and no
 * lockout counter of its own. An outage is an availability incident, not a
 * credential guess, and it must never consume a user's budget.
 *
 * WHAT IS TESTED: the accounting rule itself, not a description of it. The
 * sign-in callback in `auth.ts` delegates every outcome to the pure
 * `classifyAuthFailure` and applies it through `registerAuthVerdict`, so these
 * tests drive the REAL limiter with the REAL verdicts. The counter assertions
 * read `checkRateLimit` rather than a spy, so they fail if the budget actually
 * moves, not merely if a mock was called.
 *
 * `@/lib/prisma` and the audit writer are mocked so nothing here needs a
 * database.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/* ---------------- module mocks (must precede imports) ---------------- */

const { prismaMock, logSecurityEvent } = vi.hoisted(() => {
    const prismaMock = {
        user: { findUnique: vi.fn() },
        userSecurityFlag: { findUnique: vi.fn() },
        securityAuditLog: { create: vi.fn() },
        $disconnect: vi.fn(),
    };
    const logSecurityEvent = vi.fn().mockResolvedValue(undefined);
    return { prismaMock, logSecurityEvent };
});

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/auth/audit", async (importOriginal) => {
    // Exercise the real action vocabulary but never write to the database.
    const actual = await importOriginal<typeof import("@/lib/auth/audit")>();
    return { ...actual, logSecurityEvent };
});

/* ---------------- imports under test ---------------- */

import {
    POLICIES,
    buildCredentialRateLimitKeys,
    checkRateLimit,
    classifyAuthFailure,
    registerAuthVerdict,
    resetRateLimits,
    type AuthAttemptFacts,
} from "@/lib/auth/rate-limit";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const EMAIL = "admin@company.com";
const IP = "203.0.113.10";

/** Facts for a lookup that succeeded and found the account with a hash. */
const KNOWN_USER: AuthAttemptFacts = {
    payloadValid: true,
    lookup: "resolved",
    userFound: true,
    hasPasswordHash: true,
    passwordMatched: false,
};

/**
 * Facts for a lookup that THREW. The account evidence is identical to the
 * unknown-user case, which is exactly the ambiguity that caused the outage to
 * be counted: only `lookup` separates the two.
 */
const THROWN_LOOKUP: AuthAttemptFacts = {
    payloadValid: true,
    lookup: "unavailable",
    userFound: false,
    hasPasswordHash: false,
    passwordMatched: false,
};

const UNKNOWN_USER: AuthAttemptFacts = {
    payloadValid: true,
    lookup: "resolved",
    userFound: false,
    hasPasswordHash: false,
    passwordMatched: false,
};

function account(email = EMAIL, ip: string | null = IP) {
    return buildCredentialRateLimitKeys(email, ip);
}

function apply(facts: AuthAttemptFacts, keys = account()): Promise<void> {
    return registerAuthVerdict({
        verdict: classifyAuthFailure(facts),
        pairKey: keys.pair,
        accountKey: keys.account,
        policy: POLICIES.credentials,
        email: EMAIL,
        ip: IP,
    });
}

beforeEach(() => {
    resetRateLimits();
    logSecurityEvent.mockClear();
});

/* ------------------------------------------------------------------ */

describe("classifyAuthFailure — infrastructure failure is not a credential guess", () => {
    it("a thrown lookup is an availability incident that is not counted", () => {
        const verdict = classifyAuthFailure(THROWN_LOOKUP);
        expect(verdict.kind).toBe("INFRASTRUCTURE_ERROR");
        expect(verdict.countsAsFailure).toBe(false);
        expect(verdict.clearsFailures).toBe(false);
        // 'none' is what stops the counters from being touched at all.
        expect(verdict.keyScope).toBe("none");
        expect(verdict.auditOutcome).toBe("ERROR");
    });

    it("distinguishes 'the database could not answer' from 'no such account'", () => {
        // Same account evidence, opposite accounting. If this test ever merges
        // the two kinds again, an outage is back to locking users out.
        expect(classifyAuthFailure(THROWN_LOOKUP).kind).not.toBe(
            classifyAuthFailure(UNKNOWN_USER).kind
        );
        expect(classifyAuthFailure(UNKNOWN_USER).kind).toBe("INVALID_CREDENTIALS");
        expect(classifyAuthFailure(UNKNOWN_USER).countsAsFailure).toBe(true);
    });

    it("an outage is not counted even when the account is known to exist", () => {
        // The lookup answered, the account exists, but the follow-up state
        // read failed. The password is not the reason we cannot decide, so
        // nothing may be charged.
        const verdict = classifyAuthFailure({
            payloadValid: true,
            lookup: "unavailable",
            userFound: true,
            hasPasswordHash: true,
            passwordMatched: false,
        });
        expect(verdict.countsAsFailure).toBe(false);
        expect(verdict.keyScope).toBe("none");
    });
});

describe("classifyAuthFailure — genuine credential guesses are counted", () => {
    it("a wrong password is counted against both budgets", () => {
        const verdict = classifyAuthFailure(KNOWN_USER);
        expect(verdict.kind).toBe("WRONG_PASSWORD");
        expect(verdict.countsAsFailure).toBe(true);
        expect(verdict.keyScope).toBe("account-and-ip");
    });

    it("an unknown user is counted against both budgets", () => {
        expect(classifyAuthFailure(UNKNOWN_USER).keyScope).toBe("account-and-ip");
    });

    it("a malformed payload is counted on the IP budget only", () => {
        // The account key would be the shared `…:unknown:unknown` bucket here,
        // so charging it would let anonymous junk starve other anonymous junk.
        const verdict = classifyAuthFailure({
            payloadValid: false,
            lookup: "resolved",
            userFound: false,
            hasPasswordHash: false,
            passwordMatched: false,
        });
        expect(verdict.kind).toBe("MALFORMED_PAYLOAD");
        expect(verdict.countsAsFailure).toBe(true);
        expect(verdict.keyScope).toBe("ip-only");
    });

    it("a correct password with a forced change outstanding is not a guess", () => {
        const verdict = classifyAuthFailure({
            ...KNOWN_USER,
            passwordMatched: true,
            passwordChangeDue: true,
        });
        expect(verdict.kind).toBe("PASSWORD_CHANGE_DUE");
        // Still refused, and still recorded, but not against the account
        // budget: the user typed the right password and cannot fix this by
        // typing more of them.
        expect(verdict.clearsFailures).toBe(false);
        expect(verdict.keyScope).toBe("ip-only");
    });

    it("an account awaiting first-login activation is reported as such", () => {
        const verdict = classifyAuthFailure({
            payloadValid: true,
            lookup: "resolved",
            userFound: true,
            hasPasswordHash: false,
            passwordMatched: false,
            awaitingActivation: true,
        });
        expect(verdict.kind).toBe("ACCOUNT_PENDING_ACTIVATION");
        expect(verdict.reason).not.toMatch(/invalid credentials/i);
    });

    it("a successful sign-in clears the accumulated failures", () => {
        const verdict = classifyAuthFailure({ ...KNOWN_USER, passwordMatched: true });
        expect(verdict.kind).toBe("SUCCESS");
        expect(verdict.clearsFailures).toBe(true);
        expect(verdict.countsAsFailure).toBe(false);
        expect(verdict.keyScope).toBe("account-and-ip");
    });
});

/* ------------------------------------------------------------------ */

describe("lockout accounting against the real limiter", () => {
    it("a thrown database lookup never increments the failure counter", async () => {
        const keys = account();
        // Well past the production budget. Before the fix each of these calls
        // charged the account one failed guess and locked the user out.
        for (let i = 0; i < 20; i++) {
            await apply(THROWN_LOOKUP, keys);
        }

        for (const key of [keys.pair, keys.account]) {
            const decision = checkRateLimit(key, POLICIES.credentials);
            expect(decision.remaining, `${key} was charged for an outage`).toBe(
                POLICIES.credentials.maxFailures
            );
            expect(decision.blocked).toBe(false);
            expect(decision.allowed).toBe(true);
        }
    });

    it("a wrong password does increment the failure counter", async () => {
        const keys = account();
        await apply(KNOWN_USER, keys);

        expect(checkRateLimit(keys.pair, POLICIES.credentials).remaining).toBe(
            POLICIES.credentials.maxFailures - 1
        );
        expect(checkRateLimit(keys.account, POLICIES.credentials).remaining).toBe(
            POLICIES.credentials.maxFailures - 1
        );
    });

    it("repeated wrong passwords still lock the account out", async () => {
        const keys = account();
        for (let i = 0; i < POLICIES.credentials.maxFailures; i++) {
            await apply(KNOWN_USER, keys);
        }
        const decision = checkRateLimit(keys.account, POLICIES.credentials);
        expect(decision.allowed).toBe(false);
        expect(decision.blocked).toBe(true);
        expect(decision.retryAfterSeconds).toBeGreaterThan(0);
    });

    it("an outage between real failures does not tip the account into lockout", async () => {
        // The production scenario: four genuine typos, then the database drops
        // for two attempts. The outage must not spend the fifth and final
        // unit of budget, so the next real attempt is judged on its own merits.
        const keys = account();
        for (let i = 0; i < 4; i++) await apply(KNOWN_USER, keys);
        for (let i = 0; i < 2; i++) await apply(THROWN_LOOKUP, keys);

        const decision = checkRateLimit(keys.account, POLICIES.credentials);
        expect(decision.remaining).toBe(1);
        expect(decision.allowed).toBe(true);

        // One more genuine failure is the one that locks the account out —
        // the outage contributed nothing to that.
        await apply(KNOWN_USER, keys);
        expect(checkRateLimit(keys.account, POLICIES.credentials).allowed).toBe(false);
    });

    it("a successful sign-in clears the counter on both budgets", async () => {
        const keys = account();
        for (let i = 0; i < 3; i++) await apply(KNOWN_USER, keys);
        expect(checkRateLimit(keys.account, POLICIES.credentials).remaining).toBe(2);

        await apply({ ...KNOWN_USER, passwordMatched: true }, keys);

        for (const key of [keys.pair, keys.account]) {
            expect(checkRateLimit(key, POLICIES.credentials).remaining).toBe(
                POLICIES.credentials.maxFailures
            );
            expect(checkRateLimit(key, POLICIES.credentials).blocked).toBe(false);
        }
    });

    it("an outage is still visible in the security log even though it is not counted", async () => {
        // A lockout with no visible reason is the second half of the incident.
        await apply(THROWN_LOOKUP);
        expect(logSecurityEvent).toHaveBeenCalledTimes(1);
        expect(logSecurityEvent.mock.calls[0][0]).toMatchObject({
            outcome: "ERROR",
            detail: { kind: "INFRASTRUCTURE_ERROR", counted: false },
        });
    });

    it("an account cannot be locked out from a different IP", async () => {
        // The account-keyed budget is the one that protects a legitimate user
        // when an attacker rotates source addresses.
        const victim = account(EMAIL, "198.51.100.7");
        for (let i = 0; i < 20; i++) {
            await apply(KNOWN_USER, account(EMAIL, `10.0.0.${i}`));
        }
        expect(checkRateLimit(victim.account, POLICIES.credentials).allowed).toBe(false);
    });
});

/* ------------------------------------------------------------------ */

describe("source guards — auth.ts must keep delegating the accounting", () => {
    const source = readFileSync(join(process.cwd(), "auth.ts"), "utf8");

    it("the sign-in callback classifies outcomes instead of counting them inline", () => {
        // If someone re-adds a raw `registerAuthOutcome(... success: false)`
        // to the outcome paths, an outage can start counting again. The slice
        // starts at the first classifier call so the rate-limit pre-check —
        // which legitimately records a blocked attempt — is excluded.
        expect(source).toMatch(/classifyAuthFailure\(/);
        expect(source).toMatch(/registerAuthVerdict\(/);
        const outcomes = source.slice(source.indexOf("classifyAuthFailure("));
        expect(outcomes).not.toMatch(/success:\s*false/);
        expect(outcomes).not.toMatch(/recordFailure\(/);
    });

    it("the user lookup reports a thrown query instead of collapsing it to null", () => {
        // The defect: a bare `throw` escaped `authorize` (which @auth/core does
        // not wrap) and a swallowed error became indistinguishable from
        // "no such user".
        expect(source).not.toMatch(/throw new Error\(['"]Failed to fetch user/);
        expect(source).toMatch(/lookup: 'unavailable'/);
    });

    it("a forced password change is still refused", () => {
        // P1.1 must survive this refactor.
        expect(source).toMatch(/mustChangePassword/);
        expect(source).toMatch(/passwordChangeDue/);
    });
});
