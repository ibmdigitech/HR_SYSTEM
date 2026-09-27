import prisma from "@/lib/prisma";
import EmployeeList from "./employee-list";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";

export default async function EmployeesPage() {
    // The employee master record is HR/ADMIN data. This page previously checked
    // only that a session existed, so any authenticated STAFF account could read
    // the full employee directory — including government IDs, bank details and
    // salary components. Requires an explicit capability now.
    await requirePagePermission(PERMISSIONS.EMPLOYEES_VIEW);

    const employees = await prisma.employee.findMany({
        orderBy: { firstName: 'asc' }
    });

    // Fetch managers (anyone in HR or Admin role, or just all employees for selection)
    const managers = await prisma.employee.findMany({
        orderBy: { firstName: 'asc' },
        select: {
            id: true,
            firstName: true,
            lastName: true
        }
    });

    return (
        <div className="p-8 max-w-7xl mx-auto">
            <EmployeeList
                initialEmployees={JSON.parse(JSON.stringify(employees))}
                managers={JSON.parse(JSON.stringify(managers))}
            />
        </div>
    );
}
