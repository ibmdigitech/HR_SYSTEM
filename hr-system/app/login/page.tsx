"use client";

import { useState, useTransition } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { Building2, Mail, Loader2 } from 'lucide-react';

// Google Icon SVG
function GoogleIcon() {
    return (
        <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
            <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#4285F4"
            />
            <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
            />
            <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
            />
            <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
            />
        </svg>
    );
}

// Microsoft Icon SVG
function MicrosoftIcon() {
    return (
        <svg className="h-5 w-5" viewBox="0 0 23 23" aria-hidden="true">
            <rect x="1" y="1" width="10" height="10" fill="#F25022" />
            <rect x="12" y="1" width="10" height="10" fill="#7FBA00" />
            <rect x="1" y="12" width="10" height="10" fill="#00A4EF" />
            <rect x="12" y="12" width="10" height="10" fill="#FFB900" />
        </svg>
    );
}

export default function LoginPage() {
    const [errorMessage, setErrorMessage] = useState<string | undefined>();
    const [isPending, startTransition] = useTransition();
    const [oauthLoading, setOauthLoading] = useState<'google' | 'microsoft' | null>(null);
    const router = useRouter();
    const searchParams = useSearchParams();
    const callbackUrl = searchParams.get('callbackUrl') || '/dashboard';

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setErrorMessage(undefined);
        const formData = new FormData(e.currentTarget);
        const email = formData.get('email') as string;
        const password = formData.get('password') as string;

        startTransition(async () => {
            try {
                const result = await signIn('credentials', {
                    email,
                    password,
                    redirect: false,
                });

                if (result?.error) {
                    setErrorMessage('Invalid email or password. Please try again.');
                    return;
                }

                if (result?.ok) {
                    router.push(callbackUrl);
                    router.refresh();
                }
            } catch {
                setErrorMessage('Something went wrong. Please try again.');
            }
        });
    }

    async function handleOAuth(provider: 'google' | 'microsoft-entra-id', label: 'google' | 'microsoft') {
        setOauthLoading(label);
        try {
            await signIn(provider, { callbackUrl });
        } catch {
            setOauthLoading(null);
            setErrorMessage('OAuth sign-in failed. Please try again.');
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 p-4">
            {/* Background decorative blobs */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-40 -right-40 w-80 h-80 bg-indigo-600 rounded-full opacity-10 blur-3xl" />
                <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-violet-600 rounded-full opacity-10 blur-3xl" />
            </div>

            <Card className="w-full max-w-md relative bg-white/5 border border-white/10 backdrop-blur-xl shadow-2xl text-white">
                <CardHeader className="text-center pb-2">
                    <div className="flex justify-center mb-4">
                        <div className="h-14 w-14 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/30">
                            <Building2 className="h-7 w-7 text-white" />
                        </div>
                    </div>
                    <CardTitle className="text-2xl font-bold text-white">Welcome back</CardTitle>
                    <CardDescription className="text-slate-400">
                        Sign in to your HR System account
                    </CardDescription>
                </CardHeader>

                <CardContent className="space-y-5 pt-2">
                    {/* OAuth Buttons */}
                    <div className="space-y-3">
                        <button
                            id="btn-google-signin"
                            type="button"
                            onClick={() => handleOAuth('google', 'google')}
                            disabled={!!oauthLoading || isPending}
                            className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-lg bg-white text-gray-800 font-medium text-sm hover:bg-gray-100 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow"
                        >
                            {oauthLoading === 'google' ? (
                                <Loader2 className="h-5 w-5 animate-spin text-gray-600" />
                            ) : (
                                <GoogleIcon />
                            )}
                            Continue with Google
                        </button>

                        <button
                            id="btn-microsoft-signin"
                            type="button"
                            onClick={() => handleOAuth('microsoft-entra-id', 'microsoft')}
                            disabled={!!oauthLoading || isPending}
                            className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-lg bg-[#2f2f2f] text-white font-medium text-sm hover:bg-[#404040] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow border border-white/10"
                        >
                            {oauthLoading === 'microsoft' ? (
                                <Loader2 className="h-5 w-5 animate-spin" />
                            ) : (
                                <MicrosoftIcon />
                            )}
                            Continue with Microsoft
                        </button>
                    </div>

                    {/* Divider */}
                    <div className="flex items-center gap-3">
                        <div className="flex-1 h-px bg-white/10" />
                        <span className="text-xs text-slate-500 uppercase tracking-widest">or</span>
                        <div className="flex-1 h-px bg-white/10" />
                    </div>

                    {/* Credentials Form */}
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-1.5">
                            <Label htmlFor="email" className="text-slate-300 text-sm">Email</Label>
                            <Input
                                id="email"
                                type="email"
                                name="email"
                                placeholder="admin@company.com"
                                required
                                disabled={isPending || !!oauthLoading}
                                className="bg-white/10 border-white/20 text-white placeholder:text-slate-500 focus:border-indigo-500 focus:ring-indigo-500/20"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="password" className="text-slate-300 text-sm">Password</Label>
                            <Input
                                id="password"
                                type="password"
                                name="password"
                                placeholder="••••••••"
                                required
                                disabled={isPending || !!oauthLoading}
                                className="bg-white/10 border-white/20 text-white placeholder:text-slate-500 focus:border-indigo-500 focus:ring-indigo-500/20"
                            />
                        </div>

                        <Button
                            id="btn-credentials-signin"
                            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 transition-all duration-200 shadow-lg shadow-indigo-500/30"
                            type="submit"
                            disabled={isPending || !!oauthLoading}
                        >
                            {isPending ? (
                                <span className="flex items-center gap-2">
                                    <Loader2 className="h-4 w-4 animate-spin" /> Signing in...
                                </span>
                            ) : (
                                <span className="flex items-center gap-2">
                                    <Mail className="h-4 w-4" /> Sign in with Email
                                </span>
                            )}
                        </Button>

                        {errorMessage && (
                            <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400 text-center">
                                {errorMessage}
                            </div>
                        )}
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
