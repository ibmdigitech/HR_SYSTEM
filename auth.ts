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
    buildCredentialRateLimitKeys,
    checkRateLimit,
    classifyAuthFailure,
    registerAuthOutcome,
    registerAuthVerdict,
} from '@/lib/auth/rate-limit';

type UserRecord = NonNullable<Awaited<ReturnType<typeof prisma.user.findUnique>>>;

/**
 * Result of resolving an account. A discriminated union, not `User | null`.
 *
 * WHY NOT `User | null`: `null` is equally the answer to "there is no such
 * account" and to "the database could not tell us", and the sign-in callback
 * feeds the result straight into the brute-force budget. Collapsing the two
 * means every transient database outage is charged to the account that
 * happened to be signing in. That is what locked an administrator out for two
 * hours in production: five sign-in attempts during a brief outage exhausted
 * the 15-minute budget and the exponential backoff stretched the penalty to
 * `blockMs * 8`.
 *
 * A thrown lookup is therefore RETURNED, not swallowed and not rethrown.
 * Re-throwing a bare `Error` escapes `authorize` entirely — `@auth/core` does
 * not wrap that call in a try/catch
 * (node_modules/@auth/core/lib/actions/callback/index.js) — so the user got a
 * server error instead of a sign-in message, while any wrapper that did
 * swallow it would have silently started counting outages. Returning the
 * failure keeps both the response and the accounting honest.
 */
type UserLookup =
    | { ok: true; user: UserRecord | null }
    | { ok: false; error: unknown };

async function lookupUser(email: string): Promise<UserLookup> {
    try {
        const user = await prisma.user.findUnique({ where: { email } });
        return { ok: true, user };
    } catch (error) {
        return { ok: false, error };
    }
}

type PasswordChangeState =
    | { available: true; mustChange: boolean }
    | { available: false; error: unknown };

/**
 * Reads the account's password-state flag. A second datastore call, and it
 * fails in exactly the same way the user lookup does, so it is reported in the
 * same shape rather than being allowed to abort the attempt.
 */
async function readPasswordChangeState(user: UserRecord): Promise<PasswordChangeState> {
    try {
        const { mustChangePassword } = await import('@/lib/workflow/credentials');
        return { available: true, mustChange: await mustChangePassword(user.id) };
    } catch (error) {
        return { available: false, error };
    }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
    ...authConfig,
    // The Prisma adapter's inferred type is too deep for the compiler, so the
    // assertion is narrowed to `unknown` rather than `any`. A wider type here
    // would leak into every downstream consumer of `auth()`.
    // @ts-expect-error - excessive type depth in the Prisma adapter
    adapter: PrismaAdapter(prisma) as unknown as Adapter,
    secret: process.env.AUTH_SECRET,
    trustHost: true,
    session: {
        strategy: 'jwt', // must use JWT when using Credentials alongside OAuth
    },
    providers: [
        ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
            ? [
                  Google({
                      clientId: process.env.GOOGLE_CLIENT_ID,
                      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
                  }),
              ]
            : []),
        ...(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET
            ? [
                  MicrosoftEntraID({
                      clientId: process.env.MICROSOFT_CLIENT_ID,
                      clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
                      // @ts-expect-error - tenantId is accepted at runtime but untyped
                      tenantId: process.env.MICROSOFT_TENANT_ID ?? 'common',
                  }),
              ]
            : []),
        Credentials({
            async authorize(credentials, request) {
                // Rate limiting (P0-6). Two independent budgets are enforced:
                // one keyed on IP+email, one keyed on email alone, so neither
                // rotating IPs nor spraying one account across IPs is enough.
                // A per-IP-only throttle would be evaded by rotation and would
                // also let one host grief a colleague's account.
                const ip =
                    request?.headers?.get('x-forwarded-for')?.split(',')[0]?.trim() ??
                    request?.headers?.get('x-real-ip') ??
                    null;

                const rawEmail =
                    typeof credentials?.email === 'string' ? credentials.email : null;
                const normalizedEmail = rawEmail?.trim().toLowerCase() ?? null;

                const { pair: pairKey, account: accountKey } = buildCredentialRateLimitKeys(
                    normalizedEmail,
                    ip,
                );

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

                // Every outcome below is classified by the pure
                // `classifyAuthFailure` and accounted for by
                // `registerAuthVerdict`. No path in this callback increments a
                // counter on its own, which is what stops an outage from being
                // recorded as a credential guess.
                const parsedCredentials = z
                    .object({ email: z.string().email(), password: z.string().min(6) })
                    .safeParse(credentials);

                if (!parsedCredentials.success) {
                    await registerAuthVerdict({
                        verdict: classifyAuthFailure({
                            payloadValid: false,
                            lookup: 'resolved',
                            userFound: false,
                            hasPasswordHash: false,
                            passwordMatched: false,
                        }),
                        pairKey,
                        accountKey,
                        policy: POLICIES.credentials,
                        email: normalizedEmail,
                        ip,
                    });
                    return null;
                }

                const { email, password } = parsedCredentials.data;

                let lookup = await lookupUser(email);

                // Both datastore calls below are funnelled into a single
                // `lookup` verdict so that ANY database failure during the
                // attempt is attributed to the infrastructure rather than to
                // the person typing a password.
                let mustChange = false;
                if (lookup.ok && lookup.user) {
                    const state = await readPasswordChangeState(lookup.user);
                    if (!state.available) {
                        lookup = { ok: false, error: state.error };
                    } else {
                        mustChange = state.mustChange;
                    }
                }

                if (!lookup.ok) {
                    // Availability incident, not a security event. Log it for
                    // visibility, count nothing, and answer with the same
                    // `null` as a wrong password so the response shape cannot
                    // be used to probe the account and the outage does not
                    // surface as a server error.
                    console.error('[AUTH_LOOKUP_UNAVAILABLE]', lookup.error);
                    await registerAuthVerdict({
                        verdict: classifyAuthFailure({
                            payloadValid: true,
                            lookup: 'unavailable',
                            userFound: false,
                            hasPasswordHash: false,
                            passwordMatched: false,
                        }),
                        pairKey,
                        accountKey,
                        policy: POLICIES.credentials,
                        email: normalizedEmail,
                        ip,
                    });
                    return null;
                }

                const user = lookup.user;
                const hasUser = Boolean(user);
                const hash = user?.password ?? null;
                const hasPasswordHash = hash !== null;

                // "Do not distinguish unknown user from wrong password" in
                // timing or in the response: the hash comparison below is only
                // reached when a hash exists, as before.
                const passwordMatched = hash !== null ? await bcrypt.compare(password, hash) : false;

                const verdict = classifyAuthFailure({
                    payloadValid: true,
                    lookup: 'resolved',
                    userFound: hasUser,
                    hasPasswordHash,
                    passwordMatched,
                    awaitingActivation: hasUser && !hasPasswordHash && mustChange,
                    passwordChangeDue: hasUser && passwordMatched && mustChange,
                });

                if (verdict.kind === 'SUCCESS' && user) {
                    await registerAuthVerdict({
                        verdict,
                        pairKey,
                        accountKey,
                        policy: POLICIES.credentials,
                        email: normalizedEmail,
                        ip,
                    });
                    return user;
                }

                await registerAuthVerdict({
                    verdict,
                    pairKey,
                    accountKey,
                    policy: POLICIES.credentials,
                    email: normalizedEmail,
                    ip,
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
                const image = (user as { image?: unknown }).image;
                token.image = typeof image === 'string' && image.length > 0 ? image : undefined;
            }
            // On OAuth sign-in, fetch the role from the DB
            if (account && account.provider !== 'credentials') {
                const dbUser = await prisma.user.findUnique({
                    where: { email: token.email! },
                });
                if (dbUser) {
                    token.role = dbUser.role;
                    token.id = dbUser.id;
                    token.image = dbUser.image ?? undefined;
                }
            }
            return token;
        },
    },
});
