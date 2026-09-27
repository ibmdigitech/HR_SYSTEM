import * as React from "react";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Calendar as CalendarIcon, Clock, Filter, UserCheck, Users, MapPin, Cpu, CalendarClock } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { redirect } from "next/navigation";
import { CheckInButton } from "@/components/attendance/CheckInButton";
import { AttendanceDownloadButton } from "@/components/attendance/AttendanceDownloadButton";
import Link from "next/link";

export default async function AttendancePage({
    searchParams,
}: {
    searchParams: Promise<{ all?: string; view?: string }>;
}) {
    const session = await auth();
    if (!session?.user?.email) redirect("/login");

    const user = await prisma.user.findUnique({
        where: { email: session.user.email },
        include: { employee: true }
    });

    if (!user) redirect("/login");

    const userRole = user.role;
    const params = await searchParams;
    const showAll = params.all === "true";
    const view = params.view || ((userRole === "ADMIN" || userRole === "HR" || userRole === "MANAGER") ? "today" : "history");

    // Fetch Attendance for today/recent
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

    const allActiveEmployees = await prisma.employee.findMany({
        where: { isActive: true },
        include: { shift: true },
        orderBy: { firstName: 'asc' }
    });

    const todayRecords = await prisma.attendance.findMany({
        where: {
            date: {
                gte: today,
                lt: tomorrow
            }
        },
        include: { employee: { include: { shift: true } } }
    });

    const presentToday = todayRecords.filter(r => r.status === "PRESENT" || r.status === "LATE").length;
    const lateToday = todayRecords.filter(r => r.status === "LATE" || r.lateMinutes > 0).length;
    const leavesToday = todayRecords.filter(r => r.status === "LEAVE").length;
    const absentToday = Math.max(0, allActiveEmployees.length - presentToday - leavesToday);

    const completedToday = todayRecords.filter(r => r.checkOut).length;
    
    let avgHours = 0;
    if (completedToday > 0) {
        const totalMs = todayRecords.reduce((acc, r) => {
            if (r.checkIn && r.checkOut) {
                return acc + (new Date(r.checkOut).getTime() - new Date(r.checkIn).getTime());
            }
            return acc;
        }, 0);
        avgHours = totalMs / (completedToday * 1000 * 60 * 60);
    }

    // Determine records to display in the main table
    let displayRecords: any[] = [];
    if (view === "today") {
        displayRecords = allActiveEmployees.map(emp => {
            const record = todayRecords.find(r => r.employeeId === emp.id);
            return {
                id: record?.id || `temp-${emp.id}`,
                employee: emp,
                date: record?.date || today,
                checkIn: record?.checkIn || null,
                checkOut: record?.checkOut || null,
                status: record?.status || "NO_RECORD",
                lateMinutes: record?.lateMinutes || 0,
                shift: emp.shift || null
            };
        });
    } else {
        if (userRole === "ADMIN" || userRole === "HR" || userRole === "MANAGER") {
            displayRecords = await prisma.attendance.findMany({
                include: { employee: { include: { shift: true } } },
                orderBy: { date: 'desc' },
                ...(showAll ? {} : { take: 20 })
            });
        } else if (user.employee) {
            displayRecords = await prisma.attendance.findMany({
                where: { employeeId: user.employee.id },
                include: { employee: { include: { shift: true } } },
                orderBy: { date: 'desc' },
                ...(showAll ? {} : { take: 10 })
            });
        }
    }

    return (
        <div className="space-y-8 p-4 md:p-8 w-full max-w-7xl mx-auto">
            {/* Header Area */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-gradient-to-r from-emerald-900 to-teal-950 p-8 rounded-[2rem] shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3"></div>
                <div className="absolute bottom-0 left-0 w-72 h-72 bg-teal-500/20 rounded-full blur-3xl translate-y-1/3 -translate-x-1/4"></div>
                
                <div className="relative z-10">
                    <h1 className="text-4xl md:text-5xl font-black tracking-tight text-white mb-2">Attendance Hub</h1>
                    <p className="text-emerald-100 text-sm md:text-base font-medium max-w-xl">
                        Monitor daily presence, track shift compliance, and manage workforce availability in real-time.
                    </p>
                </div>
                <div className="relative z-10 flex flex-col sm:flex-row gap-3 flex-wrap">
                    <Link href="/attendance/shifts">
                        <Button variant="secondary" className="gap-2 w-full sm:w-auto rounded-xl font-bold bg-white/10 text-white hover:bg-white/20 border-0 backdrop-blur-md">
                            <CalendarClock className="h-4 w-4" />
                            Shift Roster
                        </Button>
                    </Link>
                    {(userRole === "ADMIN" || userRole === "HR") && (
                        <Link href="/attendance/machine-integration">
                            <Button variant="secondary" className="gap-2 w-full sm:w-auto rounded-xl font-bold bg-white/10 text-white hover:bg-white/20 border-0 backdrop-blur-md">
                                <Cpu className="h-4 w-4" />
                                Machine Import
                            </Button>
                        </Link>
                    )}
                    {(userRole === "ADMIN" || userRole === "HR" || userRole === "MANAGER") && (
                        <AttendanceDownloadButton />
                    )}
                    <CheckInButton />
                </div>
            </div>

            {/* Quick Stats Grid */}
            <div className="grid gap-6 md:grid-cols-4">
                <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-sm rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-bold text-slate-500 uppercase tracking-wider">Total Active</CardTitle>
                        <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg">
                            <Users className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-slate-800 dark:text-white">{allActiveEmployees.length} Staff</div>
                        <p className="text-xs font-medium text-indigo-600 mt-1">Total active workforce</p>
                    </CardContent>
                </Card>

                <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-sm rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-bold text-slate-500 uppercase tracking-wider">Present Today</CardTitle>
                        <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
                            <UserCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-slate-800 dark:text-white">{presentToday} Present</div>
                        <p className="text-xs font-medium text-emerald-600 mt-1">Live check-ins</p>
                    </CardContent>
                </Card>

                <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-sm rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-bold text-slate-500 uppercase tracking-wider">Late Today</CardTitle>
                        <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                            <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-slate-800 dark:text-white">{lateToday} Late</div>
                        <p className="text-xs font-medium text-amber-600 mt-1">Grace period exceeded</p>
                    </CardContent>
                </Card>

                <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-sm rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-bold text-slate-500 uppercase tracking-wider">Absent Today</CardTitle>
                        <div className="p-2 bg-rose-100 dark:bg-rose-900/30 rounded-lg">
                            <Users className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-slate-800 dark:text-white">{absentToday} Absent</div>
                        <p className="text-xs font-medium text-rose-600 mt-1">No check-in record</p>
                    </CardContent>
                </Card>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
                {/* Main Table Area */}
                <Card className="lg:col-span-2 bg-white dark:bg-slate-950 border-slate-100 dark:border-slate-800/60 shadow-sm rounded-2xl overflow-hidden">
                    <CardHeader className="border-b border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-900/20 px-6 py-5">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <div>
                                <CardTitle className="text-xl font-bold">Presence Log</CardTitle>
                                <CardDescription className="font-medium text-slate-500">
                                    {view === "today" ? "Today's attendance status for all active employees" : `Recent records for ${userRole === "STAFF" ? "you" : "all employees"}`}
                                </CardDescription>
                            </div>
                            <div className="flex flex-wrap items-center gap-3">
                                {(userRole === "ADMIN" || userRole === "HR" || userRole === "MANAGER") && (
                                    <div className="flex bg-slate-100 dark:bg-slate-900 p-1 rounded-xl border border-slate-200/50 dark:border-slate-800/50">
                                        <Link href={`/attendance?view=today&all=${showAll}`}>
                                            <Button variant={view === "today" ? "secondary" : "ghost"} size="sm" className="font-bold rounded-lg text-xs uppercase px-3 py-1.5 h-8">
                                                Today&#39;s Status
                                            </Button>
                                        </Link>
                                        <Link href={`/attendance?view=history&all=${showAll}`}>
                                            <Button variant={view === "history" ? "secondary" : "ghost"} size="sm" className="font-bold rounded-lg text-xs uppercase px-3 py-1.5 h-8">
                                                History Log
                                            </Button>
                                        </Link>
                                    </div>
                                )}
                                <Link href={showAll ? `/attendance?view=${view}` : `/attendance?view=${view}&all=true`}>
                                    <Button variant="ghost" size="sm" className="text-emerald-600 font-bold hover:bg-emerald-50 h-8">
                                        {showAll ? "View Less" : "View All"}
                                    </Button>
                                </Link>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="border-slate-100 dark:border-slate-800/60 hover:bg-transparent">
                                        <TableHead className="font-bold py-4">Employee</TableHead>
                                        <TableHead className="font-bold py-4">Shift</TableHead>
                                        <TableHead className="font-bold py-4">Date</TableHead>
                                        <TableHead className="font-bold py-4">Check-In</TableHead>
                                        <TableHead className="font-bold py-4">Check-Out</TableHead>
                                        <TableHead className="font-bold py-4">Status</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {displayRecords.map((record) => (
                                        <TableRow key={record.id} className="border-slate-100 dark:border-slate-800/60 hover:bg-slate-50/80 dark:hover:bg-slate-900/50 transition-colors">
                                            <TableCell className="py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="h-9 w-9 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center text-emerald-700 dark:text-emerald-400 font-bold text-xs">
                                                        {record.employee.firstName[0]}{record.employee.lastName[0]}
                                                    </div>
                                                    <div className="font-bold text-slate-900 dark:text-white">
                                                        {record.employee.firstName} {record.employee.lastName}
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                {(record.shift || record.employee?.shift) ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 rounded-lg text-[10px] font-bold">
                                                        <Clock className="h-2.5 w-2.5" />
                                                        {(record.shift || record.employee?.shift)?.name}
                                                    </span>
                                                ) : (
                                                    <span className="text-[10px] text-slate-400 italic">—</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="font-medium text-slate-600 dark:text-slate-400">
                                                {new Date(record.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                                            </TableCell>
                                            <TableCell className="font-bold text-slate-900 dark:text-white">
                                                {record.checkIn ? new Date(record.checkIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "--"}
                                            </TableCell>
                                            <TableCell className="font-bold text-slate-900 dark:text-white">
                                                {record.checkOut ? new Date(record.checkOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "--"}
                                            </TableCell>
                                            <TableCell>
                                                <Badge 
                                                    className={`font-bold px-3 py-1 rounded-full border-0 ${
                                                        record.status === "PRESENT" 
                                                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" 
                                                            : record.status === "LATE"
                                                                ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                                                : record.status === "LEAVE"
                                                                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                                                                    : "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"
                                                    }`}
                                                >
                                                    {record.status === "NO_RECORD" ? "ABSENT" : record.status}
                                                </Badge>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                    {displayRecords.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={6} className="text-center py-20 text-slate-400 italic font-medium">
                                                No attendance records found.
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>

                {/* Sidebar Info */}
                <Card className="bg-white/40 dark:bg-slate-900/40 border-slate-100 dark:border-slate-800/60 shadow-sm rounded-2xl overflow-hidden">
                    <CardHeader className="bg-slate-50/50 dark:bg-slate-900/40">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-lg font-bold">Attendance View</CardTitle>
                            <CalendarIcon className="h-5 w-5 text-emerald-600" />
                        </div>
                    </CardHeader>
                    <CardContent className="p-4">
                        <Calendar
                            mode="single"
                            selected={new Date()}
                            className="rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm mx-auto bg-white dark:bg-slate-950"
                        />
                        <div className="mt-8 space-y-6">
                            <div className="flex items-center gap-2 px-1">
                                <MapPin className="h-4 w-4 text-emerald-600" />
                                <h4 className="text-sm font-bold uppercase tracking-wider text-slate-500">Live Insights</h4>
                            </div>
                            
                            <div className="space-y-4">
                                <div className="p-4 rounded-2xl bg-white dark:bg-slate-950 border border-slate-100 dark:border-slate-800 shadow-sm">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-xs font-bold text-slate-500 uppercase tracking-tighter">Current Status</span>
                                        <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                                    </div>
                                    <div className="text-lg font-black text-slate-900 dark:text-white">{presentToday} Present</div>
                                </div>

                                <div className="p-4 rounded-2xl bg-white dark:bg-slate-950 border border-slate-100 dark:border-slate-800 shadow-sm">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-xs font-bold text-slate-500 uppercase tracking-tighter">Completion</span>
                                    </div>
                                    <div className="text-lg font-black text-slate-900 dark:text-white">{completedToday} Staff Done</div>
                                </div>
                                
                                <div className="p-4 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg">
                                    <div className="text-xs font-bold opacity-80 uppercase tracking-tighter mb-1">Productivity</div>
                                    <div className="text-2xl font-black">{avgHours.toFixed(1)} <span className="text-sm font-medium opacity-80">Avg Hours</span></div>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
