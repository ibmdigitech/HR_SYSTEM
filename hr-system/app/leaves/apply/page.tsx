"use client";

import { useFormState, useFormStatus } from "react-dom";
import { submitLeaveRequest } from "@/app/lib/actions/leave";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarIcon } from "lucide-react";

const initialState = {
    message: "",
    success: false,
};

export default function ApplyLeavePage() {
    const [state, formAction] = useFormState(submitLeaveRequest, initialState);

    return (
        <div className="max-w-2xl mx-auto p-8 space-y-8">
            <h1 className="text-3xl font-bold">Apply for Leave</h1>

            {state.success ? (
                <Card className="bg-green-50 border-green-200">
                    <CardContent className="pt-6">
                        <p className="text-green-700 font-medium">Leave request submitted successfully! Track status in your dashboard.</p>
                    </CardContent>
                </Card>
            ) : (
                <Card>
                    <form action={formAction}>
                        <CardHeader>
                            <CardTitle>Leave Details</CardTitle>
                            <CardDescription>Fill out the form below. Approval required from Manager then HR.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="type">Leave Type</Label>
                                <Select name="type" required>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select type" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="SICK">Sick Leave</SelectItem>
                                        <SelectItem value="CASUAL">Casual Leave</SelectItem>
                                        <SelectItem value="ANNUAL">Annual Leave</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Start Date</Label>
                                    <Input type="date" name="startDate" required />
                                </div>
                                <div className="space-y-2">
                                    <Label>End Date</Label>
                                    <Input type="date" name="endDate" required />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label>Reason</Label>
                                <Textarea name="reason" placeholder="Brief reason for leave..." required />
                            </div>

                            <div className="space-y-2">
                                <Label>Attachment (Medical Cert, etc.)</Label>
                                <Input type="file" name="attachment" className="cursor-pointer" />
                                <p className="text-xs text-muted-foreground">Supported: PDF, JPG, PNG</p>
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
        <Button type="submit" disabled={pending} className="gap-2">
            {pending ? "Submitting..." : "Submit Request"}
        </Button>
    );
}
