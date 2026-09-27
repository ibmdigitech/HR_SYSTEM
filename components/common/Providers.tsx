"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";

/**
 * Client provider boundary.
 *
 * `SessionProvider` is required by `useSession()`. The application had no
 * provider anywhere, so the login page's session check threw
 * "`useSession` must be wrapped in a <SessionProvider />" at runtime. The
 * TypeScript build passed because the hook is typed, not checked for a provider
 * — which is why this only surfaced when the page was requested.
 *
 * Wrapping here rather than at each call site means any future component can
 * read the session without repeating the guard.
 */
export function Providers({ children }: { children: ReactNode }) {
    return <SessionProvider>{children}</SessionProvider>;
}
