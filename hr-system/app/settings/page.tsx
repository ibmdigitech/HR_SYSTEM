import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    User, Mail, Phone, MapPin, Calendar, Building2,
    CreditCard, ShieldCheck, Bell, Lock, LogOut
} from "lucide-react";
import { signOut } from "@/auth";

export default async function SettingsPage() {
    const session = await auth();
    if (!session?.user?.email) redirect("/login");

    const user = await prisma.user.findUnique({
        where: { email: session.user.email },
        include: {
            employee: {
                include: { shift: true }
            }
        }
    });

    if (!user) redirect("/login");

    const emp = user.employee;
    const initials = `${user.name?.split(" ").map(n => n[0]).join("") || user.email[0].toUpperCase()}`;

    return (
        <div className="space-y-6 max-w-4xl">
            {/* Header */}
            <div>
                <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Settings</h1>
                <p className="text-slate-500 dark:text-slate-400">Manage your account and preferences.</p>
            </div>
            <Separator />

            {/* Profile Overview */}
            <Card className="border-slate-200 dark:border-slate-800 overflow-hidden">
                <div className="h-24 bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600" />
                <CardContent className="-mt-12 pb-6 px-6">
                    <div className="flex flex-col sm:flex-row sm:items-end gap-4">
                        <div className="h-20 w-20 rounded-2xl bg-white dark:bg-slate-900 border-4 border-white dark:border-slate-900 shadow-lg flex items-center justify-center text-2xl font-bold text-indigo-600">
                            {initials}
                        </div>
                        <div className="pb-1 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                                <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                                    {user.name || "No name set"}
                                </h2>
                                <Badge className="bg-indigo-100 text-indigo-700 border-indigo-200 hover:bg-indigo-100">
                                    {user.role}
                                </Badge>
                                {emp && (
                                    <Badge variant="outline" className="text-xs">
                                        #{emp.rollNumber}
                                    </Badge>
                                )}
                            </div>
                            <p className="text-sm text-slate-500">{user.email}</p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Account Information */}
            <Card className="border-slate-200 dark:border-slate-800">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                        <User className="h-4 w-4 text-indigo-600" /> Account Information
                    </CardTitle>
                    <CardDescription>Your login and role details.</CardDescription>
                </CardHeader>
                <CardContent>
                    <dl className="grid gap-4 sm:grid-cols-2">
                        {[
                            { label: "Full Name", value: user.name || "—", icon: User },
                            { label: "Email", value: user.email, icon: Mail },
                            { label: "Role", value: user.role, icon: ShieldCheck },
                            { label: "Member Since", value: new Date(user.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }), icon: Calendar },
                        ].map(({ label, value, icon: Icon }) => (
                            <div key={label} className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800">
                                <div className="h-8 w-8 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0">
                                    <Icon className="h-4 w-4 text-indigo-600" />
                                </div>
                                <div>
                                    <dt className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{label}</dt>
                                    <dd className="text-sm font-semibold text-slate-900 dark:text-white mt-0.5">{value}</dd>
                                </div>
                            </div>
                        ))}
                    </dl>
                </CardContent>
            </Card>

            {/* Employee Profile (if exists) */}
            {emp && (
                <Card className="border-slate-200 dark:border-slate-800">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Building2 className="h-4 w-4 text-indigo-600" /> Employee Profile
                        </CardTitle>
                        <CardDescription>Your employment details managed by HR.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            {[
                                { label: "First Name", value: emp.firstName },
                                { label: "Last Name", value: emp.lastName },
                                { label: "Designation", value: emp.designation },
                                { label: "Department", value: emp.department },
                                { label: "Roll Number", value: emp.rollNumber },
                                { label: "Employment Type", value: emp.employmentType },
                                { label: "Joining Date", value: new Date(emp.joiningDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) },
                                { label: "Work Location", value: emp.workLocation || "—" },
                                { label: "Status", value: emp.currentStatus },
                                ...(emp.phone ? [{ label: "Phone", value: emp.phone }] : []),
                                ...(emp.nationality ? [{ label: "Nationality", value: emp.nationality }] : []),
                                ...(emp.shift ? [{ label: "Shift", value: `${emp.shift.name} (${emp.shift.startTime}–${emp.shift.endTime})` }] : []),
                            ].map(({ label, value }) => (
                                <div key={label} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800">
                                    <dt className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{label}</dt>
                                    <dd className="text-sm font-semibold text-slate-900 dark:text-white mt-0.5 truncate">{value}</dd>
                                </div>
                            ))}
                        </dl>
                        <p className="text-xs text-slate-400 mt-4 italic">
                            To update your employee profile details, please contact your HR department.
                        </p>
                    </CardContent>
                </Card>
            )}

            {/* Bank & Payroll Info */}
            {emp && (emp.bankName || emp.accountNumber) && (
                <Card className="border-slate-200 dark:border-slate-800">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <CreditCard className="h-4 w-4 text-indigo-600" /> Bank Details
                        </CardTitle>
                        <CardDescription>Salary disbursement account information.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <dl className="grid gap-4 sm:grid-cols-3">
                            {[
                                { label: "Bank Name", value: emp.bankName || "—" },
                                { label: "Account Number", value: emp.accountNumber ? `****${emp.accountNumber.slice(-4)}` : "—" },
                                { label: "IFSC / Swift", value: emp.ifscCode || "—" },
                            ].map(({ label, value }) => (
                                <div key={label} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800">
                                    <dt className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{label}</dt>
                                    <dd className="text-sm font-semibold text-slate-900 dark:text-white mt-0.5">{value}</dd>
                                </div>
                            ))}
                        </dl>
                    </CardContent>
                </Card>
            )}

            {/* Notifications */}
            <Card className="border-slate-200 dark:border-slate-800">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                        <Bell className="h-4 w-4 text-indigo-600" /> Notifications
                    </CardTitle>
                    <CardDescription>System notification preferences.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    {[
                        { label: "Leave Request Updates", desc: "Get notified when your leave request status changes.", enabled: true },
                        { label: "Payroll Processed", desc: "Receive a notification when salary is disbursed.", enabled: true },
                        { label: "Document Expiry Alerts", desc: "Get reminded 30 days before visa/passport expiry.", enabled: true },
                    ].map(({ label, desc, enabled }) => (
                        <div key={label} className="flex items-center justify-between p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
                            <div>
                                <p className="text-sm font-semibold text-slate-900 dark:text-white">{label}</p>
                                <p className="text-xs text-slate-500">{desc}</p>
                            </div>
                            <div className={`h-5 w-9 rounded-full transition-colors ${enabled ? "bg-indigo-600" : "bg-slate-300"} relative cursor-pointer`}>
                                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-4" : "translate-x-0.5"}`} />
                            </div>
                        </div>
                    ))}
                </CardContent>
            </Card>

            {/* Security */}
            <Card className="border-slate-200 dark:border-slate-800">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                        <Lock className="h-4 w-4 text-indigo-600" /> Security
                    </CardTitle>
                    <CardDescription>Password and session management.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-3">
                    <Button variant="outline" className="gap-2">
                        <Lock className="h-4 w-4" /> Change Password
                    </Button>
                    <form action={async () => { "use server"; await signOut({ redirectTo: "/login" }); }}>
                        <Button type="submit" variant="destructive" className="gap-2">
                            <LogOut className="h-4 w-4" /> Sign Out
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
