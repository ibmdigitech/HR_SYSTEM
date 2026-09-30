"use client";

import { useEffect, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Bell, Settings, Clock, Globe, LogOut, User } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { signOut } from "next-auth/react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { sidebarItems, ADMIN_HREFS } from "@/components/layout/Sidebar";
import { CommandSearch } from "@/components/layout/CommandSearch";
import { resolvePermissions } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";
import { usePathname } from "next/navigation";
import { Menu, ChevronRight } from "lucide-react";
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

    // `mounted` guards the clock against a hydration mismatch: the server has
    // no meaningful "now", so it renders the placeholder and the client
    // renders the real time.
    //
    // The effect performs NO synchronous state update. Setting state directly in
    // the effect body triggers a cascading render before paint, which React
    // flags (react-hooks/set-state-in-effect); the first tick is therefore
    // deferred, and only the interval updates thereafter.
    useEffect(() => {
        const startTimer = window.setTimeout(() => {
            setMounted(true);
            setTime(new Date());
        }, 0);

        const timer = window.setInterval(() => setTime(new Date()), 1000);

        return () => {
            window.clearTimeout(startTimer);
            window.clearInterval(timer);
        };
    }, []);

    const userInitials = user?.name
        ? user.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
        : "U";

    const pathname = usePathname();
    const { permissions } = resolvePermissions(user?.role);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    const isVisible = (item: (typeof sidebarItems)[number]) => {
        const required = "permission" in item ? item.permission : null;
        return required ? permissions.has(required) : true;
    };

    const filteredCoreItems = sidebarItems.filter(
        (item) => !ADMIN_HREFS.includes(item.href as any) && isVisible(item)
    );

    const filteredAdminItems = sidebarItems.filter(
        (item) => ADMIN_HREFS.includes(item.href as any) && isVisible(item)
    );

    return (
      <header className="flex h-20 shrink-0 items-center justify-between gap-4 border-b border-slate-200/50 bg-white/70 dark:bg-slate-950/70 backdrop-blur-xl px-4 md:px-8 relative z-50">
      <div className="flex min-w-0 flex-1 items-center gap-4 md:gap-6">
                {/* Mobile Menu Trigger */}
                <Dialog open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                    <DialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="lg:hidden h-11 w-11 rounded-2xl bg-slate-100/50 dark:bg-slate-900/50">
                            <Menu className="h-5 w-5 text-slate-600 dark:text-slate-400" />
                        </Button>
                    </DialogTrigger>
                    {/* Edge-anchored drawer, so it must fully OVERRIDE the
                        shared base's centring — not just its `left`.
                        `cn` runs tailwind-merge, so `left-0` beat
                        `left-[50%]` but NOTHING beat the base's companion
                        `translate-x-[-50%] translate-y-[-50%]`. The panel
                        inherited a half-width left shift (off-screen) and a
                        vertical re-centre that clipped a full-height panel at
                        both ends. `translate-x-0 translate-y-0` is the actual
                        fix and is mandatory if the base keeps centring.
                        `inset-y-0` + `h-[100dvh]` drop `top-[50%]` and pin the
                        panel to the viewport; `overflow-y-hidden` stops the
                        base's `overflow-y-auto` double-barring the panel that
                        already scrolls via its `flex-1 overflow-y-auto` child,
                        and `flex` drops the base's `grid`. */}
                    <DialogContent
                        className="fixed inset-y-0 left-0 translate-x-0 translate-y-0 z-50 flex flex-col w-[85vw] max-w-[320px] h-[100dvh] max-h-[100dvh] overflow-y-hidden p-0 m-0 border-0 rounded-none sm:rounded-none data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left bg-slate-900 dark:bg-slate-950"
                        /* This panel is dark BY ITS OWN CLASS, whatever the app
                           theme is. With the app in light mode a theme-derived
                           close icon is dark slate on a slate-900 panel and
                           vanishes. The panel colour is the caller's decision,
                           so the caller supplies the icon colour too. */
                        closeButtonClassName="text-slate-300 hover:text-white hover:bg-white/10 focus-visible:ring-white/70"
                    >
                        <DialogTitle className="sr-only">Navigation Menu</DialogTitle>
                        <div className="flex-1 overflow-y-auto p-4 scrollbar-hide mt-10">
                            <div className="space-y-6">
                                <div>
                                    <p className="px-4 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-4">Core Platform</p>
                                    <nav className="space-y-1.5">
                                        {filteredCoreItems.map((item) => {
                                            const isActive = (item as { exact?: string }).exact
                                                ? pathname === item.href
                                                : pathname === item.href || pathname.startsWith(item.href + "/");
                                            return (
                                                <Link
                                                    key={item.href}
                                                    href={item.href}
                                                    onClick={() => setMobileMenuOpen(false)}
                                                    className={cn(
                                                        "group flex items-center justify-between rounded-2xl px-4 py-3 text-sm font-bold transition-all duration-300",
                                                        isActive
                                                            ? "bg-indigo-600 text-white shadow-xl shadow-indigo-600/20"
                                                            : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
                                                    )}
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <item.icon className={cn("h-5 w-5", isActive ? "text-white" : "text-slate-500")} />
                                                        {item.title}
                                                    </div>
                                                </Link>
                                            );
                                        })}
                                    </nav>
                                </div>
                                <div>
                                    <p className="px-4 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-4">Administration</p>
                                    <nav className="space-y-1.5">
                                        {filteredAdminItems.map((item) => {
                                            const isActive = (item as { exact?: string }).exact
                                                ? pathname === item.href
                                                : pathname === item.href || pathname.startsWith(item.href + "/");
                                            return (
                                                <Link
                                                    key={item.href}
                                                    href={item.href}
                                                    onClick={() => setMobileMenuOpen(false)}
                                                    className={cn(
                                                        "group flex items-center justify-between rounded-2xl px-4 py-3 text-sm font-bold transition-all duration-300",
                                                        isActive
                                                            ? "bg-indigo-600 text-white shadow-xl shadow-indigo-600/20"
                                                            : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
                                                    )}
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <item.icon className={cn("h-5 w-5", isActive ? "text-white" : "text-slate-500")} />
                                                        {item.title}
                                                    </div>
                                                </Link>
                                            );
                                        })}
                                    </nav>
                                </div>
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>
                {mounted && <CommandSearch />}

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
                    <Link href="/settings">
                        <Button variant="ghost" size="icon" className="h-11 w-11 rounded-2xl bg-slate-100/50 dark:bg-slate-900/50 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 group">
                            <Settings className="h-5 w-5 text-slate-600 dark:text-slate-400 group-hover:text-indigo-600 transition-colors" />
                        </Button>
                    </Link>
                </div>

                <Popover>
                    <PopoverTrigger asChild>
                        {/* `min-w-0` on the name column and `truncate` on the name
                            itself: a flex item defaults to min-width:auto, so a
                            long user name refuses to shrink and pushes the
                            avatar past the viewport edge below `lg`. `shrink-0`
                            on the avatar keeps it at a stable tap target. */}
                        <div className="flex items-center gap-4 pl-6 border-l border-slate-200 dark:border-slate-800 group cursor-pointer outline-none">
                            <div className="flex min-w-0 flex-col items-end">
                                <span className="max-w-[10rem] truncate text-sm font-black text-slate-900 dark:text-white tracking-tight group-hover:text-indigo-600 transition-colors">{user?.name || "User"}</span>
                                <div className="flex items-center gap-2">
                                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></span>
                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">{user?.role || "STAFF"}</span>
                                </div>
                            </div>
                            <Avatar className="h-11 w-11 shrink-0 rounded-2xl border-2 border-white dark:border-slate-800 shadow-lg group-hover:scale-110 transition-transform duration-300">
                                {user?.image && <AvatarImage src={user.image} />}
                                <AvatarFallback className="bg-indigo-600 text-white font-black">{userInitials}</AvatarFallback>
                            </Avatar>
                        </div>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-64 p-2 rounded-2xl bg-white/90 dark:bg-slate-950/90 backdrop-blur-xl border border-slate-200 dark:border-slate-800 shadow-2xl">
                        <div className="p-3 mb-2 flex items-center gap-3 border-b border-slate-100 dark:border-slate-800/50 pb-4">
                            <Avatar className="h-12 w-12 rounded-xl">
                                {user?.image && <AvatarImage src={user.image} />}
                                <AvatarFallback className="bg-indigo-600 text-white font-black">{userInitials}</AvatarFallback>
                            </Avatar>
                            <div className="flex flex-col">
                                <span className="text-sm font-black text-slate-900 dark:text-white leading-tight truncate w-32">{user?.name || "User"}</span>
                                <span className="text-[10px] font-bold text-slate-500 truncate w-32">{user?.email || "No email"}</span>
                            </div>
                        </div>
                        <div className="flex flex-col gap-1">
                            <Link href="/settings">
                                <Button variant="ghost" className="w-full justify-start text-xs font-bold text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 dark:text-slate-300 dark:hover:text-indigo-400 dark:hover:bg-indigo-900/20 rounded-xl h-10">
                                    <User className="mr-2 h-4 w-4" />
                                    Profile Settings
                                </Button>
                            </Link>
                            <Button 
                                variant="ghost" 
                                onClick={() => signOut({ callbackUrl: '/login' })}
                                className="w-full justify-start text-xs font-bold text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-900/20 rounded-xl h-10"
                            >
                                <LogOut className="mr-2 h-4 w-4" />
                                Sign out
                            </Button>
                        </div>
                    </PopoverContent>
                </Popover>
            </div>
        </header>
    );
}


