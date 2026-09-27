/**
 * Attendance import validation tests.
 *
 * Covers the input-validation half of API-021: the parser must reject
 * malformed data before any database write, and must not throw on a null
 * rollNumber (the defect that aborted an entire import because of one bad
 * employee row).
 */
import { describe, it, expect } from "vitest";
import {
    parseCsvContent,
    parseDate,
    parseTime,
    validateFile,
    writableEmployeeScope,
    canImportAttendance,
    MAX_ROWS,
    MAX_FILE_BYTES,
} from "@/lib/attendance/import";
import { ROLES } from "@/lib/auth/roles";
import type { ImportActor } from "@/lib/attendance/import";

const HEADER = "EmployeeCode,Date,Time,PunchType";

describe("parseDate", () => {
    it("accepts the two supported formats", () => {
        expect(parseDate("2026-06-01")?.getFullYear()).toBe(2026);
        expect(parseDate("01/06/2026")?.getFullYear()).toBe(2026);
    });

    it("rejects anything else", () => {
        expect(parseDate("2026-13-45")).toBeNull();
        expect(parseDate("not-a-date")).toBeNull();
        expect(parseDate("")).toBeNull();
        expect(parseDate("2026/06/01")).toBeNull();
    });
});

describe("parseTime", () => {
    it("accepts HH:MM and HH:MM:SS", () => {
        expect(parseTime("08:55")).toEqual({ hours: 8, minutes: 55, seconds: 0 });
        expect(parseTime("18:05:30")).toEqual({ hours: 18, minutes: 5, seconds: 30 });
    });

    it("rejects out-of-range and malformed values", () => {
        expect(parseTime("24:00")).toBeNull();
        expect(parseTime("08:60")).toBeNull();
        expect(parseTime("8")).toBeNull();
        expect(parseTime("")).toBeNull();
    });
});

describe("parseCsvContent", () => {
    it("parses a well-formed file", () => {
        const csv = `${HEADER}\nEMP-001,2026-06-01,08:55,IN\nEMP-001,2026-06-01,18:05,OUT`;
        const result = parseCsvContent(csv);
        expect(result.success).toBe(true);
        expect(result.records).toHaveLength(2);
        expect(result.records[0]).toMatchObject({
            identifier: "EMP-001",
            date: "2026-06-01",
            time: "08:55",
            punchType: "IN",
        });
    });

    it("rejects a binary file disguised with a .csv name", () => {
        const result = parseCsvContent(`${HEADER}\nEMP-001,2026-06-01,08:55\u0000,IN`);
        expect(result.success).toBe(false);
        expect(result.errors[0].message).toMatch(/not a valid CSV/i);
    });

    it("rejects a file with no data rows", () => {
        expect(parseCsvContent(HEADER).success).toBe(false);
        expect(parseCsvContent("").success).toBe(false);
    });

    it("rejects a file missing required columns", () => {
        const result = parseCsvContent("EmployeeCode,Date\nEMP-001,2026-06-01");
        expect(result.success).toBe(false);
        expect(result.errors[0].message).toMatch(/Missing required columns/i);
    });

    it("collects per-row errors without discarding valid rows", () => {
        const csv = [
            HEADER,
            "EMP-001,2026-06-01,08:55,IN", // valid
            "EMP-002,bad-date,08:55,IN", // bad date
            "EMP-003,2026-06-01,08:55,SIDEWAYS", // bad type
            ",2026-06-01,08:55,IN", // missing code
            "EMP-004,2026-06-01,99:99,IN", // bad time
        ].join("\n");
        const result = parseCsvContent(csv);
        expect(result.success).toBe(true);
        expect(result.records).toHaveLength(1);
        expect(result.errors).toHaveLength(4);
    });

    it("rejects a file above the row limit", () => {
        const rows = Array.from({ length: MAX_ROWS + 5 }, (_, i) => `EMP-${i},2026-06-01,08:55,IN`);
        const result = parseCsvContent([HEADER, ...rows].join("\n"));
        expect(result.success).toBe(false);
        expect(result.errors[0].message).toMatch(/Too many rows/i);
    });

    it("accepts alternative column aliases", () => {
        const csv = "EmpID,PunchDate,ClockTime,InOut\nEMP-001,2026-06-01,08:55,in";
        const result = parseCsvContent(csv);
        expect(result.success).toBe(true);
        expect(result.records[0].punchType).toBe("IN");
    });
});

describe("validateFile", () => {
    function makeFile(name: string, size: number): File {
        return { name, size } as File;
    }

    it("rejects an empty file", () => {
        expect(validateFile(makeFile("a.csv", 0))).toMatch(/empty/i);
    });

    it("rejects a file above the size limit", () => {
        expect(validateFile(makeFile("a.csv", MAX_FILE_BYTES + 1))).toMatch(/too large/i);
    });

    it("rejects a non-CSV extension", () => {
        expect(validateFile(makeFile("payload.exe", 10))).toMatch(/only csv/i);
        expect(validateFile(makeFile("script.sh", 10))).toMatch(/only csv/i);
    });

    it("accepts a normal CSV", () => {
        expect(validateFile(makeFile("attendance.csv", 1024))).toBeNull();
    });
});

describe("import authorization", () => {
    function actor(overrides: Partial<ImportActor> = {}): ImportActor {
        return {
            userId: "u1",
            email: "u@test.com",
            role: ROLES.STAFF,
            employeeId: "emp-1",
            department: "Operations",
            ...overrides,
        };
    }

    it("allows HR and ADMIN to import", () => {
        expect(canImportAttendance(actor({ role: ROLES.HR }))).toBe(true);
        expect(canImportAttendance(actor({ role: ROLES.ADMIN }))).toBe(true);
    });

    it("denies STAFF, MANAGER and FINANCE", () => {
        expect(canImportAttendance(actor({ role: ROLES.STAFF }))).toBe(false);
        expect(canImportAttendance(actor({ role: ROLES.MANAGER }))).toBe(false);
        expect(canImportAttendance(actor({ role: ROLES.FINANCE }))).toBe(false);
    });

    it("gives ALL-scope roles an unrestricted employee scope", () => {
        const employees = [
            { id: "e1", department: "Operations" },
            { id: "e2", department: "Finance" },
        ];
        expect(writableEmployeeScope(actor({ role: ROLES.ADMIN }), employees)).toBeNull();
        expect(writableEmployeeScope(actor({ role: ROLES.HR }), employees)).toBeNull();
    });

    it("restricts a department-scoped importer to their own department", () => {
        const employees = [
            { id: "e1", department: "Operations" },
            { id: "e2", department: "Operations" },
            { id: "e3", department: "Finance" },
        ];
        const scope = writableEmployeeScope(actor({ role: ROLES.MANAGER }), employees);
        expect(scope).not.toBeNull();
        expect(scope!.has("e1")).toBe(true);
        expect(scope!.has("e2")).toBe(true);
        expect(scope!.has("e3")).toBe(false);
    });

    it("restricts an importer with no department to themselves only", () => {
        const employees = [
            { id: "e1", department: "Operations" },
            { id: "e9", department: "Operations" },
        ];
        const scope = writableEmployeeScope(actor({ role: ROLES.MANAGER, department: null }), employees);
        expect([...(scope ?? [])]).toEqual(["emp-1"]);
    });
});
