"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { signOut } from "next-auth/react";
import {
    LayoutDashboard,
    Users,
    Calendar,
    CreditCard,
    Settings,
    LogOut,
    FileText,
    Building2,
    Briefcase,
    FileUp,
    Settings2,
    HeartHandshake,
    Sparkles,
    ChevronRight,
    Activity,
    CheckCircle2
} from "lucide-react";

const sidebarItems = [
    { title: "Dashboard",      href: "/dashboard",                icon: LayoutDashboard, exact: true },
    { title: "Employees",      href: "/employees",                icon: Users },
    { title: "Attendance",     href: "/attendance",               icon: Calendar },
    { title: "Leaves",         href: "/leaves",                   icon: Briefcase },
    { title: "Approvals",      href: "/dashboard/approvals",      icon: CheckCircle2 },
    { title: "Payroll",        href: "/payroll",                  icon: CreditCard },
    { title: "Visa & Compliance", href: "/dashboard/visa",        icon: FileUp },
    { title: "Letters",        href: "/letters",                  icon: FileText },
    { title: "Staff Services", href: "/dashboard/requests",       icon: HeartHandshake },
    { title: "Service Config", href: "/dashboard/admin/services", icon: Settings2 },
    { title: "Settings",       href: "/settings",                 icon: Settings },
];

interface SidebarProps {
    user?: {
        name?: string | null;
        email?: string | null;
        image?: string | null;
        role?: string | null;
    };
}

export function Sidebar({ user }: SidebarProps) {
    const pathname = usePathname();

    const filteredCoreItems = sidebarItems.slice(0, 7).filter(item => {
        if (item.href === "/dashboard/approvals") {
            return user?.role === "ADMIN" || user?.role === "HR" || user?.role === "MANAGER";
        }
        return true;
    });

    const filteredAdminItems = sidebarItems.slice(7).filter(item => {
        if (item.href === "/dashboard/admin/services") {
            return user?.role === "ADMIN";
        }
        return true;
    });

    return (
        <div className="hidden lg:flex flex-col h-screen w-72 border-r border-slate-200/50 bg-slate-900 dark:bg-slate-950 shadow-2xl relative overflow-hidden">
            {/* Background Accents */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none opacity-20">
                <div className="absolute top-[-10%] left-[-10%] w-[120%] h-[120%] bg-gradient-to-br from-indigo-500/10 via-transparent to-violet-500/10 rotate-12"></div>
            </div>

            <div className="p-8 relative z-10">
                <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-600/20">
                        <Building2 className="h-6 w-6 text-white" />
                    </div>
                    <div className="flex flex-col">
                        <span className="text-lg font-black tracking-tight text-white uppercase leading-none">Antigravity</span>
                        <span className="text-[10px] font-black tracking-[0.3em] text-indigo-400 uppercase mt-1">Enterprise HRMS</span>
                    </div>
                </div>
            </div>

            <div className="flex-1 px-4 py-6 overflow-y-auto relative z-10 scrollbar-hide">
                <div className="space-y-6">
                    <div>
                        <p className="px-4 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-4">Core Platform</p>
                        <nav className="space-y-1.5">
                            {filteredCoreItems.map((item) => {
                                const isActive = (item as any).exact
                                    ? pathname === item.href
                                    : pathname === item.href || pathname.startsWith(item.href + "/");
                                return (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        className={cn(
                                            "group flex items-center justify-between rounded-2xl px-4 py-3 text-sm font-bold transition-all duration-300",
                                            isActive
                                                ? "bg-indigo-600 text-white shadow-xl shadow-indigo-600/20"
                                                : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
                                        )}
                                    >
                                        <div className="flex items-center gap-3">
                                            <item.icon className={cn("h-5 w-5 transition-transform group-hover:scale-110", isActive ? "text-white" : "text-slate-500")} />
                                            {item.title}
                                        </div>
                                        {isActive && <ChevronRight className="h-4 w-4 text-white/50" />}
                                    </Link>
                                );
                            })}
                        </nav>
                    </div>

                    <div>
                        <p className="px-4 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-4">Administration</p>
                        <nav className="space-y-1.5">
                            {filteredAdminItems.map((item) => {
                                const isActive = (item as any).exact
                                    ? pathname === item.href
                                    : pathname === item.href || pathname.startsWith(item.href + "/");
                                return (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        className={cn(
                                            "group flex items-center justify-between rounded-2xl px-4 py-3 text-sm font-bold transition-all duration-300",
                                            isActive
                                                ? "bg-indigo-600 text-white shadow-xl shadow-indigo-600/20"
                                                : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
                                        )}
                                    >
                                        <div className="flex items-center gap-3">
                                            <item.icon className={cn("h-5 w-5 transition-transform group-hover:scale-110", isActive ? "text-white" : "text-slate-500")} />
                                            {item.title}
                                        </div>
                                        {isActive && <ChevronRight className="h-4 w-4 text-white/50" />}
                                    </Link>
                                );
                            })}
                        </nav>
                    </div>
                </div>
            </div>

            <div className="p-6 space-y-4 relative z-10 border-t border-slate-800/50">
                <div className="p-4 rounded-2xl bg-slate-800/50 border border-slate-700/50">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="relative">
                            <Activity className="h-4 w-4 text-emerald-400" />
                            <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                        </div>
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-300">System Live</span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-700 rounded-full overflow-hidden">
                        <div className="h-full w-[94%] bg-emerald-500 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
                    </div>
                    <div className="flex justify-between mt-2">
                        <span className="text-[9px] font-bold text-slate-500">Stability Index</span>
                        <span className="text-[9px] font-black text-emerald-400">99.9%</span>
                    </div>
                </div>

                <button 
                    onClick={() => signOut({ callbackUrl: "/login" })}
                    className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm font-black text-rose-400 hover:bg-rose-500/10 transition-all group cursor-pointer"
                >
                    <LogOut className="h-5 w-5 transition-transform group-hover:translate-x-1" />
                    Terminate Session
                </button>
            </div>
        </div>
    );
}


