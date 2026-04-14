import * as React from "react";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Calendar as CalendarIcon, Clock, Filter, Search, UserCheck } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { redirect } from "next/navigation";

export default async function AttendancePage() {
    const session = await auth();
    if (!session?.user?.email) redirect("/login");

    const user = await prisma.user.findUnique({
        where: { email: session.user.email },
        include: { employee: true }
    });

    if (!user) redirect("/login");

    const userRole = user.role;

    // Fetch Attendance for today/recent
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let attendanceRecords: any[] = [];
    if (userRole === "ADMIN" || userRole === "HR" || userRole === "MANAGER") {
        attendanceRecords = await prisma.attendance.findMany({
            include: { employee: true },
            orderBy: { date: 'desc' },
            take: 20
        });
    } else if (user.employee) {
        attendanceRecords = await prisma.attendance.findMany({
            where: { employeeId: user.employee.id },
            include: { employee: true },
            orderBy: { date: 'desc' },
            take: 10
        });
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Attendance</h1>
                    <p className="text-slate-500 dark:text-slate-400">Manage and track employee presence.</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" className="gap-2">
                        <Filter className="h-4 w-4" />
                        Filters
                    </Button>
                    <Button className="gap-2 bg-emerald-600 hover:bg-emerald-700">
                        <UserCheck className="h-4 w-4" />
                        Daily Log
                    </Button>
                </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                    <CardHeader>
                        <CardTitle>Daily Presence Log</CardTitle>
                        <CardDescription>Recent records for {userRole === "STAFF" ? "you" : "all employees"}</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Employee</TableHead>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Check-In</TableHead>
                                    <TableHead>Check-Out</TableHead>
                                    <TableHead>Status</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {attendanceRecords.map((record: any) => (
                                    <TableRow key={record.id}>
                                        <TableCell className="font-medium">
                                            {record.employee.firstName} {record.employee.lastName}
                                        </TableCell>
                                        <TableCell>{new Date(record.date).toLocaleDateString()}</TableCell>
                                        <TableCell>{record.checkIn ? new Date(record.checkIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "--"}</TableCell>
                                        <TableCell>{record.checkOut ? new Date(record.checkOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "--"}</TableCell>
                                        <TableCell>
                                            <Badge variant={record.status === "PRESENT" ? "default" : record.status === "LEAVE" ? "secondary" : "destructive"}>
                                                {record.status}
                                            </Badge>
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {attendanceRecords.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground italic">
                                            No attendance records found.
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <CardTitle>In-Depth View</CardTitle>
                            <CalendarIcon className="h-5 w-5 text-slate-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <Calendar
                            mode="single"
                            selected={new Date()}
                            className="rounded-md border shadow"
                        />
                        <div className="mt-6 space-y-4">
                            <h4 className="text-sm font-semibold">Today's Stats</h4>
                            <div className="flex items-center justify-between">
                                <span className="text-sm text-slate-500">Total Hours Avg</span>
                                <span className="text-sm font-medium italic">Available upon full integration</span>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
