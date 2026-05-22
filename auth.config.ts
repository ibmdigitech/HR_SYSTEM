import type { NextAuthConfig } from 'next-auth';

export const authConfig = {
    pages: {
        signIn: '/login',
    },
    providers: [
        // Added later in auth.ts
    ],
    callbacks: {
        authorized({ auth, request: { nextUrl } }) {
            const isLoggedIn = !!auth?.user;
            const isPublicRoute = nextUrl.pathname === '/login' || nextUrl.pathname === '/';

            // If it's a public route (like login or landing page)
            if (isPublicRoute) {
                if (isLoggedIn) {
                    return Response.redirect(new URL('/dashboard', nextUrl));
                }
                return true;
            }

            // If it's not a public route, user MUST be logged in
            return isLoggedIn;
        },
    },
} satisfies NextAuthConfig;
