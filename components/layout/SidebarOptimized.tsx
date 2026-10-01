"use client";

import { signOut } from "next-auth/react";
import { Building2, LogOut } from "lucide-react";
import { NavigationLinks } from "@/components/layout/NavigationLinks";

interface SidebarProps {
  user?: { name?: string | null; email?: string | null; image?: string | null; role?: string | null };
}

export function Sidebar({ user }: SidebarProps) {
  return <aside className="relative hidden h-screen w-72 shrink-0 flex-col overflow-hidden border-r border-slate-800 bg-slate-900 lg:flex dark:bg-slate-950">
    <div className="relative z-10 flex items-center gap-3 border-b border-slate-800/70 px-6 py-6">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-600 shadow-md shadow-indigo-950/30">
        <Building2 className="h-5 w-5 text-white" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-base font-bold leading-tight text-white">IBM Digitech</p>
        <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-300">Enterprise HRMS</p>
      </div>
    </div>

    <div className="relative z-10 flex-1 overflow-y-auto px-3 py-5 scrollbar-hide">
      <NavigationLinks role={user?.role} />
    </div>

    <div className="relative z-10 border-t border-slate-800/70 p-3">
      <button type="button" onClick={() => signOut({ callbackUrl: "/login" })} className="flex min-h-10 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-300 transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
        <LogOut className="h-[18px] w-[18px]" />
        Sign out
      </button>
    </div>
  </aside>;
}
