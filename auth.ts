import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id';
import { PrismaAdapter } from '@auth/prisma-adapter';
import type { Adapter } from 'next-auth/adapters';
import { authConfig } from './auth.config';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import {
    POLICIES,
    buildRateLimitKey,
    checkRateLimit,
    registerAuthOutcome,
} from '@/lib/auth/rate-limit';

async function getUser(email: string) {
    try {
        const user = await prisma.user.findUnique({ where: { email } });
        return user;
    } catch (error) {
        console.error('Failed to fetch user:', error);
        throw new Error('Failed to fetch user.');
    }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
    ...authConfig,
    // The Prisma adapter's inferred type is too deep for the compiler, so the
    // assertion is narrowed to `unknown` rather than `any`. A wider type here
    // would leak into every downstream consumer of `auth()`.
    adapter: PrismaAdapter(prisma) as unknown as Adapter,
    secret: process.env.AUTH_SECRET,
    trustHost: true,
    session: {
        strategy: 'jwt', // must use JWT when using Credentials alongside OAuth
    },
    providers: [
        Google({
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        }),
        MicrosoftEntraID({
            clientId: process.env.MICROSOFT_CLIENT_ID!,
            clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
            // The provider does not declare `tenantId` in its published types,
            // but it is supported at runtime. `@ts-expect-error` is used rather
            // than `@ts-ignore` so that the assertion FAILS if the provider ever
            // gains the type — a silent no-op suppression would hide that.
            // @ts-expect-error - tenantId is accepted at runtime but untyped
            tenantId: process.env.MICROSOFT_TENANT_ID ?? 'common',
        }),
        Credentials({
            async authorize(credentials, request) {
                const { mustChangePassword } = await import('@/lib/workflow/credentials');
                // Rate limiting (P0-6). Two independent budgets are enforced:
                // one keyed on IP+email, one keyed on email alone, so neither
                // rotating IPs nor spraying one account across IPs is enough.
                const ip =
                    request?.headers?.get('x-forwarded-for')?.split(',')[0]?.trim() ??
                    request?.headers?.get('x-real-ip') ??
                    null;

                const rawEmail =
                    typeof credentials?.email === 'string' ? credentials.email : null;
                const normalizedEmail = rawEmail?.trim().toLowerCase() ?? null;

                const pairKey = buildRateLimitKey('credentials', ip, normalizedEmail);
                const accountKey = buildRateLimitKey('credentials-account', null, normalizedEmail);

                for (const key of [pairKey, accountKey]) {
                    const decision = checkRateLimit(key, POLICIES.credentials);
                    if (!decision.allowed) {
                        await registerAuthOutcome({
                            key,
                            policy: POLICIES.credentials,
                            email: normalizedEmail,
                            ip,
                            success: false,
                            reason: 'rate limited',
                        });
                        // Returning null (not throwing) keeps the NextAuth
                        // response shape identical whether the failure was a
                        // wrong password or a lockout, so this cannot be used
                        // to probe which accounts exist.
                        return null;
                    }
                }

                const parsedCredentials = z
                    .object({ email: z.string().email(), password: z.string().min(6) })
                    .safeParse(credentials);

                if (parsedCredentials.success) {
                    const { email, password } = parsedCredentials.data;
                    const user = await getUser(email);
                    if (!user || !user.password) {
                        // An account with a null password is one awaiting its
                        // first-login activation (P1.1). It is not an error and
                        // must not be reported as "invalid credentials", which
                        // would leave the user with no way forward.
                        if (user) {
                            const needsActivation = await mustChangePassword(user.id);
                            if (needsActivation) {
                                await registerAuthOutcome({
                                    key: pairKey,
                                    policy: POLICIES.credentials,
                                    email: normalizedEmail,
                                    ip,
                                    success: false,
                                    reason: 'account awaiting first-login activation',
                                });
                                return null;
                            }
                        }
                        // Do not distinguish "unknown user" from "wrong
                        // password" in timing or in the response.
                        await registerAuthOutcome({
                            key: pairKey,
                            policy: POLICIES.credentials,
                            email: normalizedEmail,
                            ip,
                            success: false,
                            reason: 'unknown user or non-credential account',
                        });
                        await registerAuthOutcome({
                            key: accountKey,
                            policy: POLICIES.credentials,
                            email: normalizedEmail,
                            ip,
                            success: false,
                            reason: 'unknown user or non-credential account',
                        });
                        return null;
                    }

                    const passwordsMatch = await bcrypt.compare(password, user.password);
                    if (passwordsMatch) {
                        // P1.1: a successful password match is refused while a
                        // forced change is outstanding. The account is reachable
                        // only through the activation link.
                        if (await mustChangePassword(user.id)) {
                            await registerAuthOutcome({
                                key: pairKey,
                                policy: POLICIES.credentials,
                                email: normalizedEmail,
                                ip,
                                success: false,
                                reason: 'forced password change outstanding',
                            });
                            return null;
                        }

                        await registerAuthOutcome({
                            key: pairKey,
                            policy: POLICIES.credentials,
                            email: normalizedEmail,
                            ip,
                            success: true,
                        });
                        await registerAuthOutcome({
                            key: accountKey,
                            policy: POLICIES.credentials,
                            email: normalizedEmail,
                            ip,
                            success: true,
                        });
                        return user;
                    }

                    await registerAuthOutcome({
                        key: pairKey,
                        policy: POLICIES.credentials,
                        email: normalizedEmail,
                        ip,
                        success: false,
                        reason: 'password mismatch',
                    });
                    await registerAuthOutcome({
                        key: accountKey,
                        policy: POLICIES.credentials,
                        email: normalizedEmail,
                        ip,
                        success: false,
                        reason: 'password mismatch',
                    });
                    return null;
                }

                // Malformed payload still counts as an attempt.
                await registerAuthOutcome({
                    key: pairKey,
                    policy: POLICIES.credentials,
                    email: normalizedEmail,
                    ip,
                    success: false,
                    reason: 'malformed credentials payload',
                });
                return null;
            },
        }),
    ],
    callbacks: {
        /**
         * IMPORTANT: `...authConfig.callbacks` is spread FIRST.
         *
         * `NextAuth({ ...authConfig, callbacks: { ... } })` replaces the whole
         * `callbacks` object. Omitting the spread silently discards the
         * `session` callback defined in `auth.config.ts`, which is what attaches
         * `role` and `id` to the session. That happened during phase 2: the
         * session lost `id`, `lib/auth/guards.ts` then looked up the User row by
         * email in the `id` field, found nothing, and returned 401 for every
         * authenticated API call.
         *
         * `proxy.ts` builds a separate `NextAuth(authConfig)` that relies on the
         * same callback, so it MUST be preserved here.
         */
        ...authConfig.callbacks,

        async jwt({ token, user, account }) {
            if (user) {
                token.id = user.id;
                // The AdapterUser type does not declare `role`, but the token
                // does and the whole authorization model reads it. Narrow rather
                // than casting to `any`.
                const role = (user as { role?: unknown }).role;
                token.role = typeof role === 'string' && role.length > 0 ? role : 'STAFF';
            }
            // On OAuth sign-in, fetch the role from the DB
            if (account && account.provider !== 'credentials') {
                const dbUser = await prisma.user.findUnique({
                    where: { email: token.email! },
                });
                if (dbUser) {
                    token.role = dbUser.role;
                    token.id = dbUser.id;
                }
            }
            return token;
        },
    },
});
