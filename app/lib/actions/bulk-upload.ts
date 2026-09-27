"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { issueActivationToken } from "@/lib/workflow/credentials";

/**
 * Bulk employee upload.
 *
 * SECURITY (P1.1 / SEC-027): this path previously created every imported
 * account with a bcrypt hash of the shared default `password123` — the exact
 * defect the single-employee path was fixed for, still present here. Accounts
 * are now created with a NULL password plus a one-time activation token, so a
 * bulk import can no longer mint predictable credentials.
 *
 * Token issuance happens AFTER the transaction commits, per employee, so a
 * token failure cannot roll back an imported employee. The plaintext token is
 * never logged; the caller receives counts and is directed to the employee
 * record to issue links.
 */
export async function uploadMasterFile(formData: FormData) {
    const session = await auth();
    if (!session || !["ADMIN", "HR"].includes((session.user as { role: string }).role)) {
        return { success: false, message: "Unauthorized" };
    }

    const file = formData.get("file") as File;
    if (!file) return { success: false, message: "No file provided" };

    const text = await file.text();
    const rows = text.split(/\r?\n/).filter(line => line.trim() !== "");

    if (rows.length < 2) return { success: false, message: "File is empty or missing headers" };

    const headers = rows[0].split(",").map(h => h.trim().toLowerCase());
    const dataRows = rows.slice(1);

    const results = {
        success: 0,
        failed: 0,
        errors: [] as string[]
    };

    // No default password: each imported account is activated by a one-time
    // token instead.
    const activatedUserIds: string[] = [];

    for (let i = 0; i < dataRows.length; i++) {
        const values = dataRows[i].split(",").map(v => v.trim());
        // Values come straight from splitting the CSV, so every entry is a
        // string. Typed accordingly rather than as `any`.
        const row: Record<string, string> = {};

        headers.forEach((header, index) => {
            row[header] = values[index] ?? "";
        });

        // Basic validation
        if (!row.email || !row.firstname || !row.lastname || !row.rollnumber) {
            results.failed++;
            results.errors.push(`Row ${i + 2}: Missing required fields (Email, First Name, Last Name, or Roll Number)`);
            continue;
        }

        try {
            await prisma.$transaction(async (tx) => {
                // Check if user exists
                const existingUser = await tx.user.findUnique({ where: { email: row.email } });
                if (existingUser) throw new Error(`User with email ${row.email} already exists`);

                const existingEmp = await tx.employee.findUnique({ where: { rollNumber: row.rollnumber } });
                if (existingEmp) throw new Error(`Employee with roll number ${row.rollnumber} already exists`);

                const user = await tx.user.create({
                    data: {
                        email: row.email,
                        // No usable password until the employee activates their
                        // account with a one-time token.
                        password: null,
                        name: `${row.firstname} ${row.lastname}`,
                        role: "STAFF"
                    }
                });

                await tx.employee.create({
                    data: {
                        userId: user.id,
                        rollNumber: row.rollnumber,
                        firstName: row.firstname,
                        lastName: row.lastname,
                        email: row.email,
                        designation: row.designation || "Staff",
                        department: row.department || "General",
                        joiningDate: row.joiningdate ? new Date(row.joiningdate) : new Date(),
                        isActive: true
                    }
                });

                activatedUserIds.push(user.id);
            });
            results.success++;
        } catch (error: unknown) {
            results.failed++;
            results.errors.push(`Row ${i + 2}: ${(error instanceof Error ? error.message : "Unknown error")}`);
        }
    }

    // Activation links are issued after the import commits. A failure here
    // leaves a valid employee who can still be activated manually; it must
    // never undo an imported record.
    let activationFailed = 0;
    for (const userId of activatedUserIds) {
        try {
            await issueActivationToken({
                userId,
                createdBy: "bulk-upload",
                purpose: "FIRST_LOGIN",
            });
        } catch (tokenError) {
            activationFailed++;
            console.error("[BULK_UPLOAD_ACTIVATION_FAILED]", tokenError);
        }
    }

    revalidatePath("/employees");
    return {
        success: results.failed === 0,
        message: `Processed ${dataRows.length} rows. Success: ${results.success}, Failed: ${results.failed}` +
            (activationFailed > 0
                ? `. ${activationFailed} activation link(s) need reissuing from the employee record.`
                : ". Activation links issued for every imported account."),
        errors: results.errors
    };
}
