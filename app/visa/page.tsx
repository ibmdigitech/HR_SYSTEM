import prisma from "@/lib/prisma";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle, Search, Clock, ShieldAlert, ArrowUpRight } from "lucide-react";
import Link from "next/link";

export default async function VisaCompliancePage() {
    const session = await auth();
    if (!session?.user) redirect("/login");

    const userRole = (session.user as { role: string }).role;
    if (!["ADMIN", "HR", "MANAGER"].includes(userRole)) {
        redirect("/staff-services");
    }

    const employees = await prisma.employee.findMany({
        where: { isActive: true },
        orderBy: { firstName: "asc" }
    });

    const today = new Date();
    const thirtyDays = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
    const ninetyDays = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000);

    // `passportExpiry` is `Date | null`. `new Date(null)` produces a bogus
    // 1970 date rather than failing, so the null case is handled explicitly
    // instead of being coerced.
    const formatExpiry = (value: Date | null | undefined): string =>
        value ? new Date(value).toLocaleDateString() : "—";

    const getDocumentStatus = (expiryDate: Date | null | undefined) => {
        if (!expiryDate) return { label: "N/A", color: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400" };
        const exp = new Date(expiryDate);
        if (exp < today) return { label: "Expired", color: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400" };
        if (exp <= thirtyDays) return { label: "Critical (<30d)", color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" };
        if (exp <= ninetyDays) return { label: "Warning (<90d)", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" };
        return { label: "Active", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" };
    };

    // Calculate overall stats
    let expiredCount = 0;
    let criticalCount = 0;
    let warningCount = 0;

    employees.forEach(emp => {
        const docDates = [emp.passportExpiry, emp.emiratesIdExpiry, emp.visaExpiry, emp.medicalInsuranceExpiry];
        docDates.forEach(date => {
            if (date) {
                const exp = new Date(date);
                if (exp < today) expiredCount++;
                else if (exp <= thirtyDays) criticalCount++;
                else if (exp <= ninetyDays) warningCount++;
            }
        });
    });

    return (
        <div className="space-y-8 p-4 md:p-8 w-full max-w-7xl mx-auto">
            {/* Header section */}
            <div className="relative overflow-hidden bg-gradient-to-br from-rose-900 via-rose-950 to-slate-900 p-8 md:p-12 rounded-[2.5rem] shadow-2xl transition-all">
                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-rose-500/10 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2"></div>
                <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-orange-500/10 rounded-full blur-[80px] translate-y-1/2 -translate-x-1/2"></div>
                
                <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-8">
                    <div>
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/10 text-rose-200 text-xs font-bold uppercase tracking-widest mb-6">
                            <ShieldAlert className="h-3 w-3 text-rose-400" />
                            Document & Visa Audit
                        </div>
                        <h1 className="text-4xl md:text-6xl font-black tracking-tight text-white mb-4 leading-tight">
                            Compliance<br />
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-rose-400 to-orange-400">Control Center</span>
                        </h1>
                        <p className="text-slate-300 text-base font-medium max-w-xl leading-relaxed">
                            Monitor Passport, Emirates ID, and Visa expiries. Flag expired files and critical compliance risks before they disrupt operations.
                        </p>
                    </div>
                </div>
            </div>

            {/* Quick Stats Grid */}
            <div className="grid gap-6 md:grid-cols-4">
                <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-sm rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-bold text-slate-500 uppercase tracking-wider">Total Headcount</CardTitle>
                        <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg">
                            <Clock className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-slate-800 dark:text-white">{employees.length} Staff</div>
                        <p className="text-xs font-medium text-slate-500 mt-1">Total active sponsorship</p>
                    </CardContent>
                </Card>

                <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-sm rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-bold text-slate-500 uppercase tracking-wider">Expired Documents</CardTitle>
                        <div className="p-2 bg-rose-100 dark:bg-rose-900/30 rounded-lg">
                            <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-rose-600 dark:text-rose-400">{expiredCount} File(s)</div>
                        <p className="text-xs font-bold text-rose-600 mt-1">Requires immediate renewal 🔴</p>
                    </CardContent>
                </Card>

                <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-sm rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-bold text-slate-500 uppercase tracking-wider">Critical Expiry (&lt;30d)</CardTitle>
                        <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
                            <Clock className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-orange-600 dark:text-orange-400">{criticalCount} File(s)</div>
                        <p className="text-xs font-medium text-orange-600 mt-1">Action due this month 🟠</p>
                    </CardContent>
                </Card>

                <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-sm rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-bold text-slate-500 uppercase tracking-wider">Warning Expiry (&lt;90d)</CardTitle>
                        <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                            <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-amber-600 dark:text-amber-400">{warningCount} File(s)</div>
                        <p className="text-xs font-medium text-amber-600 mt-1">Sufficient runway remaining 🟡</p>
                    </CardContent>
                </Card>
            </div>

            {/* Compliance Table Card */}
            <Card className="bg-white dark:bg-slate-950 border-slate-100 dark:border-slate-800/60 shadow-sm rounded-2xl overflow-hidden">
                <CardHeader className="border-b border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-900/20 px-6 py-5">
                    <div>
                        <CardTitle className="text-xl font-bold">Workforce Document Directory</CardTitle>
                        <CardDescription className="font-medium text-slate-500">
                            Comprehensive record of passport, Emirates ID, medical insurance, and visa validity dates.
                        </CardDescription>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="border-slate-100 dark:border-slate-800/60 hover:bg-transparent">
                                    <TableHead className="font-bold py-4">Employee</TableHead>
                                    <TableHead className="font-bold py-4">Passport</TableHead>
                                    <TableHead className="font-bold py-4">Emirates ID</TableHead>
                                    <TableHead className="font-bold py-4">Visa Details</TableHead>
                                    <TableHead className="font-bold py-4">Medical Insurance</TableHead>
                                    <TableHead className="font-bold py-4 text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {employees.map((record) => {
                                    const passStat = getDocumentStatus(record.passportExpiry);
                                    const eidStat = getDocumentStatus(record.emiratesIdExpiry);
                                    const visaStat = getDocumentStatus(record.visaExpiry);
                                    const medStat = getDocumentStatus(record.medicalInsuranceExpiry);

                                    return (
                                        <TableRow key={record.id} className="border-slate-100 dark:border-slate-800/60 hover:bg-slate-50/80 dark:hover:bg-slate-900/50 transition-colors">
                                            <TableCell className="py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="h-9 w-9 rounded-full bg-rose-100 dark:bg-rose-900/50 flex items-center justify-center text-rose-700 dark:text-rose-400 font-bold text-xs">
                                                        {record.firstName[0]}{record.lastName[0]}
                                                    </div>
                                                    <div>
                                                        <div className="font-bold text-slate-900 dark:text-white">
                                                            {record.firstName} {record.lastName}
                                                        </div>
                                                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">
                                                            {record.employeeCode || "No Code"}
                                                        </div>
                                                    </div>
                                                </div>
                                            </TableCell>
                                            
                                            {/* Passport */}
                                            <TableCell>
                                                {record.passportNumber ? (
                                                    <div className="space-y-1">
                                                        <div className="font-bold text-xs text-slate-700 dark:text-slate-300">{record.passportNumber}</div>
                                                        <div className="flex items-center gap-1.5">
                                                            <span className="text-[10px] text-slate-500 font-medium">Exp: {formatExpiry(record.passportExpiry)}</span>
                                                            <Badge className={`px-2 py-0.5 text-[8px] font-black uppercase rounded-md border-0 ${passStat.color}`}>{passStat.label}</Badge>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <span className="text-slate-400 text-xs italic">Not Provided</span>
                                                )}
                                            </TableCell>

                                            {/* Emirates ID */}
                                            <TableCell>
                                                {record.emiratesId ? (
                                                    <div className="space-y-1">
                                                        <div className="font-bold text-xs text-slate-700 dark:text-slate-300">{record.emiratesId}</div>
                                                        <div className="flex items-center gap-1.5">
                                                            <span className="text-[10px] text-slate-500 font-medium">Exp: {formatExpiry(record.emiratesIdExpiry)}</span>
                                                            <Badge className={`px-2 py-0.5 text-[8px] font-black uppercase rounded-md border-0 ${eidStat.color}`}>{eidStat.label}</Badge>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <span className="text-slate-400 text-xs italic">Not Provided</span>
                                                )}
                                            </TableCell>

                                            {/* Visa Details */}
                                            <TableCell>
                                                {record.visaNumber ? (
                                                    <div className="space-y-1">
                                                        <div className="font-bold text-xs text-slate-700 dark:text-slate-300">{record.visaNumber} <span className="text-[10px] opacity-75 font-medium">({record.visaType || "Employment"})</span></div>
                                                        <div className="flex items-center gap-1.5">
                                                            <span className="text-[10px] text-slate-500 font-medium">Exp: {formatExpiry(record.visaExpiry)}</span>
                                                            <Badge className={`px-2 py-0.5 text-[8px] font-black uppercase rounded-md border-0 ${visaStat.color}`}>{visaStat.label}</Badge>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <span className="text-slate-400 text-xs italic">Not Provided</span>
                                                )}
                                            </TableCell>

                                            {/* Medical Insurance */}
                                            <TableCell>
                                                {record.medicalInsuranceExpiry ? (
                                                    <div className="space-y-1">
                                                        <div className="text-[10px] text-slate-500 font-medium">Exp: {new Date(record.medicalInsuranceExpiry).toLocaleDateString()}</div>
                                                        <Badge className={`px-2 py-0.5 text-[8px] font-black uppercase rounded-md border-0 ${medStat.color}`}>{medStat.label}</Badge>
                                                    </div>
                                                ) : (
                                                    <span className="text-slate-400 text-xs italic">Not Provided</span>
                                                )}
                                            </TableCell>

                                            <TableCell className="text-right">
                                                <Link href="/employees">
                                                    <Button variant="ghost" size="sm" className="font-bold hover:bg-slate-100 gap-1 rounded-xl">
                                                        Edit Profile
                                                        <ArrowUpRight className="h-3 w-3" />
                                                    </Button>
                                                </Link>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                                {employees.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={6} className="text-center py-20 text-slate-400 italic font-medium">
                                            No active employees found in system database.
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
