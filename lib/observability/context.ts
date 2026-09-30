/**
 * Request-scoped context.
 *
 * SERVER ONLY. Imports `node:async_hooks`, which does not exist in a browser.
 * `client-report.ts` is the isomorphic counterpart for `"use client"` files.
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * The correlation id has to appear on BOTH the error report and the ordinary
 * request log for the same request, or it is not a correlation id - it is
 * decoration. Threading it through every function signature to reach a `catch`
 * that is three frames below the handler is not an option: no one maintains
 * that, and the call sites that forget are exactly the deep ones.
 *
 * `AsyncLocalStorage` carries it through the async call graph automatically,
 * including across `await` boundaries and into Prisma's callbacks, with no
 * signature change anywhere.
 *
 * WHY IT IS NOT WIRED YET
 * -----------------------
 * The one place that would install it per request is `proxy.ts` (Next.js
 * middleware), which is owned by another change in this repository and outside
 * this task's file ownership. Until that lands, `getCorrelationId()` mints a
 * FRESH id per call and `reportError` writes that same id into the envelope, so
 * an error record and the request log emitted inside the same `reportError`
 * call still share it. See `docs/audit/OPS_OBSERVABILITY.md` for the exact
 * one-line middleware change and why it is not made here.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { newCorrelationId } from "./correlation";

export interface RequestContext {
    correlationId: string;
    /** Route path, e.g. `/api/employees`. Never a full URL with query string. */
    route?: string | null;
    method?: string | null;
    /** The authenticated user's id. NEVER their email. See report.ts. */
    userId?: string | null;
    userRole?: string | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Runs `fn` with `context` visible to everything it awaits, transitively. */
export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
    return storage.run(context, fn);
}

/** The ambient context, or `undefined` outside a `runWithRequestContext` scope. */
export function getRequestContext(): RequestContext | undefined {
    return storage.getStore();
}

/**
 * The ambient correlation id, or a newly minted one.
 *
 * Deliberately never returns `undefined` and never returns a shared constant:
 * a report that has no id cannot be joined to a request, so a fresh id is
 * always better than a blank field.
 */
export function getCorrelationId(): string {
    return storage.getStore()?.correlationId ?? newCorrelationId();
}
