import type { NextAuthConfig } from 'next-auth';

/**
 * Edge route→capability gate (P0-23).
 *
 * WHY THIS EXISTS: a `redirect()` thrown from a Server Component cannot change
 * the HTTP status code once the root layout has begun streaming the document,
 * so an unauthorized page request answers `200` with a meta-refresh instead of
 * `307`. Verified during this phase: `/employees` as STAFF returned 200 while
 * the guard correctly denied it and the body contained no employee data.
 *
 * The authorization boundary held, but the status code is a weaker signal for
 * monitoring, WAFs and any automation that keys on 3xx.
 *
 * The `authorized` callback runs INSIDE `auth()` in `proxy.ts`, which executes
 * at the edge BEFORE any component renders. It can therefore issue a real 307.
 * It also has access to `auth()` itself, so the session is properly decrypted
 * and `auth.user.role` is trustworthy here — unlike reading the cookie.
 *
 * This is defence in depth, not a replacement: `lib/auth/page-guard.ts` still
 * re-reads the role from the database inside the page, which is the
 * authoritative check.
 */

/** Coarse capability gate applied at the edge. */
const EDGE_ROUTE_RULES: { prefix: string; roles: string[] }[] = [
    // System-wide business rules and configuration.
    { prefix: '/dashboard/admin', roles: ['SUPER_ADMIN', 'ADMIN'] },
    { prefix: '/settings', roles: ['SUPER_ADMIN', 'ADMIN'] },
    // Access control: granting and revoking roles.
    { prefix: '/dashboard/request-access', roles: ['SUPER_ADMIN', 'ADMIN'] },
    { prefix: '/dashboard/approvals/roles', roles: ['SUPER_ADMIN', 'ADMIN'] },
    // Employee master data.
    { prefix: '/employees', roles: ['SUPER_ADMIN', 'ADMIN', 'HR'] },
    // Compensation.
    { prefix: '/payroll', roles: ['SUPER_ADMIN', 'ADMIN', 'FINANCE'] },
    // Biometric ingestion.
    { prefix: '/attendance/machine-integration', roles: ['SUPER_ADMIN', 'ADMIN', 'HR'] },
    // Document generation.
    { prefix: '/dashboard/letters', roles: ['SUPER_ADMIN', 'ADMIN', 'HR'] },
    { prefix: '/letters/offer', roles: ['SUPER_ADMIN', 'ADMIN', 'HR'] },
    { prefix: '/letters/appointment', roles: ['SUPER_ADMIN', 'ADMIN', 'HR'] },
    { prefix: '/letters/relieving', roles: ['SUPER_ADMIN', 'ADMIN', 'HR'] },
    // Compliance records.
    { prefix: '/visa', roles: ['SUPER_ADMIN', 'ADMIN', 'HR'] },
    // Hiring.
    { prefix: '/recruitment', roles: ['SUPER_ADMIN', 'ADMIN', 'HR'] },
];

function edgeRoleAllowed(pathname: string, role: string | undefined | null): boolean {
    for (const rule of EDGE_ROUTE_RULES) {
        if (pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`)) {
            // An unknown or missing role is treated as unprivileged.
            const normalised = typeof role === 'string' ? role.toUpperCase() : '';
            return rule.roles.includes(normalised);
        }
    }
    return true;
}

export const authConfig = {
    pages: {
        signIn: '/login',
    },
    providers: [
        // Added later in auth.ts
    ],
    callbacks: {
        /**
         * Session shape.
         *
         * This lives in `authConfig` (not only in `auth.ts`) on purpose.
         * `proxy.ts` builds a SEPARATE `NextAuth(authConfig)` instance for the
         * edge, and `auth.ts` extends the config with its own `callbacks`.
         * When the `session` callback was defined only in `auth.ts`, the edge
         * instance produced a session WITHOUT `role`, so the route gate in
         * `authorized` saw `role === undefined` and redirected every user —
         * including admins. Defining it once here keeps both instances
         * identical.
         *
         * Deliberately free of Prisma imports: this module is bundled for the
         * edge runtime. The `jwt` callback that resolves an OAuth user's role
         * from the database stays in `auth.ts`.
         */
        async session({ session, token }) {
            if (session.user) {
                (session.user as { role?: string }).role =
                    typeof token.role === 'string' ? token.role : 'STAFF';
                (session.user as { id?: string }).id =
                    typeof token.id === 'string' ? token.id : undefined;
            }
            return session;
        },

        async authorized({ auth, request: { nextUrl } }) {
            const isLoggedIn = !!auth?.user;
            const pathname = nextUrl.pathname;

            // `/activate/[token]` is reachable without a session BY DESIGN: the
            // single-use token in the URL is the credential. Requiring a session
            // would make it impossible for a brand-new account — which has never
            // signed in — to set its first password.
            const isActivationRoute = pathname.startsWith("/activate/");

            /**
             * The liveness probe. An uptime monitor holds no session, so this
             * would otherwise receive a 401 forever and report a healthy service
             * as down. It returns `true` even for a signed-in operator, because
             * falling through to the public-route branch below would redirect
             * them to /dashboard and hand them HTML instead of JSON — the check
             * would look broken precisely when someone is diagnosing an outage.
             *
             * Safe to leave unauthenticated: the handler reports only liveness,
             * never business data, identifiers or connection details.
             */
            if (pathname === "/api/health") {
                return true;
            }

            const isPublicRoute = pathname === "/login" || pathname === "/" || isActivationRoute;

            // Public route: send an authenticated visitor onward.
            if (isPublicRoute) {
                if (isLoggedIn && !isActivationRoute) {
                    return Response.redirect(new URL("/dashboard", nextUrl));
                }
                return true;
            }

            // API routes return a machine-readable 401; pages redirect.
            const isApi = nextUrl.pathname.startsWith('/api/');
            if (!isLoggedIn) {
                if (isApi) {
                    return Response.json({ error: 'Authentication required' }, { status: 401 });
                }
                const loginUrl = new URL('/login', nextUrl);
                if (nextUrl.pathname !== '/') loginUrl.searchParams.set('callbackUrl', nextUrl.pathname);
                return Response.redirect(loginUrl);
            }

            // Coarse role gate for the administrative surface.
            // The JWT session type does not declare `role`, so it is read
            // through a narrow cast. The authoritative role check happens
            // server-side where it is re-read from the database.
            const sessionRole = (auth?.user as { role?: string } | undefined)?.role;
            if (!edgeRoleAllowed(nextUrl.pathname, sessionRole)) {
                if (isApi) {
                    return Response.json({ error: 'Insufficient permissions' }, { status: 403 });
                }
                return Response.redirect(new URL('/dashboard', nextUrl));
            }

            return true;
        },
    },
} satisfies NextAuthConfig;
