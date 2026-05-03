"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { 
    Mail, 
    Briefcase, 
    UserMinus, 
    FileText, 
    Zap, 
    ShieldCheck, 
    ArrowRight,
    Send,
    UserCheck,
    FileSignature
} from "lucide-react";

export default function LettersDashboard() {
    const letterTypes = [
        {
            title: "Offer Letter",
            description: "Generate and dispatch official job offers to prospective candidates.",
            icon: Mail,
            href: "/letters/offer",
            color: "from-blue-500 to-indigo-600",
            lightColor: "bg-blue-50 text-blue-600"
        },
        {
            title: "Appointment Letter",
            description: "Solidify employment agreements and confirm roles for newly onboarded staff.",
            icon: FileSignature,
            href: "/letters/appointment",
            color: "from-violet-500 to-purple-600",
            lightColor: "bg-violet-50 text-violet-600"
        },
        {
            title: "Relieving Letter",
            description: "Professional exit documentation for employees transitioning out of the firm.",
            icon: UserMinus,
            href: "/letters/relieving",
            color: "from-rose-500 to-orange-600",
            lightColor: "bg-rose-50 text-rose-600"
        }
    ];

    return (
        <div className="space-y-8 p-4 md:p-8 w-full max-w-7xl mx-auto">
            {/* Premium Header */}
            <div className="relative group overflow-hidden bg-gradient-to-br from-indigo-900 via-indigo-950 to-slate-900 p-8 md:p-12 rounded-[2.5rem] shadow-2xl transition-all duration-500">
                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-indigo-500/10 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2"></div>
                <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-violet-500/10 rounded-full blur-[80px] translate-y-1/2 -translate-x-1/2"></div>
                
                <div className="relative z-10">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/10 text-indigo-200 text-xs font-bold uppercase tracking-widest mb-6">
                        <FileText className="h-3 w-3 fill-indigo-400" />
                        Document Governance
                    </div>
                    <h1 className="text-4xl md:text-6xl font-black tracking-tight text-white mb-4 leading-tight">
                        Official Letter<br />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-violet-400">Generation Hub</span>
                    </h1>
                    <p className="text-slate-300 text-base font-medium max-w-xl leading-relaxed">
                        Automated document engine for corporate compliance. Create, verify, and archive official correspondence with legal precision and speed.
                    </p>
                </div>
            </div>

            <div className="grid gap-8 md:grid-cols-3">
                {letterTypes.map((type) => (
                    <Card key={type.title} className="group relative overflow-hidden bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border border-white/40 dark:border-slate-800/60 shadow-xl rounded-[2.5rem] hover:shadow-2xl hover:scale-[1.02] transition-all duration-500">
                        <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br ${type.color} opacity-[0.03] group-hover:opacity-[0.1] transition-opacity rounded-bl-[5rem]`} />
                        
                        <CardHeader className="p-8">
                            <div className={`h-14 w-14 rounded-2xl ${type.lightColor} flex items-center justify-center mb-6 shadow-sm group-hover:scale-110 transition-transform duration-500`}>
                                <type.icon className="h-7 w-7" />
                            </div>
                            <CardTitle className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight group-hover:text-indigo-600 transition-colors">
                                {type.title}
                            </CardTitle>
                            <CardDescription className="text-slate-500 font-medium text-sm leading-relaxed mt-2">
                                {type.description}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="p-8 pt-0">
                            <Link href={type.href}>
                                <Button className="w-full h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 hover:bg-indigo-600 dark:hover:bg-indigo-600 hover:text-white text-slate-900 dark:text-white font-black uppercase text-xs tracking-widest border-0 transition-all duration-300 group-hover:shadow-lg group-hover:shadow-indigo-600/20 flex items-center gap-2">
                                    Initiate Process
                                    <ArrowRight className="h-4 w-4 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                                </Button>
                            </Link>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Quick Actions / Templates */}
            <div className="bg-slate-900 rounded-[3rem] p-10 relative overflow-hidden shadow-2xl">
                <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2" />
                <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-8">
                    <div className="flex items-center gap-6">
                        <div className="h-16 w-16 rounded-2xl bg-white/10 backdrop-blur-md flex items-center justify-center shadow-inner">
                            <ShieldCheck className="h-8 w-8 text-indigo-400" />
                        </div>
                        <div>
                            <h4 className="text-xl font-black text-white uppercase tracking-tight">Compliance Verified Templates</h4>
                            <p className="text-slate-400 text-sm font-medium">All generated letters follow the latest UAE Labour Law standards.</p>
                        </div>
                    </div>
                    <Button variant="outline" className="h-14 px-8 rounded-2xl bg-white/5 border-white/10 text-white hover:bg-white/10 font-black text-xs uppercase tracking-widest gap-2">
                        View Template Library
                        <ArrowRight className="h-4 w-4" />
                    </Button>
                </div>
            </div>
        </div>
    );
}

