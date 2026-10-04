"use client";

import { signOut } from "next-auth/react";
import { Building2, LogOut, Activity } from "lucide-react";
import { NavigationLinks } from "@/components/layout/NavigationLinks";

interface SidebarProps {
  user?: { name?: string | null; email?: string | null; image?: string | null; role?: string | null };
}

export function Sidebar({ user }: SidebarProps) {
  const initials = user?.name
    ? user.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
    : "?";

  return (
    <aside className="relative hidden h-screen w-[270px] shrink-0 flex-col overflow-hidden border-r border-slate-800/60 bg-[#0f1117] lg:flex dark:bg-slate-950">

      {/* Subtle gradient blob at top */}
      <div className="pointer-events-none absolute -top-24 -left-24 h-72 w-72 rounded-full bg-indigo-600/10 blur-3xl" />
      <div className="pointer-events-none absolute top-0 right-0 h-48 w-48 rounded-full bg-violet-600/5 blur-2xl" />

      {/* ── Logo ─────────────────────────────────────────────────── */}
      <div className="relative z-10 flex items-center gap-3 border-b border-slate-800/60 px-5 py-5">
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-900/40">
          <Building2 className="h-5 w-5 text-white" />
          {/* Live dot */}
          <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#0f1117] bg-emerald-500" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-[15px] font-black leading-tight tracking-tight text-white">IBM Digitech</p>
          <p className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.22em] text-indigo-400">Enterprise HRMS</p>
        </div>
      </div>

      {/* ── Navigation ───────────────────────────────────────────── */}
      <div className="relative z-10 flex-1 overflow-y-auto px-3 py-4 scrollbar-hide">
        <NavigationLinks role={user?.role} />
      </div>

      {/* ── Footer ───────────────────────────────────────────────── */}
      <div className="relative z-10 border-t border-slate-800/60 p-3 space-y-2">
        {/* System status pill */}
        <div className="flex items-center gap-2 rounded-xl bg-slate-800/50 px-3 py-2 ring-1 ring-slate-700/40">
          <div className="relative flex shrink-0 items-center justify-center">
            <Activity className="h-3 w-3 text-emerald-400" />
            <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          </div>
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">All systems operational</span>
        </div>

        {/* User + Sign out */}
        <div className="flex items-center gap-2.5 rounded-xl px-2 py-1.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 text-[11px] font-black text-white shadow">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-semibold text-slate-200 leading-tight">
              {user?.name ?? "User"}
            </p>
            <p className="truncate text-[10px] text-slate-500 leading-tight">
              {user?.role ?? "Staff"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/login" })}
            title="Sign out"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-all hover:bg-rose-500/10 hover:text-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
          >
            <LogOut className="h-[14px] w-[14px]" />
          </button>
        </div>
      </div>
    </aside>
  );
}
