import prisma from "@/lib/prisma";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import NotificationsClient from "./notifications-client";

export default async function NotificationsPage() {
    const session = await auth();
    if (!session?.user?.email) redirect("/login");

    const user = await prisma.user.findUnique({
        where: { email: session.user.email },
        include: { employee: true }
    });

    if (!user) redirect("/login");

    let notifications: any[] = [];
    if (user.employee) {
        notifications = await prisma.notification.findMany({
            where: { employeeId: user.employee.id },
            orderBy: { createdAt: "desc" },
            take: 50 // Limit to latest 50 notifications
        });
    }

    return (
        <div className="p-8 max-w-7xl mx-auto">
            <NotificationsClient notifications={JSON.parse(JSON.stringify(notifications))} />
        </div>
    );
}
