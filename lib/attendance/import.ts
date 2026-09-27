/**
 * Attendance import core.
 *
 * Shared by the server action (`app/lib/actions/attendance-import.ts`) and the
 * API route (`app/api/attendance/import/route.ts`) so that both entry points
 * enforce identical authorization and identical validation. A server action is
 * directly invocable by any client, so having two divergent implementations
 * would guarantee one of them is the weaker path.
 *
 * NOT a server-action file — this module must never be exported to the client.
 */

import prisma from "@/lib/prisma";
import { createHash } from "node:crypto";
import { PermissionOverrides, resolvePermissions, PERMISSIONS } from "@/lib/auth/permissions";
import type { Role } from "@/lib/auth/roles";

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export interface ParsedPunchRecord {
    rowNumber: number;
    /** Employee code or roll number as supplied in the file (untrusted). */
    identifier: string;
    date: string;
    time: string;
    punchType: "IN" | "OUT";
    rawLine: string;
}

export interface ImportResult {
    success: boolean;
    totalRows: number;
    imported: number;
    skipped: number;
    duplicates: number;
    errors: { row: number; message: string }[];
}

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 20_000;

/**
 * Device identifier used when an import is not attributed to a registered
 * terminal (a manual CSV upload). Registered devices use their own identifier,
 * which is what makes per-device idempotency possible.
 */
export const DEVICE_ID = "CSV_IMPORT";

/**
 * Fingerprint of a single punch (P1.7 idempotency).
 *
 * Derived only from data the device actually supplies — device, employee,
 * timestamp, punch type — never from a value the device cannot provide. The
 * unique index on `BiometricLog.punchHash` turns "the same punch is never
 * processed twice" into a database guarantee, so two concurrent imports of the
 * same file cannot both insert the row. A read-then-write check could not
 * prevent that: both transactions would observe "not yet present".
 */
export function punchFingerprint(params: {
    deviceId: string;
    employeeId: string;
    timestamp: Date;
    type: string;
}): string {
    return createHash("sha256")
        .update(
            [params.deviceId, params.employeeId, params.timestamp.toISOString(), params.type].join("|")
        )
        .digest("hex");
}
export const ALLOWED_EXTENSIONS = [".csv"];

/* ------------------------------------------------------------------ */
/* Validation                                                         */
/* ------------------------------------------------------------------ */

export function parseDate(dateStr: string): Date | null {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const d = new Date(`${dateStr}T00:00:00`);
        return isNaN(d.getTime()) ? null : d;
    }
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
        const [day, month, year] = dateStr.split("/");
        const d = new Date(`${year}-${month}-${day}T00:00:00`);
        return isNaN(d.getTime()) ? null : d;
    }
    return null;
}

export function parseTime(timeStr: string): { hours: number; minutes: number; seconds: number } | null {
    const match = timeStr.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) return null;
    const hours = Number.parseInt(match[1], 10);
    const minutes = Number.parseInt(match[2], 10);
    const seconds = match[3] ? Number.parseInt(match[3], 10) : 0;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) return null;
    return { hours, minutes, seconds };
}

/** Returns a rejection reason, or null when the file passes pre-flight checks. */
export function validateFile(file: File): string | null {
    if (file.size === 0) return "File is empty";
    if (file.size > MAX_FILE_BYTES) return `File too large. Maximum size is ${MAX_FILE_BYTES / 1024 / 1024}MB.`;
    const lower = file.name.toLowerCase();
    if (!ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext))) return "Only CSV files are supported.";
    return null;
}

export function parseCsvContent(content: string): {
    success: boolean;
    records: ParsedPunchRecord[];
    errors: { row: number; message: string }[];
} {
    // A NUL byte means this is not the CSV we were promised.
    if (content.includes("\u0000")) {
        return { success: false, records: [], errors: [{ row: 0, message: "File is not a valid CSV" }] };
    }

    const lines = content.split(/\r?\n/).filter((l) => l.trim() !== "");
    if (lines.length < 2) {
        return { success: false, records: [], errors: [{ row: 0, message: "CSV file is empty or has no data rows" }] };
    }
    if (lines.length - 1 > MAX_ROWS) {
        return {
            success: false,
            records: [],
            errors: [{ row: 0, message: `Too many rows. Maximum is ${MAX_ROWS} per import.` }],
        };
    }

    const headers = lines[0].trim().split(",").map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, ""));
    const codeIdx = headers.findIndex((h) =>
        ["employeecode", "empcode", "employeeid", "empid", "code", "rollnumber"].includes(h)
    );
    const dateIdx = headers.findIndex((h) => ["date", "punchdate", "attendancedate"].includes(h));
    const timeIdx = headers.findIndex((h) => ["time", "punchtime", "clocktime"].includes(h));
    const typeIdx = headers.findIndex((h) => ["punchtype", "type", "inout", "direction"].includes(h));

    if (codeIdx === -1 || dateIdx === -1 || timeIdx === -1 || typeIdx === -1) {
        return {
            success: false,
            records: [],
            errors: [
                {
                    row: 0,
                    message: `Missing required columns. Found: [${headers.join(", ")}]. Required: EmployeeCode, Date, Time, PunchType`,
                },
            ],
        };
    }

    const records: ParsedPunchRecord[] = [];
    const errors: { row: number; message: string }[] = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const cols = line.split(",").map((c) => c.trim());

        const identifier = cols[codeIdx] ?? "";
        const dateStr = cols[dateIdx] ?? "";
        const timeStr = cols[timeIdx] ?? "";
        const typeStr = (cols[typeIdx] ?? "").toUpperCase();

        if (!identifier) {
            errors.push({ row: i + 1, message: "Missing employee code" });
            continue;
        }
        if (!parseDate(dateStr)) {
            errors.push({ row: i + 1, message: `Invalid date format: "${dateStr}". Use YYYY-MM-DD or DD/MM/YYYY` });
            continue;
        }
        if (!parseTime(timeStr)) {
            errors.push({ row: i + 1, message: `Invalid time format: "${timeStr}". Use HH:MM or HH:MM:SS` });
            continue;
        }
        if (typeStr !== "IN" && typeStr !== "OUT") {
            errors.push({ row: i + 1, message: `Invalid punch type: "${typeStr}". Must be IN or OUT` });
            continue;
        }

        records.push({ rowNumber: i + 1, identifier, date: dateStr, time: timeStr, punchType: typeStr as "IN" | "OUT", rawLine: line });
    }

    return { success: true, records, errors };
}

/* ------------------------------------------------------------------ */
/* Authorization                                                      */
/* ------------------------------------------------------------------ */

export interface ImportActor {
    userId: string;
    email: string;
    role: Role;
    employeeId: string | null;
    department: string | null;
}

export function canImportAttendance(actor: ImportActor, overrides?: PermissionOverrides | null): boolean {
    return resolvePermissions(actor.role, overrides).permissions.has(PERMISSIONS.ATTENDANCE_IMPORT);
}

/**
 * Employees this actor may write attendance for.
 * `null` means unrestricted (organization-wide). Otherwise a set of ids.
 */
export function writableEmployeeScope(
    actor: ImportActor,
    allEmployees: { id: string; department: string }[]
): Set<string> | null {
    if (actor.role === "SUPER_ADMIN" || actor.role === "ADMIN" || actor.role === "HR") return null;
    if (!actor.department) {
        return new Set(actor.employeeId ? [actor.employeeId] : []);
    }
    return new Set(allEmployees.filter((e) => e.department === actor.department).map((e) => e.id));
}

/* ------------------------------------------------------------------ */
/* Import execution                                                   */
/* ------------------------------------------------------------------ */

const EMPTY: ImportResult = { success: false, totalRows: 0, imported: 0, skipped: 0, duplicates: 0, errors: [] };

export async function runAttendanceImport(params: {
    content: string;
    actor: ImportActor;
    fileName: string;
}): Promise<ImportResult> {
    const { content, actor } = params;

    const parsed = parseCsvContent(content);
    if (!parsed.success) {
        return { ...EMPTY, errors: parsed.errors };
    }
    const { records, errors: parseErrors } = parsed;

    // Identities are always resolved from the database. Nothing in the file is
    // trusted as proof of identity.
    const employees = await prisma.employee.findMany({
        select: { id: true, employeeCode: true, rollNumber: true, department: true, shiftId: true },
    });

    const byIdentifier = new Map<string, (typeof employees)[number]>();
    for (const emp of employees) {
        if (emp.employeeCode) byIdentifier.set(emp.employeeCode.toLowerCase(), emp);
        // Null-safe: the previous unguarded .toLowerCase() aborted the import.
        if (emp.rollNumber) byIdentifier.set(emp.rollNumber.toLowerCase(), emp);
    }

    const scope = writableEmployeeScope(actor, employees);

    type Group = { employee: (typeof employees)[number]; date: Date; punches: ParsedPunchRecord[] };
    const grouped = new Map<string, Group>();
    const errors = [...parseErrors];
    let skipped = 0;

    for (const record of records) {
        const key = record.identifier.toLowerCase();
        const employee = byIdentifier.get(key);

        if (!employee) {
            errors.push({ row: record.rowNumber, message: `Employee not found: "${record.identifier}"` });
            skipped++;
            continue;
        }
        if (scope && !scope.has(employee.id)) {
            errors.push({ row: record.rowNumber, message: `Out of scope: "${record.identifier}"` });
            skipped++;
            continue;
        }

        const date = parseDate(record.date)!;
        const groupKey = `${employee.id}_${date.toISOString().slice(0, 10)}`;
        if (!grouped.has(groupKey)) grouped.set(groupKey, { employee, date, punches: [] });
        grouped.get(groupKey)!.punches.push(record);
    }

    let imported = 0;
    let duplicates = 0;

    // One transaction for the whole write phase: a failure rolls back every
    // attendance and biometric row, so the data cannot be left half-written.
    try {
        await prisma.$transaction(async (tx) => {
            for (const [, group] of grouped) {
                const { employee, date, punches } = group;

                const dayStart = new Date(date);
                dayStart.setHours(0, 0, 0, 0);
                const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

                const toDate = (p: ParsedPunchRecord) => {
                    const t = parseTime(p.time)!;
                    const d = new Date(date);
                    d.setHours(t.hours, t.minutes, t.seconds);
                    return d;
                };

                const existing = await tx.attendance.findFirst({
                    where: { employeeId: employee.id, date: { gte: dayStart, lt: dayEnd } },
                });

                if (existing) {
                    duplicates++;
                    // P1.7: skip punches already recorded rather than writing
                    // them again. createMany with `skipDuplicates` relies on the
                    // punchHash unique index, so a re-import of the same file is
                    // a no-op even if two imports run at once.
                    await tx.biometricLog.createMany({
                        data: punches.map((p) => ({
                            attendanceId: existing.id,
                            deviceId: DEVICE_ID,
                            employeeId: employee.id,
                            timestamp: toDate(p),
                            type: p.punchType,
                            rawLog: p.rawLine,
                            punchHash: punchFingerprint({
                                deviceId: DEVICE_ID,
                                employeeId: employee.id,
                                timestamp: toDate(p),
                                type: p.punchType,
                            }),
                        })),
                        skipDuplicates: true,
                    });
                    continue;
                }

                const inPunches = punches.filter((p) => p.punchType === "IN");
                const outPunches = punches.filter((p) => p.punchType === "OUT");

                const minutesOf = (p: ParsedPunchRecord) => {
                    const t = parseTime(p.time)!;
                    return t.hours * 60 + t.minutes;
                };
                const checkInPunch = inPunches.length ? inPunches.reduce((a, b) => (minutesOf(a) <= minutesOf(b) ? a : b)) : null;
                const checkOutPunch = outPunches.length ? outPunches.reduce((a, b) => (minutesOf(a) >= minutesOf(b) ? a : b)) : null;

                const checkIn = checkInPunch ? toDate(checkInPunch) : null;
                const checkOut = checkOutPunch ? toDate(checkOutPunch) : null;

                let status = "PRESENT";
                let lateMinutes = 0;
                if (checkIn) {
                    const threshold = new Date(date);
                    threshold.setHours(9, 15, 0, 0);
                    if (checkIn > threshold) {
                        status = "LATE";
                        lateMinutes = Math.round((checkIn.getTime() - threshold.getTime()) / 60000);
                    }
                }

                let overtimeMinutes = 0;
                if (checkIn && checkOut) {
                    const worked = (checkOut.getTime() - checkIn.getTime()) / 60000;
                    if (worked > 8 * 60) overtimeMinutes = Math.round(worked - 8 * 60);
                }

                const attendance = await tx.attendance.create({
                    data: {
                        employeeId: employee.id,
                        date: dayStart,
                        checkIn,
                        checkOut,
                        status,
                        lateMinutes,
                        overtimeMinutes,
                        shiftId: employee.shiftId || null,
                    },
                });

                await tx.biometricLog.createMany({
                    data: punches.map((p) => ({
                        attendanceId: attendance.id,
                        deviceId: DEVICE_ID,
                        employeeId: employee.id,
                        timestamp: toDate(p),
                        type: p.punchType,
                        rawLog: p.rawLine,
                        punchHash: punchFingerprint({
                            deviceId: DEVICE_ID,
                            employeeId: employee.id,
                            timestamp: toDate(p),
                            type: p.punchType,
                        }),
                    })),
                    skipDuplicates: true,
                });

                imported++;
            }
        });
    } catch (error) {
        return {
            success: false,
            totalRows: records.length,
            imported: 0,
            skipped,
            duplicates: 0,
            errors: [
                ...errors,
                {
                    row: 0,
                    message: `Import rolled back: ${
                        error instanceof Error ? (error instanceof Error ? error.message : "Unknown error") : "database error"
                    }. No attendance data was changed.`,
                },
            ],
        };
    }

    return {
        success: true,
        totalRows: records.length,
        imported,
        skipped,
        duplicates,
        errors: errors.slice(0, 100),
    };
}
