"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
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
} from "lucide-react";

const sidebarItems = [
    { title: "Dashboard",      href: "/dashboard",                icon: LayoutDashboard, exact: true },
    { title: "Employees",      href: "/employees",                icon: Users },
    { title: "Attendance",     href: "/attendance",               icon: Calendar },
    { title: "Leaves",         href: "/leaves",                   icon: Briefcase },
    { title: "Payroll",        href: "/payroll",                  icon: CreditCard },
    { title: "Visa",           href: "/dashboard/visa",           icon: FileUp },
    { title: "Letters",        href: "/letters",                  icon: FileText },
    { title: "Staff Services", href: "/dashboard/requests",       icon: HeartHandshake },
    { title: "Service Config", href: "/dashboard/admin/services", icon: Settings2 },
    { title: "Settings",       href: "/settings",                 icon: Settings },
];

export function Sidebar() {
    const pathname = usePathname();

    return (
        <div className="flex flex-col h-screen w-64 border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
            <div className="p-6">
                <div className="flex items-center gap-2 font-bold text-xl text-slate-900 dark:text-white">
                    <div className="h-8 w-8 rounded-lg bg-indigo-600 flex items-center justify-center">
                        <Building2 className="h-5 w-5 text-white" />
                    </div>
                    <span>HR System</span>
                </div>
            </div>

            <div className="flex-1 px-3 py-4 overflow-y-auto">
                <nav className="space-y-1">
                    {sidebarItems.map((item) => {
                        const isActive = (item as any).exact
                            ? pathname === item.href
                            : pathname === item.href || pathname.startsWith(item.href + "/");
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={cn(
                                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                                    isActive
                                        ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-400"
                                        : "text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-50"
                                )}
                            >
                                <item.icon className={cn("h-4 w-4", isActive ? "text-indigo-700 dark:text-indigo-400" : "text-slate-500 dark:text-slate-400")} />
                                {item.title}
                            </Link>
                        );
                    })}
                </nav>
            </div>

            <div className="p-4 border-t border-slate-200 dark:border-slate-800">
                <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 transition-colors">
                    <LogOut className="h-4 w-4" />
                    Sign Out
                </button>
            </div>
        </div>
    );
}
