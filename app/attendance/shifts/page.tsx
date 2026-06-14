import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShiftAssignmentDropdown } from "@/components/attendance/ShiftAssignmentDropdown";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    CalendarClock,
    Clock,
    Users,
    UserCheck,
    AlertCircle,
    ChevronLeft,
    Sun,
    Moon,
    Sunrise,
    Settings
} from "lucide-react";
import Link from "next/link";

const shiftIcons: Record<string, any> = {
    morning: Sunrise,
    day: Sun,
    night: Moon,
};

function getShiftIcon(name: string) {
    const lower = name.toLowerCase();
    if (lower.includes("night") || lower.includes("evening")) return Moon;
    if (lower.includes("morning") || lower.includes("early")) return Sunrise;
    return Sun;
}

const weeklyOffLabels: Record<string, string> = {
    "SAT_SUN": "Sat & Sun",
    "SUN": "Sunday",
    "FRI_SAT": "Fri & Sat",
    "2ND_SAT_SUN": "2nd Sat & Sun",
    "ALT_SAT_SUN": "Alt Sat & Sun"
};

export default async function ShiftRosterPage() {
    const session = await auth();
    if (!session?.user?.email) redirect("/login");

    const user = await prisma.user.findUnique({
        where: { email: session.user.email },
        include: { employee: true }
    });

    if (!user) redirect("/login");

    const userRole = user.role;
    const isStaff = userRole === "STAFF";
    const isManager = userRole === "MANAGER";
    const isAdmin = userRole === "ADMIN" || userRole === "HR";
    const canEdit = isAdmin || isManager;

    // For staff: show only their own shift
    if (isStaff && user.employee) {
        const emp = await prisma.employee.findUnique({
            where: { id: user.employee.id },
            include: { shift: true }
        });

        return (
            <div className="max-w-3xl mx-auto p-4 md:p-8 space-y-6">
                <Link href="/attendance" className="inline-flex items-center text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors">
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Back to Attendance
                </Link>

                <Card className="rounded-2xl border-slate-200 dark:border-slate-800 shadow-lg overflow-hidden">
                    <div className="bg-gradient-to-br from-teal-600 via-emerald-700 to-teal-800 p-8 text-white relative">
                        <div className="absolute top-0 right-0 w-[250px] h-[250px] bg-white/5 rounded-full blur-[60px] -translate-y-1/2 translate-x-1/2" />
                        <div className="relative z-10 flex items-center gap-4">
                            <div className="p-4 bg-white/10 rounded-2xl backdrop-blur-md">
                                <CalendarClock className="h-8 w-8 text-teal-200" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-black tracking-tight">My Shift Schedule</h1>
                                <p className="text-teal-200 font-medium text-sm">Your assigned working hours and weekly off days</p>
                            </div>
                        </div>
                    </div>

                    <CardContent className="p-8">
                        {emp?.shift ? (
                            <div className="space-y-6">
                                <div className="flex items-center gap-4">
                                    <div className="p-3 bg-indigo-50 rounded-xl">
                                        {(() => { const Icon = getShiftIcon(emp.shift.name); return <Icon className="h-6 w-6 text-indigo-600" />; })()}
                                    </div>
                                    <div>
                                        <h2 className="text-2xl font-black text-slate-900 dark:text-white">{emp.shift.name}</h2>
                                        <p className="text-sm text-slate-500 font-medium">Your current shift assignment</p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-xl text-center">
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Start Time</p>
                                        <p className="text-xl font-black text-emerald-600 mt-1">{emp.shift.startTime}</p>
                                    </div>
                                    <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-xl text-center">
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">End Time</p>
                                        <p className="text-xl font-black text-rose-600 mt-1">{emp.shift.endTime}</p>
                                    </div>
                                    <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-xl text-center">
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Late Grace</p>
                                        <p className="text-xl font-black text-amber-600 mt-1">{emp.shift.lateThreshold} min</p>
                                    </div>
                                    <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-xl text-center">
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Weekly Off</p>
                                        <p className="text-sm font-black text-indigo-600 mt-1">{weeklyOffLabels[emp.shift.weeklyOffs] || emp.shift.weeklyOffs}</p>
                                    </div>
                                </div>

                                <div className="p-4 bg-blue-50 dark:bg-blue-950/20 rounded-xl border border-blue-100 dark:border-blue-900/30">
                                    <p className="text-xs font-bold text-blue-700">ℹ️ Monthly Late Threshold: <span className="font-black">{emp.shift.monthlyLateThresholdHours} hours</span></p>
                                    <p className="text-xs text-blue-600 mt-1">Exceeding this will trigger salary deduction per company policy.</p>
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center py-12 text-center">
                                <AlertCircle className="h-12 w-12 text-slate-300 mb-4" />
                                <h3 className="text-lg font-bold text-slate-700">No Shift Assigned</h3>
                                <p className="text-slate-400 mt-2 max-w-sm">You don't have a shift assigned yet. Please contact your manager or HR department.</p>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        );
    }

    // For HR/Admin/Manager: Full roster view
    const shifts = await prisma.shift.findMany({
        include: {
            employees: {
                where: {
                    isActive: true,
                    ...(isManager && user.employee ? { managerId: user.employee.id } : {})
                },
                orderBy: { firstName: 'asc' }
            },
            _count: { select: { employees: true } }
        },
        orderBy: { name: 'asc' }
    });

    const unassignedQuery: any = { isActive: true, shiftId: null };
    if (isManager && user.employee) {
        unassignedQuery.managerId = user.employee.id;
    }
    const unassigned = await prisma.employee.findMany({
        where: unassignedQuery,
        orderBy: { firstName: 'asc' }
    });

    const allShiftsFlat = shifts.map(s => ({ id: s.id, name: s.name, startTime: s.startTime, endTime: s.endTime }));
    const totalAssigned = shifts.reduce((acc, s) => acc + s.employees.length, 0);

    return (
        <div className="max-w-7xl mx-auto p-4 md:p-8 space-y-8">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-3">
                        <div className="p-2.5 bg-teal-600 rounded-xl shadow-lg shadow-teal-600/20">
                            <CalendarClock className="h-6 w-6 text-white" />
                        </div>
                        Shift Roster
                    </h1>
                    <p className="text-slate-500 mt-1 ml-14">
                        {isManager ? "Manage shift assignments for your team" : "View and manage all employee shift assignments"}
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <Link href="/attendance">
                        <Button variant="outline" className="rounded-xl font-bold text-sm">
                            <ChevronLeft className="h-4 w-4 mr-1" /> Attendance
                        </Button>
                    </Link>
                    {isAdmin && (
                        <Link href="/settings/shifts">
                            <Button variant="outline" className="rounded-xl font-bold text-sm border-indigo-200 text-indigo-700 hover:bg-indigo-50">
                                <Settings className="h-4 w-4 mr-1" /> Manage Shifts
                            </Button>
                        </Link>
                    )}
                </div>
            </div>

            {/* Stats */}
            <div className="grid gap-4 md:grid-cols-4">
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-4">
                    <div className="p-3 bg-teal-50 rounded-xl shrink-0"><CalendarClock className="h-5 w-5 text-teal-600" /></div>
                    <div>
                        <p className="text-2xl font-black text-slate-900 dark:text-white">{shifts.length}</p>
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Active Shifts</p>
                    </div>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-4">
                    <div className="p-3 bg-emerald-50 rounded-xl shrink-0"><UserCheck className="h-5 w-5 text-emerald-600" /></div>
                    <div>
                        <p className="text-2xl font-black text-emerald-600">{totalAssigned}</p>
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Assigned</p>
                    </div>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-4">
                    <div className="p-3 bg-amber-50 rounded-xl shrink-0"><AlertCircle className="h-5 w-5 text-amber-600" /></div>
                    <div>
                        <p className="text-2xl font-black text-amber-600">{unassigned.length}</p>
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Unassigned</p>
                    </div>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-4">
                    <div className="p-3 bg-indigo-50 rounded-xl shrink-0"><Users className="h-5 w-5 text-indigo-600" /></div>
                    <div>
                        <p className="text-2xl font-black text-indigo-600">{totalAssigned + unassigned.length}</p>
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Staff</p>
                    </div>
                </div>
            </div>

            {/* Shift Cards */}
            <div className="space-y-6">
                {shifts.map(shift => {
                    const Icon = getShiftIcon(shift.name);
                    return (
                        <Card key={shift.id} className="rounded-2xl border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                            <CardHeader className="bg-slate-50/50 dark:bg-slate-900/50 px-6 py-4 border-b border-slate-100 dark:border-slate-800">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-xl">
                                            <Icon className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                                        </div>
                                        <div>
                                            <CardTitle className="text-base font-black">{shift.name}</CardTitle>
                                            <p className="text-xs text-slate-500 font-medium mt-0.5">
                                                {shift.startTime} – {shift.endTime} · Grace: {shift.lateThreshold}min · Off: {weeklyOffLabels[shift.weeklyOffs] || shift.weeklyOffs}
                                            </p>
                                        </div>
                                    </div>
                                    <Badge className="bg-indigo-100 text-indigo-700 border-0 font-bold">
                                        {shift.employees.length} employee{shift.employees.length !== 1 ? "s" : ""}
                                    </Badge>
                                </div>
                            </CardHeader>
                            <CardContent className="p-0">
                                {shift.employees.length === 0 ? (
                                    <div className="p-8 text-center text-slate-400 text-sm italic">
                                        No {isManager ? "team members" : "employees"} assigned to this shift
                                    </div>
                                ) : (
                                    <Table>
                                        <TableHeader>
                                            <TableRow className="hover:bg-transparent">
                                                <TableHead className="font-bold text-xs uppercase tracking-wider py-3">Employee</TableHead>
                                                <TableHead className="font-bold text-xs uppercase tracking-wider py-3">Department</TableHead>
                                                <TableHead className="font-bold text-xs uppercase tracking-wider py-3">Designation</TableHead>
                                                {canEdit && <TableHead className="font-bold text-xs uppercase tracking-wider py-3 text-right">Reassign</TableHead>}
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {shift.employees.map((emp: any) => (
                                                <TableRow key={emp.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-colors">
                                                    <TableCell className="py-3">
                                                        <div className="flex items-center gap-3">
                                                            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white text-xs font-black shrink-0">
                                                                {emp.firstName[0]}{emp.lastName[0]}
                                                            </div>
                                                            <div>
                                                                <div className="font-bold text-sm text-slate-900 dark:text-slate-100">{emp.firstName} {emp.lastName}</div>
                                                                <div className="text-[10px] text-slate-400">{emp.employeeCode || emp.id.substring(0, 6)}</div>
                                                            </div>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-sm text-slate-600 dark:text-slate-400">{emp.department}</TableCell>
                                                    <TableCell className="text-sm text-slate-600 dark:text-slate-400">{emp.designation}</TableCell>
                                                    {canEdit && (
                                                        <TableCell className="text-right">
                                                            <ShiftAssignmentDropdown
                                                                employeeId={emp.id}
                                                                employeeName={`${emp.firstName} ${emp.lastName}`}
                                                                currentShiftId={emp.shiftId}
                                                                shifts={allShiftsFlat}
                                                                canEdit={true}
                                                            />
                                                        </TableCell>
                                                    )}
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                )}
                            </CardContent>
                        </Card>
                    );
                })}

                {/* Unassigned Employees */}
                {unassigned.length > 0 && (
                    <Card className="rounded-2xl border-amber-200 dark:border-amber-800/30 shadow-sm overflow-hidden">
                        <CardHeader className="bg-amber-50/50 dark:bg-amber-950/20 px-6 py-4 border-b border-amber-100 dark:border-amber-800/30">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-xl">
                                        <AlertCircle className="h-5 w-5 text-amber-600" />
                                    </div>
                                    <div>
                                        <CardTitle className="text-base font-black text-amber-800 dark:text-amber-300">Unassigned Employees</CardTitle>
                                        <p className="text-xs text-amber-600 font-medium mt-0.5">These {isManager ? "team members" : "employees"} have no shift assigned yet</p>
                                    </div>
                                </div>
                                <Badge className="bg-amber-100 text-amber-700 border-0 font-bold">{unassigned.length}</Badge>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0">
                            <Table>
                                <TableHeader>
                                    <TableRow className="hover:bg-transparent">
                                        <TableHead className="font-bold text-xs uppercase tracking-wider py-3">Employee</TableHead>
                                        <TableHead className="font-bold text-xs uppercase tracking-wider py-3">Department</TableHead>
                                        <TableHead className="font-bold text-xs uppercase tracking-wider py-3">Designation</TableHead>
                                        {canEdit && <TableHead className="font-bold text-xs uppercase tracking-wider py-3 text-right">Assign Shift</TableHead>}
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {unassigned.map((emp: any) => (
                                        <TableRow key={emp.id} className="hover:bg-amber-50/50 transition-colors">
                                            <TableCell className="py-3">
                                                <div className="flex items-center gap-3">
                                                    <div className="h-8 w-8 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 text-xs font-black shrink-0">
                                                        {emp.firstName[0]}{emp.lastName[0]}
                                                    </div>
                                                    <div>
                                                        <div className="font-bold text-sm text-slate-900 dark:text-slate-100">{emp.firstName} {emp.lastName}</div>
                                                        <div className="text-[10px] text-slate-400">{emp.employeeCode || emp.id.substring(0, 6)}</div>
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-sm text-slate-600">{emp.department}</TableCell>
                                            <TableCell className="text-sm text-slate-600">{emp.designation}</TableCell>
                                            {canEdit && (
                                                <TableCell className="text-right">
                                                    <ShiftAssignmentDropdown
                                                        employeeId={emp.id}
                                                        employeeName={`${emp.firstName} ${emp.lastName}`}
                                                        currentShiftId={null}
                                                        shifts={allShiftsFlat}
                                                        canEdit={true}
                                                    />
                                                </TableCell>
                                            )}
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                )}

                {shifts.length === 0 && unassigned.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-20 border-2 border-dashed border-slate-200 rounded-2xl text-center">
                        <CalendarClock className="h-12 w-12 text-slate-300 mb-4" />
                        <p className="font-bold text-slate-600">No Shifts Configured</p>
                        <p className="text-slate-400 text-sm mt-1">
                            {isAdmin ? "Go to Settings → Shift Manager to create shift policies first." : "No shifts have been created by HR yet."}
                        </p>
                        {isAdmin && (
                            <Link href="/settings/shifts" className="mt-4">
                                <Button className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl">
                                    <Settings className="h-4 w-4 mr-2" /> Create Shifts
                                </Button>
                            </Link>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
