import prisma from "@/lib/prisma";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import RequestClient from "./request-client";

// Helper to auto-seed service types if empty
async function ensureServiceTypes() {
    const count = await prisma.staffServiceType.count();
    if (count === 0) {
        await prisma.staffServiceType.createMany({
            data: [
                { name: "Salary Certificate Request", icon: "CreditCard", description: "Official document outlining your designation and monthly salary structure for banks/financial entities.", requiresAmount: false, requiresDates: false },
                { name: "NOC Certificate Request", icon: "FileText", description: "No Objection Certificate for travel, visa application, or driving license registry.", requiresAmount: false, requiresDates: false },
                { name: "Experience Certificate", icon: "Award", description: "Formal work experience letter outlining service duration and designation.", requiresAmount: false, requiresDates: false },
                { name: "Sponsorship Visa Renewal", icon: "Shield", description: "Submit expiry warnings and initiate official residence visa renewal.", requiresAmount: false, requiresDates: false },
                { name: "Salary Advance Loan", icon: "DollarSign", description: "Interest-free salary advance. Repayable over subsequent payroll cycles.", requiresAmount: true, requiresDates: false },
                { name: "Business Expenses Reimbursement", icon: "Plane", description: "Claim back travel, client entertainment, or operational expenses incurred.", requiresAmount: true, requiresDates: true }
            ]
        });
    }
}

export default async function RequestsPage() {
    const session = await auth();
    if (!session?.user?.email) redirect("/login");

    await ensureServiceTypes();

    const user = await prisma.user.findUnique({
        where: { email: session.user.email },
        include: { employee: true }
    });

    if (!user) redirect("/login");

    const role = user.role;
    const isStaffOnly = role === "STAFF";

    let requests: any[] = [];
    if (role === "ADMIN" || role === "HR") {
        // Admins and HR see all requests
        requests = await prisma.staffRequest.findMany({
            include: {
                employee: true,
                serviceType: true
            },
            orderBy: { createdAt: "desc" }
        });
    } else {
        // Managers and Staff see only their own requests
        // (For simplicity, managers submit/track their own requests here as well)
        if (user.employee) {
            requests = await prisma.staffRequest.findMany({
                where: { employeeId: user.employee.id },
                include: {
                    employee: true,
                    serviceType: true
                },
                orderBy: { createdAt: "desc" }
            });
        }
    }

    const serviceTypes = await prisma.staffServiceType.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" }
    });

    return (
        <div className="p-8 max-w-7xl mx-auto">
            <RequestClient
                requests={JSON.parse(JSON.stringify(requests))}
                serviceTypes={JSON.parse(JSON.stringify(serviceTypes))}
                isStaffOnly={isStaffOnly}
                role={role}
            />
        </div>
    );
}
