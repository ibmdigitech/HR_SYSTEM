/**
 * Security audit logging.
 *
 * The existing `AuditLog` model is scoped to an `employeeId`, which makes it
 * unusable for events that are not about a specific employee (a role change, a
 * failed sign-in, a denied request). Rather than migrating that model — the
 * brief forbids unnecessary schema churn — privileged events are written to a
 * dedicated, append-only security log table.
 *
 * NEVER log: passwords, password hashes, tokens, session cookies, secrets, or
 * OAuth credentials. `redact()` is applied to every value before it is stored.
 */

import prisma from "@/lib/prisma";

export const SECURITY_ACTION = {
    SEED_EXECUTED: "SEED_EXECUTED",
    SEED_DENIED: "SEED_DENIED",
    ATTENDANCE_IMPORT: "ATTENDANCE_IMPORT",
    ATTENDANCE_IMPORT_DENIED: "ATTENDANCE_IMPORT_DENIED",
    ROLE_CHANGED: "ROLE_CHANGED",
    ROLE_REQUEST_APPROVED: "ROLE_REQUEST_APPROVED",
    ROLE_REQUEST_REJECTED: "ROLE_REQUEST_REJECTED",
    USER_DISABLED: "USER_DISABLED",
    USER_ENABLED: "USER_ENABLED",
    PERMISSION_OVERRIDE_CHANGED: "PERMISSION_OVERRIDE_CHANGED",
    SESSION_TERMINATED: "SESSION_TERMINATED",
    ACCESS_DENIED: "ACCESS_DENIED",
    AUTH_FAILURE: "AUTH_FAILURE",
    LETTER_GENERATED: "LETTER_GENERATED",
    LETTER_APPROVED: "LETTER_APPROVED",
    LETTER_REJECTED: "LETTER_REJECTED",
} as const;

export type SecurityAction = (typeof SECURITY_ACTION)[keyof typeof SECURITY_ACTION];

const SENSITIVE_KEYS = new Set([
    "password",
    "newpassword",
    "currentpassword",
    "passwordhash",
    "token",
    "accesstoken",
    "refreshtoken",
    "sessiontoken",
    "cookie",
    "authorization",
    "secret",
    "authsecret",
    "clientsecret",
    "apikey",
    "databaseurl",
    "directurl",
    "connectionstring",
]);

/**
 * Normalises a key for comparison: lower-cased with separators removed, so
 * `refresh_token`, `refreshToken` and `REFRESH-TOKEN` all match the same entry.
 * Comparing the lower-cased key alone silently missed snake_case names.
 */
function normaliseKey(key: string): string {
    return key.toLowerCase().replace(/[\s_\-.]/g, "");
}

export const MAX_VALUE_LENGTH = 500;

/**
 * Key-based redaction is not sufficient on its own.
 *
 * `SENSITIVE_KEYS` only fires when a secret arrives under a recognisable KEY
 * (`password`, `token`, ...). It does nothing for a secret embedded in the
 * *text* of a value — and that is exactly how driver errors present. Prisma and
 * `pg` routinely put the full connection string in `error.message`:
 *
 *     "Can't reach database server at postgresql://hr_app:s3cr3t@db:5433/hr"
 *
 * Passing that through `redact()` unchanged writes the database password into
 * `SecurityAuditLog` and into stdout, where a log shipper will fan it out to
 * anyone with dashboard access. Key redaction cannot catch it, so every string
 * value is additionally scrubbed for credential-shaped patterns.
 */

/** `postgresql://user:secret@host:5433/db` -> `postgresql://***@host:5433/db` */
const CREDENTIALS_IN_URL = /([a-z][a-z0-9+.-]*:\/\/)[^/\s@]*@/gi;

/** `password=secret`, `PGPASSWORD=secret`, `pwd: secret` */
const CREDENTIALS_IN_KV = /\b(password|pgpassword|pwd|passwd|secret|token|api[_-]?key)\b\s*[=:]\s*("?)[^\s",;)]+\2/gi;

/** `Bearer eyJhbGci...` / `Basic dXNlcjpwYXNz` */
const AUTH_SCHEME = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g;

/**
 * Removes credential-shaped substrings from free text.
 *
 * Deliberately pattern-based rather than a "looks secret" heuristic: a heuristic
 * that redacts aggressively would destroy the diagnostic value of the log,
 * which is the only reason the log exists. These three shapes are the ones
 * that actually appear in driver and framework errors.
 */
export function scrubCredentials(text: string): string {
    return text
        .replace(CREDENTIALS_IN_URL, "$1***@")
        .replace(CREDENTIALS_IN_KV, "$1=$2***$2")
        .replace(AUTH_SCHEME, "$1 ***");
}

/** Strips secrets and truncates long values so nothing sensitive is persisted. */
export function redact(input: unknown, depth = 0): unknown {
    if (input === null || input === undefined) return input;
    if (typeof input === "string") {
        // Scrub BEFORE truncating: slicing first can cut a connection string in
        // half and leave the host half looking like a harmless value.
        const scrubbed = scrubCredentials(input);
        return scrubbed.length > MAX_VALUE_LENGTH ? `${scrubbed.slice(0, MAX_VALUE_LENGTH)}...[truncated]` : scrubbed;
    }
    if (typeof input === "number" || typeof input === "boolean") return input;
    if (depth > 4) return "[deep]";
    if (Array.isArray(input)) return input.slice(0, 50).map((v) => redact(v, depth + 1));
    if (input instanceof Date) return input.toISOString();
    if (typeof input === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
            if (SENSITIVE_KEYS.has(normaliseKey(k))) {
                out[k] = "[redacted]";
                continue;
            }
            out[k] = redact(v, depth + 1);
        }
        return out;
    }
    return "[unserialisable]";
}

export interface SecurityEventInput {
    action: SecurityAction;
    /** Who performed the action. Null for unauthenticated attempts. */
    actorEmail?: string | null;
    actorRole?: string | null;
    /** The record or capability the action targeted. */
    target?: string | null;
    outcome?: "SUCCESS" | "DENIED" | "ERROR";
    detail?: Record<string, unknown>;
    requestPath?: string | null;
    requestMethod?: string | null;
    ipAddress?: string | null;
}

/**
 * Appends a security event.
 *
 * Never throws: an audit-log failure must not turn a successful authorised
 * request into a 500. Failures are reported on the server console instead.
 */
export async function logSecurityEvent(event: SecurityEventInput): Promise<void> {
    try {
        await prisma.securityAuditLog.create({
            data: {
                action: event.action,
                actorEmail: event.actorEmail ?? null,
                actorRole: event.actorRole ?? null,
                target: event.target ? String(event.target).slice(0, MAX_VALUE_LENGTH) : null,
                outcome: event.outcome ?? "SUCCESS",
                detail: redact(event.detail ?? {}) as object,
                requestPath: event.requestPath ?? null,
                requestMethod: event.requestMethod ?? null,
                ipAddress: event.ipAddress ?? null,
            },
        });
    } catch (error) {
        console.error("[SECURITY_AUDIT_LOG_FAILED]", event.action, error);
    }
}
