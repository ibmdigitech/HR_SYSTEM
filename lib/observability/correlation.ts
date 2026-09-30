/**
 * Correlation ids.
 *
 * WHAT THIS IS FOR
 * ----------------
 * An operator reading a log aggregator needs to answer "which request produced
 * this error?" without guessing. A correlation id is that join key: it is
 * emitted on the error report AND on the ordinary request log for the same
 * request, so one grep moves between them.
 *
 * WHY IT IS OWNED HERE AND NOT BY A LIBRARY
 * -----------------------------------------
 * `uuid` is already a dependency, but pulling it in for 32 hex characters would
 * make the most basic module of the observability layer the heaviest one. Node
 * 20 and every evergreen browser expose `crypto.randomUUID()` on `globalThis`,
 * so no import is required at all - which also keeps this file usable from a
 * `"use client"` error boundary, where `node:crypto` would break the bundle.
 *
 * UNTRUSTED INPUT
 * ---------------
 * `normaliseCorrelationId` exists because the id can be accepted from outside
 * the process (an inbound `x-correlation-id` header). An attacker-controlled
 * string written verbatim into a JSON log line is a log-injection and
 * log-forging vector: newlines can fake an entire second log record. So an
 * inbound value is accepted ONLY if it is exactly 32 lowercase hex characters,
 * and is otherwise discarded in favour of a freshly minted id.
 */

/** Header a caller may use to supply their own id. Lower-case: HTTP is a no-op. */
export const CORRELATION_HEADER = "x-correlation-id";

/**
 * 32 lowercase hex characters, no dashes.
 *
 * Fixed width on purpose: the normaliser is an exact-match test, not a search,
 * so there is no way to smuggle a longer or padded value through it.
 */
export const CORRELATION_ID_PATTERN = /^[0-9a-f]{32}$/;

/**
 * Returns a new correlation id as 32 lowercase hex characters.
 *
 * `globalThis.crypto.randomUUID()` is the CSPRNG path and is present on Node
 * >= 19 and on any secure context in a browser. The `Math.random` fallback
 * exists only so a plain-HTTP, non-secure-context browser and an ancient
 * runtime cannot make the whole observability layer throw. It is NOT
 * unpredictable, which is why the returned value is never used as a token; it
 * is a join key.
 */
export function newCorrelationId(): string {
    const webcrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (webcrypto && typeof webcrypto.randomUUID === "function") {
        return webcrypto.randomUUID().replace(/-/g, "");
    }
    let out = "";
    for (let i = 0; i < 32; i++) {
        out += Math.floor(Math.random() * 16).toString(16);
    }
    return out;
}

/**
 * Accepts a correlation id only if it is well-formed; otherwise `null`.
 *
 * Callers turn `null` into `newCorrelationId()`. A rejected inbound value is
 * never forwarded, so nothing outside the process controls the bytes that
 * reach the log.
 */
export function normaliseCorrelationId(value: unknown): string | null {
    if (typeof value !== "string") return null;
    if (!CORRELATION_ID_PATTERN.test(value)) return null;
    return value;
}

/** The id to use for a request: the inbound one if valid, a new one otherwise. */
export function resolveCorrelationId(inbound: unknown): string {
    return normaliseCorrelationId(inbound) ?? newCorrelationId();
}
