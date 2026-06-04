"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";

// Types for parsed CSV records
export interface ParsedPunchRecord {
  rowNumber: number;
  employeeCode: string;
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
  errors: { row: number; message: string }[];
  duplicates: number;
}

function parseDate(dateStr: string): Date | null {
  // Try YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const d = new Date(dateStr + "T00:00:00");
    return isNaN(d.getTime()) ? null : d;
  }
  // Try DD/MM/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
    const [day, month, year] = dateStr.split("/");
    const d = new Date(`${year}-${month}-${day}T00:00:00`);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function parseTime(timeStr: string): { hours: number; minutes: number; seconds: number } | null {
  const match = timeStr.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const hours = parseInt(match[1]);
  const minutes = parseInt(match[2]);
  const seconds = match[3] ? parseInt(match[3]) : 0;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) return null;
  return { hours, minutes, seconds };
}

export async function parseCsvContent(content: string): Promise<{
  success: boolean;
  records: ParsedPunchRecord[];
  errors: { row: number; message: string }[];
}> {
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) {
    return { success: false, records: [], errors: [{ row: 0, message: "CSV file is empty or has no data rows" }] };
  }

  // Parse header
  const headerLine = lines[0].trim();
  const headers = headerLine.split(",").map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, ""));

  // Map column indices
  const codeIdx = headers.findIndex((h) => h === "employeecode" || h === "empcode" || h === "employeeid" || h === "empid" || h === "code" || h === "rollnumber");
  const dateIdx = headers.findIndex((h) => h === "date" || h === "punchdate" || h === "attendancedate");
  const timeIdx = headers.findIndex((h) => h === "time" || h === "punchtime" || h === "clocktime");
  const typeIdx = headers.findIndex((h) => h === "punchtype" || h === "type" || h === "inout" || h === "direction");

  if (codeIdx === -1 || dateIdx === -1 || timeIdx === -1 || typeIdx === -1) {
    return {
      success: false,
      records: [],
      errors: [{
        row: 0,
        message: `Missing required columns. Found: [${headers.join(", ")}]. Required: EmployeeCode, Date, Time, PunchType`
      }]
    };
  }

  const records: ParsedPunchRecord[] = [];
  const errors: { row: number; message: string }[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = line.split(",").map((c) => c.trim());
    const employeeCode = cols[codeIdx] || "";
    const dateStr = cols[dateIdx] || "";
    const timeStr = cols[timeIdx] || "";
    const typeStr = (cols[typeIdx] || "").toUpperCase();

    if (!employeeCode) {
      errors.push({ row: i + 1, message: "Missing employee code" });
      continue;
    }

    const parsedDate = parseDate(dateStr);
    if (!parsedDate) {
      errors.push({ row: i + 1, message: `Invalid date format: "${dateStr}". Use YYYY-MM-DD or DD/MM/YYYY` });
      continue;
    }

    const parsedTime = parseTime(timeStr);
    if (!parsedTime) {
      errors.push({ row: i + 1, message: `Invalid time format: "${timeStr}". Use HH:MM or HH:MM:SS` });
      continue;
    }

    if (typeStr !== "IN" && typeStr !== "OUT") {
      errors.push({ row: i + 1, message: `Invalid punch type: "${typeStr}". Must be IN or OUT` });
      continue;
    }

    records.push({
      rowNumber: i + 1,
      employeeCode,
      date: dateStr,
      time: timeStr,
      punchType: typeStr as "IN" | "OUT",
      rawLine: line,
    });
  }

  return { success: true, records, errors };
}

export async function importAttendanceFromCsv(formData: FormData): Promise<ImportResult> {
  const session = await auth();
  if (!session?.user?.email) {
    return { success: false, totalRows: 0, imported: 0, skipped: 0, errors: [{ row: 0, message: "Unauthorized" }], duplicates: 0 };
  }

  // Check role
  const currentUser = await prisma.user.findUnique({ where: { email: session.user.email } });
  if (!currentUser || !["ADMIN", "HR"].includes(currentUser.role)) {
    return { success: false, totalRows: 0, imported: 0, skipped: 0, errors: [{ row: 0, message: "Only Admin/HR can import attendance" }], duplicates: 0 };
  }

  const file = formData.get("file") as File;
  if (!file) {
    return { success: false, totalRows: 0, imported: 0, skipped: 0, errors: [{ row: 0, message: "No file provided" }], duplicates: 0 };
  }

  const content = await file.text();
  const { success, records, errors } = await parseCsvContent(content);

  if (!success) {
    return { success: false, totalRows: 0, imported: 0, skipped: 0, errors, duplicates: 0 };
  }

  // Fetch all employees for mapping
  const allEmployees = await prisma.employee.findMany({
    select: { id: true, employeeCode: true, rollNumber: true, firstName: true, lastName: true, shiftId: true },
  });

  const empByCode = new Map<string, typeof allEmployees[0]>();
  const empByRoll = new Map<string, typeof allEmployees[0]>();
  allEmployees.forEach((emp) => {
    if (emp.employeeCode) empByCode.set(emp.employeeCode.toLowerCase(), emp);
    empByRoll.set(emp.rollNumber.toLowerCase(), emp);
  });

  // Group records by employee+date
  const grouped = new Map<string, { employee: typeof allEmployees[0]; date: Date; punches: ParsedPunchRecord[] }>();

  const importErrors: { row: number; message: string }[] = [...errors];
  let skipped = 0;

  for (const record of records) {
    const code = record.employeeCode.toLowerCase();
    const employee = empByCode.get(code) || empByRoll.get(code);

    if (!employee) {
      importErrors.push({ row: record.rowNumber, message: `Employee not found: "${record.employeeCode}"` });
      skipped++;
      continue;
    }

    const parsedDate = parseDate(record.date)!;
    const key = `${employee.id}_${parsedDate.toISOString().split("T")[0]}`;

    if (!grouped.has(key)) {
      grouped.set(key, { employee, date: parsedDate, punches: [] });
    }
    grouped.get(key)!.punches.push(record);
  }

  let imported = 0;
  let duplicates = 0;

  // Process each employee-date group
  for (const [, group] of grouped) {
    const { employee, date, punches } = group;

    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    // Check for existing attendance record on that day
    const existing = await prisma.attendance.findFirst({
      where: {
        employeeId: employee.id,
        date: { gte: dayStart, lt: dayEnd },
      },
    });

    if (existing) {
      duplicates++;
      // Still create biometric logs for existing records
      for (const punch of punches) {
        const parsedTime = parseTime(punch.time)!;
        const timestamp = new Date(date);
        timestamp.setHours(parsedTime.hours, parsedTime.minutes, parsedTime.seconds);

        await prisma.biometricLog.create({
          data: {
            attendanceId: existing.id,
            deviceId: "CSV_IMPORT",
            employeeId: employee.id,
            timestamp,
            type: punch.punchType,
            rawLog: punch.rawLine,
          },
        });
      }
      continue;
    }

    // Find earliest IN and latest OUT
    const inPunches = punches.filter((p) => p.punchType === "IN");
    const outPunches = punches.filter((p) => p.punchType === "OUT");

    let checkIn: Date | null = null;
    let checkOut: Date | null = null;

    if (inPunches.length > 0) {
      const times = inPunches.map((p) => {
        const t = parseTime(p.time)!;
        return { ...t, totalMinutes: t.hours * 60 + t.minutes };
      });
      const earliest = times.reduce((a, b) => (a.totalMinutes < b.totalMinutes ? a : b));
      checkIn = new Date(date);
      checkIn.setHours(earliest.hours, earliest.minutes, earliest.seconds);
    }

    if (outPunches.length > 0) {
      const times = outPunches.map((p) => {
        const t = parseTime(p.time)!;
        return { ...t, totalMinutes: t.hours * 60 + t.minutes };
      });
      const latest = times.reduce((a, b) => (a.totalMinutes > b.totalMinutes ? a : b));
      checkOut = new Date(date);
      checkOut.setHours(latest.hours, latest.minutes, latest.seconds);
    }

    // Determine status
    let status = "PRESENT";
    let lateMinutes = 0;
    if (checkIn) {
      const threshold = new Date(date);
      threshold.setHours(9, 15, 0, 0); // Default 9:15 AM threshold
      if (checkIn > threshold) {
        status = "LATE";
        lateMinutes = Math.round((checkIn.getTime() - threshold.getTime()) / (1000 * 60));
      }
    }

    // Calculate overtime
    let overtimeMinutes = 0;
    if (checkIn && checkOut) {
      const workedMs = checkOut.getTime() - checkIn.getTime();
      const workedMinutes = workedMs / (1000 * 60);
      const standardMinutes = 8 * 60; // 8 hours
      if (workedMinutes > standardMinutes) {
        overtimeMinutes = Math.round(workedMinutes - standardMinutes);
      }
    }

    try {
      const attendance = await prisma.attendance.create({
        data: {
          employeeId: employee.id,
          date: dayStart,
          checkIn,
          checkOut,
          status,
          lateMinutes,
          overtimeMinutes,
          shiftId: employee.shiftId || undefined,
        },
      });

      // Create biometric log entries
      for (const punch of punches) {
        const parsedTime = parseTime(punch.time)!;
        const timestamp = new Date(date);
        timestamp.setHours(parsedTime.hours, parsedTime.minutes, parsedTime.seconds);

        await prisma.biometricLog.create({
          data: {
            attendanceId: attendance.id,
            deviceId: "CSV_IMPORT",
            employeeId: employee.id,
            timestamp,
            type: punch.punchType,
            rawLog: punch.rawLine,
          },
        });
      }

      imported++;
    } catch (err: any) {
      importErrors.push({ row: punches[0].rowNumber, message: `DB error for ${employee.employeeCode}: ${err.message}` });
      skipped++;
    }
  }

  revalidatePath("/attendance");
  revalidatePath("/attendance/machine-integration");

  return {
    success: true,
    totalRows: records.length,
    imported,
    skipped,
    errors: importErrors,
    duplicates,
  };
}
