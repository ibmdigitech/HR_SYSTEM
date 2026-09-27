import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
// Salary structure defines compensation. Restricted to payroll structure
// managers, and audit-logged on denial.

import { SalaryStructurePage } from "./page-client";

export default async function Page() {
    await requirePagePermission(PERMISSIONS.PAYROLL_STRUCTURE_MANAGE);
    return <SalaryStructurePage />;
}