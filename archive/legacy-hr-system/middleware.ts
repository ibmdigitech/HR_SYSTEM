import { auth } from '@/auth';
import { NextResponse } from 'next/server';

const roleRouteAccess: Record<string, string[]> = {
    ADMIN: [
        '/dashboard',
        '/employees',
        '/attendance',
        '/leaves',
        '/payroll',
        '/letters',
        '/dashboard/visa',
        '/dashboard/requests',
        '/dashboard/approvals',
        '/dashboard/letters',
        '/dashboard/admin',
        '/settings',
    ],
    MANAGER: [
        '/dashboard',
        '/employees',
        '/attendance',
        '/leaves',
        '/payroll',
        '/letters',
        '/dashboard/visa',
        '/dashboard/requests',
        '/dashboard/approvals',
        '/dashboard/letters',
        '/settings',
    ],
    STAFF: [
        '/dashboard',
        '/attendance',
        '/leaves',
        '/payroll',
        '/letters',
        '/dashboard/visa',
        '/dashboard/requests',
        '/settings',
    ],
};

const publicRoutes = ['/login', '/', '/api/auth'];

function hasAccess(role: string, pathname: string): boolean {
    const allowedRoutes = roleRouteAccess[role] || [];
    return allowedRoutes.some((route) => pathname === route || pathname.startsWith(route + '/'));
}

export default auth((req) => {
    const { nextUrl } = req;
    const isLoggedIn = !!req.auth?.user;
    const role = (req.auth?.user as any)?.role || 'STAFF';

    const isPublicRoute = publicRoutes.some((route) => nextUrl.pathname === route || nextUrl.pathname.startsWith(route + '/'));

    if (isPublicRoute) {
        if (isLoggedIn && nextUrl.pathname === '/login') {
            return NextResponse.redirect(new URL('/dashboard', nextUrl));
        }
        return NextResponse.next();
    }

    if (!isLoggedIn) {
        const loginUrl = new URL('/login', nextUrl);
        loginUrl.searchParams.set('callbackUrl', nextUrl.pathname);
        return NextResponse.redirect(loginUrl);
    }

    if (!hasAccess(role, nextUrl.pathname)) {
        return NextResponse.redirect(new URL('/dashboard', nextUrl));
    }

    return NextResponse.next();
});

export const config = {
    matcher: [
        '/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.png$).*)',
    ],
};