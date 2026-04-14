"use server";

import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function submitVisaRequest(formData: FormData) {
    const session = await auth();
    if (!session?.user?.email) {
        return { message: "Not authenticated", success: false };
    }

    const user = await prisma.user.findUnique({
        where: { email: session.user.email },
        include: { employee: true }
    });

    if (!user?.employee) {
        return { message: "Employee profile not found", success: false };
    }

    const visaType = formData.get("visaType") as string;
    const destinationCountry = formData.get("destinationCountry") as string;
    const purpose = formData.get("purpose") as string;

    try {
        const visaRequest = await prisma.visaRequest.create({
            data: {
                employeeId: user.employee.id,
                visaType,
                destinationCountry,
                purpose,
                status: "PENDING",
            },
        });

        // Handle categorized attachments
        const categories = [
            "EID_PHOTO",
            "PASSPORT_PHOTO",
            "VISA_COPY",
            "EID_REQUEST_FORM",
            "MEDICAL_PAYMENT_BILL",
            "PASSPORT_COPY",
            "REQUEST_FORM",
            "MEDICAL_INSURANCE",
            "ILOE_INSURANCE"
        ];

        for (const category of categories) {
            const file = formData.get(category) as File;
            const docNumber = formData.get(`${category}_number`) as string;
            const docExpiry = formData.get(`${category}_expiry`) as string;

            if (file && file.size > 0) {
                // In a real app, upload to S3/Cloudinary. Here we mock the URL.
                await prisma.attachment.create({
                    data: {
                        visaRequestId: visaRequest.id,
                        fileName: file.name,
                        fileUrl: `/uploads/${category}_${Date.now()}_${file.name}`,
                        fileType: file.type,
                        category: category,
                        docNumber: docNumber || null,
                        docExpiry: docExpiry ? new Date(docExpiry) : null,
                    }
                });
            }
        }

        revalidatePath("/dashboard/visa");
        return { message: "Visa request submitted successfully", success: true };
    } catch (error) {
        console.error(error);
        return { message: "Failed to submit visa request", success: false };
    }
}

export async function updateVisaStatus(requestId: string, status: string, notes?: string) {
    const session = await auth();
    if (!session?.user?.email) return { success: false };

    // Check if HR/Admin
    const user = await prisma.user.findUnique({ where: { email: session.user.email } });
    if (!user || (user.role !== "HR" && user.role !== "ADMIN")) {
        return { message: "Unauthorized", success: false };
    }

    try {
        await prisma.visaRequest.update({
            where: { id: requestId },
            data: { status, notes }
        });
        revalidatePath("/dashboard/approvals/visa");
        return { message: "Status updated", success: true };
    } catch (error) {
        return { message: "Update failed", success: false };
    }
}
