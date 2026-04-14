"use client";

import { useState, useTransition } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Building2 } from 'lucide-react';

export default function LoginPage() {
    const [errorMessage, setErrorMessage] = useState<string | undefined>();
    const [isPending, startTransition] = useTransition();
    const router = useRouter();
    const searchParams = useSearchParams();
    const callbackUrl = searchParams.get('callbackUrl') || '/dashboard';

    async function handleSubmit(formData: FormData) {
        setErrorMessage(undefined);
        const email = formData.get('email') as string;
        const password = formData.get('password') as string;

        try {
            // Fetch CSRF token first
            const csrfRes = await fetch('/api/auth/csrf');
            const { csrfToken } = await csrfRes.json();

            const result = await signIn('credentials', {
                email,
                password,
                csrfToken,
                redirect: false,
            });

            if (result?.error) {
                setErrorMessage('Invalid credentials.');
                return;
            }

            if (result?.ok) {
                router.push(callbackUrl);
                router.refresh();
            }
        } catch (error) {
            setErrorMessage('Something went wrong.');
        }
    }

    return (
        <div className="flex h-screen items-center justify-center bg-slate-50 dark:bg-slate-900">
            <Card className="w-full max-w-sm">
                <CardHeader className="text-center">
                    <div className="flex justify-center mb-4">
                        <div className="h-12 w-12 rounded-lg bg-indigo-600 flex items-center justify-center">
                            <Building2 className="h-6 w-6 text-white" />
                        </div>
                    </div>
                    <CardTitle className="text-2xl">Welcome back</CardTitle>
                    <CardDescription>
                        Enter your email to sign in to your account
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form action={handleSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="email">Email</Label>
                            <Input id="email" type="email" name="email" placeholder="m@example.com" required disabled={isPending} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="password">Password</Label>
                            <Input id="password" type="password" name="password" required disabled={isPending} />
                        </div>
                        <LoginButton isPending={isPending} />
                        <div
                            className="flex h-8 items-end space-x-1"
                            aria-live="polite"
                            aria-atomic="true"
                        >
                            {errorMessage && (
                                <p className="text-sm text-red-500">
                                    {errorMessage}
                                </p>
                            )}
                        </div>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}

function LoginButton({ isPending }: { isPending: boolean }) {
    return (
        <Button className="w-full" type="submit" disabled={isPending}>
            {isPending ? 'Signing in...' : 'Sign in'}
        </Button>
    );
}
