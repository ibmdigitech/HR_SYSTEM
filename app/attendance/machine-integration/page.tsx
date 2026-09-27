import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
// Biometric import writes attendance records. Requires the same
// attendance.import capability the API route and server action enforce.

import { MachineIntegrationPage } from "./page-client";

export default async function Page() {
    await requirePagePermission(PERMISSIONS.ATTENDANCE_IMPORT);
    return <MachineIntegrationPage />;
}