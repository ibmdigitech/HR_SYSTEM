import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
    AlertCircle,
    Globe,
    FileDigit as Passport,
    ShieldCheck,
    ShieldAlert,
    Stethoscope,
    FileText,
    TrendingUp,
    Zap,
    ChevronRight,
    Bell,
    Download
} from "lucide-react";
import { VisaForm } from "@/components/visa/VisaForm";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import { differenceInDays, format } from "date-fns";
import { Button } from "@/components/ui/button";

export default async function VisaRequestPage() {
    const session = await auth();
    if (!session?.user?.email) redirect("/login");

    const user = await prisma.user.findUnique({
        where: { email: session.user.email },
        include: { employee: true }
    });

    if (!user || !user.employee) redirect("/login");

    const attachments = await prisma.attachment.findMany({
        where: { employeeId: user.employee.id }
    });

    const getDoc = (category: string) => attachments.find(a => a.category === category);

    const renderDocCard = (category: string, title: string, icon: any, colorName: "emerald" | "blue" | "amber" | "slate" | "rose") => {
        const doc = getDoc(category);
        const Icon = icon;
        
        const colorStyles = {
            emerald: { light: "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-100 dark:border-emerald-900/50 text-emerald-700 dark:text-emerald-400", icon: "text-emerald-500", dark: "bg-emerald-500" },
            blue: { light: "bg-blue-50 dark:bg-blue-950/20 border-blue-100 dark:border-blue-900/50 text-blue-700 dark:text-blue-400", icon: "text-blue-500", dark: "bg-blue-500" },
            amber: { light: "bg-amber-50 dark:bg-amber-950/20 border-amber-100 dark:border-amber-900/50 text-amber-700 dark:text-amber-400", icon: "text-amber-500", dark: "bg-amber-500" },
            slate: { light: "bg-slate-50 dark:bg-slate-900/20 border-slate-100 dark:border-slate-800 text-slate-700 dark:text-slate-400", icon: "text-slate-500", dark: "bg-slate-500" },
            rose: { light: "bg-rose-50 dark:bg-rose-950/20 border-rose-100 dark:border-rose-900/50 text-rose-700 dark:text-rose-400", icon: "text-rose-500", dark: "bg-rose-500" }
        };
        const theme = colorStyles[colorName] || colorStyles.slate;
        
        if (!doc || !doc.docExpiry) {
            return (
                <div className={`p-4 rounded-2xl border ${theme.light} transition-all hover:scale-[1.02] duration-300 shadow-sm`}>
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-xl bg-white dark:bg-slate-900 shadow-sm ${theme.icon}`}>
                                <Icon className="h-5 w-5" />
                            </div>
                            <span className="text-xs font-black uppercase tracking-wider">{title}</span>
                        </div>
                        <Badge variant="secondary" className="text-[10px] font-bold px-2 py-0 h-5 bg-white/50 dark:bg-slate-800/50 uppercase tracking-tighter">Required</Badge>
                    </div>
                    <div className="flex justify-between items-end">
                        <div>
                            <p className="text-3xl font-black leading-none opacity-20">-</p>
                            <p className="text-[10px] font-bold opacity-60 uppercase tracking-tighter mt-1">Not Uploaded</p>
                        </div>
                        <p className="text-[10px] font-black italic text-rose-600 bg-rose-100 dark:bg-rose-900/40 px-3 py-1 rounded-full uppercase tracking-widest">Missing</p>
                    </div>
                </div>
            );
        }

        const days = differenceInDays(new Date(doc.docExpiry), new Date());
        const isExpired = days < 0;
        const isCritical = days < 30;

        const statusLabel = isExpired ? "Expired" : isCritical ? "Critical" : "Active";
        const statusColor = isExpired ? "bg-rose-500" : isCritical ? "bg-amber-500" : theme.dark;
        const cardBorder = isExpired ? "border-rose-300 dark:border-rose-800 shadow-rose-500/5" : isCritical ? "border-amber-300 dark:border-amber-800 shadow-amber-500/5" : theme.light;

        return (
            <div className={`p-4 rounded-2xl border shadow-sm transition-all hover:scale-[1.02] duration-300 ${cardBorder}`}>
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-xl bg-white dark:bg-slate-900 shadow-sm ${isExpired ? "text-rose-500" : isCritical ? "text-amber-500" : theme.icon}`}>
                            <Icon className="h-5 w-5" />
                        </div>
                        <span className="text-xs font-black uppercase tracking-wider">{title}</span>
                    </div>
                    <Badge className={`text-[10px] font-bold px-2 py-0 h-5 ${statusColor} text-white border-0 shadow-sm uppercase tracking-tighter`}>{statusLabel}</Badge>
                </div>
                <div className="flex justify-between items-end">
                    <div>
                        <p className="text-3xl font-black leading-none">{isExpired ? 0 : days}</p>
                        <p className="text-[10px] font-bold opacity-60 uppercase tracking-tighter mt-1">Days Remaining</p>
                    </div>
                    <div className="text-right">
                        <p className="text-sm font-black text-slate-900 dark:text-white">{format(new Date(doc.docExpiry), "dd MMM yyyy")}</p>
                        <button className="text-[10px] font-bold text-indigo-600 hover:underline flex items-center gap-1 mt-1 uppercase tracking-tighter">
                            <Download className="h-3 w-3" /> View Doc
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="space-y-8 p-4 md:p-8 w-full max-w-7xl mx-auto">
            {/* Header Area */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-gradient-to-r from-slate-900 to-slate-800 p-8 rounded-[2rem] shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3"></div>
                <div className="absolute bottom-0 left-0 w-72 h-72 bg-emerald-500/10 rounded-full blur-3xl translate-y-1/3 -translate-x-1/4"></div>
                
                <div className="relative z-10">
                    <div className="flex items-center gap-2 mb-4">
                        <Globe className="h-6 w-6 text-indigo-400" />
                        <span className="text-indigo-400 font-black text-xs uppercase tracking-[0.3em]">Compliance Hub</span>
                    </div>
                    <h1 className="text-4xl md:text-5xl font-black tracking-tight text-white mb-2">Visa & Residency</h1>
                    <p className="text-slate-400 text-sm md:text-base font-medium max-w-xl">
                        Monitor your legal status in real-time. Our system tracks UAE labor laws and residency requirements automatically.
                    </p>
                </div>
                <div className="relative z-10 flex flex-col sm:flex-row gap-3">
                    <Button variant="outline" className="gap-2 rounded-xl font-bold bg-white/5 text-white hover:bg-white/10 border-white/10 backdrop-blur-md">
                        <Bell className="h-4 w-4" />
                        Alert History
                    </Button>
                </div>
            </div>

            <div className="grid gap-8 lg:grid-cols-5">
                {/* Form Section */}
                <div className="lg:col-span-3">
                    <VisaForm />
                </div>

                {/* Status Column */}
                <div className="lg:col-span-2 space-y-6">
                    <Card className="bg-white/60 dark:bg-slate-950/60 backdrop-blur-xl border-slate-100 dark:border-slate-800/60 shadow-xl rounded-[2.5rem] overflow-hidden">
                        <CardHeader className="bg-slate-50/50 dark:bg-slate-900/40 px-6 py-6 border-b border-slate-100 dark:border-slate-800/60">
                            <CardTitle className="text-xl font-black flex items-center gap-2">
                                <ShieldCheck className="h-6 w-6 text-emerald-600" />
                                Residency Vault
                            </CardTitle>
                            <CardDescription className="font-bold text-[10px] uppercase tracking-widest mt-1 text-slate-400">Personal compliance documents</CardDescription>
                        </CardHeader>
                        <CardContent className="p-6 space-y-4">
                            {renderDocCard("PASSPORT_COPY", "Passport Validity", Passport, "emerald")}
                            {renderDocCard("VISA_COPY", "Visa Validity", Globe, "blue")}
                            {renderDocCard("MEDICAL_INSURANCE", "Medical Insurance", Stethoscope, "amber")}
                            {renderDocCard("ILOE_INSURANCE", "ILOE Insurance", ShieldAlert, "slate")}

                            <div className="mt-8 p-6 rounded-[2rem] bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/10 dark:to-orange-950/10 border border-amber-100 dark:border-amber-900/30">
                                <div className="flex gap-4">
                                    <div className="h-10 w-10 rounded-xl bg-amber-500 flex items-center justify-center shrink-0 shadow-lg shadow-amber-500/20">
                                        <Bell className="h-6 w-6 text-white" />
                                    </div>
                                    <div>
                                        <h4 className="text-sm font-black text-amber-900 dark:text-amber-400 uppercase tracking-tight">Smart Notifications</h4>
                                        <p className="text-[11px] font-medium leading-relaxed text-amber-800 dark:text-amber-500/80 mt-1">
                                            Automated alerts are dispatched **30 days** and **7 days** prior to expiry. Please ensure all digital copies are high-resolution and legible.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-white/40 dark:bg-slate-950/40 backdrop-blur-sm border-slate-100 dark:border-slate-800/60 shadow-lg rounded-[2.5rem] overflow-hidden">
                        <CardHeader className="px-8 py-6">
                            <CardTitle className="text-lg font-black uppercase tracking-tighter">Archived Requests</CardTitle>
                        </CardHeader>
                        <CardContent className="px-8 pb-8">
                            <div className="flex flex-col items-center justify-center py-10 text-slate-400/50">
                                <FileText className="h-12 w-12 mb-4 opacity-20" />
                                <p className="text-xs font-black uppercase tracking-widest italic text-center">No active or archived<br />applications found</p>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}

