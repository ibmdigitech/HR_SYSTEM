"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { submitLeaveRequest } from "@/app/lib/actions/leave";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarIcon, Send, Clock, Sparkles, FileText, CheckCircle2 } from "lucide-react";

const initialState = {
    message: "",
    success: false,
};

export default function ApplyLeavePage() {
    const [state, formAction] = useActionState(submitLeaveRequest, initialState);

    return (
        <div className="min-h-[80vh] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-50 via-white to-purple-50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800 -z-10" />
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-indigo-500/10 dark:bg-indigo-500/20 blur-[100px] rounded-full -z-10 pointer-events-none" />
            
            <div className="w-full max-w-2xl">
                <div className="mb-8 text-center space-y-2">
                    <div className="inline-flex items-center justify-center p-3 bg-indigo-100 dark:bg-indigo-900/50 rounded-2xl mb-2 shadow-inner">
                        <Sparkles className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <h1 className="text-4xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                        Request Time Off
                    </h1>
                    <p className="text-slate-500 dark:text-slate-400 text-lg">
                        Submit your leave application for manager and HR approval
                    </p>
                </div>

                {state.success ? (
                    <Card className="border-0 shadow-2xl bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl ring-1 ring-slate-200 dark:ring-slate-800 overflow-hidden relative">
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-400 to-teal-500" />
                        <CardContent className="pt-12 pb-12 flex flex-col items-center text-center space-y-4">
                            <div className="w-20 h-20 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center mb-2">
                                <CheckCircle2 className="w-10 h-10 text-emerald-600 dark:text-emerald-400" />
                            </div>
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Application Submitted!</h2>
                            <p className="text-slate-500 dark:text-slate-400 max-w-md">
                                Your leave request has been successfully routed to your manager for the first level of approval.
                            </p>
                            <div className="pt-6">
                                <Button variant="outline" className="rounded-full px-8" onClick={() => window.location.href = '/leaves'}>
                                    View My Leaves
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                ) : (
                    <Card className="border-0 shadow-2xl bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl ring-1 ring-slate-200 dark:ring-slate-800 overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 to-purple-500" />
                        <form action={formAction}>
                            <CardHeader className="px-8 pt-8 pb-4">
                                <CardTitle className="flex items-center gap-2 text-xl">
                                    <FileText className="w-5 h-5 text-indigo-500" />
                                    Leave Details
                                </CardTitle>
                                <CardDescription className="text-base">
                                    Please provide accurate dates and a valid reason for your absence.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="px-8 space-y-6">
                                <div className="space-y-3">
                                    <Label htmlFor="type" className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                                        Leave Type
                                    </Label>
                                    <Select name="type" required>
                                        <SelectTrigger className="h-12 bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 focus:ring-indigo-500 rounded-xl transition-all shadow-sm">
                                            <SelectValue placeholder="Select type of leave" />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-xl border-slate-200 dark:border-slate-800 shadow-xl">
                                            <SelectItem value="SICK" className="py-3 cursor-pointer">🤒 Sick Leave</SelectItem>
                                            <SelectItem value="CASUAL" className="py-3 cursor-pointer">☕ Casual Leave</SelectItem>
                                            <SelectItem value="ANNUAL" className="py-3 cursor-pointer">✈️ Annual Leave</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="space-y-3">
                                        <Label className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                                            Start Date
                                        </Label>
                                        <div className="relative">
                                            <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" />
                                            <Input 
                                                type="date" 
                                                name="startDate" 
                                                required 
                                                className="h-12 pl-10 bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 focus:ring-indigo-500 rounded-xl shadow-sm"
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-3">
                                        <Label className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                                            End Date
                                        </Label>
                                        <div className="relative">
                                            <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" />
                                            <Input 
                                                type="date" 
                                                name="endDate" 
                                                required 
                                                className="h-12 pl-10 bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 focus:ring-indigo-500 rounded-xl shadow-sm"
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <Label className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                                        Reason for Leave
                                    </Label>
                                    <Textarea 
                                        name="reason" 
                                        placeholder="Please explain briefly..." 
                                        required 
                                        className="min-h-[120px] resize-none bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 focus:ring-indigo-500 rounded-xl shadow-sm p-4"
                                    />
                                </div>

                                <div className="space-y-3 p-5 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-100 dark:border-slate-800">
                                    <Label className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                                        Supporting Document (Optional)
                                    </Label>
                                    <Input 
                                        type="file" 
                                        name="attachment" 
                                        className="cursor-pointer file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 dark:file:bg-indigo-900/30 dark:file:text-indigo-400 bg-transparent border-0 shadow-none p-0 h-auto" 
                                    />
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 flex items-center gap-1">
                                        <Clock className="w-3 h-3" />
                                        Required for Sick Leaves exceeding 2 days (PDF, JPG, PNG)
                                    </p>
                                </div>

                                {state.message && (
                                    <div className="p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-xl text-sm border border-red-100 dark:border-red-900/30">
                                        {state.message}
                                    </div>
                                )}
                            </CardContent>
                            <CardFooter className="px-8 pb-8 pt-2">
                                <SubmitButton />
                            </CardFooter>
                        </form>
                    </Card>
                )}
            </div>
        </div>
    );
}

function SubmitButton() {
    const { pending } = useFormStatus();
    return (
        <Button 
            type="submit" 
            disabled={pending} 
            className="w-full h-12 text-base font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-200 dark:shadow-none transition-all group"
        >
            {pending ? (
                <span className="flex items-center gap-2">
                    <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Processing Request...
                </span>
            ) : (
                <span className="flex items-center gap-2">
                    Submit Application
                    <Send className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </span>
            )}
        </Button>
    );
}
