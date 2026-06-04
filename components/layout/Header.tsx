"use client";

import { useEffect, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Bell, Search, Settings, Command, Clock, Globe } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import Link from "next/link";

interface HeaderProps {
    user?: {
        name?: string | null;
        email?: string | null;
        image?: string | null;
        role?: string | null;
    };
}

export function Header({ user }: HeaderProps) {
    const [time, setTime] = useState<Date | null>(null);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
        setTime(new Date());
        const timer = setInterval(() => setTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    const userInitials = user?.name
        ? user.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
        : "U";

    return (
        <header className="flex h-20 items-center justify-between border-b border-slate-200/50 bg-white/70 dark:bg-slate-950/70 backdrop-blur-xl px-8 relative z-50">
            <div className="flex items-center gap-6 flex-1">
                <div className="relative w-full max-w-md group hidden md:block">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
                    <Input 
                        placeholder="Quick search (⌘ + K)" 
                        className="pl-12 h-11 bg-slate-100/50 dark:bg-slate-900/50 border-0 rounded-2xl font-medium focus-visible:ring-2 focus-visible:ring-indigo-500 transition-all"
                    />
                </div>

                <div className="hidden xl:flex items-center gap-6 pl-6 border-l border-slate-200 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-indigo-500" />
                        <span className="text-sm font-black text-slate-700 dark:text-slate-300 tracking-tight min-w-[80px]">
                            {mounted && time ? time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : "--:--:--"}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Globe className="h-4 w-4 text-slate-400" />
                        <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">GMT +4 (UAE)</span>
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                    <Link href="/notifications">
                        <Button variant="ghost" size="icon" className="h-11 w-11 rounded-2xl bg-slate-100/50 dark:bg-slate-900/50 relative hover:bg-indigo-50 dark:hover:bg-indigo-900/20 group">
                            <Bell className="h-5 w-5 text-slate-600 dark:text-slate-400 group-hover:text-indigo-600 transition-colors" />
                            <span className="absolute top-3 right-3 h-2 w-2 rounded-full bg-rose-500 ring-4 ring-white dark:ring-slate-950 animate-pulse" />
                        </Button>
                    </Link>
                    <Button variant="ghost" size="icon" className="h-11 w-11 rounded-2xl bg-slate-100/50 dark:bg-slate-900/50 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 group">
                        <Settings className="h-5 w-5 text-slate-600 dark:text-slate-400 group-hover:text-indigo-600 transition-colors" />
                    </Button>
                </div>

                <div className="flex items-center gap-4 pl-6 border-l border-slate-200 dark:border-slate-800 group cursor-pointer">
                    <div className="flex flex-col items-end">
                        <span className="text-sm font-black text-slate-900 dark:text-white tracking-tight group-hover:text-indigo-600 transition-colors">{user?.name || "User"}</span>
                        <div className="flex items-center gap-2">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></span>
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">{user?.role || "STAFF"}</span>
                        </div>
                    </div>
                    <Avatar className="h-11 w-11 rounded-2xl border-2 border-white dark:border-slate-800 shadow-lg group-hover:scale-110 transition-transform duration-300">
                        {user?.image && <AvatarImage src={user.image} />}
                        <AvatarFallback className="bg-indigo-600 text-white font-black">{userInitials}</AvatarFallback>
                    </Avatar>
                </div>
            </div>
        </header>
    );
}


