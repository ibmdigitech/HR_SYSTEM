"use server";

/**
 * Service request actions — server-action wrappers.
 *
 * A `"use server"` file may only export async functions, so these are thin
 * wrappers rather than re-exports. An earlier attempt used
 * `export { x } from "..."` here, which passes `tsc` but FAILS the production
 * build with "Only async functions are allowed to be exported in a 'use server'
 * file" — a reminder that the build is the real gate, not the type checker.
 *
 * The implementation lives in `lib/workflow/service-requests.ts` and is shared
 * with `requests.ts`, so the two entry points cannot drift.
 *
 * `staff-requests.ts` previously held a SECOND `submitStaffRequest` with a
 * different signature that no page called. Two same-named exports with
 * different contracts is how the "Missing required fields" bug happened: the
 * form imported from here while a near-identical unused function sat beside it,
 * both reading field names the form did not post.
 */

import {
    submitStaffRequest as submitCore,
    submitStaffRequestForm as submitFormCore,
    handleRequestAction as handleCore,
    getAvailableRequestActions as availableCore,
    type RequestActionResult,
} from "@/lib/workflow/service-requests";

export async function submitStaffRequest(
    prevState: unknown,
    formData: FormData
): Promise<RequestActionResult> {
    return submitCore(prevState, formData);
}

/**
 * Form-action variant for server components: `<form action={...}>` requires
 * `(formData) => void`. Delegates to the same core and surfaces failure via
 * redirect so an error is never silently swallowed.
 */
export async function submitStaffRequestForm(formData: FormData): Promise<void> {
    return submitFormCore(formData);
}

export async function handleRequestAction(
    requestId: string,
    action: "APPROVED" | "REJECTED" | "COMPLETED",
    hrNote?: string
): Promise<RequestActionResult> {
    return handleCore(requestId, action, hrNote);
}

export async function getAvailableRequestActions(requestId: string): Promise<string[]> {
    return availableCore(requestId);
}

/**
 * Deprecated alias for `handleRequestAction`, retained because
 * `app/dashboard/approvals/page.tsx` imports this name. It is the SAME
 * function, not a second implementation, so the two cannot drift.
 */
export async function approveStaffRequest(
    requestId: string,
    action: "APPROVED" | "REJECTED" | "COMPLETED",
    hrNote?: string
): Promise<RequestActionResult> {
    return handleCore(requestId, action, hrNote);
}
