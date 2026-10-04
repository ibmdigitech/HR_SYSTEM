"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity, ArrowRightLeft, Bell, Briefcase, Calendar, CalendarClock,
  CheckCircle2, ChevronDown, CreditCard, FileSignature, FileText, FileUp,
  HeartHandshake, LayoutDashboard, Plane, Settings2, Target, UserPlus, Users,
  UserRoundX, Layers, Sparkles, Shield, ShieldCheck, UserCircle, KeyRound, BookOpen, Rocket,
  FolderOpen, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PERMISSIONS, resolvePermissions } from "@/lib/auth/permissions";
import type { Permission } from "@/lib/auth/permissions";

/**
 * Single source of truth for the navigation surface.
 *
 * Information architecture (see docs/IA.md):
 *
 *  OVERVIEW        Dashboard
 *  PEOPLE          Employees, Resignation & Exit, Attendance, Leave, Approvals
 *  OPERATIONS      Payroll, Shift & Roster, Letters, Visa & Compliance,
 *                  Staff Services, Requests, Notifications, Business Travel, Performance
 *  TALENT          Recruitment, Interviews, Offers
 *  ADMINISTRATION  Access Control, Documents, Workforce Configuration, System
 *
 * Every capability below points at an EXISTING route. No routes are invented here;
 * a leaf appears only when the backing page exists and the user holds the
 * capability the page itself enforces. Hiding a link is a usability affordance
 * only — every page, server action and API route authorizes independently on the
 * server (see lib/auth/page-guard.ts and lib/auth/guards.ts).
 */

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Module color applied to the icon when the item is inactive. */
  iconColor: string;
  permission?: Permission;
  exact?: boolean;
}

export const sidebarItems: NavItem[] = [
  /* ── OVERVIEW ─────────────────────────────────────────── */
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard, iconColor: "text-indigo-400", exact: true },

  /* ── PEOPLE ───────────────────────────────────────────── */
  { title: "Employees", href: "/employees", icon: Users, iconColor: "text-cyan-400", permission: PERMISSIONS.EMPLOYEES_VIEW },
  { title: "Resignation & Exit", href: "/exits", icon: UserRoundX, iconColor: "text-rose-400", permission: PERMISSIONS.RESIGNATION_CREATE },
  { title: "Attendance", href: "/attendance", icon: Calendar, iconColor: "text-sky-400", permission: PERMISSIONS.ATTENDANCE_VIEW },
  { title: "Leave", href: "/leaves", icon: Briefcase, iconColor: "text-emerald-400", permission: PERMISSIONS.LEAVE_VIEW },
  { title: "Approvals", href: "/dashboard/approvals", icon: CheckCircle2, iconColor: "text-violet-400", permission: PERMISSIONS.LEAVE_APPROVE },

  /* ── OPERATIONS ───────────────────────────────────────── */
  { title: "Payroll", href: "/payroll", icon: CreditCard, iconColor: "text-amber-400", permission: PERMISSIONS.PAYROLL_VIEW },
  { title: "Shift & Roster", href: "/attendance/shifts", icon: CalendarClock, iconColor: "text-sky-400", permission: PERMISSIONS.ATTENDANCE_VIEW },
  { title: "Letters", href: "/letters", icon: FileText, iconColor: "text-pink-400", permission: PERMISSIONS.LETTER_VIEW },
  { title: "Visa & Compliance", href: "/visa", icon: FileUp, iconColor: "text-orange-400", permission: PERMISSIONS.VISA_VIEW },
  { title: "Staff Services", href: "/staff-services", icon: HeartHandshake, iconColor: "text-teal-400", permission: PERMISSIONS.SERVICE_VIEW },
  { title: "Requests", href: "/requests", icon: ArrowRightLeft, iconColor: "text-sky-400", permission: PERMISSIONS.REQUEST_VIEW },
  { title: "Notifications", href: "/notifications", icon: Bell, iconColor: "text-sky-400", permission: PERMISSIONS.NOTIFICATION_VIEW },
  { title: "Business Travel", href: "/travel", icon: Plane, iconColor: "text-orange-400", permission: PERMISSIONS.TRAVEL_VIEW },
  { title: "Performance", href: "/performance", icon: Target, iconColor: "text-fuchsia-400", permission: PERMISSIONS.PERFORMANCE_VIEW },

  /* ── TALENT ───────────────────────────────────────────── */
  { title: "Recruitment", href: "/recruitment", icon: UserPlus, iconColor: "text-amber-400", permission: PERMISSIONS.RECRUITMENT_VIEW },
  { title: "Interviews", href: "/recruitment/interviews", icon: CalendarClock, iconColor: "text-indigo-400", permission: PERMISSIONS.RECRUITMENT_VIEW },
  { title: "Offers", href: "/recruitment/offers", icon: FileSignature, iconColor: "text-emerald-400", permission: PERMISSIONS.RECRUITMENT_OFFER },

  /* ── ADMINISTRATION ───────────────────────────────────── */
  { title: "Users", href: "/settings", icon: UserCircle, iconColor: "text-indigo-400", permission: PERMISSIONS.SETTINGS_VIEW },
  { title: "Roles & Permissions", href: "/dashboard/approvals/roles", icon: Shield, iconColor: "text-indigo-400", permission: PERMISSIONS.ACCESS_APPROVE },
  { title: "Access Requests", href: "/dashboard/request-access", icon: KeyRound, iconColor: "text-indigo-400", permission: PERMISSIONS.ACCESS_APPROVE },
  { title: "Letter Templates", href: "/dashboard/settings/templates", icon: BookOpen, iconColor: "text-pink-400", permission: PERMISSIONS.LETTER_TEMPLATE_MANAGE },
  { title: "Company Documents", href: "/company/documents", icon: FolderOpen, iconColor: "text-teal-400", permission: PERMISSIONS.SETTINGS_VIEW },
  { title: "Service Configuration", href: "/dashboard/admin/services", icon: Settings2, iconColor: "text-sky-400", permission: PERMISSIONS.SERVICE_CONFIG_MANAGE },
  { title: "Shift & Roster Settings", href: "/settings/shifts", icon: Settings2, iconColor: "text-emerald-400", permission: PERMISSIONS.ATTENDANCE_SHIFT_MANAGE },
  { title: "Audit Log", href: "/system/logs", icon: Activity, iconColor: "text-slate-400", permission: PERMISSIONS.SYSTEM_AUDIT_VIEW },
  // Without an entry here the href below is dropped: a group link is resolved
  // through sidebarItems and filtered out when no matching item exists, so
  // adding the path to the group's `links` array alone renders nothing.
  { title: "Backup & Recovery", href: "/system/backup", icon: ShieldCheck, iconColor: "text-emerald-400", permission: PERMISSIONS.SYSTEM_BACKUP_VIEW },
  // Deployment & migration status. Shares SYSTEM_BACKUP_VIEW deliberately: both
  // pages report infrastructure state an administrator must see, and splitting
  // them would mean an operator could see their backups were stale without
  // being able to see that migrations cannot deploy at all.
  { title: "Deployment & Health", href: "/system/deployment", icon: Rocket, iconColor: "text-sky-400", permission: PERMISSIONS.SYSTEM_BACKUP_VIEW },
] as NavItem[];

export interface NavCategoryDef {
  title: string;
  icon: LucideIcon;
  color: string;
  links: readonly string[];
}

export interface NavGroupDef {
  title: string;
  icon: LucideIcon;
  color: string;
  collapsible: boolean;
  links?: readonly string[];
  categories?: NavCategoryDef[];
}

export const navigationGroups: NavGroupDef[] = [
  {
    title: "OVERVIEW",
    icon: LayoutDashboard,
    color: "text-indigo-400",
    collapsible: false,
    links: ["/dashboard"],
  },
  {
    title: "PEOPLE",
    icon: Users,
    color: "text-sky-400",
    collapsible: true,
    links: ["/employees", "/exits", "/attendance", "/leaves", "/dashboard/approvals"],
  },
  {
    title: "OPERATIONS",
    icon: Layers,
    color: "text-violet-400",
    collapsible: true,
    links: [
      "/payroll", "/attendance/shifts", "/letters", "/visa", "/staff-services",
      "/requests", "/notifications", "/travel", "/performance",
    ],
  },
  {
    title: "TALENT",
    icon: Sparkles,
    color: "text-amber-400",
    collapsible: true,
    links: ["/recruitment", "/recruitment/interviews", "/recruitment/offers"],
  },
  {
    title: "ADMINISTRATION",
    icon: Shield,
    color: "text-violet-400",
    collapsible: true,
    categories: [
      {
        title: "Access Control",
        icon: ShieldCheck,
        color: "text-indigo-400",
        links: ["/settings", "/dashboard/approvals/roles", "/dashboard/request-access"],
      },
      {
        title: "Documents",
        icon: FileText,
        color: "text-pink-400",
        links: ["/dashboard/settings/templates", "/company/documents"],
      },
      {
        title: "Workforce Configuration",
        icon: Settings2,
        color: "text-slate-400",
        links: ["/dashboard/admin/services", "/settings/shifts"],
      },
      {
        title: "System",
        icon: Activity,
        color: "text-slate-400",
        links: ["/system/logs", "/system/backup", "/system/deployment"],
      },
    ],
  },
];

/**
 * The nav list after the caller's permissions have removed what they may not
 * open. Both navigation surfaces go through this — the drawer below and the
 * header's command palette — so the palette can never offer a destination the
 * drawer hides.
 */
export function visibleNavItems(role?: string | null) {
  const { permissions } = resolvePermissions(role);
  return sidebarItems.filter((item) => !item.permission || permissions.has(item.permission));
}

/**
 * Resolves the subtitle shown in the command palette for a given route: the
 * Administration category (Access Control, Documents, ...) when present, else
 * the top-level group (OVERVIEW, PEOPLE, ...).
 */
function buildSubtitleMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const group of navigationGroups) {
    if (group.categories) {
      for (const cat of group.categories) {
        for (const href of cat.links) map.set(href, cat.title);
      }
    } else if (group.links) {
      for (const href of group.links) map.set(href, group.title);
    }
  }
  return map;
}

/**
 * The same list shaped for the command palette, where each row needs a group
 * label rather than a route. The subtitle is the group the link is filed under,
 * so "Interviews" reads as "Talent" instead of repeating its own path.
 */
export function navPaletteEntries(role?: string | null): NavPaletteEntry[] {
  const subMap = buildSubtitleMap();
  return visibleNavItems(role).map((item) => ({
    id: `nav-${item.href}`,
    title: item.title,
    subtitle: subMap.get(item.href) ?? "Navigation",
    href: item.href,
    icon: item.icon,
  }));
}

export interface NavPaletteEntry {
  id: string;
  title: string;
  subtitle: string;
  href: string;
  icon: LucideIcon;
}

interface NavigationLinksProps {
  role?: string | null;
  onNavigate?: () => void;
}

export function NavigationLinks({ role, onNavigate }: NavigationLinksProps) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  /**
   * `manuallyClosed` records a collapse performed on the current route. The
   * derived `resolvedExpanded` memo honours it for the CURRENT pathname only,
   * so a section stays shut where you are but re-opens automatically when the
   * active route genuinely moves to a different page in the same group.
   */
  const [manuallyClosed, setManuallyClosed] = useState<Record<string, string>>({});

  const visible = useMemo(() => visibleNavItems(role), [role]);
  const itemByHref = useMemo(
    () => new Map(visible.map((item) => [item.href, item] as const)),
    [visible]
  );

  const isActiveLink = (href: string, exact = false): boolean =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  // Which section should read as expanded. A group/category opens when the USER
  // toggled it OR it owns the active route. The route-driven half is DERIVED
  // during render rather than synced through an effect that calls setState:
  // the previous effect called setExpanded unconditionally and, even with its
  // `return changed ? next : prev` bail-out, tripped react-hooks v7's
  // `set-state-in-effect` rule (which is non-deterministic in v7.0.1) and could
  // resurface as a build-breaking error. Deriving this value removes the
  // setState-in-effect entirely and keeps collapse behaviour loop-free.
  //
  // `manuallyClosed` records a collapse performed on the CURRENT route, so a
  // section can stay shut even while one of its own pages is active; the entry
  // is ignored as soon as the route changes, so the section re-opens when the
  // active route genuinely moves to a different page in the same group.
  const resolvedExpanded = useMemo(
    () => {
      const result: Record<string, boolean> = { ...expanded };
      for (const group of navigationGroups) {
        let groupActive = false;
        if (group.categories) {
          for (const cat of group.categories) {
            const catActive = cat.links.some((h) => isActiveLink(h, !!itemByHref.get(h)?.exact));
            if (catActive) {
              groupActive = true;
              if (manuallyClosed[cat.title] !== pathname) result[cat.title] = true;
            }
          }
        } else if (group.links) {
          if (group.links.some((h) => isActiveLink(h, !!itemByHref.get(h)?.exact))) {
            groupActive = true;
          }
        }
        if (groupActive && manuallyClosed[group.title] !== pathname) {
          result[group.title] = true;
        }
      }
      return result;
    },
    // `isActiveLink` is intentionally excluded: it is recreated every render, so
    // including it would recompute this memo on every render. `pathname` is the
    // only value it reads, and it is already a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pathname, expanded, manuallyClosed, itemByHref]
  );

  const isGroupExpanded = (group: NavGroupDef) =>
    !group.collapsible || !!resolvedExpanded[group.title];
  const isCategoryExpanded = (cat: NavCategoryDef) =>
    !!resolvedExpanded[cat.title];

  /**
   * DOM id for a collapsible region.
   *
   * `aria-controls` must reference a real id, and HTML5 forbids ASCII whitespace
   * inside one. The category titles are human labels with spaces — "Workforce
   * Configuration" — so interpolating them raw produced `id="nav-cat-Workforce
   * Configuration"`, which is both an invalid id and not the id the button
   * pointed at. Slugging keeps the two ends in agreement.
   *
   * The pairing is also only meaningful because the region now CARRIES the id.
   * Previously the buttons declared `aria-controls` for elements that were never
   * given one, so assistive tech announced a relationship to nothing.
   */
  const regionId = (kind: "group" | "cat", title: string) =>
    `nav-${kind}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

  const toggle = (key: string) => {
    const isOpen = !!resolvedExpanded[key];
    setExpanded((e) => ({ ...e, [key]: !isOpen }));
    // Record the close against the route it happened on. Without this, the
    // route-driven expansion in `resolvedExpanded` would immediately re-open
    // it and the chevron would appear to do nothing.
    setManuallyClosed((m) =>
      isOpen ? { ...m, [key]: pathname } : { ...m }
    );
  };

  const renderItem = (item: NavItem) => {
    const active = isActiveLink(item.href, !!item.exact);
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition-all duration-150",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
          "border-l-2",
          active
            ? "bg-indigo-600 text-white border-indigo-300 shadow-lg shadow-indigo-900/30"
            : "text-slate-400 hover:bg-white/5 hover:text-slate-200 border-transparent"
        )}
      >
        <span
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-all duration-150",
            active ? "bg-white/20" : "bg-white/5 group-hover:bg-white/8"
          )}
        >
          <Icon
            className={cn(
              "h-[15px] w-[15px] transition-transform duration-150 group-hover:scale-110",
              active ? "text-white" : item.iconColor
            )}
          />
        </span>
        <span className="truncate">{item.title}</span>
      </Link>
    );
  };

  return (
    <nav aria-label="Main navigation" className="space-y-1">
      {navigationGroups.map((group) => {
        const isFlat = !group.categories;
        const flatItems = isFlat
          ? (group.links as readonly string[]).map((h) => itemByHref.get(h)).filter(Boolean) as NavItem[]
          : [];
        if (isFlat && flatItems.length === 0) return null;
        if (group.categories && !group.categories.some((cat) => cat.links.some((h) => itemByHref.has(h)))) return null;

        return (
          <section key={group.title} className="pb-1">
            {/* ── Group header ── */}
            {group.collapsible ? (
              <button
                type="button"
                aria-expanded={isGroupExpanded(group)}
                aria-controls={regionId("group", group.title)}
                onClick={() => toggle(group.title)}
                className={cn(
                  "group mb-1 flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition-all duration-200",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
                  // The open section gets a faint wash as well as the rotated
                  // chevron. Rotating the chevron alone meant a user scanning the
                  // rail had to look closely at a 14px glyph to know what was open.
                  isGroupExpanded(group)
                    ? "bg-white/[0.04]"
                    : "hover:bg-white/5"
                )}
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-lg transition-all duration-200",
                      "bg-white/5 ring-1 ring-white/10 group-hover:ring-white/20",
                      isGroupExpanded(group) && "ring-white/25"
                    )}
                  >
                    <group.icon className={cn("h-3.5 w-3.5 transition-transform duration-200 group-hover:scale-110", group.color)} />
                  </span>
                  <span className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-slate-400 group-hover:text-slate-200 transition-colors">
                    {group.title}
                  </span>
                </div>
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 text-slate-600 transition-all duration-200 group-hover:text-slate-400",
                    isGroupExpanded(group) && "rotate-180 text-slate-400"
                  )}
                />
              </button>
            ) : (
              <div className="mb-1 flex items-center gap-2.5 px-3 py-2">
                <span
 className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-lg",
                    "bg-white/5 ring-1 ring-white/10"
                  )}
                >
                  <group.icon className={cn("h-3.5 w-3.5", group.color)} />
                </span>
                <span className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-slate-400">
                  {group.title}
                </span>
              </div>
            )}

            {/* ── Group body ── */}
            {isGroupExpanded(group) && (
              <div
                id={regionId("group", group.title)}
                className={cn(
                  "space-y-0.5",
                  group.collapsible && "pl-2",
                  // The project's own `.animate-fade-in` utility from
                  // app/globals.css, which is backed by a real @keyframes.
                  // `animate-in` / `slide-in-from-top-1` are tailwindcss-animate
                  // classes and this project is Tailwind v4 WITHOUT that plugin,
                  // so they compile to nothing and the section would snap open
                  // with no transition while appearing to have one.
                  "animate-fade-in"
                )}
              >
                {group.categories
                  ? group.categories.map((cat) => {
                      const catItems = (cat.links as readonly string[])
                        .map((h) => itemByHref.get(h))
                        .filter(Boolean) as NavItem[];
                      if (catItems.length === 0) return null;
                      return (
                        <div key={cat.title} className="pt-1">
                          <button
                            type="button"
                            aria-expanded={isCategoryExpanded(cat)}
                            aria-controls={regionId("cat", cat.title)}
                            onClick={() => toggle(cat.title)}
                            className={cn(
                              "group mb-0.5 flex w-full items-center justify-between rounded-xl px-3 py-1.5 text-left text-slate-300 transition-all duration-200 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
                              isCategoryExpanded(cat) ? "bg-white/[0.04] text-slate-100" : "hover:bg-white/5"
                            )}
                          >
                            <div className="flex items-center gap-2">
                              {/* Given the same chip treatment as a group header.
                                  Without it the two levels read as the same weight,
                                  which is why the category labels looked like loose
                                  text rather than a nested section. */}
                              <span
                                className={cn(
                                  "flex h-5 w-5 items-center justify-center rounded-md transition-all duration-200",
                                  "bg-white/5 ring-1 ring-white/10 group-hover:ring-white/20",
                                  isCategoryExpanded(cat) && "ring-white/25"
                                )}
                              >
                                <cat.icon className={cn("h-3 w-3 transition-transform duration-200 group-hover:scale-110", cat.color)} />
                              </span>
                              <span className="text-[10px] font-extrabold uppercase tracking-[0.16em]">
                                {cat.title}
                              </span>
                            </div>
                            <ChevronDown
                              className={cn(
                                "h-3 w-3 text-slate-600 transition-all duration-200 group-hover:text-slate-400",
                                isCategoryExpanded(cat) && "rotate-180 text-slate-400"
                              )}
                            />
                          </button>
                          {isCategoryExpanded(cat) && (
                            <div
                              id={regionId("cat", cat.title)}
                              className="space-y-0.5 pl-4 animate-fade-in"
                            >
                              {catItems.map((item) => renderItem(item))}
                            </div>
                          )}
                        </div>
                      );
                    })
                  : flatItems.map((item) => renderItem(item))}
              </div>
            )}
          </section>
        );
      })}
    </nav>
  );
}
