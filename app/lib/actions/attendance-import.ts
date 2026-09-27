"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, AuthenticationError, AuthorizationError } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logSecurityEvent, SECURITY_ACTION } from "@/lib/auth/audit";
import {
    runAttendanceImport,
    parseCsvContent,
    validateFile,
    type ImportResult,
    type ParsedPunchRecord,
} from "@/lib/attendance/import";

/**
 * Secured wrapper around the shared attendance-import core.
 *
 * A `"use server"` export is directly invocable by any client, so this action
 * is a first-class attack surface and enforces its own authorization. It
 * previously did an inline `["ADMIN","HR"]` check and answered a permission
 * failure with `success: false` — indistinguishable to the caller from bad
 * data. It now goes through the centralized guard.
 *
 * The page (`app/attendance/machine-integration/page.tsx`) imports
 * `parseCsvContent` and `importAttendanceFromCsv` and is unchanged.
 */

export type { ImportResult, ParsedPunchRecord };
export { parseCsvContent };

function denied(message: string): ImportResult {
    return { success: false, totalRows: 0, imported: 0, skipped: 0, duplicates: 0, errors: [{ row: 0, message }] };
}

export async function importAttendanceFromCsv(formData: FormData): Promise<ImportResult> {
    let actorEmail = "unknown";
    let actorRole = "unknown";

    try {
        // Centralized guard: re-reads the role from the database, so a stale JWT
        // cannot grant authority after a demotion.
        const user = await requirePermission(PERMISSIONS.ATTENDANCE_IMPORT);
        actorEmail = user.email;
        actorRole = user.role;

        const file = formData.get("file");
        if (!(file instanceof File)) {
            return denied("No file provided");
        }

        const fileError = validateFile(file);
        if (fileError) {
            return denied(fileError);
        }

        const content = await file.text();
        const result = await runAttendanceImport({
            content,
            fileName: file.name,
            actor: {
                userId: user.id,
                email: user.email,
                role: user.role,
                employeeId: user.employeeId,
                department: user.department,
            },
        });

        await logSecurityEvent({
            action: result.success ? SECURITY_ACTION.ATTENDANCE_IMPORT : SECURITY_ACTION.ATTENDANCE_IMPORT_DENIED,
            actorEmail,
            actorRole,
            outcome: result.success ? "SUCCESS" : "ERROR",
            requestPath: "/attendance/machine-integration",
            requestMethod: "SERVER_ACTION",
            detail: {
                fileName: file.name,
                totalRows: result.totalRows,
                imported: result.imported,
                duplicates: result.duplicates,
                skipped: result.skipped,
            },
        });

        if (result.success) {
            revalidatePath("/attendance");
            revalidatePath("/attendance/machine-integration");
        }

        return result;
    } catch (error) {
        if (error instanceof AuthenticationError) {
            await logSecurityEvent({
                action: SECURITY_ACTION.ATTENDANCE_IMPORT_DENIED,
                actorEmail,
                outcome: "DENIED",
                requestPath: "/attendance/machine-integration",
                requestMethod: "SERVER_ACTION",
                detail: { reason: "unauthenticated" },
            });
            return denied("Authentication required");
        }
        if (error instanceof AuthorizationError) {
            await logSecurityEvent({
                action: SECURITY_ACTION.ATTENDANCE_IMPORT_DENIED,
                actorEmail,
                outcome: "DENIED",
                requestPath: "/attendance/machine-integration",
                requestMethod: "SERVER_ACTION",
                detail: { reason: (error instanceof Error ? error.message : "Unknown error") },
            });
            return denied("You do not have permission to import attendance");
        }

        await logSecurityEvent({
            action: SECURITY_ACTION.ATTENDANCE_IMPORT,
            actorEmail,
            actorRole,
            outcome: "ERROR",
            requestPath: "/attendance/machine-integration",
            requestMethod: "SERVER_ACTION",
            detail: { message: error instanceof Error ? (error instanceof Error ? error.message : "Unknown error") : "unknown" },
        });
        return denied("Import failed");
    }
}
