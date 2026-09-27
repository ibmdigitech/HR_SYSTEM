import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
// Generating an appointment letter is an HR capability.

import { AppointmentLetterPage } from "./page-client";

export default async function Page() {
    await requirePagePermission(PERMISSIONS.LETTER_GENERATE);
    return <AppointmentLetterPage />;
}