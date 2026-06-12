'use server';

import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function createJobRequisition(prevState: any, formData: FormData) {
    const session = await auth();
    if (!session?.user?.email) return { message: "Not authenticated", success: false };

    const title = formData.get("title") as string;
    const department = formData.get("department") as string;
    const location = formData.get("location") as string;
    const description = formData.get("description") as string;
    const requirements = formData.get("requirements") as string;

    if (!title || !department)
        return { message: "Missing required fields", success: false };

    try {
        const user = await prisma.user.findUnique({
            where: { email: session.user.email },
            include: { employee: true },
        });

        if (!user?.employee) return { message: "Employee profile not found.", success: false };

        const job = await prisma.jobRequisition.create({
            data: {
                title,
                department,
                location,
                description,
                requirements,
                requestedById: user.employee.id,
                status: "OPEN"
            },
        });

        revalidatePath("/recruitment");
        return { message: "Job Requisition created successfully!", success: true };
    } catch (e) {
        console.error(e);
        return { message: "Database Error", success: false };
    }
}

export async function submitCandidateApplication(prevState: any, formData: FormData) {
    const firstName = formData.get("firstName") as string;
    const lastName = formData.get("lastName") as string;
    const email = formData.get("email") as string;
    const phone = formData.get("phone") as string;
    const jobId = formData.get("jobId") as string;

    if (!firstName || !lastName || !email || !jobId)
        return { message: "Missing required fields", success: false };

    try {
        const candidate = await prisma.candidate.create({
            data: {
                firstName,
                lastName,
                email,
                phone,
                jobId,
                status: "APPLIED"
            },
        });

        revalidatePath("/recruitment");
        return { message: "Application submitted successfully!", success: true };
    } catch (e) {
        console.error(e);
        return { message: "Database Error", success: false };
    }
}

export async function scheduleInterview(prevState: any, formData: FormData) {
    const session = await auth();
    if (!session?.user?.email) return { message: "Not authenticated", success: false };

    const candidateId = formData.get("candidateId") as string;
    const interviewerId = formData.get("interviewerId") as string;
    const scheduledAt = formData.get("scheduledAt") as string;

    if (!candidateId || !interviewerId || !scheduledAt)
        return { message: "Missing required fields", success: false };

    try {
        const interview = await prisma.interview.create({
            data: {
                candidateId,
                interviewerId,
                scheduledAt: new Date(scheduledAt),
                status: "SCHEDULED"
            },
        });

        await prisma.candidate.update({
            where: { id: candidateId },
            data: { status: "INTERVIEW" }
        });

        revalidatePath("/recruitment");
        return { message: "Interview scheduled successfully!", success: true };
    } catch (e) {
        console.error(e);
        return { message: "Database Error", success: false };
    }
}

export async function convertCandidateToEmployee(candidateId: string) {
    const session = await auth();
    if (!session?.user?.email) return { message: "Not authenticated", success: false };

    try {
        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user || (user.role !== "HR" && user.role !== "ADMIN"))
            return { message: "Unauthorized: HR role required", success: false };

        const candidate = await prisma.candidate.findUnique({
            where: { id: candidateId },
            include: { job: true }
        });

        if (!candidate) return { message: "Candidate not found", success: false };

        // 1. Create a dummy user for the employee to login
        const newUser = await prisma.user.create({
            data: {
                email: candidate.email,
                name: `${candidate.firstName} ${candidate.lastName}`,
                role: "STAFF"
            }
        });

        // 2. Create the Employee record
        const newEmployee = await prisma.employee.create({
            data: {
                userId: newUser.id,
                firstName: candidate.firstName,
                lastName: candidate.lastName,
                email: candidate.email,
                phone: candidate.phone,
                designation: candidate.job.title,
                department: candidate.job.department,
                joiningDate: new Date(),
                rollNumber: `TEMP-${Date.now()}` // Will be updated to auto-increment later
            }
        });

        // 3. Update candidate status
        await prisma.candidate.update({
            where: { id: candidateId },
            data: { status: "HIRED" }
        });

        revalidatePath("/employees");
        revalidatePath("/recruitment");
        return { message: "Candidate successfully onboarded as Employee!", success: true };
    } catch (e) {
        console.error(e);
        return { message: "Database Error", success: false };
    }
}
