import prisma from "@/lib/prisma";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    HeartHandshake,
    DollarSign,
    CalendarRange,
    FileUp,
    Info,
    CheckCircle2,
    Clock,
    Zap,
    History,
    Plus,
    Activity,
    ChevronRight,
    ArrowRight
} from "lucide-react";
import { submitStaffRequest } from "@/app/lib/actions/staff-requests";
import { Badge } from "@/components/ui/badge";
import { DatePicker } from "@/components/ui/date-picker";
import { cn } from "@/lib/utils";

export default async function StaffRequestsPage() {
    const session = await auth();
    if (!session?.user) redirect("/login");

    const services = await prisma.serviceCategory.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' }
    });

    const user = await prisma.user.findUnique({
        where: { email: session.user.email! },
        include: { employee: { include: { serviceRequests: { include: { category: true }, orderBy: { createdAt: 'desc' } } } } }
    });

    if (!user?.employee) {
        return (
            <div className="p-8 max-w-4xl mx-auto">
                <Card className="border-0 shadow-2xl bg-rose-50/50 dark:bg-rose-950/20 backdrop-blur-xl rounded-[2.5rem] overflow-hidden">
                    <div className="p-12 text-center">
                        <div className="h-20 w-20 rounded-full bg-rose-100 dark:bg-rose-900/50 flex items-center justify-center mx-auto mb-6">
                            <Info className="h-10 w-10 text-rose-600" />
                        </div>
                        <h2 className="text-3xl font-black text-rose-900 dark:text-rose-100 mb-4 tracking-tight uppercase">Profile Incomplete</h2>
                        <p className="text-rose-700/70 dark:text-rose-300/70 text-lg font-medium leading-relaxed max-w-md mx-auto">
                            Our system requires a complete employee profile to process service requests. Please contact the HR department to finalize your documentation.
                        </p>
                    </div>
                </Card>
            </div>
        );
    }

    return (
        <div className="space-y-8 p-4 md:p-8 w-full max-w-7xl mx-auto">
            {/* Premium Header */}
            <div className="relative group overflow-hidden bg-gradient-to-br from-indigo-900 via-indigo-950 to-slate-900 p-8 md:p-12 rounded-[2.5rem] shadow-2xl transition-all duration-500">
                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-indigo-500/10 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2"></div>
                <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-violet-500/10 rounded-full blur-[80px] translate-y-1/2 -translate-x-1/2"></div>
                
                <div className="relative z-10">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/10 text-indigo-200 text-xs font-bold uppercase tracking-widest mb-6">
                        <HeartHandshake className="h-3 w-3 fill-indigo-400" />
                        Staff Services Hub
                    </div>
                    <h1 className="text-4xl md:text-6xl font-black tracking-tight text-white mb-4 leading-tight">
                        Self-Service<br />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-violet-400">Request Center</span>
                    </h1>
                    <p className="text-slate-300 text-base font-medium max-w-xl leading-relaxed">
                        Submit and track corporate service requests, reimbursements, and administrative requirements with real-time status updates.
                    </p>
                </div>
            </div>

            <div className="grid gap-8 lg:grid-cols-12">
                {/* Request Form Area */}
                <div className="lg:col-span-8 space-y-8">
                    <div className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border border-white/40 dark:border-slate-800/60 shadow-2xl rounded-[3rem] overflow-hidden">
                        <div className="p-8 border-b border-slate-100 dark:border-slate-800/60 bg-slate-50/30 dark:bg-slate-900/30 flex items-center justify-between">
                            <div>
                                <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Initiate New Request</h3>
                                <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-1">Select a category to begin</p>
                            </div>
                            <div className="h-12 w-12 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-600/20">
                                <Plus className="h-6 w-6 text-white" />
                            </div>
                        </div>

                        <div className="p-0">
                            {services.length === 0 ? (
                                <div className="p-24 text-center">
                                    <Info className="h-16 w-16 mx-auto mb-6 text-slate-200" />
                                    <h4 className="text-lg font-black text-slate-800 dark:text-white uppercase tracking-tight">No Active Services</h4>
                                    <p className="text-slate-400 font-medium max-w-xs mx-auto mt-2">No request categories have been configured for your department yet.</p>
                                </div>
                            ) : (
                                <Tabs defaultValue={services[0].id} className="w-full">
                                    <div className="border-b border-slate-100 dark:border-slate-800/60 bg-white/40 dark:bg-slate-950/40 px-8">
                                        <ScrollArea className="w-full">
                                            <TabsList className="h-20 bg-transparent gap-8 w-full justify-start rounded-none p-0">
                                                {services.map((service: any) => (
                                                    <TabsTrigger
                                                        key={service.id}
                                                        value={service.id}
                                                        className="h-20 rounded-none border-b-4 border-transparent px-2 data-[state=active]:border-indigo-600 data-[state=active]:bg-transparent data-[state=active]:text-indigo-600 data-[state=active]:shadow-none transition-all hover:text-indigo-500 font-black text-xs uppercase tracking-[0.2em]"
                                                    >
                                                        {service.name}
                                                    </TabsTrigger>
                                                ))}
                                            </TabsList>
                                        </ScrollArea>
                                    </div>

                                    {services.map((service: any) => (
                                        <TabsContent key={service.id} value={service.id} className="p-10 mt-0 focus-visible:outline-none">
                                            <form action={submitStaffRequest} className="space-y-10">
                                                <input type="hidden" name="categoryId" value={service.id} />

                                                <div className="grid md:grid-cols-2 gap-8">
                                                    <div className="md:col-span-2 space-y-4">
                                                        <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">Request Summary & Rationale</Label>
                                                        <Input
                                                            name="details"
                                                            placeholder={`Describe the purpose of your ${service.name.toLowerCase()}...`}
                                                            required
                                                            className="h-14 rounded-2xl bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 font-medium focus-visible:ring-2 focus-visible:ring-indigo-500 transition-all"
                                                        />
                                                    </div>

                                                    {service.requiresAmount && (
                                                        <div className="space-y-4">
                                                            <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1 flex items-center gap-2">
                                                                <DollarSign className="h-3 w-3 text-indigo-500" /> Fiscal Value (AED)
                                                            </Label>
                                                            <Input
                                                                type="number"
                                                                name="amount"
                                                                step="0.01"
                                                                placeholder="0.00"
                                                                required
                                                                className="h-14 rounded-2xl bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 font-black text-lg focus-visible:ring-2 focus-visible:ring-indigo-500"
                                                            />
                                                        </div>
                                                    )}

                                                    {service.requiresDates && (
                                                        <>
                                                            <div className="space-y-4">
                                                                <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1 flex items-center gap-2">
                                                                    <CalendarRange className="h-3 w-3 text-indigo-500" /> Start Date
                                                                </Label>
                                                                <DatePicker name="startDate" required className="h-14 rounded-2xl bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 font-bold focus-visible:ring-2 focus-visible:ring-indigo-500" />
                                                            </div>
                                                            <div className="space-y-4">
                                                                <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1 flex items-center gap-2">
                                                                    <CalendarRange className="h-3 w-3 text-indigo-500" /> End Date
                                                                </Label>
                                                                <DatePicker name="endDate" required className="h-14 rounded-2xl bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 font-bold focus-visible:ring-2 focus-visible:ring-indigo-500" />
                                                            </div>
                                                        </>
                                                    )}

                                                    <div className="md:col-span-2 space-y-4">
                                                        <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1 flex items-center gap-2">
                                                            <FileUp className="h-3 w-3 text-indigo-500" /> Supporting Evidence
                                                        </Label>
                                                        <div className="relative group border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-3xl p-10 bg-slate-50/50 dark:bg-slate-900/50 text-center transition-all hover:border-indigo-400 hover:bg-indigo-50/30 dark:hover:bg-indigo-900/10">
                                                            <Input
                                                                type="file"
                                                                name="attachment"
                                                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                                            />
                                                            <div className="space-y-3">
                                                                <div className="h-12 w-12 rounded-2xl bg-white dark:bg-slate-800 flex items-center justify-center mx-auto shadow-md group-hover:scale-110 transition-transform">
                                                                    <FileUp className="h-6 w-6 text-indigo-600" />
                                                                </div>
                                                                <p className="text-sm font-black text-slate-700 dark:text-slate-300 tracking-tight">Drop verification documents here</p>
                                                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">PDF, JPG, or PNG (MAX 5MB)</p>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="flex justify-end">
                                                    <Button type="submit" className="h-14 px-12 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase text-xs tracking-[0.2em] shadow-xl shadow-indigo-600/20 transition-all hover:scale-105 active:scale-95 flex items-center gap-3">
                                                        Dispatch {service.name} Request
                                                        <ArrowRight className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </form>
                                        </TabsContent>
                                    ))}
                                </Tabs>
                            )}
                        </div>
                    </div>
                </div>

                {/* History Area */}
                <div className="lg:col-span-4 space-y-8">
                    <div className="bg-white/80 dark:bg-slate-950/80 backdrop-blur-2xl border border-slate-100 dark:border-slate-800/60 shadow-2xl rounded-[3rem] overflow-hidden flex flex-col h-full">
                        <div className="p-8 border-b border-slate-50 dark:border-slate-900 bg-slate-50/50 dark:bg-slate-900/50">
                            <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight flex items-center gap-3">
                                <History className="h-6 w-6 text-indigo-600" />
                                Audit Log
                            </h3>
                            <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mt-1">Live status tracking</p>
                        </div>

                        <ScrollArea className="flex-1 max-h-[700px]">
                            <div className="p-8 space-y-6">
                                {user.employee.serviceRequests.length === 0 ? (
                                    <div className="py-24 text-center">
                                        <Activity className="h-12 w-12 mx-auto mb-4 text-slate-100" />
                                        <p className="text-xs font-black text-slate-300 uppercase tracking-widest">No Activity Recorded</p>
                                    </div>
                                ) : (
                                    (user.employee.serviceRequests as any[]).map((req: any) => (
                                        <div key={req.id} className="group relative pl-8 pb-8 last:pb-0">
                                            {/* Timeline Line */}
                                            <div className="absolute left-[7px] top-0 bottom-0 w-[2px] bg-slate-100 dark:bg-slate-800 group-last:bottom-auto group-last:h-4" />
                                            
                                            {/* Status Dot */}
                                            <div className={cn(
                                                "absolute left-0 top-1 h-4 w-4 rounded-full border-4 border-white dark:border-slate-950 shadow-sm z-10 transition-transform group-hover:scale-125",
                                                req.status === 'PENDING' ? "bg-amber-500" :
                                                    req.status === 'COMPLETED' || req.status.includes('APPROVED') ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" :
                                                        "bg-rose-500"
                                            )} />

                                            <div className="p-5 rounded-2xl bg-slate-50/50 dark:bg-slate-900/50 border border-transparent hover:border-indigo-100 dark:hover:border-indigo-900/30 hover:bg-white dark:hover:bg-slate-900 transition-all">
                                                <div className="flex items-center justify-between mb-2">
                                                    <Badge className={cn(
                                                        "rounded-lg px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.1em] border-0",
                                                        req.status === 'PENDING' ? "bg-amber-100 text-amber-700" :
                                                            req.status === 'COMPLETED' || req.status.includes('APPROVED') ? "bg-emerald-100 text-emerald-700" :
                                                                "bg-rose-100 text-rose-700"
                                                    )}>
                                                        {req.status}
                                                    </Badge>
                                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">
                                                        {new Date(req.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                                                    </span>
                                                </div>
                                                <h5 className="font-black text-sm text-slate-900 dark:text-white tracking-tight group-hover:text-indigo-600 transition-colors">
                                                    {req.category.name}
                                                </h5>
                                                <p className="text-[11px] font-medium text-slate-500 line-clamp-1 mt-1">{req.details}</p>
                                                
                                                {req.amount && (
                                                    <div className="mt-3 flex items-center justify-between">
                                                        <span className="text-[10px] font-black uppercase text-slate-400">Amount</span>
                                                        <span className="text-sm font-black text-emerald-600 tracking-tight">AED {req.amount.toLocaleString()}</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </ScrollArea>
                    </div>
                </div>
            </div>
        </div>
    );
}

