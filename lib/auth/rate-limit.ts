/**
 * Rate limiting for authentication-sensitive operations.
 *
 * SCOPE AND LIMITS — this is a deliberately dependency-free implementation.
 * It uses an in-process sliding window, which is correct for a single Node
 * instance (the Next.js dev server and a single-container deployment) and is
 * sufficient to blunt online password guessing.
 *
 * PRODUCTION SCALING — THIS IS NOT PRODUCTION-SAFE UNDER HORIZONTAL SCALING.
 * The store below is a `Map` held in the Node process. With N instances behind
 * a load balancer every instance keeps its own counters, so an attacker gets N
 * times the budget, rotating between instances defeats the limiter entirely,
 * and any deploy, crash or `globalThis` reset wipes the history. The same is
 * true, and worse, on serverless or any runtime that recycles the process
 * between requests, where the map is empty on a cold start.
 *
 * The only deployment this is correct for is a SINGLE long-lived Node
 * instance. Before adding a second one, the whole counting surface in this
 * file (`checkRateLimit`, `recordFailure`, `recordSuccess` and the `store`
 * map) must be backed by a shared store — Upstash Redis, or a Postgres table
 * written with an atomic upsert / `INSERT ... ON CONFLICT`. The exported
 * surface is deliberately narrow (`checkRateLimit` / `recordFailure` /
 * `recordSuccess` plus the pure classifier) so that swap stays a
 * single-file change.
 *
 * SECURITY PROPERTIES:
 *  - Counts failures, not successes, so a legitimate user who signs in
 *    successfully is never penalised for earlier typos.
 *  - Throttles PER ACCOUNT as well as per IP+account, so neither rotating IPs
 *    nor spraying one account from many hosts is enough. See
 *    `buildCredentialRateLimitKeys`; a per-IP-only key is not a lockout.
 *  - NEVER counts an infrastructure failure. A database outage is an
 *    availability incident, not a credential guess; charging it against the
 *    budget locks out legitimate users for up to `blockMs * 8` with nothing in
 *    the UI to explain why. See `classifyAuthFailure`.
 *  - Applies exponential backoff once the budget is exhausted.
 *  - Emits a `Retry-After` value so a client can back off correctly.
 *  - Fails OPEN on an unexpected internal error. A rate-limiter bug must never
 *    lock every user out of the application.
 *
 * KNOWN LIMITATION (not fixable in-process): when a request carries neither a
 * resolvable client IP nor an identifier, `buildRateLimitKey` degrades to
 * `<op>:unknown:unknown`, which is a single bucket shared by every such
 * request. That bucket only ever holds requests that were going to be rejected
 * anyway, so the blast radius is small, but it does mean anonymous junk can
 * starve other anonymous junk. Callers that cannot identify a caller should
 * record the outcome under an IP-only key rather than the double-unknown one.
 */

import { logSecurityEvent, SECURITY_ACTION } from "./audit";

export interface RateLimitDecision {
    allowed: boolean;
    /** Remaining attempts in the current window. */
    remaining: number;
    /** Seconds until the caller may retry. 0 when allowed. */
    retryAfterSeconds: number;
    /** True when the caller is currently blocked. */
    blocked: boolean;
}

interface Bucket {
    /** Failure timestamps, oldest first. */
    failures: number[];
    /** Set when the bucket is locked out; cleared on the first success. */
    blockedUntil: number;
}

export interface RateLimitPolicy {
    /** Maximum failures permitted inside the window. */
    maxFailures: number;
    /** Window length in milliseconds. */
    windowMs: number;
    /** Lockout applied once the budget is exhausted. */
    blockMs: number;
}

export const POLICIES = {
    /** Credential sign-in: 5 failures per 15 minutes. */
    credentials: { maxFailures: 5, windowMs: 15 * 60 * 1000, blockMs: 15 * 60 * 1000 },
    /** Password change / recovery: 5 per hour. */
    sensitive: { maxFailures: 5, windowMs: 60 * 60 * 1000, blockMs: 60 * 60 * 1000 },
} as const satisfies Record<string, RateLimitPolicy>;

const globalStore: Map<string, Bucket> | undefined = (globalThis as { __hrRateLimits?: Map<string, Bucket> }).__hrRateLimits;
const store: Map<string, Bucket> = globalStore ?? new Map<string, Bucket>();
(globalThis as { __hrRateLimits?: Map<string, Bucket> }).__hrRateLimits = store;

/** Bounds memory so a flood of unique keys cannot exhaust the heap. */
const MAX_BUCKETS = 10_000;

function bucketFor(key: string): Bucket {
    let bucket = store.get(key);
    if (!bucket) {
        if (store.size >= MAX_BUCKETS) {
            // Evict the oldest bucket rather than growing without bound.
            const oldestKey = store.keys().next().value;
            if (oldestKey !== undefined) store.delete(oldestKey);
        }
        bucket = { failures: [], blockedUntil: 0 };
        store.set(key, bucket);
    }
    return bucket;
}

function prune(bucket: Bucket, windowMs: number, now: number): void {
    const cutoff = now - windowMs;
    while (bucket.failures.length > 0 && bucket.failures[0] <= cutoff) {
        bucket.failures.shift();
    }
    if (bucket.blockedUntil > 0 && bucket.blockedUntil <= now) {
        bucket.blockedUntil = 0;
    }
}

/** Composes the two independent limits an attacker must evade. */
export function buildRateLimitKey(operation: string, ip: string | null, identifier: string | null): string {
    const ipPart = ip && ip.length > 0 ? ip : "unknown";
    const idPart = identifier && identifier.length > 0 ? identifier.trim().toLowerCase() : "unknown";
    return `${operation}:${ipPart}:${idPart}`;
}

/**
 * The two independent budgets a credential sign-in must consult.
 *
 * `pair` is scoped to one IP + one account and `account` to the account alone,
 * so an attacker has to evade both: rotating IPs does not help because
 * `account` is not IP-scoped, and spraying one account from many hosts does
 * not help because `account` still accumulates.
 *
 * A per-IP-only throttle is NOT sufficient — it is trivially evaded by
 * rotation, and it also means an attacker can grief a colleague's account by
 * exhausting that colleague's IP bucket. Callers handling sign-in must use
 * these two keys, never `buildRateLimitKey(op, ip, null)` on its own.
 */
export function buildCredentialRateLimitKeys(
    email: string | null,
    ip: string | null
): { pair: string; account: string } {
    return {
        pair: buildRateLimitKey("credentials", ip, email),
        account: buildRateLimitKey("credentials-account", null, email),
    };
}

export function checkRateLimit(key: string, policy: RateLimitPolicy): RateLimitDecision {
    try {
        const now = Date.now();
        const bucket = bucketFor(key);
        prune(bucket, policy.windowMs, now);

        if (bucket.blockedUntil > now) {
            return {
                allowed: false,
                blocked: true,
                remaining: 0,
                retryAfterSeconds: Math.ceil((bucket.blockedUntil - now) / 1000),
            };
        }

        const remaining = Math.max(0, policy.maxFailures - bucket.failures.length);
        return { allowed: true, blocked: false, remaining, retryAfterSeconds: 0 };
    } catch (error) {
        // Fail open: a limiter fault must not deny legitimate users.
        console.error("[RATE_LIMIT_CHECK_FAILED]", error);
        return { allowed: true, blocked: false, remaining: 0, retryAfterSeconds: 0 };
    }
}

export function recordFailure(key: string, policy: RateLimitPolicy): RateLimitDecision {
    try {
        const now = Date.now();
        const bucket = bucketFor(key);
        prune(bucket, policy.windowMs, now);

        bucket.failures.push(now);

        if (bucket.failures.length >= policy.maxFailures) {
            // Exponential backoff: 1x, 2x, 4x … capped at 8x the base window.
            const overage = bucket.failures.length - policy.maxFailures;
            const multiplier = Math.min(2 ** Math.min(overage, 3), 8);
            bucket.blockedUntil = now + policy.blockMs * multiplier;
        }

        return checkRateLimit(key, policy);
    } catch (error) {
        console.error("[RATE_LIMIT_RECORD_FAILED]", error);
        return { allowed: true, blocked: false, remaining: 0, retryAfterSeconds: 0 };
    }
}

/** Called after a successful authentication so a user is not penalised later. */
export function recordSuccess(key: string): void {
    try {
        store.delete(key);
    } catch (error) {
        console.error("[RATE_LIMIT_RESET_FAILED]", error);
    }
}

/** Resets a bucket and records the outcome in the security audit log. */
export async function registerAuthOutcome(params: {
    key: string;
    policy: RateLimitPolicy;
    email: string | null;
    ip: string | null;
    success: boolean;
    reason?: string;
}): Promise<void> {
    if (params.success) {
        recordSuccess(params.key);
        return;
    }
    const decision = recordFailure(params.key, params.policy);
    await logSecurityEvent({
        action: SECURITY_ACTION.AUTH_FAILURE,
        actorEmail: params.email,
        target: `auth:${params.key}`,
        outcome: decision.blocked ? "DENIED" : "ERROR",
        ipAddress: params.ip,
        detail: {
            reason: params.reason ?? "invalid credentials",
            remaining: decision.remaining,
            retryAfterSeconds: decision.retryAfterSeconds,
        },
    });
}

/** Test seam: clears all counters. */
export function resetRateLimits(): void {
    store.clear();
}

/* ------------------------------------------------------------------ */
/* Auth-outcome classification                                          */
/* ------------------------------------------------------------------ */

/**
 * What the server actually observed during ONE credential sign-in attempt.
 *
 * THE BUG THIS EXISTS TO FIX. The sign-in callback used to decide what to
 * count from a single `user` value. That value is `null` both when Prisma
 * returned no row AND when the Prisma call itself threw and the error was
 * swallowed, so "no such account" and "the database is unreachable" were
 * indistinguishable and were accounted identically. Production consequence:
 * a brief outage produced five failed attempts for a real admin account, and
 * the exponential backoff turned that into a lockout of up to
 * `blockMs * 8` — two hours with no message explaining why.
 *
 * `lookup` is therefore an explicit, first-class field. It records whether the
 * datastore ANSWERED, and it is checked before `userFound` is consulted. A
 * caller must never infer `unavailable` from `userFound === false`; that
 * inference is precisely the defect.
 */
export interface AuthAttemptFacts {
    /** False when the submitted payload failed schema validation. */
    payloadValid: boolean;
    /**
     * `resolved` — the datastore answered.
     * `unavailable` — the datastore could not answer (timeout, connection
     * reset, pool exhaustion). This is an availability incident.
     */
    lookup: "resolved" | "unavailable";
    /** A row was returned by a lookup that SUCCEEDED. */
    userFound: boolean;
    /** The returned row carries a usable password hash. */
    hasPasswordHash: boolean;
    /** bcrypt reported a match. Only meaningful once a hash exists. */
    passwordMatched: boolean;
    /** First-login activation is outstanding, so no password has been set. */
    awaitingActivation?: boolean;
    /** A forced password change is outstanding (P1.1). */
    passwordChangeDue?: boolean;
}

export type AuthOutcomeKind =
    | "SUCCESS"
    | "INVALID_CREDENTIALS"
    | "WRONG_PASSWORD"
    | "MALFORMED_PAYLOAD"
    | "ACCOUNT_PENDING_ACTIVATION"
    | "PASSWORD_CHANGE_DUE"
    | "INFRASTRUCTURE_ERROR";

/**
 * Which counters an outcome may touch.
 *
 *  - `account-and-ip` — both budgets. Reserved for outcomes that are genuine
 *    credential guesses against a known account.
 *  - `ip-only` — the IP-scoped budget only. Used when the identifier is
 *    unknown (a malformed payload, where the account key would be the shared
 *    `<op>:unknown:unknown` bucket) or when the request is not a guess at all
 *    (a correct password that is merely gated behind an activation step).
 *  - `none` — the counters are not read and not written.
 */
export type AuthKeyScope = "account-and-ip" | "ip-only" | "none";

export interface AuthOutcomeVerdict {
    kind: AuthOutcomeKind;
    /** True when this outcome must increment the credential-failure budget. */
    countsAsFailure: boolean;
    /** True when this outcome must clear the accumulated failures. */
    clearsFailures: boolean;
    /** Which counters this outcome is allowed to touch. */
    keyScope: AuthKeyScope;
    /** Reason string persisted to the security audit log. Never secret. */
    reason: string;
    /** Severity recorded in the security audit log. */
    auditOutcome: "SUCCESS" | "DENIED" | "ERROR";
}

/**
 * PURE. Maps what the server observed to how it must be accounted.
 *
 * This is deliberately a total function with no I/O, so the accounting rule
 * can be tested directly instead of inferred from a sign-in flow. `auth.ts`
 * delegates to it for every outcome it produces; no failure path in the
 * sign-in callback may increment a counter on its own.
 */
export function classifyAuthFailure(facts: AuthAttemptFacts): AuthOutcomeVerdict {
    // A payload that never reached the credential check cannot have leaked a
    // guess, but it is still a non-constant-time probe worth counting.
    if (!facts.payloadValid) {
        return {
            kind: "MALFORMED_PAYLOAD",
            countsAsFailure: true,
            clearsFailures: false,
            keyScope: "ip-only",
            reason: "malformed credentials payload",
            auditOutcome: "DENIED",
        };
    }

    // CHECKED FIRST, BEFORE `userFound`. Everything below this line is about
    // the credential; nothing above it knows whether the account exists. A
    // datastore that could not answer produces no evidence about the password,
    // so there is nothing to count — and returning "invalid credentials" as an
    // accounting decision here is what caused the observed two-hour lockout.
    if (facts.lookup === "unavailable") {
        return {
            kind: "INFRASTRUCTURE_ERROR",
            countsAsFailure: false,
            clearsFailures: false,
            keyScope: "none",
            reason: "identity store unavailable; attempt not counted",
            auditOutcome: "ERROR",
        };
    }

    if (!facts.userFound) {
        return {
            kind: "INVALID_CREDENTIALS",
            countsAsFailure: true,
            clearsFailures: false,
            keyScope: "account-and-ip",
            reason: "unknown user or non-credential account",
            auditOutcome: "DENIED",
        };
    }

    if (!facts.hasPasswordHash) {
        // An account with no password hash is one awaiting its first-login
        // activation (P1.1), reached only through the activation link. That is
        // not an error and must not be reported as invalid credentials, which
        // would leave the user with no way forward.
        if (facts.awaitingActivation) {
            return {
                kind: "ACCOUNT_PENDING_ACTIVATION",
                countsAsFailure: true,
                clearsFailures: false,
                keyScope: "ip-only",
                reason: "account awaiting first-login activation",
                auditOutcome: "DENIED",
            };
        }
        return {
            kind: "INVALID_CREDENTIALS",
            countsAsFailure: true,
            clearsFailures: false,
            keyScope: "account-and-ip",
            reason: "unknown user or non-credential account",
            auditOutcome: "DENIED",
        };
    }

    if (!facts.passwordMatched) {
        return {
            kind: "WRONG_PASSWORD",
            countsAsFailure: true,
            clearsFailures: false,
            keyScope: "account-and-ip",
            reason: "password mismatch",
            auditOutcome: "DENIED",
        };
    }

    if (facts.passwordChangeDue) {
        return {
            kind: "PASSWORD_CHANGE_DUE",
            countsAsFailure: true,
            clearsFailures: false,
            keyScope: "ip-only",
            reason: "forced password change outstanding",
            auditOutcome: "DENIED",
        };
    }

    return {
        kind: "SUCCESS",
        countsAsFailure: false,
        clearsFailures: true,
        keyScope: "account-and-ip",
        reason: "authenticated",
        auditOutcome: "SUCCESS",
    };
}

/**
 * Applies a verdict from `classifyAuthFailure` to the counters.
 *
 * This is the ONLY place an authentication attempt is allowed to change a
 * counter. The infrastructure branch is the important one: it writes an audit
 * record for visibility but does not read, increment or clear anything, so an
 * outage can never consume a user's budget.
 */
export async function registerAuthVerdict(params: {
    verdict: AuthOutcomeVerdict;
    pairKey: string;
    accountKey: string;
    policy: RateLimitPolicy;
    email: string | null;
    ip: string | null;
}): Promise<void> {
    const { verdict, pairKey, accountKey, policy, email, ip } = params;

    const keys: string[] =
        verdict.keyScope === "account-and-ip"
            ? [pairKey, accountKey]
            : verdict.keyScope === "ip-only"
              ? [pairKey]
              : [];

    if (verdict.clearsFailures) {
        for (const key of keys) recordSuccess(key);
        return;
    }

    if (!verdict.countsAsFailure) {
        await logSecurityEvent({
            action: SECURITY_ACTION.AUTH_FAILURE,
            actorEmail: email,
            target: `auth:${pairKey}`,
            outcome: verdict.auditOutcome,
            ipAddress: ip,
            detail: {
                reason: verdict.reason,
                kind: verdict.kind,
                counted: false,
                note: "infrastructure failure; credential budget untouched",
            },
        });
        return;
    }

    for (const key of keys) {
        await registerAuthOutcome({ key, policy, email, ip, success: false, reason: verdict.reason });
    }
}

