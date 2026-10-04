"use client";

import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Bell, Settings, LogOut, User, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { signOut } from "next-auth/react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { CommandSearch } from "@/components/layout/CommandSearch";
import { HeaderClock } from "@/components/layout/HeaderClock";
import { HeaderTimezone } from "@/components/layout/HeaderTimezone";
import { NavigationLinks } from "@/components/layout/NavigationLinks";
import { Menu } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface HeaderProps {
    user?: {
        name?: string | null;
        email?: string | null;
        image?: string | null;
        role?: string | null;
    };
}

/**
 * Shared chrome for every header icon control.
 *
 * `ring-inset` gives the resting state a hairline that matches the sidebar, so
 * the row reads as buttons without a filled chip per icon; hover lifts the ring
 * to indigo and adds a shadow. The scale on `active:` is the only transform, and
 * `motion-reduce` neutralises it along with the transition, because a control
 * that jumps under the pointer is exactly what that preference asks us not to
 * do. `focus-visible:outline-none` suppresses the global `:focus-visible`
 * outline in globals.css so the ring is not doubled.
 */
const ICON_BUTTON =
    "h-11 w-11 shrink-0 rounded-2xl bg-slate-100/50 text-slate-600 shadow-sm ring-1 ring-inset ring-slate-200/70 transition-all duration-200 hover:bg-indigo-50 hover:text-indigo-600 hover:shadow-md hover:ring-indigo-200 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 motion-reduce:transition-none motion-reduce:transform-none dark:bg-slate-900/50 dark:text-slate-400 dark:ring-slate-800 dark:hover:bg-indigo-900/20 dark:hover:text-indigo-300 dark:hover:ring-indigo-500/40";

export function Header({ user }: HeaderProps) {
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    // Below `md` there is no room for a 448px field next to three 44px controls,
    // so search collapses to an icon that expands the field over the row.
    const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

    const userInitials = user?.name
        ? user.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
        : "U";

    return (
        <header className="relative z-50 flex h-16 shrink-0 items-center justify-between gap-2 border-b border-slate-200/50 bg-white/70 px-3 backdrop-blur-xl dark:bg-slate-950/70 md:h-20 md:gap-4 md:px-8">
            <div className="flex min-w-0 flex-1 items-center gap-2 md:gap-6">
                {/* Mobile Menu Trigger */}
                <Dialog open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                    <DialogTrigger asChild>
                        <Button variant="ghost" size="icon" className={cn(ICON_BUTTON, "lg:hidden")}>
                            <Menu className="h-5 w-5" />
                            <span className="sr-only">Open navigation menu</span>
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
                        <div className="mt-10 flex-1 overflow-y-auto p-4 scrollbar-hide">
                            <NavigationLinks role={user?.role} onNavigate={() => setMobileMenuOpen(false)} />
                        </div>
                    </DialogContent>
                </Dialog>

                <Button
                    variant="ghost"
                    size="icon"
                    className={cn(ICON_BUTTON, "md:hidden")}
                    aria-label="Search"
                    title="Search (⌘K, or Ctrl+K)"
                    aria-expanded={mobileSearchOpen}
                    onClick={() => setMobileSearchOpen(true)}
                >
                    <Search className="h-5 w-5" />
                </Button>

                {/* Below `md` the expanded field sits over the header, so a
                    scrim makes the row opaque (the field is translucent by
                    design) and gives a tap target to dismiss it. `z-55` puts it
                    under the field at `z-60`; `md:hidden` means it can never
                    appear on a screen with room for the inline field. */}
                {mobileSearchOpen && (
                    <button
                        type="button"
                        aria-label="Close search"
                        className="absolute inset-0 z-[55] h-full w-full cursor-default bg-white/95 dark:bg-slate-950/95 md:hidden"
                        onClick={() => setMobileSearchOpen(false)}
                    />
                )}

                {/* `min-w-0` so the field shrinks instead of pushing the right
                    cluster out of the header; `flex-1` lets it fill the gap
                    between the menu button and the clock from `md` up. */}
                <div
                    className={cn(
                        "min-w-0 flex-1 md:max-w-md",
                        mobileSearchOpen
                            ? "absolute inset-x-3 top-1/2 z-[60] -translate-y-1/2 md:static md:z-auto md:translate-y-0"
                            : "hidden md:block"
                    )}
                >
                    <CommandSearch
                        role={user?.role}
                        autoFocus={mobileSearchOpen}
                        onDismiss={() => setMobileSearchOpen(false)}
                    />
                </div>

                {/* `shrink-0` and `whitespace-nowrap` inside the clock and
                    timezone are what keep this row to ONE line each. Without
                    them the flex algorithm narrows these items and the text
                    wraps at its spaces — "GMT" / "+4" / "(UAE)" on three lines —
                    which tripled the header height. */}
                <div className="hidden shrink-0 items-center gap-6 border-l border-slate-200 pl-6 dark:border-slate-800 xl:flex">
                    <HeaderClock />
                    <HeaderTimezone />
                </div>
            </div>

            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
                {/* `asChild` puts the button classes on the anchor itself. The
                    previous markup nested a `<button>` inside an `<a>`, which is
                    invalid HTML, gave the control two tab stops, and made the
                    visible focus ring land on the wrong element. */}
                <Button asChild variant="ghost" size="icon" className={ICON_BUTTON}>
                    <Link href="/notifications" aria-label="Notifications" title="Notifications">
                        <Bell className="h-5 w-5" />
                        <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-rose-500 ring-4 ring-white animate-pulse motion-reduce:animate-none dark:ring-slate-950" />
                    </Link>
                </Button>

                {/* Settings stays reachable from the account popover below, so
                    the duplicate icon is the first thing to go on small screens. */}
                <Button asChild variant="ghost" size="icon" className={cn(ICON_BUTTON, "hidden sm:inline-flex")}>
                    <Link href="/settings" aria-label="Settings" title="Settings">
                        <Settings className="h-5 w-5" />
                    </Link>
                </Button>

                <span aria-hidden="true" className="hidden h-9 w-px bg-slate-200 dark:bg-slate-800 lg:block" />

                <Popover>
                    <PopoverTrigger asChild>
                        {/* `min-w-0` on the name column and `truncate` on the name
                            itself: a flex item defaults to min-width:auto, so a
                            long user name refuses to shrink and pushes the
                            avatar past the viewport edge below `lg`. `shrink-0`
                            on the avatar keeps it at a stable tap target. The
                            name column itself is hidden below `lg`, where the
                            avatar alone identifies the account. */}
                        <div className="group flex cursor-pointer items-center gap-3 rounded-2xl p-1.5 pr-2 outline-none transition-colors duration-200 hover:bg-slate-100/70 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-slate-900/70">
                            <div className="hidden min-w-0 flex-col items-end lg:flex">
                                <span className="max-w-[10rem] truncate text-sm font-black tracking-tight text-slate-900 transition-colors group-hover:text-indigo-600 dark:text-white">{user?.name || "User"}</span>
                                <div className="flex items-center gap-2">
                                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></span>
                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{user?.role || "STAFF"}</span>
                                </div>
                            </div>
                            <Avatar className="h-11 w-11 shrink-0 rounded-2xl border-2 border-white shadow-lg transition-transform duration-300 group-hover:scale-110 motion-reduce:transition-none motion-reduce:transform-none dark:border-slate-800">
                                {user?.image && <AvatarImage src={user.image} alt="" />}
                                <AvatarFallback className="bg-indigo-600 font-black text-white">{userInitials}</AvatarFallback>
                            </Avatar>
                            <span className="sr-only">Account menu for {user?.name || "user"}</span>
                        </div>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-64 rounded-2xl border border-slate-200 bg-white/90 p-2 shadow-2xl backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/90">
                        <div className="mb-2 flex items-center gap-3 border-b border-slate-100 p-3 pb-4 dark:border-slate-800/50">
                            <Avatar className="h-12 w-12 rounded-xl">
                                {user?.image && <AvatarImage src={user.image} alt="" />}
                                <AvatarFallback className="bg-indigo-600 font-black text-white">{userInitials}</AvatarFallback>
                            </Avatar>
                            <div className="flex flex-col">
                                <span className="w-32 truncate text-sm font-black leading-tight text-slate-900 dark:text-white">{user?.name || "User"}</span>
                                <span className="w-32 truncate text-[10px] font-bold text-slate-500">{user?.email || "No email"}</span>
                            </div>
                        </div>
                        <div className="flex flex-col gap-1">
                            <Button asChild variant="ghost" className="h-10 w-full justify-start rounded-xl text-xs font-bold text-slate-600 hover:bg-indigo-50 hover:text-indigo-600 dark:text-slate-300 dark:hover:bg-indigo-900/20 dark:hover:text-indigo-400">
                                <Link href="/settings">
                                    <User className="mr-2 h-4 w-4" />
                                    Profile Settings
                                </Link>
                            </Button>
                            <Button
                                variant="ghost"
                                onClick={() => signOut({ callbackUrl: '/login' })}
                                className="h-10 w-full justify-start rounded-xl text-xs font-bold text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-900/20"
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