import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import { requirePageAnyPermission } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getCompanySettings } from "@/app/lib/actions/company-settings";
import { signOut } from "@/auth";
import { SettingsPageClient } from "@/components/settings/SettingsPageClient";

export default async function SettingsPage() {
    await requirePageAnyPermission([PERMISSIONS.SETTINGS_VIEW, PERMISSIONS.SETTINGS_MANAGE]);

    const session = await auth();

    const user = await prisma.user.findUnique({
        where: { email: session!.user!.email! },
        include: {
            employee: {
                include: { shift: true }
            }
        }
    });

    if (!user) redirect("/dashboard");

    const companySettings = await getCompanySettings();
    const isPowerUser = user.role === "ADMIN" || user.role === "HR";

    const emp = user.employee;
    const initials = `${user.name?.split(" ").map(n => n[0]).join("") || user.email[0].toUpperCase()}`;

    const handleSignOut = async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
    };

    return (
        <SettingsPageClient
            user={{
                name: user.name,
                email: user.email,
                role: user.role,
                createdAt: user.createdAt
            }}
            emp={emp ? {
                designation: emp.designation,
                department: emp.department,
                rollNumber: emp.rollNumber,
                employmentType: emp.employmentType,
                joiningDate: emp.joiningDate,
                workLocation: emp.workLocation
            } : null}
            companySettings={companySettings}
            isPowerUser={isPowerUser}
            initials={initials}
            onSignOut={handleSignOut}
        />
    );
}