"use server";

/**
 * Onboarding server actions (P1.1).
 *
 * A `"use server"` file may only export async functions, so these are thin
 * wrappers over `lib/workflow/onboarding.ts` — the single implementation.
 *
 * The employee record itself is created by `upsertEmployee`; nothing here
 * duplicates that logic.
 */

import { revalidatePath } from "next/cache";
import {
    ensureChecklist as ensureCore,
    updateChecklistItem as updateCore,
    assignAssets as assignCore,
    notifyManagerOfNewHire as notifyCore,
    getOnboardingSummary as summaryCore,
    DEFAULT_ONBOARDING_CHECKLIST,
} from "@/lib/workflow/onboarding";
import { requireUser } from "@/lib/auth/guards";

export async function initialiseOnboardingChecklist(employeeId: string): Promise<{
    success: boolean;
    message: string;
    created?: number;
}> {
    try {
        const user = await requireUser();
        const result = await ensureCore(employeeId, DEFAULT_ONBOARDING_CHECKLIST);
        revalidatePath("/employees");
        return {
            success: true,
            message:
                result.created > 0
                    ? `Checklist created (${result.created} item(s)).`
                    : "Checklist already in place.",
            created: result.created,
        };
    } catch (error) {
        console.error("[INITIALISE_ONBOARDING_FAILED]", error);
        return { success: false, message: "Could not create the onboarding checklist." };
    }
}

export async function advanceOnboardingItem(params: {
    itemId: string;
    to: string;
    documentRef?: string;
    notes?: string;
}): Promise<{ success: boolean; message: string }> {
    try {
        const user = await requireUser();
        const result = await updateCore({
            itemId: params.itemId,
            to: params.to,
            documentRef: params.documentRef ?? null,
            notes: params.notes ?? null,
            actor: { id: user.id, email: user.email, role: user.role },
        });
        if (result.success) revalidatePath("/employees");
        return result;
    } catch (error) {
        console.error("[ADVANCE_ONBOARDING_ITEM_FAILED]", error);
        return { success: false, message: "Could not update the checklist item." };
    }
}

export async function issueAssets(params: {
    employeeId: string;
    assetIds: string[];
}): Promise<{ success: boolean; message: string }> {
    try {
        const user = await requireUser();
        const result = await assignCore({
            employeeId: params.employeeId,
            assetIds: params.assetIds,
            actor: { id: user.id, email: user.email, role: user.role },
        });
        if (result.success) revalidatePath("/employees");
        return { success: result.success, message: result.message };
    } catch (error) {
        console.error("[ISSUE_ASSETS_FAILED]", error);
        return { success: false, message: "Could not assign the assets." };
    }
}

export async function alertManagerOfHire(employeeId: string): Promise<{ success: boolean; message: string }> {
    try {
        const user = await requireUser();
        await notifyCore({ employeeId, actorEmail: user.email });
        revalidatePath("/employees");
        return { success: true, message: "Manager notified." };
    } catch (error) {
        console.error("[ALERT_MANAGER_FAILED]", error);
        return { success: false, message: "Could not notify the manager." };
    }
}

export async function loadOnboardingSummary(employeeId: string) {
    return summaryCore(employeeId);
}
