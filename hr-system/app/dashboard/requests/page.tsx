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
    Clock
} from "lucide-react";
import { submitStaffRequest } from "@/app/lib/actions/staff-requests";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export default async function StaffRequestsPage() {
    const session = await auth();
    if (!session?.user) redirect("/login");

    const services = await prisma.staffServiceType.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' }
    });

    const user = await prisma.user.findUnique({
        where: { email: session.user.email! },
        include: { employee: { include: { staffRequests: { include: { serviceType: true }, orderBy: { createdAt: 'desc' } } } } }
    });

    if (!user?.employee) {
        return (
            <div className="p-8">
                <Card className="border-red-200 bg-red-50 text-red-700">
                    <CardHeader>
                        <CardTitle>Profile Incomplete</CardTitle>
                        <CardDescription className="text-red-600">Please contact HR to complete your employee profile.</CardDescription>
                    </CardHeader>
                </Card>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Staff Services</h1>
                    <p className="text-slate-500 dark:text-slate-400">Submit reimbursements, overtime, and other requests.</p>
                </div>
                <div className="flex items-center gap-2 px-4 py-2 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 rounded-full border border-emerald-100 dark:border-emerald-800">
                    <HeartHandshake className="h-4 w-4" />
                    <span className="text-sm font-bold">Request Hub</span>
                </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-12">
                <div className="lg:col-span-8 space-y-6">
                    <Card className="border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                        <CardHeader className="bg-slate-50/50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-800">
                            <CardTitle className="text-lg">Submit New Request</CardTitle>
                            <CardDescription>Select a category and fill in the details below.</CardDescription>
                        </CardHeader>
                        <CardContent className="p-0">
                            {services.length === 0 ? (
                                <div className="p-12 text-center text-slate-400">
                                    <Info className="h-12 w-12 mx-auto mb-4 opacity-20" />
                                    <p>No request categories available. Please contact HR.</p>
                                </div>
                            ) : (
                                <Tabs defaultValue={services[0].id} className="w-full">
                                    <div className="border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-950 px-4">
                                        <ScrollArea className="w-full">
                                            <TabsList className="h-14 bg-transparent gap-6 w-full justify-start rounded-none p-0">
                                                {services.map((service: any) => (
                                                    <TabsTrigger
                                                        key={service.id}
                                                        value={service.id}
                                                        className="h-14 rounded-none border-b-2 border-transparent px-2 data-[state=active]:border-indigo-600 data-[state=active]:bg-transparent data-[state=active]:text-indigo-600 data-[state=active]:shadow-none transition-all hover:text-indigo-500 font-bold text-xs uppercase tracking-wider"
                                                    >
                                                        {service.name}
                                                    </TabsTrigger>
                                                ))}
                                            </TabsList>
                                        </ScrollArea>
                                    </div>

                                    {services.map((service: any) => (
                                        <TabsContent key={service.id} value={service.id} className="p-6 mt-0">
                                            <form action={async (fd: FormData) => { await submitStaffRequest(fd); }} className="space-y-6">
                                                <input type="hidden" name="typeId" value={service.id} />

                                                <div className="grid md:grid-cols-2 gap-6">
                                                    <div className="space-y-2">
                                                        <Label className="text-xs font-bold uppercase text-slate-500">Details / Description</Label>
                                                        <Input
                                                            name="details"
                                                            placeholder={`Describe your ${service.name.toLowerCase()} request...`}
                                                            required
                                                        />
                                                    </div>

                                                    {service.requiresAmount && (
                                                        <div className="space-y-2">
                                                            <Label className="text-xs font-bold uppercase text-slate-500 flex items-center gap-1">
                                                                <DollarSign className="h-3 w-3" /> Amount (AED)
                                                            </Label>
                                                            <Input
                                                                type="number"
                                                                name="amount"
                                                                step="0.01"
                                                                placeholder="0.00"
                                                                required
                                                            />
                                                        </div>
                                                    )}

                                                    {service.requiresDates && (
                                                        <>
                                                            <div className="space-y-2">
                                                                <Label className="text-xs font-bold uppercase text-slate-500 flex items-center gap-1">
                                                                    <CalendarRange className="h-3 w-3" /> Start Date
                                                                </Label>
                                                                <Input type="date" name="startDate" required />
                                                            </div>
                                                            <div className="space-y-2">
                                                                <Label className="text-xs font-bold uppercase text-slate-500 flex items-center gap-1">
                                                                    <CalendarRange className="h-3 w-3" /> End Date
                                                                </Label>
                                                                <Input type="date" name="endDate" required />
                                                            </div>
                                                        </>
                                                    )}

                                                    <div className="md:col-span-2 space-y-2">
                                                        <Label className="text-xs font-bold uppercase text-slate-500 flex items-center gap-1">
                                                            <FileUp className="h-3 w-3" /> Supporting Document / Receipt
                                                        </Label>
                                                        <div className="border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl p-6 bg-slate-50/50 dark:bg-slate-900/50 text-center transition-colors hover:border-indigo-400">
                                                            <Input
                                                                type="file"
                                                                name="attachment"
                                                                className="cursor-pointer bg-white dark:bg-slate-950"
                                                            />
                                                            <p className="mt-2 text-xs text-slate-500">Upload PDF, JPG, or PNG (Max 5MB)</p>
                                                        </div>
                                                    </div>
                                                </div>

                                                <Button type="submit" className="w-full md:w-auto px-8 bg-indigo-600 hover:bg-indigo-700 h-11 text-sm font-bold shadow-lg shadow-indigo-200 dark:shadow-none transition-all hover:scale-[1.02] active:scale-95">
                                                    Submit {service.name} Request
                                                </Button>
                                            </form>
                                        </TabsContent>
                                    ))}
                                </Tabs>
                            )}
                        </CardContent>
                    </Card>
                </div>

                <div className="lg:col-span-4 space-y-6">
                    <Card className="border-slate-200 dark:border-slate-800 shadow-sm h-full">
                        <CardHeader>
                            <CardTitle className="text-lg flex items-center gap-2">
                                <Clock className="h-5 w-5 text-indigo-600" />
                                Recent History
                            </CardTitle>
                            <CardDescription>Track the status of your submissions.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <ScrollArea className="h-[400px] pr-4">
                                <div className="space-y-4">
                                    {user.employee.staffRequests.length === 0 ? (
                                        <p className="text-center text-sm text-slate-400 py-12">No requests yet.</p>
                                    ) : (
                                        (user.employee.staffRequests as any[]).map((req: any) => (
                                            <div key={req.id} className="group p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-950 transition-all hover:border-indigo-200 hover:shadow-md">
                                                <div className="flex items-center justify-between mb-2">
                                                    <Badge className={cn(
                                                        "text-[10px] font-bold uppercase",
                                                        req.status === 'PENDING' ? "bg-amber-100 text-amber-700 hover:bg-amber-200" :
                                                            req.status === 'APPROVED' ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200" :
                                                                "bg-red-100 text-red-700 hover:bg-red-200"
                                                    )}>
                                                        {req.status}
                                                    </Badge>
                                                    <span className="text-[10px] text-slate-400">{new Date(req.createdAt).toLocaleDateString()}</span>
                                                </div>
                                                <h5 className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-indigo-600 transition-colors">
                                                    {req.serviceType.name}
                                                </h5>
                                                <p className="text-xs text-slate-500 line-clamp-1 mt-1">{req.details}</p>
                                                {req.amount && (
                                                    <div className="mt-2 text-sm font-bold text-emerald-600">
                                                        AED {req.amount.toLocaleString()}
                                                    </div>
                                                )}
                                            </div>
                                        ))
                                    )}
                                </div>
                            </ScrollArea>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
