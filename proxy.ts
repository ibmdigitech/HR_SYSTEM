import { NextResponse } from "next/server";
import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

/**
 * Edge gate (RBAC-001 / API-010 / API-021 remediation).
 *
 * PRIOR STATE — and a correction to the earlier audit: a `proxy.ts` did exist.
 * It exported `NextAuth(authConfig).auth`, so the `authorized` callback in
 * `auth.config.ts` WAS evaluated for page routes and anonymous visitors were
 * already redirected to /login. The audit's claim that every page was reachable
 * anonymously was wrong.
 *
 * The real gap was the matcher, not the absence of the file:
 *
 *   matcher: ['/((?!api|_next/static|_next/image|.*\\.png$).*)']
 *
 * `api` was excluded, so NO /api/** route passed through the session gate at
 * all. That is precisely why `GET /api/seed` was reachable by anyone.
 *
 * What genuinely did not exist, and what this file adds:
 *   1. A session gate on /api/**.
 *   2. A JSON 401 for API callers instead of an HTML redirect.
 *   3. Any role or capability enforcement at the edge.
 *
 * DELIBERATE SCOPE LIMIT: this proxy answers one question — "is there a
 * session?". It does not decide roles or capabilities. The session is a JWE and
 * the role claim is inside the encrypted payload; reading it here would require
 * shipping AUTH_SECRET to the edge runtime, and a value read here could be
 * forged. Role and permission decisions therefore live in `lib/auth/guards.ts`
 * (server actions, API routes) and `lib/auth/page-guard.ts` (pages), where the
 * role is re-read from the database on every request.
 */

/** Reachable without a session. */
const PUBLIC_PATHS = new Set(["/", "/login"]);

/**
 * `/activate/[token]` is public by design: the single-use token in the URL is
 * the credential. A brand-new account has never signed in, so requiring a
 * session here would make first-time password setup impossible. The page
 * validates the token server-side before showing the form, and the token
 * cannot be replayed.
 */
function isPublicPath(pathname: string): boolean {
    return PUBLIC_PATHS.has(pathname) || pathname.startsWith("/activate/");
}

const { auth } = NextAuth(authConfig);

export default auth((req) => {
    const { pathname } = req.nextUrl;
    // `req.auth` is the verified session, decrypted by NextAuth at the edge.
    const session = req.auth;

    if (isPublicPath(pathname)) {
        // Preserves the previous behaviour: an authenticated visitor on a
        // public route is sent to the dashboard.
        if (session?.user) {
            return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
        }
        return NextResponse.next();
    }

    if (!session?.user) {
        if (pathname.startsWith("/api/")) {
            // API callers get a machine-readable 401, not an HTML redirect.
            return NextResponse.json({ error: "Authentication required" }, { status: 401 });
        }
        const loginUrl = new URL("/login", req.nextUrl);
        if (pathname !== "/") loginUrl.searchParams.set("callbackUrl", pathname);
        return NextResponse.redirect(loginUrl);
    }

    // Authenticated. Role and capability enforcement happens server-side.
    return NextResponse.next();
});

export const config = {
    matcher: [
        /*
         * All application paths. `api/auth` stays excluded so a session can be
         * established. Everything else — including /api/** — now passes through
         * the session gate.
         */
        "/((?!api/auth|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map)$).*)",
    ],
};
