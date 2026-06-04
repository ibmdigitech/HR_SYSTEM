"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import bcrypt from "bcryptjs";

// Default leave balances assigned to every new employee
const DEFAULT_LEAVE_BALANCES = [
    { leaveType: "ANNUAL",      totalDays: 21 },
    { leaveType: "SICK",        totalDays: 10 },
    { leaveType: "CASUAL",      totalDays: 6  },
    { leaveType: "EMERGENCY",   totalDays: 3  },
    { leaveType: "UNPAID",      totalDays: 0  },
    { leaveType: "MATERNITY",   totalDays: 90 },
    { leaveType: "PATERNITY",   totalDays: 5  },
    { leaveType: "HAJJ",        totalDays: 30 },
    { leaveType: "BEREAVEMENT", totalDays: 3  },
    { leaveType: "STUDY",       totalDays: 10 },
];

// Auto-generate employee code: EMP-001, EMP-002, etc.
async function generateEmployeeCode(): Promise<string> {
    const last = await prisma.employee.findFirst({
        where: { employeeCode: { startsWith: "EMP-" } },
        orderBy: { employeeCode: "desc" },
        select: { employeeCode: true },
    });
    let next = 1;
    if (last?.employeeCode) {
        const num = parseInt(last.employeeCode.replace("EMP-", ""));
        if (!isNaN(num)) next = num + 1;
    }
    return `EMP-${String(next).padStart(3, "0")}`;
}

export async function upsertEmployee(formData: FormData) {
    const session = await auth();
    if (!session || !["ADMIN", "HR"].includes((session.user as any).role)) {
        return { success: false, message: "Unauthorized" };
    }

    const id = formData.get("id") as string;
    const isNew = !id || id === "";

    const data: any = {
        firstName:        formData.get("firstName") as string,
        lastName:         formData.get("lastName") as string,
        email:            formData.get("email") as string,
        designation:      formData.get("designation") as string,
        department:       formData.get("department") as string,
        rollNumber:       formData.get("rollNumber") as string,
        phone:            formData.get("phone") || undefined,
        gender:           formData.get("gender") || undefined,
        maritalStatus:    formData.get("maritalStatus") || undefined,
        nationality:      formData.get("nationality") || undefined,
        governmentId:     formData.get("governmentId") || undefined,
        address:          formData.get("address") || undefined,
        permanentAddress: formData.get("permanentAddress") || undefined,
        emergencyContact: formData.get("emergencyContact") || undefined,
        emergencyPhone:   formData.get("emergencyPhone") || undefined,
        // Bank
        bankName:         formData.get("bankName") || undefined,
        accountNumber:    formData.get("accountNumber") || undefined,
        iban:             formData.get("iban") || undefined,
        ifscCode:         formData.get("ifscCode") || undefined,
        // Salary quick-reference
        basicSalary:         formData.get("basicSalary")         ? parseFloat(formData.get("basicSalary") as string)         : undefined,
        housingAllowance:    formData.get("housingAllowance")    ? parseFloat(formData.get("housingAllowance") as string)    : undefined,
        transportAllowance:  formData.get("transportAllowance")  ? parseFloat(formData.get("transportAllowance") as string)  : undefined,
        otherAllowance:      formData.get("otherAllowance")      ? parseFloat(formData.get("otherAllowance") as string)      : undefined,
        // Documents / Visa
        passportNumber:          formData.get("passportNumber") || undefined,
        passportExpiry:          formData.get("passportExpiry")          ? new Date(formData.get("passportExpiry") as string)          : undefined,
        emiratesId:              formData.get("emiratesId") || undefined,
        emiratesIdExpiry:        formData.get("emiratesIdExpiry")        ? new Date(formData.get("emiratesIdExpiry") as string)        : undefined,
        visaNumber:              formData.get("visaNumber") || undefined,
        visaExpiry:              formData.get("visaExpiry")              ? new Date(formData.get("visaExpiry") as string)              : undefined,
        visaType:                formData.get("visaType") || undefined,
        medicalInsuranceExpiry:  formData.get("medicalInsuranceExpiry")  ? new Date(formData.get("medicalInsuranceExpiry") as string)  : undefined,
        iloeInsuranceExpiry:     formData.get("iloeInsuranceExpiry")     ? new Date(formData.get("iloeInsuranceExpiry") as string)     : undefined,
        // Employment
        employmentType: (formData.get("employmentType") as string) || "FULL_TIME",
        workLocation:   formData.get("workLocation") || undefined,
        currentStatus:  (formData.get("currentStatus") as string) || "ACTIVE",
        managerId:      (formData.get("managerId") === "none" || !formData.get("managerId")) ? null : formData.get("managerId") as string,
        joiningDate:    formData.get("joiningDate")  ? new Date(formData.get("joiningDate") as string)  : new Date(),
        dateOfBirth:    formData.get("dateOfBirth")  ? new Date(formData.get("dateOfBirth") as string)  : null,
        probationDays:  parseInt(formData.get("probationDays") as string) || 90,
    };

    // Clean up empty strings / undefined
    Object.keys(data).forEach((key) => {
        const val = data[key];
        if (val === undefined || val === "undefined" || val === "null" || (typeof val === "string" && val.trim() === "")) {
            if (key !== "managerId") delete data[key];
            else data[key] = null;
        }
    });

    // Validation for new employees
    if (isNew) {
        if (!data.email || String(data.email).toLowerCase() === "null")
            return { success: false, message: "Email is mandatory for new records." };
        if (!data.firstName || !data.lastName)
            return { success: false, message: "First and Last names are mandatory." };
        if (!data.rollNumber)
            return { success: false, message: "Roll Number is mandatory." };
    }

    try {
        if (!isNew) {
            // ─── UPDATE ────────────────────────────────────────────────────
            await prisma.employee.update({ where: { id }, data });

            await prisma.auditLog.create({
                data: {
                    employeeId: id,
                    action: "UPDATE",
                    details: "Employee Master Data Updated",
                    changedBy: (session.user as any).email!,
                },
            });

            revalidatePath("/employees");
            return { success: true, message: "Employee updated successfully" };
        }

        // ─── CREATE + AUTO-PROVISION ────────────────────────────────────────
        const employeeCode = await generateEmployeeCode();
        const hashedPassword = await bcrypt.hash("password123", 10);

        // 1. Create User login
        const user = await prisma.user.create({
            data: {
                email: data.email,
                password: hashedPassword,
                role: "STAFF",
                name: `${data.firstName} ${data.lastName}`,
            },
        });

        // 2. Create Employee master record
        const employee = await prisma.employee.create({
            data: { ...data, userId: user.id, employeeCode },
        });

        const currentYear = new Date().getFullYear();

        // 3. Auto-create SalaryStructure
        await prisma.salaryStructure.create({
            data: {
                employeeId:        employee.id,
                basic:             data.basicSalary        || 0,
                housingAllowance:  data.housingAllowance   || 0,
                transportAllowance:data.transportAllowance || 0,
                medicalAllowance:  0,
                otherAllowances:   data.otherAllowance     || 0,
                ctc:               (data.basicSalary || 0) + (data.housingAllowance || 0) +
                                   (data.transportAllowance || 0) + (data.otherAllowance || 0),
                paymentMethod:     "BANK_TRANSFER",
                bankName:          data.bankName || null,
                iban:              data.iban || null,
            },
        });

        // 4. Auto-create Leave Balances for current year
        await prisma.leaveBalance.createMany({
            data: DEFAULT_LEAVE_BALANCES.map((lb) => ({
                employeeId: employee.id,
                leaveType:  lb.leaveType,
                totalDays:  lb.totalDays,
                usedDays:   0,
                year:       currentYear,
            })),
        });

        // 5. Welcome notification
        await prisma.notification.create({
            data: {
                employeeId: employee.id,
                title:   "Welcome to the Team! 🎉",
                message: `Welcome ${data.firstName}! Your employee profile (${employeeCode}) has been created. You can now access the self-service portal.`,
                type:    "SUCCESS",
                link:    "/staff-services",
            },
        });

        // 6. Audit log
        await prisma.auditLog.create({
            data: {
                employeeId: employee.id,
                action:     "EMPLOYEE_ONBOARDED",
                details:    `New employee ${data.firstName} ${data.lastName} (${employeeCode}) onboarded with full profile provisioning`,
                changedBy:  (session.user as any).email!,
            },
        });

        revalidatePath("/employees");
        revalidatePath("/attendance");
        revalidatePath("/payroll");
        revalidatePath("/leaves");
        revalidatePath("/visa");
        revalidatePath("/dashboard");

        return {
            success: true,
            message: `Employee ${data.firstName} ${data.lastName} (${employeeCode}) created! Attendance, Leave, Payroll & Visa profiles auto-provisioned.`,
        };
    } catch (error: any) {
        console.error("[UPSERT_EMPLOYEE_ERROR]", error);
        return { success: false, message: `Error: ${error.message || "Unknown error"}` };
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
            select: { id: true, firstName: true, lastName: true, email: true, designation: true, employeeCode: true },
        });
        return { success: true, data: employees };
    } catch {
        return { success: false, data: [] };
    }
}
