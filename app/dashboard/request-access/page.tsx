import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
// Granting and revoking access is the most sensitive surface in the product.
// Requires access.approve (ADMIN and above).

import { RequestAccessPage } from "./page-client";

export default async function Page() {
    await requirePagePermission(PERMISSIONS.ACCESS_APPROVE);
    return <RequestAccessPage />;
}