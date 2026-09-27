import { NextResponse, type NextRequest } from "next/server";
import { authorizePermission, getSessionUser } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logSecurityEvent, SECURITY_ACTION } from "@/lib/auth/audit";
import { runAttendanceImport, validateFile, MAX_FILE_BYTES, MAX_ROWS } from "@/lib/attendance/import";

/**
 * API-021 remediation.
 *
 * Correction to the original audit finding: this route was NOT fully
 * unauthenticated. It already returned 401 without a session, and the server
 * action it called performed an inline `["ADMIN","HR"]` role check. The real
 * defects were:
 *   - a missing permission was reported as HTTP 200 with `success: false`,
 *     so no caller could distinguish "forbidden" from "bad data";
 *   - there was no expressible attendance-import capability (only ADMIN/HR);
 *   - no transaction, so a mid-import failure left attendance and biometric
 *     rows partially written;
 *   - `emp.rollNumber.toLowerCase()` threw on a null rollNumber, aborting the
 *     whole import because of one bad employee row;
 *   - no organisational scope on which employees could be written.
 *
 * Both this route and the server action now delegate to the single
 * implementation in `lib/attendance/import.ts`, so they cannot diverge.
 */

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
    const authResult = await authorizePermission(PERMISSIONS.ATTENDANCE_IMPORT);
    if (!authResult.ok) {
        await logSecurityEvent({
            action: SECURITY_ACTION.ATTENDANCE_IMPORT_DENIED,
            outcome: "DENIED",
            requestPath: "/api/attendance/import",
            requestMethod: "POST",
            detail: { status: authResult.status, error: authResult.error },
        });
        return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const actor = authResult.user;

    try {
        let formData: FormData;
        try {
            formData = await request.formData();
        } catch {
            return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
        }

        const file = formData.get("file");
        if (!(file instanceof File)) {
            return NextResponse.json({ error: "No file provided" }, { status: 400 });
        }

        const fileError = validateFile(file);
        if (fileError) {
            const status = fileError.startsWith("File too large") ? 413 : fileError.includes("Only CSV") ? 415 : 400;
            return NextResponse.json({ error: fileError }, { status });
        }

        const content = await file.text();
        const result = await runAttendanceImport({
            content,
            fileName: file.name,
            actor: {
                userId: actor.id,
                email: actor.email,
                role: actor.role,
                employeeId: actor.employeeId,
                department: actor.department,
            },
        });

        await logSecurityEvent({
            action: result.success ? SECURITY_ACTION.ATTENDANCE_IMPORT : SECURITY_ACTION.ATTENDANCE_IMPORT_DENIED,
            actorEmail: actor.email,
            actorRole: actor.role,
            outcome: result.success ? "SUCCESS" : "ERROR",
            requestPath: "/api/attendance/import",
            requestMethod: "POST",
            detail: {
                fileName: file.name,
                totalRows: result.totalRows,
                imported: result.imported,
                duplicates: result.duplicates,
                skipped: result.skipped,
                rejected: result.errors.length,
            },
        });

        // A rolled-back import is a server-side failure, not a data error.
        const status = result.success ? 200 : 500;
        return NextResponse.json(
            { ...result, limits: { maxBytes: MAX_FILE_BYTES, maxRows: MAX_ROWS } },
            { status }
        );
    } catch (error) {
        await logSecurityEvent({
            action: SECURITY_ACTION.ATTENDANCE_IMPORT,
            actorEmail: actor.email,
            actorRole: actor.role,
            outcome: "ERROR",
            requestPath: "/api/attendance/import",
            requestMethod: "POST",
            detail: { message: error instanceof Error ? (error instanceof Error ? error.message : "Unknown error") : "unknown" },
        });
        return NextResponse.json({ error: "Import failed" }, { status: 500 });
    }
}

/** A GET on this path must never imply an import. */
export async function GET() {
    const session = await getSessionUser();
    return NextResponse.json({ error: "Method not allowed" }, { status: session.ok ? 405 : 401 });
}
