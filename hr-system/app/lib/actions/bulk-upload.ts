"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import bcrypt from "bcryptjs";

export async function uploadMasterFile(formData: FormData) {
    const session = await auth();
    if (!session || !["ADMIN", "HR"].includes((session.user as any).role)) {
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

    const hashedPassword = await bcrypt.hash("password123", 10);

    for (let i = 0; i < dataRows.length; i++) {
        const values = dataRows[i].split(",").map(v => v.trim());
        const row: any = {};

        headers.forEach((header, index) => {
            row[header] = values[index];
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
                        password: hashedPassword,
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
            });
            results.success++;
        } catch (error: any) {
            results.failed++;
            results.errors.push(`Row ${i + 2}: ${error.message}`);
        }
    }

    revalidatePath("/employees");
    return {
        success: results.failed === 0,
        message: `Processed ${dataRows.length} rows. Success: ${results.success}, Failed: ${results.failed}`,
        errors: results.errors
    };
}
