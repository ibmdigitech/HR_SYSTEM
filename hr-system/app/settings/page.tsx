import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    User, Mail, Phone, MapPin, Calendar, Building2,
    CreditCard, ShieldCheck, Bell, Lock, LogOut,
    UserCircle, Activity, Zap, Sparkles, ChevronRight,
    ArrowRight, Globe
} from "lucide-react";
import { signOut } from "@/auth";
import { cn } from "@/lib/utils";

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
        <div className="space-y-8 p-4 md:p-8 w-full max-w-5xl mx-auto">
            {/* Premium Header */}
            <div className="relative group overflow-hidden bg-gradient-to-br from-indigo-900 via-indigo-950 to-slate-900 p-8 md:p-12 rounded-[2.5rem] shadow-2xl transition-all duration-500">
                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-indigo-500/10 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2"></div>
                <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-violet-500/10 rounded-full blur-[80px] translate-y-1/2 -translate-x-1/2"></div>
                
                <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-8">
                    <div>
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/10 text-indigo-200 text-xs font-bold uppercase tracking-widest mb-6">
                            <UserCircle className="h-3 w-3 fill-indigo-400" />
                            Personal Headquarters
                        </div>
                        <h1 className="text-4xl md:text-6xl font-black tracking-tight text-white mb-4 leading-tight">
                            Identity &<br />
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-violet-400">Governance</span>
                        </h1>
                        <p className="text-slate-300 text-base font-medium max-w-xl leading-relaxed">
                            Manage your professional identity, security protocols, and system-wide preferences in a secure enterprise environment.
                        </p>
                    </div>

                    <div className="flex flex-col gap-4 w-full md:w-auto">
                        <div className="p-6 rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10 flex items-center gap-4">
                            <div className="h-16 w-16 rounded-2xl bg-indigo-600 flex items-center justify-center text-2xl font-black text-white shadow-xl shadow-indigo-600/20 group-hover:scale-110 transition-transform duration-500">
                                {initials}
                            </div>
                            <div className="flex flex-col">
                                <span className="text-lg font-black text-white leading-none tracking-tight">{user.name || "Administrator"}</span>
                                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-400 mt-1.5">{user.role} Identity</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid gap-8 lg:grid-cols-12">
                {/* Main Settings Area */}
                <div className="lg:col-span-8 space-y-8">
                    {/* Account Stats / Badges */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                        <div className="p-4 rounded-3xl bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border border-white/40 dark:border-slate-800/60 shadow-lg flex flex-col items-center justify-center text-center group hover:bg-indigo-600 transition-all duration-300">
                            <Activity className="h-5 w-5 text-indigo-600 group-hover:text-white mb-2" />
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 group-hover:text-indigo-200">Session Status</span>
                            <span className="text-sm font-black text-slate-900 dark:text-white group-hover:text-white mt-1">Active</span>
                        </div>
                        <div className="p-4 rounded-3xl bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border border-white/40 dark:border-slate-800/60 shadow-lg flex flex-col items-center justify-center text-center group hover:bg-violet-600 transition-all duration-300">
                            <ShieldCheck className="h-5 w-5 text-violet-600 group-hover:text-white mb-2" />
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 group-hover:text-violet-200">Auth Level</span>
                            <span className="text-sm font-black text-slate-900 dark:text-white group-hover:text-white mt-1">Verified</span>
                        </div>
                        <div className="p-4 rounded-3xl bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border border-white/40 dark:border-slate-800/60 shadow-lg flex flex-col items-center justify-center text-center group hover:bg-emerald-600 transition-all duration-300 col-span-2 sm:col-span-1">
                            <Zap className="h-5 w-5 text-emerald-600 group-hover:text-white mb-2" />
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 group-hover:text-emerald-200">Sync Rate</span>
                            <span className="text-sm font-black text-slate-900 dark:text-white group-hover:text-white mt-1">Real-time</span>
                        </div>
                    </div>

                    {/* Account Information */}
                    <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border border-white/40 dark:border-slate-800/60 shadow-2xl rounded-[3rem] overflow-hidden">
                        <CardHeader className="p-8 pb-4 bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-between">
                            <div>
                                <CardTitle className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight flex items-center gap-2">
                                    <User className="h-5 w-5 text-indigo-600" /> Core Identity
                                </CardTitle>
                                <CardDescription className="font-bold text-[10px] uppercase tracking-widest text-slate-400 mt-1">Primary account records</CardDescription>
                            </div>
                        </CardHeader>
                        <CardContent className="p-8">
                            <div className="grid gap-6 sm:grid-cols-2">
                                {[
                                    { label: "Full Name", value: user.name || "Administrator", icon: User },
                                    { label: "Primary Email", value: user.email, icon: Mail },
                                    { label: "System Role", value: user.role, icon: ShieldCheck },
                                    { label: "Onboarding Date", value: new Date(user.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }), icon: Calendar },
                                ].map(({ label, value, icon: Icon }) => (
                                    <div key={label} className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 flex items-start gap-4 hover:border-indigo-200 transition-all group">
                                        <div className="h-10 w-10 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0 shadow-sm group-hover:scale-110 transition-transform">
                                            <Icon className="h-5 w-5 text-indigo-600" />
                                        </div>
                                        <div className="overflow-hidden">
                                            <dt className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">{label}</dt>
                                            <dd className="text-sm font-black text-slate-900 dark:text-white mt-2 truncate">{value}</dd>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>

                    {/* Employee Profile (if exists) */}
                    {emp && (
                        <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border border-white/40 dark:border-slate-800/60 shadow-2xl rounded-[3rem] overflow-hidden">
                            <CardHeader className="p-8 pb-4 bg-slate-50/50 dark:bg-slate-900/50">
                                <CardTitle className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight flex items-center gap-2">
                                    <Building2 className="h-5 w-5 text-indigo-600" /> Workforce Profile
                                </CardTitle>
                                <CardDescription className="font-bold text-[10px] uppercase tracking-widest text-slate-400 mt-1">Official employment documentation</CardDescription>
                            </CardHeader>
                            <CardContent className="p-8">
                                <div className="grid gap-4 grid-cols-2 sm:grid-cols-3">
                                    {[
                                        { label: "Designation", value: emp.designation },
                                        { label: "Department", value: emp.department },
                                        { label: "Employee ID", value: emp.rollNumber },
                                        { label: "Work Model", value: emp.employmentType.replace('_', ' ') },
                                        { label: "Tenure Start", value: new Date(emp.joiningDate).toLocaleDateString("en-GB", { month: 'short', year: 'numeric' }) },
                                        { label: "Base Office", value: emp.workLocation || "Headquarters" },
                                    ].map(({ label, value }) => (
                                        <div key={label} className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 hover:bg-white transition-colors">
                                            <dt className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none mb-2">{label}</dt>
                                            <dd className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-tight truncate">{value}</dd>
                                        </div>
                                    ))}
                                </div>
                                <div className="mt-8 p-4 rounded-2xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800 flex items-center gap-4">
                                    <div className="h-10 w-10 rounded-xl bg-white dark:bg-slate-800 flex items-center justify-center shadow-sm">
                                        <Sparkles className="h-5 w-5 text-indigo-600" />
                                    </div>
                                    <p className="text-[10px] font-black text-indigo-700 dark:text-indigo-300 uppercase tracking-widest leading-relaxed">
                                        Need to update profile data? Contact your local HR Business Partner for documentation verification.
                                    </p>
                                </div>
                            </CardContent>
                        </Card>
                    )}
                </div>

                {/* Sidebar Settings */}
                <div className="lg:col-span-4 space-y-8">
                    {/* Security & Access */}
                    <div className="bg-slate-900 rounded-[2.5rem] p-8 space-y-6 shadow-2xl relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-[40px] -translate-y-1/2 translate-x-1/2" />
                        <div className="relative z-10 flex items-center justify-between">
                            <h3 className="text-lg font-black text-white uppercase tracking-tight">Access Control</h3>
                            <Lock className="h-5 w-5 text-indigo-500" />
                        </div>
                        <div className="space-y-3 relative z-10">
                            <Button className="w-full h-14 rounded-2xl bg-white/5 hover:bg-white/10 text-white font-black uppercase text-xs tracking-widest border border-white/10 transition-all flex items-center justify-between px-6 group">
                                Change Credentials
                                <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                            </Button>
                            <form action={async () => { "use server"; await signOut({ redirectTo: "/login" }); }} className="w-full">
                                <Button type="submit" variant="destructive" className="w-full h-14 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white font-black uppercase text-xs tracking-widest shadow-xl shadow-rose-600/20 transition-all flex items-center justify-between px-6 group">
                                    Terminate Session
                                    <LogOut className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                                </Button>
                            </form>
                        </div>
                    </div>

                    {/* Notification Preferences */}
                    <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border border-white/40 dark:border-slate-800/60 shadow-2xl rounded-[2.5rem] overflow-hidden">
                        <CardHeader className="p-8 pb-4">
                            <CardTitle className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight flex items-center gap-2">
                                <Bell className="h-5 w-5 text-indigo-600" /> Alerts
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="px-8 pb-8 space-y-4">
                            {[
                                { label: "Workflow Status", enabled: true },
                                { label: "Financial Alerts", enabled: true },
                                { label: "Document Expiry", enabled: false },
                            ].map(({ label, enabled }) => (
                                <div key={label} className="flex items-center justify-between p-4 rounded-2xl bg-slate-50/50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 group hover:bg-white transition-all">
                                    <span className="text-[11px] font-black text-slate-700 dark:text-slate-300 uppercase tracking-widest">{label}</span>
                                    <div className={cn(
                                        "h-6 w-11 rounded-full p-1 transition-colors cursor-pointer",
                                        enabled ? "bg-indigo-600" : "bg-slate-300"
                                    )}>
                                        <div className={cn(
                                            "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                                            enabled ? "translate-x-5" : "translate-x-0"
                                        )} />
                                    </div>
                                </div>
                            ))}
                        </CardContent>
                    </Card>

                    {/* Regional Info */}
                    <div className="p-8 rounded-[2.5rem] bg-indigo-600 text-white shadow-2xl relative overflow-hidden group">
                        <div className="absolute bottom-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-[40px] translate-y-1/2 translate-x-1/2 group-hover:scale-150 transition-transform duration-700" />
                        <div className="relative z-10 flex flex-col gap-4">
                            <div className="h-12 w-12 rounded-2xl bg-white/20 flex items-center justify-center">
                                <Globe className="h-6 w-6 text-white" />
                            </div>
                            <div>
                                <h4 className="text-lg font-black uppercase tracking-tight">Localization</h4>
                                <p className="text-indigo-100 text-xs font-medium mt-1">GMT +4 (UAE) Standard Time</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

