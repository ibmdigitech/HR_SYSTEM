import prisma from "@/lib/prisma";
import EmployeeList from "./employee-list";
import { auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function EmployeesPage() {
    const session = await auth();
    if (!session?.user) redirect("/login");

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
