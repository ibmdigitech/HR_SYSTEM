import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
// Letter templates are created from company data; management requires
// letter.template.manage (HR and above).

import { TemplatesPage } from "./page-client";

export default async function Page() {
    await requirePagePermission(PERMISSIONS.LETTER_TEMPLATE_MANAGE);
    return <TemplatesPage />;
}