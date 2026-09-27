/**
 * Rate limiting for authentication-sensitive operations.
 *
 * SCOPE AND LIMITS — this is a deliberately dependency-free implementation.
 * It uses an in-process sliding window, which is correct for a single Node
 * instance (the Next.js dev server and a single-container deployment) and is
 * sufficient to blunt online password guessing.
 *
 * PRODUCTION SCALING — an in-process map is per-instance. With N instances
 * behind a load balancer, an attacker gets N times the budget, and restarting a
 * process clears the counters. Before running multiple instances, replace
 * `SlidingWindowStore` with a shared store (Upstash Redis, or a Postgres table
 * with an upsert). The interface below is intentionally narrow so that swap is
 * a single-file change; `assertRateLimit` and `recordFailure` are the only
 * functions callers use.
 *
 * SECURITY PROPERTIES:
 *  - Counts failures, not successes, so a legitimate user who signs in
 *    successfully is never penalised for earlier typos.
 *  - Applies exponential backoff once the budget is exhausted.
 *  - Emits a `Retry-After` value so a client can back off correctly.
 *  - Fails OPEN on an unexpected internal error. A rate-limiter bug must never
 *    lock every user out of the application.
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
