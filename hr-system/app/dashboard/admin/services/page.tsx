import prisma from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Edit2, Settings2, ShieldCheck, CalendarRange, DollarSign } from "lucide-react";
import { upsertServiceType, deleteServiceType } from "@/app/lib/actions/staff-requests";
import { cn } from "@/lib/utils";

export default async function ServiceManagementPage() {
    const services = await prisma.staffServiceType.findMany({
        orderBy: { name: 'asc' }
    });

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Service Management</h1>
                    <p className="text-slate-500 dark:text-slate-400">Configure request types (tabs) available for staff.</p>
                </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
                <Card className="lg:col-span-1">
                    <CardHeader>
                        <CardTitle>Create New Service</CardTitle>
                        <CardDescription>Add a new tab for staff requests.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form action={async (fd: FormData) => { await upsertServiceType(fd); }} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="name">Service Name</Label>
                                <Input id="name" name="name" placeholder="e.g. Reimbursement" required />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="description">Description</Label>
                                <Input id="description" name="description" placeholder="e.g. Travel and office expenses" />
                            </div>

                            <div className="grid grid-cols-2 gap-4 pt-2">
                                <div className="flex items-center gap-2">
                                    <input type="checkbox" id="requiresAmount" name="requiresAmount" value="true" className="rounded" />
                                    <Label htmlFor="requiresAmount" className="text-xs font-medium">Requires Amount</Label>
                                </div>
                                <div className="flex items-center gap-2">
                                    <input type="checkbox" id="requiresDates" name="requiresDates" value="true" className="rounded" />
                                    <Label htmlFor="requiresDates" className="text-xs font-medium">Requires Dates</Label>
                                </div>
                            </div>

                            <Button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700">
                                <Plus className="h-4 w-4 mr-2" /> Add Service Tab
                            </Button>
                        </form>
                    </CardContent>
                </Card>

                <div className="lg:col-span-2 space-y-4">
                    <h3 className="font-bold text-slate-700 dark:text-white flex items-center gap-2">
                        <Settings2 className="h-4 w-4" />
                        Existing Services ({services.length})
                    </h3>
                    <div className="grid gap-4">
                        {services.length === 0 ? (
                            <Card className="border-dashed h-32 flex items-center justify-center text-slate-400">
                                No services configured yet.
                            </Card>
                        ) : (
                            services.map((service: any) => (
                                <Card key={service.id} className="overflow-hidden">
                                    <div className="flex items-center justify-between p-4 bg-white dark:bg-slate-950">
                                        <div className="flex items-center gap-4">
                                            <div className="h-10 w-10 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center text-indigo-600">
                                                <ShieldCheck className="h-5 w-5" />
                                            </div>
                                            <div>
                                                <h4 className="font-bold text-slate-900 dark:text-white">{service.name}</h4>
                                                <p className="text-xs text-slate-500">{service.description || "No description"}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {service.requiresAmount && (
                                                <Badge variant="outline" className="gap-1 border-emerald-200 text-emerald-700 bg-emerald-50">
                                                    <DollarSign className="h-3 w-3" /> Amount
                                                </Badge>
                                            )}
                                            {service.requiresDates && (
                                                <Badge variant="outline" className="gap-1 border-blue-200 text-blue-700 bg-blue-50">
                                                    <CalendarRange className="h-3 w-3" /> Dates
                                                </Badge>
                                            )}

                                            <form action={async () => {
                                                'use server';
                                                await deleteServiceType(service.id);
                                            }}>
                                                <Button type="submit" variant="ghost" size="icon" className="text-red-500 hover:text-red-700 hover:bg-red-50">
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </form>
                                        </div>
                                    </div>
                                </Card>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
