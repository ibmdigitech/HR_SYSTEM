import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Briefcase, Users, Calendar, PlusCircle, CheckCircle, Clock } from "lucide-react";

export default async function RecruitmentPage() {
    const session = await auth();
    if (!session?.user?.email) redirect("/login");

    const user = await prisma.user.findUnique({
        where: { email: session.user.email },
        include: { employee: true }
    });

    if (!user || (user.role !== "HR" && user.role !== "ADMIN" && user.role !== "MANAGER")) {
        redirect("/dashboard");
    }

    const jobs = await prisma.jobRequisition.findMany({
        include: { requestedBy: true, _count: { select: { candidates: true } } },
        orderBy: { createdAt: 'desc' }
    });

    const candidates = await prisma.candidate.findMany({
        include: { job: true },
        orderBy: { createdAt: 'desc' }
    });

    return (
        <div className="space-y-8 p-4 md:p-8 w-full max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">Recruitment & ATS</h1>
                    <p className="text-slate-500 font-medium mt-1">Manage job requisitions, candidate pipeline, and interviews.</p>
                </div>
                <div className="flex gap-2">
                    <Button className="bg-indigo-600 hover:bg-indigo-700 font-bold gap-2 rounded-xl">
                        <PlusCircle className="h-4 w-4" />
                        New Job Requisition
                    </Button>
                </div>
            </div>

            {/* Dashboard Stats */}
            <div className="grid gap-4 md:grid-cols-3">
                <Card className="rounded-[2rem] border-slate-100 shadow-lg dark:border-slate-800">
                    <CardContent className="p-6 flex items-center gap-4">
                        <div className="p-4 bg-indigo-50 dark:bg-indigo-900/30 rounded-2xl">
                            <Briefcase className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
                        </div>
                        <div>
                            <p className="text-3xl font-black">{jobs.length}</p>
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Open Positions</p>
                        </div>
                    </CardContent>
                </Card>
                <Card className="rounded-[2rem] border-slate-100 shadow-lg dark:border-slate-800">
                    <CardContent className="p-6 flex items-center gap-4">
                        <div className="p-4 bg-emerald-50 dark:bg-emerald-900/30 rounded-2xl">
                            <Users className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <div>
                            <p className="text-3xl font-black">{candidates.length}</p>
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Total Candidates</p>
                        </div>
                    </CardContent>
                </Card>
                <Card className="rounded-[2rem] border-slate-100 shadow-lg dark:border-slate-800">
                    <CardContent className="p-6 flex items-center gap-4">
                        <div className="p-4 bg-amber-50 dark:bg-amber-900/30 rounded-2xl">
                            <Calendar className="h-6 w-6 text-amber-600 dark:text-amber-400" />
                        </div>
                        <div>
                            <p className="text-3xl font-black">0</p>
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Upcoming Interviews</p>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Content Tabs area placeholder */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Job Requisitions */}
                <div className="lg:col-span-2 space-y-6">
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        <Briefcase className="h-5 w-5 text-indigo-500" />
                        Active Job Requisitions
                    </h2>
                    
                    {jobs.length === 0 ? (
                        <Card className="p-12 border-dashed flex flex-col items-center justify-center text-slate-400 rounded-[2rem]">
                            <Briefcase className="h-10 w-10 mb-4 opacity-50" />
                            <p className="font-medium">No active job requisitions.</p>
                        </Card>
                    ) : (
                        <div className="grid gap-4">
                            {jobs.map(job => (
                                <Card key={job.id} className="rounded-2xl border-slate-100 shadow-sm hover:shadow-md transition-all">
                                    <CardContent className="p-6">
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <h3 className="text-lg font-black">{job.title}</h3>
                                                <p className="text-sm font-medium text-slate-500">{job.department} • {job.location}</p>
                                            </div>
                                            <Badge className={job.status === "OPEN" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-700"}>
                                                {job.status}
                                            </Badge>
                                        </div>
                                        <div className="mt-4 flex gap-4 text-sm font-medium text-slate-600">
                                            <span className="flex items-center gap-1">
                                                <Users className="h-4 w-4" />
                                                {job._count.candidates} Candidates
                                            </span>
                                            <span className="flex items-center gap-1">
                                                <Clock className="h-4 w-4" />
                                                Posted {new Date(job.createdAt).toLocaleDateString()}
                                            </span>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}
                </div>

                {/* Candidate Pipeline */}
                <div className="space-y-6">
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        <Users className="h-5 w-5 text-emerald-500" />
                        Recent Candidates
                    </h2>
                    
                    {candidates.length === 0 ? (
                        <Card className="p-8 border-dashed flex flex-col items-center justify-center text-slate-400 rounded-2xl">
                            <Users className="h-8 w-8 mb-4 opacity-50" />
                            <p className="font-medium text-sm">No candidates yet.</p>
                        </Card>
                    ) : (
                        <div className="space-y-4">
                            {candidates.map(candidate => (
                                <div key={candidate.id} className="p-4 bg-white dark:bg-slate-900 rounded-2xl border shadow-sm flex flex-col gap-2">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <p className="font-bold text-sm">{candidate.firstName} {candidate.lastName}</p>
                                            <p className="text-xs text-slate-500">for {candidate.job.title}</p>
                                        </div>
                                        <Badge variant="outline" className="text-[10px]">{candidate.status}</Badge>
                                    </div>
                                    <div className="flex justify-end gap-2 mt-2">
                                        <Button size="sm" variant="outline" className="h-7 text-xs">View Profile</Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
