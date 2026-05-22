'use server';

import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function requestRoleAccess(prevState: any, formData: FormData) {
    const session = await auth();
    if (!session?.user?.email) {
        return { message: "Not authenticated", success: false };
    }

    const role = formData.get("role") as string;
    if (!role || !["MANAGER", "HR"].includes(role)) {
        return { message: "Invalid role selected", success: false };
    }

    try {
        const user = await prisma.user.findUnique({
            where: { email: session.user.email },
        });

        if (!user) return { message: "User not found", success: false };

        // Check availability
        const existing = await prisma.roleRequest.findFirst({
            where: {
                userId: user.id,
                status: "PENDING",
            },
        });

        if (existing) {
            return { message: "You already have a pending request.", success: false };
        }

        await prisma.roleRequest.create({
            data: {
                userId: user.id,
                requestedRole: role,
                status: "PENDING",
            },
        });

        revalidatePath("/dashboard");
        return { message: "Success", success: true };
    } catch (e) {
        console.error(e);
        return { message: "Database Error", success: false };
    }
}
