"use server";

import prisma from "@/lib/prisma";
import { auth } from "@/auth";
import { revalidatePath } from "next/cache";

/**
 * Marks one notification read.
 *
 * SCOPED TO THE CALLER — this was an IDOR.
 *
 * The original version authenticated the session and then ran
 * `prisma.notification.update({ where: { id } })` with nothing tying that id to
 * the caller. `Notification` rows are cuid-keyed and the ids are handed to the
 * browser in the page payload, so any authenticated user could mark ANY
 * employee's notifications read by passing someone else's id. Read state is not
 * sensitive, but it is another user's data, and an unscoped write keyed only by a
 * client-supplied id is the same shape as a real vulnerability.
 *
 * The fix resolves the caller's employee first and filters on it, so an id
 * belonging to someone else simply matches nothing. `updateMany` is used rather
 * than `update` precisely so a non-matching id is a zero-row result instead of
 * Prisma's "record not found" throw, which would have leaked the existence of
 * other users' notification ids.
 */
export async function markNotificationRead(id: string) {
    const session = await auth();
    if (!session?.user?.email) return { success: false, message: "Not authenticated" };

    try {
        const user = await prisma.user.findUnique({
            where: { email: session.user.email },
            select: { employee: { select: { id: true } } }
        });

        if (!user?.employee) {
            return { success: false, message: "No employee record for this account." };
        }

        const result = await prisma.notification.updateMany({
            where: { id, employeeId: user.employee.id },
            data: { isRead: true }
        });

        if (result.count === 0) {
            return { success: false, message: "Notification not found." };
        }

        revalidatePath("/notifications");
        return { success: true };
    } catch (e: unknown) {
        return { success: false, message: (e instanceof Error ? e.message : "Unknown error") };
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
    } catch (e: unknown) {
        return { success: false, message: (e instanceof Error ? e.message : "Unknown error") };
    }
}
