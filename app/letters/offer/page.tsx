import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
// Generating an offer letter is an HR capability.

import { OfferLetterPage } from "./page-client";

export default async function Page() {
    await requirePagePermission(PERMISSIONS.LETTER_GENERATE);
    return <OfferLetterPage />;
}