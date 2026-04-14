"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Bell } from "lucide-react";

export function Header() {
    return (
        <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-6 dark:border-slate-800 dark:bg-slate-950">
            <div className="flex items-center gap-4">
                {/* Placeholder for breadcrumb or page title if needed */}
                <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400">Welcome back, Admin</h2>
            </div>
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" className="relative">
                    <Bell className="h-5 w-5 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-50" />
                    <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white dark:ring-slate-950" />
                </Button>
                <div className="flex items-center gap-3 border-l border-slate-200 pl-4 dark:border-slate-800">
                    <div className="flex flex-col items-end">
                        <span className="text-sm font-medium text-slate-900 dark:text-white">John Doe</span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">HR Manager</span>
                    </div>
                    <Avatar>
                        <AvatarImage src="https://github.com/shadcn.png" />
                        <AvatarFallback>JD</AvatarFallback>
                    </Avatar>
                </div>
            </div>
        </header>
    );
}
