"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity, ArrowRightLeft, Bell, Briefcase, Calendar, CalendarClock,
  CheckCircle2, ChevronDown, CreditCard, FileSignature, FileText, FileUp,
  HeartHandshake, LayoutDashboard, Settings, Settings2, Target, UserPlus, Users,
  UserRoundX,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PERMISSIONS, resolvePermissions } from "@/lib/auth/permissions";

export const sidebarItems = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard, exact: true },
  { title: "Employees", href: "/employees", icon: Users, permission: PERMISSIONS.EMPLOYEES_VIEW },
  { title: "Resignation & Exit", href: "/exits", icon: UserRoundX, permission: PERMISSIONS.RESIGNATION_CREATE },
  { title: "Attendance", href: "/attendance", icon: Calendar, permission: PERMISSIONS.ATTENDANCE_VIEW },
  { title: "Leave", href: "/leaves", icon: Briefcase, permission: PERMISSIONS.LEAVE_VIEW },
  { title: "Approvals", href: "/dashboard/approvals", icon: CheckCircle2, permission: PERMISSIONS.LEAVE_APPROVE },
  { title: "Payroll", href: "/payroll", icon: CreditCard, permission: PERMISSIONS.PAYROLL_VIEW },
  { title: "Visa & Compliance", href: "/visa", icon: FileUp, permission: PERMISSIONS.VISA_VIEW },
  { title: "Letters", href: "/letters", icon: FileText, permission: PERMISSIONS.LETTER_VIEW },
  { title: "Performance", href: "/performance", icon: Target, permission: PERMISSIONS.PERFORMANCE_VIEW },
  { title: "Staff Services", href: "/staff-services", icon: HeartHandshake, permission: PERMISSIONS.SERVICE_VIEW },
  { title: "Recruitment", href: "/recruitment", icon: UserPlus, permission: PERMISSIONS.RECRUITMENT_VIEW },
  { title: "Interviews", href: "/recruitment/interviews", icon: CalendarClock, permission: PERMISSIONS.RECRUITMENT_VIEW },
  { title: "Offers", href: "/recruitment/offers", icon: FileSignature, permission: PERMISSIONS.RECRUITMENT_OFFER },
  { title: "Requests", href: "/requests", icon: ArrowRightLeft, permission: PERMISSIONS.REQUEST_VIEW },
  { title: "Notifications", href: "/notifications", icon: Bell, permission: PERMISSIONS.NOTIFICATION_VIEW },
  { title: "Service Settings", href: "/dashboard/admin/services", icon: Settings2, permission: PERMISSIONS.SERVICE_CONFIG_MANAGE },
  { title: "System Logs", href: "/system/logs", icon: Activity, permission: PERMISSIONS.SYSTEM_AUDIT_VIEW },
  { title: "System Settings", href: "/settings", icon: Settings, permission: PERMISSIONS.SETTINGS_VIEW },
] as const;

const navigationGroups = [
  { title: "OVERVIEW", links: ["/dashboard"] },
  { title: "PEOPLE", links: ["/employees", "/exits", "/attendance", "/leaves", "/dashboard/approvals"] },
  { title: "OPERATIONS", links: ["/payroll", "/visa", "/letters", "/performance", "/staff-services", "/requests", "/notifications"] },
  { title: "TALENT", links: ["/recruitment", "/recruitment/interviews", "/recruitment/offers"] },
  { title: "ADMINISTRATION", links: ["/dashboard/admin/services", "/system/logs", "/settings"] },
] as const;

interface NavigationLinksProps {
  role?: string | null;
  onNavigate?: () => void;
}

export function NavigationLinks({ role, onNavigate }: NavigationLinksProps) {
  const pathname = usePathname();
  const { permissions } = resolvePermissions(role);
  const [expandedOverride, setExpandedOverride] = useState<{ pathname: string; group: string | null } | null>(null);
  const visible = sidebarItems.filter((item) => !("permission" in item) || permissions.has(item.permission));
  const isActive = (href: string, exact = false) => exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  const activeGroup = navigationGroups.find((group) => group.title !== "OVERVIEW" && group.links.some((href) => isActive(href)));
  const expandedGroup = expandedOverride?.pathname === pathname ? expandedOverride.group : activeGroup?.title ?? null;
  const linkClass = (active: boolean, nested = false) => cn(
    "group flex min-h-11 items-center gap-3 rounded-xl text-base font-bold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
    nested ? "ml-7 px-3 py-2" : "px-3 py-2.5",
    active ? "bg-indigo-600 text-white shadow-md shadow-indigo-950/20" : "text-slate-300 hover:translate-x-0.5 hover:bg-slate-800 hover:text-white"
  );

  return <nav aria-label="Main navigation" className="space-y-5">
    {navigationGroups.map((group) => {
      const items = visible.filter((item) => (group.links as readonly string[]).includes(item.href));
      if (!items.length) return null;
      const collapsible = group.title !== "OVERVIEW";
      const isExpanded = expandedGroup === group.title;
      const sectionId = `navigation-${group.title.toLowerCase()}`;
      return <section key={group.title}>
        {collapsible ? <button type="button" aria-expanded={isExpanded} aria-controls={sectionId} onClick={() => setExpandedOverride({ pathname, group: isExpanded ? null : group.title })} className="group mb-2 flex min-h-11 w-full items-center justify-between rounded-lg px-3 text-left text-xs font-extrabold uppercase tracking-[0.14em] text-slate-300 transition-all duration-200 hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
          <span>{group.title}</span>
          <ChevronDown className={cn("h-4 w-4 transition-transform duration-200 group-hover:text-indigo-300", isExpanded && "rotate-180")} />
        </button> : <h2 className="mb-2 px-3 text-xs font-extrabold uppercase tracking-[0.14em] text-slate-300">{group.title}</h2>}
        {(!collapsible || isExpanded) && <div id={sectionId} className="space-y-1">
          {items.map((item) => {
            const active = isActive(item.href, "exact" in item && item.exact);
            return <Link key={item.href} href={item.href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={linkClass(active)}>
              <item.icon className={cn("h-[18px] w-[18px] shrink-0", active ? "text-white" : "text-slate-400 group-hover:text-white")} />
              <span className="truncate">{item.title}</span>
            </Link>;
          })}
        </div>}
      </section>;
    })}
  </nav>;
}
