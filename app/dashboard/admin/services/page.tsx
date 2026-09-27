import ConfigPageClient from "./ConfigPageClient";
import { requirePageRole } from "@/lib/auth/page-guard";
import { ROLES } from "@/lib/auth/roles";

export const metadata = {
    title: "Service Configuration | HR System",
    description: "Manage system-wide HR business rules and configurations.",
};

export default async function ServiceConfigPage() {
    // Centralized guard: system-wide business-rule configuration is restricted
    // to ADMIN and above, and a denied access is audit-logged.
    await requirePageRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);

    return (
        <div className="container mx-auto py-8">
            <ConfigPageClient />
        </div>
    );
}
