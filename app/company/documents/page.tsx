import * as React from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { requirePageAnyPermission } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getCompanyDocuments } from "@/app/lib/actions/company-documents";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import {
    FileText,
    FolderOpen,
    Plus,
    ArrowRight,
    ShieldCheck,
    BookOpen
} from "lucide-react";

export default async function CompanyDocumentsPage() {
    await requirePageAnyPermission([PERMISSIONS.SETTINGS_VIEW, PERMISSIONS.SETTINGS_MANAGE]);

    const session = await auth();
    if (!session?.user?.email) redirect("/login");

    const res = await getCompanyDocuments();
    const documents = res.success ? res.data : [];
    const userRole = session.user.role;
    const isAdmin = userRole === "ADMIN" || userRole === "HR";

    const typeColors: Record<string, string> = {
        POLICY: "bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300",
        HANDBOOK: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
        PROCEDURE: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
        FORM: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
        OTHER: "bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300",
    };

    const categoryIcons: Record<string, React.ElementType> = {
        HR: ShieldCheck,
        FINANCE: BookOpen,
        IT: FolderOpen,
        LEGAL: ShieldCheck,
        GENERAL: FileText,
    };

    return (
        <div className="space-y-8 p-4 md:p-8 w-full max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-gradient-to-r from-slate-900 to-slate-950 p-5 sm:p-6 md:p-8 rounded-[2rem] shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-96 h-96 bg-slate-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3"></div>
                <div className="absolute bottom-0 left-0 w-72 h-72 bg-slate-500/10 rounded-full blur-3xl translate-y-1/3 -translate-x-1/4"></div>

                <div className="relative z-10 min-w-0">
                    <h1 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight text-white mb-2">Company Documents</h1>
                    <p className="text-slate-300 text-sm md:text-base font-medium max-w-xl">
                        Central repository for policies, handbooks, procedures, and official company documents.
                    </p>
                </div>
                {isAdmin && (
                    <div className="relative z-10 flex flex-col sm:flex-row gap-3 flex-wrap">
                        <Link href="/company/documents/new">
                            <Button className="gap-2 w-full sm:w-auto rounded-xl font-bold bg-white text-slate-900 hover:bg-slate-100">
                                <Plus className="h-4 w-4" />
                                Upload Document
                            </Button>
                        </Link>
                    </div>
                )}
            </div>

            {/* Stats */}
            <div className="grid gap-4 sm:gap-6 md:grid-cols-4">
                <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-sm rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-bold text-slate-500 uppercase tracking-wider">Total Docs</CardTitle>
                        <div className="p-2 bg-slate-100 dark:bg-slate-900/30 rounded-lg">
                            <FileText className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-slate-800 dark:text-white">{documents.length}</div>
                    </CardContent>
                </Card>
                <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-sm rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-bold text-slate-500 uppercase tracking-wider">Policies</CardTitle>
                        <div className="p-2 bg-violet-100 dark:bg-violet-900/30 rounded-lg">
                            <BookOpen className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-slate-800 dark:text-white">
                            {documents.filter((d: any) => d.type === "POLICY").length}
                        </div>
                    </CardContent>
                </Card>
                <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-sm rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-bold text-slate-500 uppercase tracking-wider">Handbooks</CardTitle>
                        <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                            <FolderOpen className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-slate-800 dark:text-white">
                            {documents.filter((d: any) => d.type === "HANDBOOK").length}
                        </div>
                    </CardContent>
                </Card>
                <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-sm rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-bold text-slate-500 uppercase tracking-wider">Procedures</CardTitle>
                        <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
                            <BookOpen className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-slate-800 dark:text-white">
                            {documents.filter((d: any) => d.type === "PROCEDURE").length}
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card className="bg-white dark:bg-slate-950 border-slate-100 dark:border-slate-800/60 shadow-sm rounded-2xl overflow-hidden">
                <CardHeader className="border-b border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-900/20 px-4 py-4 sm:px-6 sm:py-5">
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="text-xl font-bold">Document Library</CardTitle>
                            <CardDescription className="font-medium text-slate-500">
                                All published company policies and documents
                            </CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    {documents.length === 0 ? (
                        <div className="p-12 text-center">
                            <div className="h-16 w-16 rounded-2xl bg-slate-50 dark:bg-slate-900 flex items-center justify-center mx-auto mb-4">
                                <FolderOpen className="h-8 w-8 text-slate-300" />
                            </div>
                            <h3 className="text-lg font-black text-slate-900 dark:text-white mb-2">No Documents Yet</h3>
                            <p className="text-sm text-slate-500 max-w-sm mx-auto mb-6">
                                Upload your first company policy or document to build the central repository.
                            </p>
                            {isAdmin && (
                                <Link href="/company/documents/new">
                                    <Button className="rounded-xl font-bold">
                                        <Plus className="h-4 w-4 mr-2" />
                                        Upload First Document
                                    </Button>
                                </Link>
                            )}
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
                            {documents.map((doc: any) => {
                                const Icon = categoryIcons[doc.category] || FileText;
                                return (
                                    <div
                                        key={doc.id}
                                        className="flex items-center justify-between p-4 sm:p-6 hover:bg-slate-50/80 dark:hover:bg-slate-900/50 transition-colors"
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className="h-12 w-12 rounded-2xl bg-slate-100 dark:bg-slate-900 flex items-center justify-center shrink-0">
                                                <Icon className="h-6 w-6 text-slate-600 dark:text-slate-400" />
                                            </div>
                                            <div>
                                                <h4 className="font-bold text-slate-900 dark:text-white">{doc.title}</h4>
                                                <p className="text-xs text-slate-500 font-medium">
                                                    {doc.category} · v{doc.version} · {doc.fileName}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <Badge className={`font-bold px-3 py-1 rounded-full border-0 ${typeColors[doc.type] || typeColors.OTHER}`}>
                                                {doc.type}
                                            </Badge>
                                            <Badge variant={doc.isActive ? "default" : "secondary"} className="font-bold">
                                                {doc.isActive ? "Active" : "Inactive"}
                                            </Badge>
                                            <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer">
                                                <Button variant="ghost" size="sm" className="gap-1">
                                                    View <ArrowRight className="h-3 w-3" />
                                                </Button>
                                            </a>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
