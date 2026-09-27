"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, CheckCircle2, KeyRound, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { completePasswordChange, checkPasswordStrength } from "@/lib/workflow/credentials";
import { cn } from "@/lib/utils";

/**
 * First-login password set (P1.1 — SEC-027).
 *
 * A client component because the form posts to a server action and shows
 * progressive strength feedback. It renders its own full-page shell rather
 * than relying on the app layout, because an employee arriving from the
 * activation link has no session.
 */

const RULES = [
    { id: "length", label: "At least 12 characters", test: (p: string) => p.length >= 12 },
    { id: "lower", label: "A lowercase letter", test: (p: string) => /[a-z]/.test(p) },
    { id: "upper", label: "An uppercase letter", test: (p: string) => /[A-Z]/.test(p) },
    { id: "digit", label: "A digit", test: (p: string) => /\d/.test(p) },
    { id: "symbol", label: "A symbol", test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

export default function ActivateClient({ token }: { token: string }) {
    const router = useRouter();
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const strength = checkPasswordStrength(password);
    const matches = password.length > 0 && password === confirm;

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);

        if (!strength.ok) {
            setError(strength.problems.join(". "));
            return;
        }
        if (!matches) {
            setError("The two passwords do not match.");
            return;
        }

        setSubmitting(true);
        const result = await completePasswordChange({ token, newPassword: password });
        setSubmitting(false);

        if (result.success) {
            setDone(true);
            // Send them to sign in rather than leaving them on a dead page.
            setTimeout(() => router.push("/login"), 2500);
        } else {
            setError(result.message);
        }
    }

    if (done) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-6 py-16">
                <Card className="w-full max-w-md">
                    <CardContent className="pt-8 text-center space-y-4">
                        <div className="flex justify-center">
                            <div className="p-4 rounded-2xl bg-emerald-100 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50">
                                <CheckCircle2 className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
                            </div>
                        </div>
                        <h1 className="text-xl font-black text-slate-900 dark:text-white">Password set</h1>
                        <p className="text-sm text-slate-600 dark:text-slate-400">
                            Your account is ready. Taking you to the sign-in page…
                        </p>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-6 py-16">
            <Card className="w-full max-w-md">
                <CardHeader className="text-center space-y-3">
                    <div className="flex justify-center">
                        <div className="p-4 rounded-2xl bg-indigo-100 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-900/50">
                            <KeyRound className="h-8 w-8 text-indigo-600 dark:text-indigo-400" />
                        </div>
                    </div>
                    <div>
                        <CardTitle className="text-xl font-black">Set your password</CardTitle>
                        <CardDescription className="mt-2">
                            Choose a password to activate your account. This link works once.
                        </CardDescription>
                    </div>
                </CardHeader>

                <CardContent>
                    <form onSubmit={onSubmit} className="space-y-5" noValidate>
                        <div className="space-y-2">
                            <Label htmlFor="password" className="text-xs font-black uppercase tracking-widest text-slate-500">
                                New password
                            </Label>
                            <Input
                                id="password"
                                name="password"
                                type="password"
                                autoComplete="new-password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                aria-describedby="password-rules"
                                className={cn(
                                    "h-12 rounded-xl bg-slate-50 dark:bg-slate-900 font-bold",
                                    password.length > 0 && !strength.ok &&
                                        "border-rose-400 dark:border-rose-500 focus-visible:ring-rose-500"
                                )}
                            />
                        </div>

                        {/* Live rule checklist. UX only — the server re-checks. */}
                        <ul id="password-rules" className="space-y-1.5" aria-live="polite">
                            {RULES.map((rule) => {
                                const met = rule.test(password);
                                return (
                                    <li
                                        key={rule.id}
                                        className={cn(
                                            "flex items-center gap-2 text-xs font-bold",
                                            met ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400"
                                        )}
                                    >
                                        {met ? (
                                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                        ) : (
                                            <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                        )}
                                        {rule.label}
                                        <span className="sr-only">{met ? "(met)" : "(not met)"}</span>
                                    </li>
                                );
                            })}
                        </ul>

                        <div className="space-y-2">
                            <Label htmlFor="confirm" className="text-xs font-black uppercase tracking-widest text-slate-500">
                                Confirm password
                            </Label>
                            <Input
                                id="confirm"
                                name="confirm"
                                type="password"
                                autoComplete="new-password"
                                value={confirm}
                                onChange={(e) => setConfirm(e.target.value)}
                                aria-invalid={confirm.length > 0 && !matches ? "true" : undefined}
                                className={cn(
                                    "h-12 rounded-xl bg-slate-50 dark:bg-slate-900 font-bold",
                                    confirm.length > 0 && !matches &&
                                        "border-rose-400 dark:border-rose-500 focus-visible:ring-rose-500"
                                )}
                            />
                            {confirm.length > 0 && !matches && (
                                <p className="text-xs font-bold text-rose-600 dark:text-rose-400">Passwords do not match</p>
                            )}
                        </div>

                        {error && (
                            <p role="alert" className="flex items-start gap-2 text-sm font-bold text-rose-600 dark:text-rose-400">
                                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                                {error}
                            </p>
                        )}

                        <Button
                            type="submit"
                            disabled={submitting}
                            aria-busy={submitting}
                            className="w-full h-12 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 font-black uppercase text-xs tracking-widest"
                        >
                            {submitting ? "Saving…" : "Activate account"}
                        </Button>

                        <p className="flex items-start gap-2 text-xs text-slate-500 dark:text-slate-400">
                            <ShieldCheck className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                            Your password is stored only as a one-way hash. It is never emailed or logged.
                        </p>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
