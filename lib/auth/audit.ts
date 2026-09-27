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

/** Strips secrets and truncates long values so nothing sensitive is persisted. */
export function redact(input: unknown, depth = 0): unknown {
    if (input === null || input === undefined) return input;
    if (typeof input === "string") {
        return input.length > MAX_VALUE_LENGTH ? `${input.slice(0, MAX_VALUE_LENGTH)}...[truncated]` : input;
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
