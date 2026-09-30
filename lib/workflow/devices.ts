/**
 * Biometric device registry and credential management (P1.7 — FLOW-024/025).
 *
 * The audit found the import endpoint accepted uploads with only a human
 * session, and there was no device registry at all. Devices now authenticate
 * with a per-device API key presented in a header, separate from any user
 * session.
 *
 * SECURITY:
 *  - The API secret is shown ONCE at creation and stored only as a SHA-256
 *    hash. It is never retrievable afterwards, never logged, never in an
 *    audit entry.
 *  - A REVOKED device is refused even with a valid key.
 *  - Constant-time comparison via hash equality on a fixed-length digest.
 *  - Every import is recorded in `AttendanceSyncLog` for operator visibility
 *    without exposing any credential.
 */

import crypto from "node:crypto";
import prisma from "@/lib/prisma";
import { requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logSecurityEvent, SECURITY_ACTION } from "@/lib/auth/audit";

export const DEVICE_KEY_HEADER = "x-device-key";

export type DeviceStatus = "ACTIVE" | "DISABLED" | "REVOKED";

export interface DeviceCredential {
    deviceId: string;
    name: string;
    deviceIdentifier: string;
    /** Shown ONCE. Only the hash is persisted. */
    apiKey: string;
    keyPrefix: string;
}

/** Short, non-secret prefix so an operator can identify a key in a list. */
export function keyPrefix(apiKey: string): string {
    return apiKey.slice(0, 8);
}

function hashKey(apiKey: string): string {
    return crypto.createHash("sha256").update(apiKey).digest("hex");
}

/** Registers a device and returns its one-time API key. */
export async function registerDevice(params: {
    name: string;
    deviceIdentifier: string;
    location?: string;
    actor: { email: string; role: string };
}): Promise<{ success: boolean; message: string; credential?: DeviceCredential }> {
    try {
        await requirePermission(PERMISSIONS.ATTENDANCE_MACHINE);

        const identifier = params.deviceIdentifier.trim();
        if (identifier.length < 3) {
            return { success: false, message: "Device identifier is too short." };
        }
        if (!params.name.trim()) {
            return { success: false, message: "Device name is required." };
        }

        const existing = await prisma.attendanceDevice.findUnique({
            where: { deviceIdentifier: identifier },
            select: { id: true },
        });
        if (existing) {
            return { success: false, message: "A device with this identifier is already registered." };
        }

        const apiKey = `hrms_${crypto.randomBytes(32).toString("base64url")}`;

        const device = await prisma.$transaction(async (tx) => {
            const created = await tx.attendanceDevice.create({
                data: {
                    name: params.name.trim(),
                    deviceIdentifier: identifier,
                    location: params.location ?? null,
                    status: "ACTIVE",
                    apiKeyHash: hashKey(apiKey),
                    keyPrefix: keyPrefix(apiKey),
                    createdBy: params.actor.email,
                },
                select: { id: true, name: true, deviceIdentifier: true },
            });

            await tx.auditLog.create({
                data: {
                    // An attendance device is not an employee, and it is not
                    // owned by one either — it is a shared kiosk/terminal that
                    // many employees punch in on. There is no employee to
                    // attribute this to, so the column is NULL rather than a
                    // sentinel; see the note on `model AuditLog` in
                    // prisma/schema.prisma. The device is named in `details`
                    // and the actor is in `changedBy`.
                    employeeId: null,
                    action: "ATTENDANCE_DEVICE_REGISTERED",
                    details: `Device "${created.name}" (${created.deviceIdentifier}) registered`,
                    changedBy: params.actor.email,
                },
            });

            return created;
        });

        await logSecurityEvent({
            action: SECURITY_ACTION.ACCESS_DENIED,
            actorEmail: params.actor.email,
            actorRole: params.actor.role,
            target: `attendanceDevice:${device.id}`,
            outcome: "SUCCESS",
            detail: { change: "deviceRegistered", deviceIdentifier: device.deviceIdentifier },
        });

        return {
            success: true,
            message: "Device registered. Copy the API key now — it cannot be shown again.",
            credential: {
                deviceId: device.id,
                name: device.name,
                deviceIdentifier: device.deviceIdentifier,
                apiKey,
                keyPrefix: keyPrefix(apiKey),
            },
        };
    } catch (error) {
        console.error("[REGISTER_DEVICE_FAILED]", error);
        return { success: false, message: "Could not register the device." };
    }
}

export type DeviceAuthResult =
    | { ok: true; deviceId: string; deviceIdentifier: string; name: string }
    | { ok: false; status: 401 | 403; reason: string };

/**
 * Authenticates a device request.
 *
 * Distinguishes 401 (no/unknown key) from 403 (known key, device not active),
 * so an operator can tell a misconfigured device from a revoked one.
 */
export async function authenticateDevice(apiKey: string | null): Promise<DeviceAuthResult> {
    if (!apiKey || apiKey.length < 20) {
        return { ok: false, status: 401, reason: "Missing device credential" };
    }

    const device = await prisma.attendanceDevice.findUnique({
        where: { apiKeyHash: hashKey(apiKey) },
        select: { id: true, deviceIdentifier: true, name: true, status: true },
    });

    if (!device) {
        await logSecurityEvent({
            action: SECURITY_ACTION.ATTENDANCE_IMPORT_DENIED,
            outcome: "DENIED",
            target: "attendanceDevice:unknown",
            detail: { reason: "unknown device key" },
        });
        return { ok: false, status: 401, reason: "Unknown device credential" };
    }

    if (device.status !== "ACTIVE") {
        await logSecurityEvent({
            action: SECURITY_ACTION.ATTENDANCE_IMPORT_DENIED,
            actorEmail: device.deviceIdentifier,
            outcome: "DENIED",
            target: `attendanceDevice:${device.id}`,
            detail: { reason: `device ${device.status}` },
        });
        return { ok: false, status: 403, reason: `Device is ${device.status}` };
    }

    return {
        ok: true,
        deviceId: device.id,
        deviceIdentifier: device.deviceIdentifier,
        name: device.name,
    };
}

export async function setDeviceStatus(params: {
    deviceId: string;
    status: DeviceStatus;
    actor: { email: string; role: string };
}): Promise<{ success: boolean; message: string }> {
    try {
        await requirePermission(PERMISSIONS.ATTENDANCE_MACHINE);

        const device = await prisma.attendanceDevice.findUnique({
            where: { id: params.deviceId },
            select: { id: true, name: true, status: true },
        });
        if (!device) return { success: false, message: "Device not found." };

        await prisma.$transaction([
            prisma.attendanceDevice.update({
                where: { id: params.deviceId },
                data: {
                    status: params.status,
                    ...(params.status === "REVOKED" ? { revokedAt: new Date() } : {}),
                },
            }),
            prisma.auditLog.create({
                data: {
                    // Same reasoning as ATTENDANCE_DEVICE_REGISTERED: a device
                    // is not an employee. See `model AuditLog` in
                    // prisma/schema.prisma.
                    employeeId: null,
                    action: `ATTENDANCE_DEVICE_${params.status}`,
                    details: `Device "${device.name}" changed ${device.status} → ${params.status}`,
                    changedBy: params.actor.email,
                },
            }),
        ]);

        await logSecurityEvent({
            action: SECURITY_ACTION.ACCESS_DENIED,
            actorEmail: params.actor.email,
            actorRole: params.actor.role,
            target: `attendanceDevice:${params.deviceId}`,
            outcome: "SUCCESS",
            detail: { change: "deviceStatus", from: device.status, to: params.status },
        });

        return { success: true, message: `Device ${params.status.toLowerCase()}.` };
    } catch (error) {
        console.error("[SET_DEVICE_STATUS_FAILED]", error);
        return { success: false, message: "Could not update the device." };
    }
}

/** Records the outcome of an import for the sync dashboard. */
export async function recordSync(params: {
    deviceId: string;
    fileName?: string;
    totalRows: number;
    imported: number;
    duplicates: number;
    rejected: number;
    unknownEmployees?: number;
    durationMs?: number;
    errorSummary?: string;
}): Promise<void> {
    try {
        await prisma.$transaction([
            prisma.attendanceSyncLog.create({
                data: {
                    deviceId: params.deviceId,
                    fileName: params.fileName ?? null,
                    totalRows: params.totalRows,
                    imported: params.imported,
                    duplicates: params.duplicates,
                    rejected: params.rejected,
                    unknownEmployees: params.unknownEmployees ?? 0,
                    durationMs: params.durationMs ?? null,
                    errorSummary: params.errorSummary?.slice(0, 500) ?? null,
                },
            }),
            prisma.attendanceDevice.update({
                where: { id: params.deviceId },
                data: { lastSyncAt: new Date(), lastSyncRecords: params.imported },
            }),
        ]);
    } catch (error) {
        // Never let telemetry break the import.
        console.error("[RECORD_SYNC_FAILED]", error);
    }
}

/** Operational view. Exposes no credential material. */
export async function getSyncDashboard() {
    await requirePermission(PERMISSIONS.ATTENDANCE_MACHINE);

    const [devices, recentLogs] = await Promise.all([
        prisma.attendanceDevice.findMany({
            select: {
                id: true,
                name: true,
                deviceIdentifier: true,
                location: true,
                status: true,
                keyPrefix: true,
                lastSyncAt: true,
                lastSyncRecords: true,
                createdAt: true,
            },
            orderBy: { createdAt: "desc" },
        }),
        prisma.attendanceSyncLog.findMany({
            select: {
                id: true,
                deviceId: true,
                fileName: true,
                totalRows: true,
                imported: true,
                duplicates: true,
                rejected: true,
                unknownEmployees: true,
                durationMs: true,
                createdAt: true,
            },
            orderBy: { createdAt: "desc" },
            take: 25,
        }),
    ]);

    const totals = recentLogs.reduce(
        (acc, log) => ({
            received: acc.received + log.totalRows,
            accepted: acc.accepted + log.imported,
            rejected: acc.rejected + log.rejected,
            duplicates: acc.duplicates + log.duplicates,
        }),
        { received: 0, accepted: 0, rejected: 0, duplicates: 0 }
    );

    return { devices, recentLogs, totals };
}
