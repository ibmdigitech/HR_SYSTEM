"use server";

/**
 * General request actions — server-action wrappers.
 *
 * The implementation lives in `lib/workflow/service-requests.ts`, shared with
 * `staff-requests.ts` so the two entry points cannot diverge.
 *
 * This file previously held the original `submitStaffRequest`, which read
 * `formData.get("categoryId")` while the form posted `name="typeId"`. That
 * mismatch is the reported "Missing required fields" error: the value was
 * always null, so no request was ever created.
 *
 * Wrappers rather than re-exports because a `"use server"` file may only
 * export async functions — `export { x } from "..."` passes `tsc` but fails
 * the production build.
 */

import {
    submitStaffRequest as submitCore,
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
 * Form-action variant for server components (`<form action={...}>` requires
 * `(formData) => void`). Delegates to the same core and surfaces failure via
 * redirect, so an error is never silently swallowed.
 */
export async function submitStaffRequestForm(formData: FormData): Promise<void> {
    const { submitStaffRequestForm: formCore } = await import("@/lib/workflow/service-requests");
    return formCore(formData);
}
