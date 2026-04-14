import Link from "next/link";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Download, DollarSign, CreditCard, History, Plus } from "lucide-react";
import { redirect } from "next/navigation";

export default async function PayrollPage() {
    const session = await auth();
    if (!session?.user?.email) redirect("/login");

    const user = await prisma.user.findUnique({
        where: { email: session.user.email },
        include: { employee: true }
    });

    if (!user) redirect("/login");

    const userRole = user.role;

    let salaryRecords: any[] = [];
    if (userRole === "ADMIN" || userRole === "HR") {
        salaryRecords = await prisma.salaryRecord.findMany({
            include: { employee: true },
            orderBy: [{ year: 'desc' }, { month: 'desc' }],
            take: 20
        });
    } else if (user.employee) {
        salaryRecords = await prisma.salaryRecord.findMany({
            where: { employeeId: user.employee.id },
            include: { employee: true },
            orderBy: [{ year: 'desc' }, { month: 'desc' }],
            take: 12
        });
    }

    const totalPaid = salaryRecords.reduce((acc, curr) => acc + curr.netSalary, 0);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Payroll</h1>
                    <p className="text-slate-500 dark:text-slate-400">View and manage salary distributions.</p>
                </div>
                {(userRole === "ADMIN" || userRole === "HR") && (
                    <Link href="/payroll/generate">
                        <Button className="gap-2">
                            <Plus className="h-4 w-4" />
                            Run Payroll
                        </Button>
                    </Link>
                )}
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-slate-500">
                            Total Disbursed
                        </CardTitle>
                        <DollarSign className="h-4 w-4 text-emerald-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">${totalPaid.toLocaleString()}</div>
                        <p className="text-xs text-slate-500">
                            Total from records shown
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-slate-500">
                            Active Employees
                        </CardTitle>
                        <CreditCard className="h-4 w-4 text-slate-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold italic">Live-Sync</div>
                        <p className="text-xs text-slate-500">
                            All employees eligible
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-slate-500">
                            Next Payout
                        </CardTitle>
                        <History className="h-4 w-4 text-amber-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">1st of Month</div>
                        <p className="text-xs text-slate-500">
                            Estimated schedule
                        </p>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Payroll History</CardTitle>
                    <CardDescription>Recent salary distributions</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Employee</TableHead>
                                <TableHead>Period</TableHead>
                                <TableHead>Amount</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {salaryRecords.map((record: any) => (
                                <TableRow key={record.id}>
                                    <TableCell className="font-medium">
                                        {record.employee.firstName} {record.employee.lastName}
                                    </TableCell>
                                    <TableCell>{record.month}/{record.year}</TableCell>
                                    <TableCell className="font-bold">${record.netSalary.toLocaleString()}</TableCell>
                                    <TableCell>
                                        <Badge variant={record.status === "PAID" ? "default" : "secondary"}>
                                            {record.status}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button variant="ghost" size="sm" className="gap-2">
                                            <Download className="h-4 w-4" />
                                            Statement
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}
