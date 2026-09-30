/**
 * Error taxonomy.
 *
 * WHY A TAXONOMY
 * --------------
 * "Something threw" is not an alert. An operator receiving a stream of
 * unstructured `console.error` output cannot tell a unique-constraint violation
 * (a bug in a form, fix it) from a dropped database connection (an outage, page
 * someone) from a failed `fetch` to an OAuth provider (a config problem). They
 * all render as "Error: ...".
 *
 * `classifyError` turns an arbitrary thrown value into a small, closed set of
 * kinds, plus two operational booleans:
 *
 *   - `retryable`  should a human be woken for this? A rate limit is not an
 *                  incident. A dropped connection is.
 *   - `fatal`      does this indicate the process is unfit to serve?
 *
 * DESIGN CONSTRAINTS
 * ------------------
 * 1. NO IMPORTS. This module deliberately does not `import` the Prisma client,
 *    `next`, or `next-auth`. It is reached from client error boundaries, from
 *    API routes and from tests, and pulling `@prisma/client` into any of those
 *    is how a server-only dependency ends up in a browser bundle.
 *
 *    So Prisma is detected STRUCTURALLY: by `name` prefix (`PrismaClient*`) and
 *    by the stable `code` property (`P2002` and friends), which is part of
 *    Prisma's public error contract and is not generated per-project.
 *
 * 2. DETECTION MUST NOT THROW. A classifier that throws turns a caught error
 *    into a new, different, uncaught error. Every branch here is total.
 *
 * 3. `code` is untrusted input. It is read as `unknown` and matched against
 *    literals; nothing is `eval`ed, coerced or concatenated into SQL.
 */

/** The closed set of kinds. Adding a member is a deliberate act. */
export const ERROR_KIND = {
    /** Could not be classified. The default, and the honest one. */
    UNKNOWN: "UNKNOWN",
    /** No valid session. Expected during normal operation, not an incident. */
    AUTHENTICATION: "AUTHENTICATION",
    /** Authenticated but not permitted. Expected; a 403 is a policy outcome. */
    AUTHORIZATION: "AUTHORIZATION",
    /** Bad input. A client bug or a hostile request, never a server fault. */
    VALIDATION: "VALIDATION",
    /** The requested record does not exist (Prisma P2025, Next 404). */
    NOT_FOUND: "NOT_FOUND",
    /** Uniqueness or concurrency conflict (Prisma P2002, P2034). */
    CONFLICT: "CONFLICT",
    /** Throttled. Expected and self-healing; never page on it. */
    RATE_LIMIT: "RATE_LIMIT",
    /** The database could not be reached, or refused the operation. */
    DATABASE: "DATABASE",
    /** A third-party API (OAuth, WPS, an email relay) failed. */
    EXTERNAL_SERVICE: "EXTERNAL_SERVICE",
    /** A deadline expired. `ETIMEDOUT`, `AbortError`, Prisma P1008. */
    TIMEOUT: "TIMEOUT",
    /** DNS, TLS, socket. `ECONNREFUSED`, `ENOTFOUND`, `ECONNRESET`. */
    NETWORK: "NETWORK",
    /** The deployment is misconfigured (missing env var, bad credentials). */
    CONFIGURATION: "CONFIGURATION",
    /** A fault in this codebase with no more specific classification. */
    INTERNAL: "INTERNAL",
} as const;

export type ErrorKind = (typeof ERROR_KIND)[keyof typeof ERROR_KIND];

export interface ErrorClassification {
    kind: ErrorKind;
    /**
     * Kinds that describe a fault in a DEPENDENCY rather than a request. A
     * monitor watching `retryable` can page on those and ignore the rest.
     */
    retryable: boolean;
    /**
     * The process is unfit to serve and should be replaced/restarted. True
     * only for database and configuration faults; an unhandled `TypeError` is
     * a bug to fix, not a reason to recycle the instance.
     */
    fatal: boolean;
    /** The stable machine code behind the classification, e.g. `P2002`. */
    code: string | null;
}

/**
 * Kinds that are a NORMAL, EXPECTED outcome of a hostile or unauthorised
 * request. A 401 and a 403 are security controls working. They are reported
 * (so they are searchable) but marked non-retryable so nobody is paged for a
 * password guess.
 */
const EXPECTED_KINDS: ReadonlySet<ErrorKind> = new Set<ErrorKind>([
    ERROR_KIND.AUTHENTICATION,
    ERROR_KIND.AUTHORIZATION,
    ERROR_KIND.VALIDATION,
    ERROR_KIND.NOT_FOUND,
    ERROR_KIND.CONFLICT,
    ERROR_KIND.RATE_LIMIT,
]);

/** Dependency-side faults. These are what an on-call rotation cares about. */
const RETRYABLE_KINDS: ReadonlySet<ErrorKind> = new Set<ErrorKind>([
    ERROR_KIND.DATABASE,
    ERROR_KIND.EXTERNAL_SERVICE,
    ERROR_KIND.TIMEOUT,
    ERROR_KIND.NETWORK,
]);

/** Misconfiguration and lost database make the instance unfit to serve. */
const FATAL_KINDS: ReadonlySet<ErrorKind> = new Set<ErrorKind>([
    ERROR_KIND.DATABASE,
    ERROR_KIND.CONFIGURATION,
]);

/**
 * Prisma error code -> kind.
 *
 * These are Prisma's documented `KnownRequestError` codes, which are a stable
 * public contract across v4/v5/v6. Only the ones that change what an operator
 * should DO are mapped; anything absent falls through to a name-based rule.
 */
const PRISMA_CODES: Readonly<Record<string, ErrorKind>> = {
    // Record already exists.
    P2002: ERROR_KIND.CONFLICT,
    // Foreign key constraint failed.
    P2003: ERROR_KIND.VALIDATION,
    // A constraint failed on the database (CHECK / NOT NULL / FK).
    P2004: ERROR_KIND.VALIDATION,
    // The value is outside the range the column allows.
    P2005: ERROR_KIND.VALIDATION,
    // Required value is missing.
    P2011: ERROR_KIND.VALIDATION,
    // The record the operation required does not exist.
    P2025: ERROR_KIND.NOT_FOUND,
    // The record is required but not connected.
    P2014: ERROR_KIND.VALIDATION,
    // Write or read failed. Also the code for a failed raw query.
    P2010: ERROR_KIND.DATABASE,
    // Transaction conflict / deadlock: retry the whole transaction.
    P2034: ERROR_KIND.CONFLICT,
    // The database is not reachable at all.
    P1000: ERROR_KIND.CONFIGURATION,
    P1001: ERROR_KIND.DATABASE,
    // Connection refused / host unreachable.
    P1002: ERROR_KIND.NETWORK,
    // The database server asked for a password it was not given.
    P1003: ERROR_KIND.CONFIGURATION,
    // Connection pool exhausted: the app is leaking connections.
    P1008: ERROR_KIND.DATABASE,
    P1010: ERROR_KIND.CONFIGURATION,
    P1011: ERROR_KIND.NETWORK,
    P1017: ERROR_KIND.NETWORK,
    // A migration has not been applied.
    P3005: ERROR_KIND.CONFIGURATION,
    P3006: ERROR_KIND.CONFIGURATION,
    // Schema is out of sync with the client.
    P5009: ERROR_KIND.CONFIGURATION,
};

/** `error.name` (or constructor name) -> kind, for our own error classes. */
const NAME_KINDS: Readonly<Record<string, ErrorKind>> = {
    AuthenticationError: ERROR_KIND.AUTHENTICATION,
    AuthorizationError: ERROR_KIND.AUTHORIZATION,
    ZodError: ERROR_KIND.VALIDATION,
    PrismaClientKnownRequestError: ERROR_KIND.DATABASE,
    PrismaClientUnknownRequestError: ERROR_KIND.DATABASE,
    PrismaClientRustPanicError: ERROR_KIND.INTERNAL,
    PrismaClientInitializationError: ERROR_KIND.CONFIGURATION,
    PrismaClientValidationError: ERROR_KIND.VALIDATION,
    CredentialsSignin: ERROR_KIND.AUTHENTICATION,
    JWT: ERROR_KIND.AUTHENTICATION,
    CallbackRouteError: ERROR_KIND.AUTHENTICATION,
    AccessDenied: ERROR_KIND.AUTHORIZATION,
    TypeError: ERROR_KIND.INTERNAL,
    ReferenceError: ERROR_KIND.INTERNAL,
    RangeError: ERROR_KIND.INTERNAL,
    SyntaxError: ERROR_KIND.INTERNAL,
    URIError: ERROR_KIND.VALIDATION,
    /**
     * A bare `Error` is the definition of INTERNAL: a fault in this codebase
     * with nothing more specific to say. Leaving it UNKNOWN would make the
     * most common real failure the one kind an operator cannot act on.
     */
    Error: ERROR_KIND.INTERNAL,
};

/** Node/libuv socket error codes -> kind. */
const SYSCALL_KINDS: Readonly<Record<string, ErrorKind>> = {
    ECONNREFUSED: ERROR_KIND.NETWORK,
    ECONNRESET: ERROR_KIND.NETWORK,
    ENOTFOUND: ERROR_KIND.NETWORK,
    EAI_AGAIN: ERROR_KIND.NETWORK,
    EHOSTUNREACH: ERROR_KIND.NETWORK,
    ENETUNREACH: ERROR_KIND.NETWORK,
    EPIPE: ERROR_KIND.NETWORK,
    ETIMEDOUT: ERROR_KIND.TIMEOUT,
    EPROTO: ERROR_KIND.NETWORK,
    CERT_HAS_EXPIRED: ERROR_KIND.CONFIGURATION,
    DEPTH_ZERO_SELF_SIGNED_CERT: ERROR_KIND.CONFIGURATION,
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: ERROR_KIND.CONFIGURATION,
};

/**
 * Next.js server-render digests.
 *
 * `NEXT_REDIRECT` is the *success* path for `redirect()`; Next.js throws it and
 * catches it internally. Treating it as an error is how a log gets filled with
 * thousands of identical "errors" per day.
 */
const DIGEST_KINDS: Readonly<Record<string, ErrorKind | null>> = {
    NEXT_REDIRECT: null,
    NEXT_NOT_FOUND: ERROR_KIND.NOT_FOUND,
    NEXT_HTTP_ERROR_FALLBACK: ERROR_KIND.INTERNAL,
};

/** Reads a property without letting a hostile getter throw. */
function safeGet(target: unknown, key: string): unknown {
    if (target === null || (typeof target !== "object" && typeof target !== "function")) return undefined;
    try {
        return (target as Record<string, unknown>)[key];
    } catch {
        return undefined;
    }
}

function asString(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
}

function finish(kind: ErrorKind, code: string | null): ErrorClassification {
    return {
        kind,
        retryable: RETRYABLE_KINDS.has(kind) && !EXPECTED_KINDS.has(kind),
        fatal: FATAL_KINDS.has(kind),
        code,
    };
}

/**
 * Classifies a thrown value. Total: it never throws, for any input.
 *
 * Order matters. Next.js digests and the HTTP status are checked before the
 * class name, because a `redirect()` surfacing as a `TypeError`-shaped object
 * must be classified as what it is, not as a bug.
 */
export function classifyError(error: unknown): ErrorClassification {
    if (error === null || error === undefined) {
        return finish(ERROR_KIND.UNKNOWN, null);
    }

    // 1. Next.js server-render digest. Present on every error that crossed the
    //    server/client boundary.
    const digest = asString(safeGet(error, "digest"));
    if (digest && digest in DIGEST_KINDS) {
        const kind = DIGEST_KINDS[digest];
        // `NEXT_REDIRECT` is a null kind: a successful navigation, not a fault.
        // Everything else resolves here, so a digest never falls through to the
        // generic branches and loses the classification it arrived with.
        if (kind === null) return finish(ERROR_KIND.NOT_FOUND, digest);
        return finish(kind, digest);
    }

    // 2. Our own typed errors carry an explicit `kind`. Honour it first so a
    //    caller can always override the heuristic.
    const explicit = asString(safeGet(error, "kind"));
    if (explicit && explicit in ERROR_KIND) {
        return finish(explicit as ErrorKind, null);
    }

    // 3. A bare HTTP status (`{ status: 403 }`), as thrown by route handlers.
    const status = safeGet(error, "status");
    if (typeof status === "number" && status >= 400 && status <= 599) {
        return finish(kindFromHttpStatus(status), null);
    }

    // 4. Prisma: `code` is a `P`-prefixed string. Checked before the name
    //    because `PrismaClientKnownRequestError` covers a dozen very different
    //    faults and the code is what distinguishes them.
    const code = asString(safeGet(error, "code"));
    if (code && /^P\d{4}$/.test(code) && code in PRISMA_CODES) {
        return finish(PRISMA_CODES[code], code);
    }
    if (code && /^P\d{4}$/.test(code)) {
        return finish(ERROR_KIND.DATABASE, code);
    }

    // 5. Node socket-level codes, on `code` or `errno`. `syscall` alone is not
    //    enough to identify a fault, so the error code is what is matched.
    const syscallCode = asString(safeGet(error, "code")) ?? null;
    const bySyscall = syscallCode && syscallCode in SYSCALL_KINDS ? SYSCALL_KINDS[syscallCode] : null;
    const byName = nameOf(error);

    if (byName === "AbortError") return finish(ERROR_KIND.TIMEOUT, null);
    if (bySyscall) return finish(bySyscall, syscallCode);

    // 6. `fetch` and undici failures carry a `cause`, and the outer error is
    //    always a generic `Error: fetch failed`. Consulted BEFORE the class
    //    name, because classifying that as an internal bug when the real cause
    //    is a refused socket is exactly the misdiagnosis this layer exists to
    //    prevent. A cause that only yields UNKNOWN/INTERNAL adds nothing, so it
    //    is ignored and the outer error is classified normally.
    const cause = safeGet(error, "cause");
    if (cause && cause !== error) {
        const nested = classifyError(cause);
        if (nested.kind !== ERROR_KIND.UNKNOWN && nested.kind !== ERROR_KIND.INTERNAL) {
            return { ...nested, code: nested.code ?? code };
        }
    }

    // 7. Class name.
    if (byName && byName in NAME_KINDS) {
        return finish(NAME_KINDS[byName], null);
    }
    if (byName && byName.startsWith("PrismaClient")) {
        return finish(ERROR_KIND.DATABASE, null);
    }

    return finish(ERROR_KIND.UNKNOWN, null);
}

function nameOf(error: unknown): string | null {
    const direct = asString(safeGet(error, "name"));
    if (direct) return direct;
    if (error instanceof Error) return error.constructor?.name ?? null;
    return null;
}

/** Maps an HTTP status to the kind an operator should reason about. */
export function kindFromHttpStatus(status: number): ErrorKind {
    if (status === 401) return ERROR_KIND.AUTHENTICATION;
    if (status === 403) return ERROR_KIND.AUTHORIZATION;
    if (status === 404 || status === 410) return ERROR_KIND.NOT_FOUND;
    if (status === 409) return ERROR_KIND.CONFLICT;
    if (status === 422 || status === 400) return ERROR_KIND.VALIDATION;
    if (status === 429) return ERROR_KIND.RATE_LIMIT;
    if (status === 502 || status === 503 || status === 504) return ERROR_KIND.EXTERNAL_SERVICE;
    if (status === 408) return ERROR_KIND.TIMEOUT;
    if (status >= 500) return ERROR_KIND.INTERNAL;
    return ERROR_KIND.UNKNOWN;
}

/**
 * A typed error that carries its own classification.
 *
 * Use this when a `throw` would otherwise be a bare string or a generic
 * `Error`: the classification survives, and the message can be written once
 * with a placeholder instead of a formatted secret.
 */
export class AppError extends Error {
    readonly kind: ErrorKind;
    readonly code: string | null;
    readonly context: Record<string, unknown>;

    constructor(
        kind: ErrorKind,
        message: string,
        options: { code?: string | null; context?: Record<string, unknown> } = {}
    ) {
        super(message);
        this.name = "AppError";
        this.kind = kind;
        this.code = options.code ?? null;
        this.context = options.context ?? {};
    }
}
