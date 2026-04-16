import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
    AlertCircle,
    Globe,
    FileDigit as Passport,
    ShieldCheck,
    ShieldAlert,
    Stethoscope,
    FileText
} from "lucide-react";
import { VisaForm } from "@/components/visa/VisaForm";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import { differenceInDays, format } from "date-fns";

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

    const renderDocCard = (category: string, title: string, icon: any, color: string) => {
        const doc = getDoc(category);
        const Icon = icon;
        
        if (!doc || !doc.docExpiry) {
            return (
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/40 text-slate-700 dark:text-slate-400 border border-slate-100 dark:border-slate-800">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <Icon className="h-3.5 w-3.5" />
                            <span className="text-[10px] font-bold uppercase tracking-tighter">{title}</span>
                        </div>
                        <Badge variant="outline" className="text-[9px] h-4">Pending</Badge>
                    </div>
                    <div className="flex justify-between items-end">
                        <div>
                            <p className="text-2xl font-black leading-none opacity-20">-</p>
                            <p className="text-[9px] font-medium opacity-70">Not Uploaded</p>
                        </div>
                        <p className="text-[10px] font-bold italic">Action Req</p>
                    </div>
                </div>
            );
        }

        const days = differenceInDays(new Date(doc.docExpiry), new Date());
        const isExpired = days < 0;
        const isCritical = days < 30;

        const statusLabel = isExpired ? "Expired" : isCritical ? "Critical" : "Active";
        const statusColor = isExpired ? "bg-red-500" : isCritical ? "bg-amber-500" : "bg-emerald-500";
        
        const cardBg = isExpired ? "bg-red-50 border-red-100" : isCritical ? "bg-amber-50 border-amber-100" : `bg-${color}-50 border-${color}-100`;
        const textColor = isExpired ? "text-red-700" : isCritical ? "text-amber-700" : `text-${color}-700`;

        return (
            <div className={`p-3 rounded-xl border ${cardBg} ${textColor}`}>
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                        <Icon className="h-3.5 w-3.5" />
                        <span className="text-[10px] font-bold uppercase tracking-tighter">{title}</span>
                    </div>
                    <Badge className={`text-[9px] h-4 ${statusColor} hover:${statusColor} text-white border-0`}>{statusLabel}</Badge>
                </div>
                <div className="flex justify-between items-end">
                    <div>
                        <p className="text-2xl font-black leading-none">{isExpired ? 0 : days}</p>
                        <p className="text-[9px] font-medium opacity-70">Days Remaining</p>
                    </div>
                    <p className="text-[10px] font-bold">{format(new Date(doc.docExpiry), "dd MMM yyyy")}</p>
                </div>
            </div>
        );
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Visa & Compliance</h1>
                    <p className="text-slate-500 dark:text-slate-400">Manage visa requests and monitor document validity.</p>
                </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
                <VisaForm />

                <div className="space-y-6">
                    <Card className="border-indigo-100 dark:border-indigo-900/50 overflow-hidden">
                        <CardHeader className="bg-indigo-50/50 dark:bg-indigo-900/10">
                            <CardTitle className="text-sm flex items-center gap-2">
                                <ShieldCheck className="h-4 w-4 text-indigo-600" />
                                Compliance Status
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-4 space-y-3">
                            {renderDocCard("PASSPORT_COPY", "Passport Validity", Passport, "emerald")}
                            {renderDocCard("VISA_COPY", "Visa Validity", Globe, "blue")}
                            {renderDocCard("MEDICAL_INSURANCE", "Medical Insurance", Stethoscope, "amber")}
                            {renderDocCard("ILOE_INSURANCE", "ILOE Insurance", ShieldAlert, "slate")}

                            <div className="mt-4 p-4 rounded-xl border-2 border-dashed border-slate-100 dark:border-slate-800 bg-slate-50/30">
                                <div className="flex gap-2">
                                    <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                                    <p className="text-[11px] font-medium leading-relaxed">
                                        Notifications are sent **30 days** and **7 days** before any document expiry. Please ensure all uploads are current.
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-sm">Request Archive</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-center py-6 text-slate-400 italic text-[11px]">
                                No application history available.
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
