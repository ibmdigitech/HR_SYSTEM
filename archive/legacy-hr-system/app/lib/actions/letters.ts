"use server";

import prisma from "@/lib/prisma";
import { auth } from "@/auth";
import { revalidatePath } from "next/cache";

export async function saveLetterRecord(formData: FormData) {
    const session = await auth();
    if (!session?.user?.email) {
        return { success: false, message: "Not authenticated" };
    }

    const type = formData.get("type") as string;
    const recipientName = formData.get("recipientName") as string;
    const employeeId = formData.get("employeeId") as string || null;
    const details = formData.get("details") as string || null;

    if (!type || !recipientName) {
        return { success: false, message: "Missing required fields" };
    }

    try {
        await prisma.letterRecord.create({
            data: {
                type,
                recipientName,
                employeeId: employeeId || null,
                details,
            }
        });

        revalidatePath("/dashboard/letters");
        return { success: true, message: "Letter record saved successfully" };
    } catch (error) {
        console.error("[SAVE_LETTER_ERROR]", error);
        return { success: false, message: "Failed to save letter record" };
    }
}

export async function getLetterHistory() {
    const session = await auth();
    if (!session?.user?.email) {
        return { success: false, data: [] };
    }

    try {
        const letters = await prisma.letterRecord.findMany({
            orderBy: { generatedAt: "desc" },
            take: 50,
            include: { employee: true }
        });
        return { success: true, data: letters };
    } catch (error) {
        return { success: false, data: [] };
    }
}

export async function getEmployeesForLetter() {
    const session = await auth();
    if (!session?.user?.email) return { success: false, data: [] };

    try {
        const employees = await prisma.employee.findMany({
            where: { isActive: true },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                designation: true,
                department: true,
                joiningDate: true,
                salaryStructure: {
                    select: { ctc: true }
                }
            },
            orderBy: { firstName: "asc" }
        });
        return { success: true, data: employees };
    } catch (error) {
        return { success: false, data: [] };
    }
}
