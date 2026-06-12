import prisma from "@/lib/prisma";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { 
    User, Briefcase, Building2, Calendar, MapPin, Mail, Phone, ShieldCheck, 
    CreditCard, CalendarDays, Percent, Clock, FileCheck, FileText, ArrowRightLeft,
    Wallet, TrendingUp, ChevronRight
} from "lucide-react";
import Link from "next/link";

export default async function StaffServicesPage() {
    const session = await auth();
    if (!session?.user?.email) redirect("/login");

    const user = await prisma.user.findUnique({
        where: { email: session.user.email },
        include: {
            employee: {
                include: {
                    salaryStructure: true,
                    leaveBalances: true,
                    attendance: {
                        orderBy: { date: "desc" },
                        take: 15
                    },
                    salaryRecords: {
                        orderBy: [
                            { year: "desc" },
                            { month: "desc" }
                        ],
                        take: 12
                    },
                    serviceRequests: {
                        include: { category: true },
                        orderBy: { createdAt: "desc" },
                        take: 5
                    }
                }
            }
        }
    });

    if (!user) redirect("/login");

    if (!user.employee) {
        return (
            <div className="flex flex-col items-center justify-center p-24 text-center max-w-lg mx-auto space-y-6">
                <div className="h-16 w-16 rounded-2xl bg-amber-100 flex items-center justify-center text-amber-600 shadow-md">
                    <User className="h-8 w-8" />
                </div>
                <h2 className="text-2xl font-black text-slate-800 dark:text-white uppercase tracking-tight">Profile Not Provisioned</h2>
                <p className="text-slate-400 font-medium leading-relaxed">
                    Your login is registered under the admin/role accounts but lacks an Employee Master Profile. Please contact HR to create your Employee Record.
                </p>
                <Link href="/dashboard">
                    <Button className="font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl">Go to Dashboard</Button>
                </Link>
            </div>
        );
    }

    const emp = user.employee;
    const stats = {
        totalLeaves: emp.leaveBalances.reduce((acc: any, b: any) => acc + b.totalDays, 0),
        usedLeaves: emp.leaveBalances.reduce((acc: any, b: any) => acc + b.usedDays, 0),
        presenceCount: emp.attendance.filter((a: any) => a.status === "PRESENT" || a.status === "LATE").length,
        presencePct: emp.attendance.length > 0 
            ? Math.round((emp.attendance.filter((a: any) => a.status === "PRESENT" || a.status === "LATE").length / emp.attendance.length) * 100)
            : 100
    };

    const remainingLeaves = Math.max(0, stats.totalLeaves - stats.usedLeaves);

    return (
        <div className="space-y-8 p-4 md:p-8 w-full max-w-7xl mx-auto">
            {/* Premium Header */}
            <div className="relative overflow-hidden bg-gradient-to-br from-indigo-900 via-indigo-950 to-slate-900 p-8 md:p-12 rounded-[2.5rem] shadow-2xl transition-all">
                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-indigo-500/10 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2"></div>
                <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-purple-500/10 rounded-full blur-[80px] translate-y-1/2 -translate-x-1/2"></div>
                
                <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-8">
                    <div>
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/10 text-indigo-200 text-xs font-bold uppercase tracking-widest mb-6">
                            <ShieldCheck className="h-3 w-3 text-indigo-400" />
                            Employee Portal
                        </div>
                        <h1 className="text-4xl md:text-5xl font-black tracking-tight text-white mb-2 leading-tight">
                            Hello, {emp.firstName}!
                        </h1>
                        <p className="text-slate-300 text-sm md:text-base font-medium max-w-xl">
                            {emp.designation} &bull; {emp.department} &bull; {emp.employeeCode}
                        </p>
                    </div>

                    <div className="flex flex-wrap gap-3">
                        <Link href="/leaves">
                            <Button className="h-12 px-6 rounded-xl bg-white text-indigo-900 hover:bg-slate-50 font-bold text-sm shadow-md transition-transform hover:scale-105 active:scale-95">
                                Book Leave
                            </Button>
                        </Link>
                        <Link href="/requests">
                            <Button className="h-12 px-6 rounded-xl bg-white/10 text-white hover:bg-white/20 font-bold text-sm border border-white/20 backdrop-blur-sm transition-transform hover:scale-105 active:scale-95">
                                Apply for Certificate / Loan
                            </Button>
                        </Link>
                    </div>
                </div>
            </div>

            {/* Quick Summary Widgets */}
            <div className="grid gap-6 md:grid-cols-4">
                <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-sm rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-bold text-slate-500 uppercase tracking-wider">Leave Balance</CardTitle>
                        <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg">
                            <CalendarDays className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-slate-800 dark:text-white">{remainingLeaves} Days</div>
                        <p className="text-xs font-medium text-slate-500 mt-1">Of {stats.totalLeaves} total allocated</p>
                    </CardContent>
                </Card>

                <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-sm rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-bold text-slate-500 uppercase tracking-wider">Present Ratio</CardTitle>
                        <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
                            <Percent className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-slate-800 dark:text-white">{stats.presencePct}%</div>
                        <p className="text-xs font-medium text-emerald-600 mt-1">Calculated over recent logs</p>
                    </CardContent>
                </Card>

                <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-sm rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-bold text-slate-500 uppercase tracking-wider">Lateness Count</CardTitle>
                        <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                            <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-slate-800 dark:text-white">
                            {emp.attendance.filter((a: any) => a.status === "LATE").length} Time(s)
                        </div>
                        <p className="text-xs font-medium text-slate-500 mt-1">Pending verification</p>
                    </CardContent>
                </Card>

                <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-sm rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-bold text-slate-500 uppercase tracking-wider">Net Salary Structure</CardTitle>
                        <div className="p-2 bg-teal-100 dark:bg-teal-900/30 rounded-lg">
                            <Wallet className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-slate-800 dark:text-white">
                            AED {emp.salaryStructure ? emp.salaryStructure.ctc.toLocaleString() : "--"}
                        </div>
                        <p className="text-xs font-medium text-slate-500 mt-1">Base package details</p>
                    </CardContent>
                </Card>
            </div>

            {/* Content Tabs */}
            <Tabs defaultValue="profile" className="w-full">
                <TabsList className="w-full justify-start bg-slate-100/50 dark:bg-slate-900/50 p-1 h-12 rounded-xl mb-6">
                    <TabsTrigger value="profile" className="rounded-lg data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:shadow-sm font-bold text-xs uppercase tracking-wider px-6">My Profile</TabsTrigger>
                    <TabsTrigger value="leaves" className="rounded-lg data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:shadow-sm font-bold text-xs uppercase tracking-wider px-6">Leave Balance</TabsTrigger>
                    <TabsTrigger value="attendance" className="rounded-lg data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:shadow-sm font-bold text-xs uppercase tracking-wider px-6">Recent Attendance</TabsTrigger>
                    <TabsTrigger value="payroll" className="rounded-lg data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:shadow-sm font-bold text-xs uppercase tracking-wider px-6">Salary & Payslips</TabsTrigger>
                </TabsList>

                {/* Profile tab content */}
                <TabsContent value="profile">
                    <div className="grid gap-6 md:grid-cols-3">
                        <Card className="md:col-span-2 bg-white dark:bg-slate-950 border-slate-100 dark:border-slate-800 shadow-sm rounded-2xl">
                            <CardHeader className="border-b border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-900/20 px-6 py-5">
                                <CardTitle className="text-lg font-bold">Personal & Professional Records</CardTitle>
                            </CardHeader>
                            <CardContent className="p-6 space-y-6">
                                <div className="grid grid-cols-2 gap-6 text-sm">
                                    <div className="space-y-1">
                                        <span className="text-[10px] uppercase font-black tracking-wider text-slate-400">Full Name</span>
                                        <div className="font-bold text-slate-800 dark:text-slate-200">{emp.firstName} {emp.lastName}</div>
                                    </div>
                                    <div className="space-y-1">
                                        <span className="text-[10px] uppercase font-black tracking-wider text-slate-400">Employee ID</span>
                                        <div className="font-bold text-slate-800 dark:text-slate-200">{emp.employeeCode || "N/A"}</div>
                                    </div>
                                    <div className="space-y-1">
                                        <span className="text-[10px] uppercase font-black tracking-wider text-slate-400">Department / Designation</span>
                                        <div className="font-bold text-slate-800 dark:text-slate-200">{emp.designation} &bull; {emp.department}</div>
                                    </div>
                                    <div className="space-y-1">
                                        <span className="text-[10px] uppercase font-black tracking-wider text-slate-400">Joined Company</span>
                                        <div className="font-bold text-slate-800 dark:text-slate-200">{new Date(emp.joiningDate).toLocaleDateString()}</div>
                                    </div>
                                    <div className="space-y-1">
                                        <span className="text-[10px] uppercase font-black tracking-wider text-slate-400">Official Email</span>
                                        <div className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5"><Mail className="h-3.5 w-3.5 text-slate-400" /> {emp.email}</div>
                                    </div>
                                    <div className="space-y-1">
                                        <span className="text-[10px] uppercase font-black tracking-wider text-slate-400">Phone Number</span>
                                        <div className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-slate-400" /> {emp.phone || "Not Provided"}</div>
                                    </div>
                                    <div className="space-y-1">
                                        <span className="text-[10px] uppercase font-black tracking-wider text-slate-400">Work Location</span>
                                        <div className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-slate-400" /> {emp.workLocation || "Head Office"}</div>
                                    </div>
                                    <div className="space-y-1">
                                        <span className="text-[10px] uppercase font-black tracking-wider text-slate-400">Employment Contract</span>
                                        <div className="font-bold text-slate-800 dark:text-slate-200">{emp.employmentType.replace('_', ' ')}</div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Recent Requests Summary */}
                        <Card className="bg-white dark:bg-slate-950 border-slate-100 dark:border-slate-800 shadow-sm rounded-2xl">
                            <CardHeader className="border-b border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-900/20 px-6 py-5">
                                <CardTitle className="text-lg font-bold">Recent Requests</CardTitle>
                            </CardHeader>
                            <CardContent className="p-4 space-y-4">
                                {emp.serviceRequests.map((r: any) => (
                                    <div key={r.id} className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-100/50 dark:border-slate-800/50">
                                        <div>
                                            <div className="font-bold text-xs text-slate-800 dark:text-slate-200">{r.category.name}</div>
                                            <div className="text-[10px] text-slate-400">{new Date(r.createdAt).toLocaleDateString()}</div>
                                        </div>
                                        <Badge className={`px-2 py-0.5 text-[8px] font-black uppercase rounded-md border-0 ${
                                            r.status === "PENDING" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30" : 
                                            r.status === "COMPLETED" || r.status.includes("APPROVED") ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30" : 
                                            r.status === "REJECTED" ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30" : 
                                            "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30"
                                        }`}>{r.status}</Badge>
                                    </div>
                                ))}
                                {emp.serviceRequests.length === 0 && (
                                    <p className="text-center text-xs text-slate-400 italic py-10">No recent certificates or loans requested.</p>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>

                {/* Leaves tab content */}
                <TabsContent value="leaves">
                    <Card className="bg-white dark:bg-slate-950 border-slate-100 dark:border-slate-800 shadow-sm rounded-2xl overflow-hidden">
                        <CardHeader className="border-b border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-900/20 px-6 py-5">
                            <CardTitle className="text-lg font-bold">My Allocation & Leaves Balance</CardTitle>
                        </CardHeader>
                        <CardContent className="p-6">
                            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                                {emp.leaveBalances.map((bal: any) => {
                                    const rem = Math.max(0, bal.totalDays - bal.usedDays);
                                    const pct = bal.totalDays > 0 ? Math.min(100, Math.round((bal.usedDays / bal.totalDays) * 100)) : 0;
                                    return (
                                        <div key={bal.id} className="p-5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-100/50 dark:border-slate-800/50 space-y-4">
                                            <div className="flex justify-between items-start">
                                                <div>
                                                    <h4 className="font-black text-sm text-slate-800 dark:text-slate-200 uppercase tracking-tight">{bal.leaveType}</h4>
                                                    <span className="text-[10px] text-slate-400 font-bold">Year {bal.year}</span>
                                                </div>
                                                <Badge className="bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 border-0 text-[10px] font-black">{rem} / {bal.totalDays} Left</Badge>
                                            </div>
                                            <div className="space-y-1">
                                                <Progress value={pct} className="h-2 bg-slate-200 dark:bg-slate-800" />
                                                <div className="flex justify-between text-[9px] text-slate-400 font-bold uppercase">
                                                    <span>Used: {bal.usedDays} Days</span>
                                                    <span>{pct}% Used</span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                                {emp.leaveBalances.length === 0 && (
                                    <p className="text-center text-xs text-slate-400 italic py-10 col-span-3">No leave allocations found. Contact HR.</p>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Attendance tab content */}
                <TabsContent value="attendance">
                    <Card className="bg-white dark:bg-slate-950 border-slate-100 dark:border-slate-800 shadow-sm rounded-2xl overflow-hidden">
                        <CardHeader className="border-b border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-900/20 px-6 py-5">
                            <CardTitle className="text-lg font-bold">Recent Sign-In History</CardTitle>
                            <CardDescription className="text-xs text-slate-500 font-bold">Showing the latest 15 records recorded from biometric/portal logging.</CardDescription>
                        </CardHeader>
                        <CardContent className="p-0">
                            <Table>
                                <TableHeader>
                                    <TableRow className="border-slate-100 dark:border-slate-800/60 hover:bg-transparent">
                                        <TableHead className="font-bold py-4">Date</TableHead>
                                        <TableHead className="font-bold py-4">Check-In</TableHead>
                                        <TableHead className="font-bold py-4">Check-Out</TableHead>
                                        <TableHead className="font-bold py-4">Lateness (Mins)</TableHead>
                                        <TableHead className="font-bold py-4">Status</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {emp.attendance.map((record: any) => (
                                        <TableRow key={record.id} className="border-slate-100 dark:border-slate-800 hover:bg-slate-50/80 dark:hover:bg-slate-900/50 transition-colors">
                                            <TableCell className="font-bold text-slate-800 dark:text-slate-200">
                                                {new Date(record.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                                            </TableCell>
                                            <TableCell className="font-bold text-slate-900 dark:text-white">
                                                {record.checkIn ? new Date(record.checkIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "--"}
                                            </TableCell>
                                            <TableCell className="font-bold text-slate-900 dark:text-white">
                                                {record.checkOut ? new Date(record.checkOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "--"}
                                            </TableCell>
                                            <TableCell className="font-bold text-slate-800 dark:text-slate-200">
                                                {record.lateMinutes > 0 ? `${record.lateMinutes} mins` : "--"}
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
                                                    {record.status}
                                                </Badge>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                    {emp.attendance.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={5} className="text-center py-20 text-slate-400 italic font-medium">
                                                No attendance logs found in database.
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Payroll tab content */}
                <TabsContent value="payroll">
                    <div className="grid gap-6 md:grid-cols-3">
                        {/* Salary structure detail */}
                        <Card className="bg-white dark:bg-slate-950 border-slate-100 dark:border-slate-800 shadow-sm rounded-2xl">
                            <CardHeader className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/20 px-6 py-5">
                                <CardTitle className="text-lg font-bold">Salary Breakdowns</CardTitle>
                            </CardHeader>
                            <CardContent className="p-6 space-y-4 text-xs font-bold">
                                {emp.salaryStructure ? (
                                    <>
                                        <div className="flex justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                                            <span className="text-slate-400 uppercase">Basic Salary</span>
                                            <span className="text-slate-800 dark:text-slate-200">AED {emp.salaryStructure.basic.toLocaleString()}</span>
                                        </div>
                                        <div className="flex justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                                            <span className="text-slate-400 uppercase">Housing Allowance</span>
                                            <span className="text-slate-800 dark:text-slate-200">AED {emp.salaryStructure.housingAllowance.toLocaleString()}</span>
                                        </div>
                                        <div className="flex justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                                            <span className="text-slate-400 uppercase">Transport Allowance</span>
                                            <span className="text-slate-800 dark:text-slate-200">AED {emp.salaryStructure.transportAllowance.toLocaleString()}</span>
                                        </div>
                                        <div className="flex justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                                            <span className="text-slate-400 uppercase">Medical Allowance</span>
                                            <span className="text-slate-800 dark:text-slate-200">AED {emp.salaryStructure.medicalAllowance.toLocaleString()}</span>
                                        </div>
                                        <div className="flex justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                                            <span className="text-slate-400 uppercase">Other Allowances</span>
                                            <span className="text-slate-800 dark:text-slate-200">AED {emp.salaryStructure.otherAllowances.toLocaleString()}</span>
                                        </div>
                                        <div className="flex justify-between pt-2 text-indigo-600 font-black text-sm uppercase">
                                            <span>Net Base CTC</span>
                                            <span>AED {emp.salaryStructure.ctc.toLocaleString()}</span>
                                        </div>
                                        <div className="flex justify-between pt-2">
                                            <span className="text-slate-400 uppercase">Payment Mode</span>
                                            <Badge className="bg-indigo-100 text-indigo-700 border-0">{emp.salaryStructure.paymentMethod}</Badge>
                                        </div>
                                    </>
                                ) : (
                                    <p className="text-center text-xs text-slate-400 italic py-10">No salary structure found. Contact HR.</p>
                                )}
                            </CardContent>
                        </Card>

                        {/* Recent payslips */}
                        <Card className="md:col-span-2 bg-white dark:bg-slate-950 border-slate-100 dark:border-slate-800 shadow-sm rounded-2xl overflow-hidden">
                            <CardHeader className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/20 px-6 py-5">
                                <CardTitle className="text-lg font-bold">My Payslip Archive</CardTitle>
                            </CardHeader>
                            <CardContent className="p-0">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="border-slate-100 dark:border-slate-800 hover:bg-transparent">
                                            <TableHead className="font-bold">Period</TableHead>
                                            <TableHead className="font-bold">Allowances</TableHead>
                                            <TableHead className="font-bold">Penalties / Deducts</TableHead>
                                            <TableHead className="font-bold">Net Salary</TableHead>
                                            <TableHead className="font-bold">Status</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {emp.salaryRecords.map((rec: any) => {
                                            const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                                            const period = `${monthNames[rec.month - 1]} ${rec.year}`;
                                            const allowances = rec.housingAllowance + rec.transportAllowance + rec.medicalAllowance + rec.otherAllowances;
                                            const deductions = rec.latePenalty + rec.leaveDeduction + rec.loanDeduction + rec.otherDeductions;
                                            return (
                                                <TableRow key={rec.id} className="border-slate-100 dark:border-slate-800 hover:bg-slate-50/80 dark:hover:bg-slate-900/50 transition-colors">
                                                    <TableCell className="font-black text-slate-800 dark:text-slate-200">{period}</TableCell>
                                                    <TableCell className="font-bold text-slate-600 dark:text-slate-400">AED {allowances.toLocaleString()}</TableCell>
                                                    <TableCell className="font-bold text-rose-600 dark:text-rose-400">AED {deductions.toLocaleString()}</TableCell>
                                                    <TableCell className="font-black text-slate-950 dark:text-white">AED {rec.netSalary.toLocaleString()}</TableCell>
                                                    <TableCell>
                                                        <Badge className={`px-2 py-0.5 text-[8px] font-black uppercase rounded-md border-0 ${
                                                            rec.status === "PAID" 
                                                                ? "bg-emerald-100 text-emerald-700" 
                                                                : "bg-amber-100 text-amber-700"
                                                        }`}>{rec.status}</Badge>
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })}
                                        {emp.salaryRecords.length === 0 && (
                                            <TableRow>
                                                <TableCell colSpan={5} className="text-center py-20 text-slate-400 italic font-medium">
                                                    No payslips have been generated yet for your profile.
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>
            </Tabs>
        </div>
    );
}
