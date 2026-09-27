import { NextResponse, type NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { authorizePermission, getSessionUser } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logSecurityEvent, SECURITY_ACTION } from "@/lib/auth/audit";
import {
    runAttendanceImport,
    validateFile,
    MAX_FILE_BYTES,
    MAX_ROWS,
    DEVICE_ID,
} from "@/lib/attendance/import";
import {
    authenticateDevice,
    recordSync,
    DEVICE_KEY_HEADER,
} from "@/lib/workflow/devices";

/**
 * Device-authenticated attendance ingestion (P1.7 — FLOW-024).
 *
 * This endpoint is for BIOMETRIC TERMINALS, not for people. It authenticates
 * with a per-device API key in a header, entirely separate from any user
 * session. That is the fix for the audit finding that the import path relied
 * on a human login.
 *
 * Two credentials are accepted, and both are verified:
 *   - a device API key  → machine-to-machine ingestion
 *   - a user session    → manual CSV upload, as before
 *
 * The second is kept deliberately: an HR administrator uploading a CSV by hand
 * is legitimate, and removing it would break an existing working feature.
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
    const startedAt = Date.now();
    const deviceKey = request.headers.get(DEVICE_KEY_HEADER);

    // --- Machine path: device API key -------------------------------------
    if (deviceKey) {
        const device = await authenticateDevice(deviceKey);
        if (!device.ok) {
            return NextResponse.json({ error: device.reason }, { status: device.status });
        }

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
            const status = fileError.startsWith("File too large")
                ? 413
                : fileError.includes("Only CSV")
                  ? 415
                  : 400;
            await recordSync({
                deviceId: device.deviceId,
                fileName: file.name,
                totalRows: 0,
                imported: 0,
                duplicates: 0,
                rejected: 0,
                errorSummary: fileError,
            });
            return NextResponse.json({ error: fileError }, { status });
        }

        const result = await runAttendanceImport({
            content: await file.text(),
            fileName: file.name,
            // Device scope: all active employees the device serves.
            actor: {
                userId: `device:${device.deviceId}`,
                email: device.deviceIdentifier,
                role: "ADMIN",
                employeeId: null,
                department: null,
            },
        });

        await recordSync({
            deviceId: device.deviceId,
            fileName: file.name,
            totalRows: result.totalRows,
            imported: result.imported,
            duplicates: result.duplicates,
            rejected: result.errors.length,
            durationMs: Date.now() - startedAt,
        });

        await logSecurityEvent({
            action: SECURITY_ACTION.ATTENDANCE_IMPORT,
            actorEmail: device.deviceIdentifier,
            target: `attendanceDevice:${device.deviceId}`,
            outcome: result.success ? "SUCCESS" : "ERROR",
            requestPath: "/api/attendance/device-import",
            requestMethod: "POST",
            detail: {
                imported: result.imported,
                duplicates: result.duplicates,
                rejected: result.errors.length,
            },
        });

        return NextResponse.json(
            { ...result, device: device.name, limits: { maxBytes: MAX_FILE_BYTES, maxRows: MAX_ROWS } },
            { status: result.success ? 200 : 500 }
        );
    }

    // --- Human path: session + permission ---------------------------------
    const authResult = await authorizePermission(PERMISSIONS.ATTENDANCE_IMPORT);
    if (!authResult.ok) {
        await logSecurityEvent({
            action: SECURITY_ACTION.ATTENDANCE_IMPORT_DENIED,
            outcome: "DENIED",
            requestPath: "/api/attendance/device-import",
            requestMethod: "POST",
            detail: { status: authResult.status },
        });
        return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const actor = authResult.user;
    const subject = await prisma.user.findUnique({
        where: { id: actor.id },
        select: { employee: { select: { id: true, department: true } } },
    });

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
        const status = fileError.startsWith("File too large")
            ? 413
            : fileError.includes("Only CSV")
              ? 415
              : 400;
        return NextResponse.json({ error: fileError }, { status });
    }

    const result = await runAttendanceImport({
        content: await file.text(),
        fileName: file.name,
        actor: {
            userId: actor.id,
            email: actor.email,
            role: actor.role,
            employeeId: subject?.employee?.id ?? null,
            department: subject?.employee?.department ?? null,
        },
    });

    await logSecurityEvent({
        action: result.success ? SECURITY_ACTION.ATTENDANCE_IMPORT : SECURITY_ACTION.ATTENDANCE_IMPORT_DENIED,
        actorEmail: actor.email,
        actorRole: actor.role,
        outcome: result.success ? "SUCCESS" : "ERROR",
        requestPath: "/api/attendance/device-import",
        requestMethod: "POST",
        detail: { fileName: file.name, imported: result.imported, duplicates: result.duplicates },
    });

    return NextResponse.json(
        { ...result, source: "manual", limits: { maxBytes: MAX_FILE_BYTES, maxRows: MAX_ROWS } },
        { status: result.success ? 200 : 500 }
    );
}

export async function GET() {
    const session = await getSessionUser();
    return NextResponse.json({ error: "Method not allowed" }, { status: session.ok ? 405 : 401 });
}

export { DEVICE_ID };
