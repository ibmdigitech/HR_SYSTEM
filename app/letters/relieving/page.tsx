import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
// Generating a relieving letter is an HR capability.

import { RelievingLetterPage } from "./page-client";

export default async function Page() {
    await requirePagePermission(PERMISSIONS.LETTER_GENERATE);
    return <RelievingLetterPage />;
}