'use client';

import { useState, useTransition } from "react";
import { assignShift } from "@/app/lib/actions/shifts";
import { Button } from "@/components/ui/button";
import { Loader2, Check, ChevronDown } from "lucide-react";

interface ShiftAssignmentDropdownProps {
    employeeId: string;
    employeeName: string;
    currentShiftId: string | null;
    shifts: { id: string; name: string; startTime: string; endTime: string }[];
    canEdit: boolean;
}

export function ShiftAssignmentDropdown({
    employeeId,
    employeeName,
    currentShiftId,
    shifts,
    canEdit
}: ShiftAssignmentDropdownProps) {
    const [isPending, startTransition] = useTransition();
    const [isOpen, setIsOpen] = useState(false);
    const [message, setMessage] = useState<{ text: string; success: boolean } | null>(null);

    const currentShift = shifts.find(s => s.id === currentShiftId);

    const handleAssign = (shiftId: string | null) => {
        startTransition(async () => {
            const res = await assignShift(employeeId, shiftId);
            setMessage({ text: res.message, success: res.success });
            setIsOpen(false);
            setTimeout(() => setMessage(null), 3000);
        });
    };

    if (!canEdit) {
        return (
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                {currentShift ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-50 text-indigo-700 rounded-lg text-xs font-bold">
                        {currentShift.name}
                        <span className="text-indigo-400">({currentShift.startTime} - {currentShift.endTime})</span>
                    </span>
                ) : (
                    <span className="text-xs text-slate-400 italic">No shift assigned</span>
                )}
            </span>
        );
    }

    if (message) {
        return (
            <span className={`text-xs font-bold px-3 py-1.5 rounded-lg ${message.success ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                {message.text}
            </span>
        );
    }

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors cursor-pointer"
            >
                {isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                ) : currentShift ? (
                    <>
                        <span className="h-2 w-2 rounded-full bg-indigo-500" />
                        {currentShift.name}
                    </>
                ) : (
                    <span className="text-slate-400">Assign Shift</span>
                )}
                <ChevronDown className="h-3 w-3 text-slate-400" />
            </button>

            {isOpen && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
                    <div className="absolute top-full mt-1 right-0 z-50 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl min-w-[220px] py-1 overflow-hidden">
                        <div className="px-3 py-2 text-[10px] font-black text-slate-400 uppercase tracking-wider border-b border-slate-100 dark:border-slate-700">
                            Assign to {employeeName}
                        </div>
                        {shifts.map(s => (
                            <button
                                key={s.id}
                                onClick={() => handleAssign(s.id)}
                                className={`w-full text-left px-3 py-2.5 text-xs font-medium hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors flex items-center justify-between ${
                                    s.id === currentShiftId ? "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700" : "text-slate-700 dark:text-slate-300"
                                }`}
                            >
                                <div>
                                    <div className="font-bold">{s.name}</div>
                                    <div className="text-[10px] text-slate-400 mt-0.5">{s.startTime} – {s.endTime}</div>
                                </div>
                                {s.id === currentShiftId && <Check className="h-3.5 w-3.5 text-indigo-600" />}
                            </button>
                        ))}
                        {currentShiftId && (
                            <button
                                onClick={() => handleAssign(null)}
                                className="w-full text-left px-3 py-2.5 text-xs font-bold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors border-t border-slate-100 dark:border-slate-700"
                            >
                                Remove Shift Assignment
                            </button>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
