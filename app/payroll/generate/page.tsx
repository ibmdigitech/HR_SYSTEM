import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
// Payroll generation mutates salary records. Requires an explicit payroll
// capability instead of an inline role list. Middleware blocks anonymous
// visitors; this guard is the authoritative role check.

import { PayrollGeneratePage } from "./page-client";

export default async function Page() {
    await requirePagePermission(PERMISSIONS.PAYROLL_GENERATE);
    return <PayrollGeneratePage />;
}