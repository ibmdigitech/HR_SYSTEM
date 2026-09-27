"use client";import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { requestRoleAccess } from "@/app/lib/actions/role-request";
import { useFormState, useFormStatus } from "react-dom";

// Initial state for the form action
const initialState = {
    message: "",
    success: false,
};

export function RequestAccessPage () {
    const [state, formAction] = useFormState(requestRoleAccess, initialState);

    return (
        <div className="max-w-2xl mx-auto space-y-8 p-8">
            <div>
                <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-primary flex items-center gap-2 mb-4">
                    <ArrowLeft className="h-4 w-4" />
                    Back to Dashboard
                </Link>
                <h1 className="text-3xl font-bold tracking-tight">Request Role Access</h1>
                <p className="text-muted-foreground">Apply for elevated permissions within the HR System.</p>
            </div>

            {state.success ? (
                <Card className="border-emerald-500/50 bg-emerald-50/50 dark:bg-emerald-950/20">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="h-5 w-5" />
                            Request Submitted
                        </CardTitle>
                        <CardDescription>
                            Your request has been sent to the Admin/HR team for review. You will be notified once approved.
                        </CardDescription>
                    </CardHeader>
                    <CardFooter>
                        <Link href="/dashboard">
                            <Button variant="outline">Return Home</Button>
                        </Link>
                    </CardFooter>
                </Card>
            ) : (
                <Card>
                    <form action={formAction}>
                        <CardHeader>
                            <CardTitle>Select Role</CardTitle>
                            <CardDescription>Which role are you requesting access for?</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="role">Role Type</Label>
                                <Select name="role" required>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select a role..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="MANAGER">Manager (Department Head)</SelectItem>
                                        <SelectItem value="HR">HR Specialist</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            {state.message && (
                                <p className="text-sm text-red-500">{state.message}</p>
                            )}
                        </CardContent>
                        <CardFooter className="flex justify-end">
                            <SubmitButton />
                        </CardFooter>
                    </form>
                </Card>
            )}
        </div>
    );
}

function SubmitButton() {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" disabled={pending}>
            {pending ? "Submitting..." : "Submit Request"}
        </Button>
    );
}
