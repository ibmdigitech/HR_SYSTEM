import prisma from "@/lib/prisma";
import { requirePageAnyPermission } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { format } from "date-fns";
import { NewOvertimeForm } from "@/components/payroll/NewOvertimeForm";
import { Badge } from "@/components/ui/badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Clock, AlertCircle, CheckCircle2 } from "lucide-react";

export default async function OvertimePage() {
    // Overtime affects payroll, so it requires a payroll capability rather than
    // an inline role list. MANAGER does not hold payroll capabilities, so a
    // manager is now correctly excluded (previously the inline list allowed them).
    await requirePageAnyPermission([PERMISSIONS.PAYROLL_VIEW, PERMISSIONS.PAYROLL_OVERTIME_MANAGE]);

    const overtimes = await prisma.overtime.findMany({
        include: { employee: true },
        orderBy: { date: 'desc' }
    });

    const activeEmployees = await prisma.employee.findMany({
        where: { isActive: true },
        orderBy: { firstName: 'asc' }
    });

    const totalOvertimeThisMonth = overtimes.filter(o => {
        const d = new Date(o.date);
        const now = new Date();
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).reduce((acc, o) => acc + o.hours, 0);

    return (
        <div className="p-4 sm:p-6 md:p-8 space-y-6 sm:space-y-8">
            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 bg-white dark:bg-slate-900 p-4 sm:p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                <div className="min-w-0">
                    <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-3">
                        <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg shrink-0">
                            <Clock className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
                        </div>
                        Overtime Management
                    </h1>
                    <p className="text-slate-500 mt-2">Log and track employee overtime hours and calculate pay.</p>
                </div>
                <div className="flex items-center gap-4 justify-between sm:justify-end">
                    <div className="text-right sm:mr-4">
                        <p className="text-sm font-medium text-slate-500">Total Hours (This Month)</p>
                        <p className="text-2xl font-bold text-indigo-600">{totalOvertimeThisMonth} hrs</p>
                    </div>
                    <NewOvertimeForm employees={activeEmployees} />
                </div>
            </div>

            {/* MOBILE: card list, same six fields as the table below. */}
            <ul className="md:hidden divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                {overtimes.length === 0 ? (
                    <li className="p-12 text-center text-slate-500">
                        <AlertCircle className="mx-auto h-8 w-8 mb-3 text-slate-400" />
                        No overtime records found
                    </li>
                ) : (
                    overtimes.map((record) => (
                        <li key={record.id} className="p-4 flex flex-col gap-2.5">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="font-medium text-slate-900 dark:text-slate-100 truncate">
                                        {record.employee.firstName} {record.employee.lastName}
                                    </p>
                                    <p className="text-[11px] text-slate-500">
                                        {record.employee.employeeCode || record.employee.id.substring(0, 6)}
                                    </p>
                                </div>
                                <span className="shrink-0 text-sm font-medium text-indigo-600">
                                    AED {record.totalPay.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                </span>
                            </div>

                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                                <span className="text-slate-500">
                                    {format(new Date(record.date), "MMM dd, yyyy")}
                                </span>
                                <span className="font-medium text-slate-900">
                                    {record.hours} hrs @ {record.ratePerHour.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                </span>
                            </div>

                            <div>
                                <Badge className={`px-3 py-1 rounded-full border-0 ${
                                    record.status === 'APPROVED' ? 'bg-blue-100 text-blue-700 hover:bg-blue-100' :
                                        record.status === 'PAID' ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100' :
                                            record.status === 'REJECTED' ? 'bg-rose-100 text-rose-700 hover:bg-rose-100' :
                                                'bg-amber-100 text-amber-700 hover:bg-amber-100'
                                }`}>
                                    {record.status === 'PAID' && <CheckCircle2 className="w-3 h-3 mr-1" />}
                                    {record.status}
                                </Badge>
                            </div>
                        </li>
                    ))
                )}
            </ul>

            <div className="hidden md:block bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
                <Table>
                    <TableHeader className="bg-slate-50/50 dark:bg-slate-800/50">
                        <TableRow>
                            <TableHead className="font-semibold text-slate-600">Employee</TableHead>
                            <TableHead className="font-semibold text-slate-600">Date</TableHead>
                            <TableHead className="font-semibold text-slate-600 text-right">Hours</TableHead>
                            <TableHead className="font-semibold text-slate-600 text-right">Rate/Hour</TableHead>
                            <TableHead className="font-semibold text-slate-600 text-right">Total Pay (AED)</TableHead>
                            <TableHead className="font-semibold text-slate-600 text-center">Status</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {overtimes.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} className="text-center py-12 text-slate-500">
                                    <AlertCircle className="mx-auto h-8 w-8 text-slate-400 mb-3" />
                                    No overtime records found
                                </TableCell>
                            </TableRow>
                        ) : (
                            overtimes.map((record) => (
                                <TableRow key={record.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-colors">
                                    <TableCell>
                                        <div className="font-medium text-slate-900 dark:text-slate-100">
                                            {record.employee.firstName} {record.employee.lastName}
                                        </div>
                                        <div className="text-xs text-slate-500">
                                            {record.employee.employeeCode || record.employee.id.substring(0,6)}
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-slate-600">
                                        {format(new Date(record.date), "MMM dd, yyyy")}
                                    </TableCell>
                                    <TableCell className="text-right font-medium text-slate-900">
                                        {record.hours}
                                    </TableCell>
                                    <TableCell className="text-right text-slate-600">
                                        {record.ratePerHour.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                    </TableCell>
                                    <TableCell className="text-right font-medium text-indigo-600">
                                        {record.totalPay.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                    </TableCell>
                                    <TableCell className="text-center">
                                        <Badge className={`px-3 py-1 rounded-full border-0 ${
                                            record.status === 'APPROVED' ? 'bg-blue-100 text-blue-700 hover:bg-blue-100' :
                                            record.status === 'PAID' ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100' :
                                            record.status === 'REJECTED' ? 'bg-rose-100 text-rose-700 hover:bg-rose-100' :
                                            'bg-amber-100 text-amber-700 hover:bg-amber-100'
                                        }`}>
                                            {record.status === 'PAID' && <CheckCircle2 className="w-3 h-3 mr-1" />}
                                            {record.status}
                                        </Badge>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
