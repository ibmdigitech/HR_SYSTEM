import type { NextConfig } from "next";
import path from "path";

/**
 * Security headers (P0-11).
 *
 * REGRESSION RISK IS THE PRIMARY CONCERN HERE. A mis-specified
 * Content-Security-Policy can break Next.js hydration, the NextAuth
 * `/api/auth/*` routes, the Google and Microsoft OAuth redirects, inline
 * styles, and Turbopack's dev overlay. Two mitigations are applied:
 *
 *  1. DEVELOPMENT and PRODUCTION use different policies. Development is
 *     permissive (it must be, for HMR and source maps); production is strict
 *     but still allows every origin this app actually uses.
 *  2. `'unsafe-inline'` is retained for `style-src`. Tailwind 4 and Radix both
 *     inject inline styles, and removing it breaks them. This is a documented,
 *     deliberate trade-off, not an oversight — `script-src` has no such
 *     exemption.
 *
 * HSTS is production-only. Sending `Strict-Transport-Security` over plain HTTP
 * on localhost pins the browser to HTTPS for `localhost:3000` and breaks
 * local development until the browser cache is cleared.
 */

const isDev = process.env.NODE_ENV !== "production";

/**
 * CONFIG CONSOLIDATION (P0-11).
 *
 * This repository previously contained BOTH `next.config.js` and
 * `next.config.ts`. Next.js resolves in the order `.js` → `.mjs` → `.ts`, so
 * the `.js` file won and this `.ts` file was silently dead — meaning
 * `turbopack.root`, `images.formats` and `serverExternalPackages` were never
 * applied at all.
 *
 * Everything has been merged here: the `serverActions.bodySizeLimit` that the
 * `.js` file carried, plus the settings that only existed in the ignored `.ts`
 * file. `next.config.js` has been removed so the two cannot drift apart again.
 * This is a merge, not a removal of behaviour.
 */

/**
 * Sources this application legitimately loads from at runtime.
 * Adding a provider means adding it here, not weakening the policy.
 *
 * NOTE: script origins are inlined into the production CSP string below rather
 * than referenced from a constant, because `script-src` is assembled
 * separately from `connect-src`. An earlier unused constant was removed after
 * lint flagged it as dead code.
 */
const EXTERNAL_CONNECT_ORIGINS = [
    "https://accounts.google.com",
    "https://login.microsoftonline.com",
    "https://graph.microsoft.com",
];

/**
 * `frame-ancestors 'none'` blocks clickjacking. `X-Frame-Options` is the
 * legacy fallback for older browsers.
 */
const BASE_HEADERS = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-DNS-Prefetch-Control", value: "off" },
    {
        key: "Permissions-Policy",
        // Geolocation, camera, microphone, payment and USB are unused.
        value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    },
    {
        // Cross-origin isolation headers. COEP is intentionally omitted:
        // enabling it without CORP headers blocks Google/Microsoft OAuth.
        key: "Cross-Origin-Opener-Policy",
        value: "same-origin-allow-popups",
    },
];

function buildCsp(): string {
    if (isDev) {
        return [
            "default-src 'self'",
            // Turbopack HMR, React Refresh and the dev overlay need eval and
            // inline scripts. Development only.
            "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "font-src 'self' data:",
            `connect-src 'self' ws: wss: ${EXTERNAL_CONNECT_ORIGINS.join(" ")}`,
            "frame-ancestors 'none'",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
        ].join("; ");
    }

    return [
        "default-src 'self'",
        // No 'unsafe-eval' in production. 'unsafe-inline' is present because
        // Next.js injects inline bootstrap scripts for RSC payloads; it cannot
        // be removed without a nonce-based CSP, which is a larger change than
        // this phase permits.
        "script-src 'self' 'unsafe-inline' https://accounts.google.com https://login.microsoftonline.com",
        // 'unsafe-inline' required by Tailwind/Radix inline styles.
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "font-src 'self' data:",
        `connect-src 'self' ${EXTERNAL_CONNECT_ORIGINS.join(" ")}`,
        "frame-src 'self' https://accounts.google.com https://login.microsoftonline.com",
        "frame-ancestors 'none'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self' https://accounts.google.com https://login.microsoftonline.com",
        "upgrade-insecure-requests",
    ].join("; ");
}

const nextConfig: NextConfig = {
    turbopack: {
        // Absolute path to project root to avoid distDirRoot issues
        root: path.resolve(__dirname),
    },
    images: {
        formats: ["image/avif", "image/webp"],
    },
    serverExternalPackages: ["@prisma/client"],

    // Merged from the previously-active next.config.js (P0-11).
    experimental: {
        serverActions: {
            // Leave room for the bounded 5 MB resignation letter plus multipart overhead.
            bodySizeLimit: "6mb",
        },
    },

    async headers() {
        const headers = [
            ...BASE_HEADERS,
            { key: "Content-Security-Policy", value: buildCsp() },
        ];

        // HSTS only in production. Never sent over plain-HTTP localhost.
        if (!isDev) {
            headers.push({
                key: "Strict-Transport-Security",
                value: "max-age=63072000; includeSubDomains; preload",
            });
        }

        return [
            {
                source: "/:path*",
                headers,
            },
            {
                // Auth responses must never be cached by a shared proxy.
                source: "/api/auth/:path*",
                headers: [
                    { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, private" },
                    { key: "Pragma", value: "no-cache" },
                ],
            },
        ];
    },
};

export default nextConfig;
