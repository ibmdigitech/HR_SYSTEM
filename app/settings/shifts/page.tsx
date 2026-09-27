import { requirePageAnyPermission } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
// Shift configuration is an attendance-management capability.

import { ShiftsPage } from "./page-client";

export default async function Page() {
    await requirePageAnyPermission([PERMISSIONS.ATTENDANCE_SHIFT_MANAGE]);
    return <ShiftsPage />;
}