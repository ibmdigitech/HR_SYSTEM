"use server";

import prisma from "@/lib/prisma";
import { auth } from "@/auth";
import { revalidatePath } from "next/cache";

export async function markNotificationRead(id: string) {
    const session = await auth();
    if (!session?.user?.email) return { success: false, message: "Not authenticated" };

    try {
        await prisma.notification.update({
            where: { id },
            data: { isRead: true }
        });
        revalidatePath("/notifications");
        return { success: true };
    } catch (e: any) {
        return { success: false, message: e.message };
    }
}

export async function markAllRead() {
    const session = await auth();
    if (!session?.user?.email) return { success: false, message: "Not authenticated" };

    try {
        const user = await prisma.user.findUnique({
            where: { email: session.user.email },
            include: { employee: true }
        });
        if (user?.employee) {
            await prisma.notification.updateMany({
                where: { employeeId: user.employee.id, isRead: false },
                data: { isRead: true }
            });
        }
        revalidatePath("/notifications");
        return { success: true };
    } catch (e: any) {
        return { success: false, message: e.message };
    }
}
