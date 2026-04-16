"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import bcrypt from "bcryptjs";

export async function upsertEmployee(formData: FormData) {
    const session = await auth();
    if (!session || !["ADMIN", "HR"].includes((session.user as any).role)) {
        return { success: false, message: "Unauthorized" };
    }

    const id = formData.get("id") as string;
    const data: any = {
        firstName: formData.get("firstName") as string,
        lastName: formData.get("lastName") as string,
        email: formData.get("email") as string,
        designation: formData.get("designation") as string,
        department: formData.get("department") as string,
        rollNumber: formData.get("rollNumber") as string,
        phone: formData.get("phone") || undefined,
        gender: formData.get("gender") || undefined,
        maritalStatus: formData.get("maritalStatus") || undefined,
        nationality: formData.get("nationality") || undefined,
        governmentId: formData.get("governmentId") || undefined,
        address: formData.get("address") || undefined,
        permanentAddress: formData.get("permanentAddress") || undefined,
        emergencyContact: formData.get("emergencyContact") || undefined,
        emergencyPhone: formData.get("emergencyPhone") || undefined,
        bankName: formData.get("bankName") || undefined,
        accountNumber: formData.get("accountNumber") || undefined,
        ifscCode: formData.get("ifscCode") || undefined,
        employmentType: (formData.get("employmentType") as string) || "FULL_TIME",
        workLocation: formData.get("workLocation") || undefined,
        currentStatus: (formData.get("currentStatus") as string) || "ACTIVE",
        managerId: (formData.get("managerId") === "none" || !formData.get("managerId")) ? null : formData.get("managerId") as string,
        joiningDate: formData.get("joiningDate") ? new Date(formData.get("joiningDate") as string) : new Date(),
        dateOfBirth: formData.get("dateOfBirth") ? new Date(formData.get("dateOfBirth") as string) : null,
        probationDays: parseInt(formData.get("probationDays") as string) || 90,
    };

    // Remove undefined or null values so Prisma uses defaults where appropriate
    // But keep null for fields that are explicitly set to null (like managerId)
    Object.keys(data).forEach(key => {
        const value = data[key];
        if (
            value === undefined || 
            value === 'undefined' || 
            value === 'null' || 
            (typeof value === 'string' && value.trim() === '')
        ) {
            // Only delete if it's not a required field or if we want it to be null/default
            if (key !== 'managerId') {
                delete data[key];
            } else {
                data[key] = null;
            }
        }
    });

    const isNew = !id || id === "";

    // Validation for new employees
    if (isNew) {
        const emailStr = String(data.email || "").trim();
        if (!data.email || emailStr === "" || emailStr.toLowerCase() === "null") {
            return { success: false, message: "Email is mandatory for new records." };
        }
        if (!data.firstName || !data.lastName || 
            String(data.firstName).toLowerCase() === "null" || 
            String(data.lastName).toLowerCase() === "null") {
            return { success: false, message: "First and Last names are mandatory." };
        }
    }

    try {
        if (!isNew) {
            // Get old values for auditing
            const oldEmployee = await prisma.employee.findUnique({ where: { id } });

            const updated = await prisma.employee.update({
                where: { id },
                data: data
            });

            // Audit changes
            await prisma.auditLog.create({
                data: {
                    employeeId: id,
                    action: "UPDATE",
                    details: "Employee Master Data Updated",
                    changedBy: (session.user as any).email!
                }
            });
        } else {
            // Creation logic
            const hashedPassword = await bcrypt.hash("password123", 10);
            const user = await prisma.user.create({
                data: {
                    email: data.email,
                    password: hashedPassword,
                    role: "STAFF",
                    name: `${data.firstName} ${data.lastName}`
                }
            });

            await prisma.employee.create({
                data: {
                    ...data,
                    userId: user.id
                }
            });
        }

        revalidatePath("/employees");
        return { success: true, message: "Employee saved successfully" };
    } catch (error: any) {
        console.error("[UPSERT_EMPLOYEE_ERROR]", error);
        return { success: false, message: `Error saving employee: ${error.message || "Unknown error"}. Check server logs.` };
    }
}

export async function deleteEmployee(id: string) {
    const session = await auth();
    if (!session || !["ADMIN", "HR"].includes((session.user as any).role)) {
        return { success: false, message: "Unauthorized" };
    }

    try {
        await prisma.employee.delete({ where: { id } });
        revalidatePath("/employees");
        return { success: true, message: "Employee deleted" };
    } catch (error) {
        return { success: false, message: "Error deleting employee" };
    }
}

export async function getActiveEmployees() {
    const session = await auth();
    if (!session || !["ADMIN", "HR"].includes((session.user as any).role)) {
        return { success: false, data: [] };
    }
    try {
        const employees = await prisma.employee.findMany({
            where: { isActive: true },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                designation: true,
            }
        });
        return { success: true, data: employees };
    } catch (error) {
        return { success: false, data: [] };
    }
}
