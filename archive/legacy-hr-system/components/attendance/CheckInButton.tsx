"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { checkIn, checkOut, getTodayStatus } from "@/app/lib/actions/attendance";
import { toast } from "sonner";
import { Clock, LogOut, LogIn } from "lucide-react";

export function CheckInButton() {
    const [status, setStatus] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    const fetchStatus = async () => {
        setLoading(true);
        const res = await getTodayStatus();
        if (res.success) setStatus(res.data);
        setLoading(false);
    };

    useEffect(() => {
        fetchStatus();
    }, []);

    const handleAction = async () => {
        const isCheckingIn = !status;
        const tid = toast.loading(isCheckingIn ? "Checking in..." : "Checking out...");
        
        const res = isCheckingIn ? await checkIn() : await checkOut();
        
        if (res.success) {
            toast.success(res.message, { id: tid });
            fetchStatus();
        } else {
            toast.error(res.message, { id: tid });
        }
    };

    if (loading) return <Button disabled className="gap-2"><Clock className="h-4 w-4 animate-spin" /> Loading...</Button>;

    if (status && status.checkIn && status.checkOut) {
        return (
            <Button disabled variant="outline" className="gap-2 border-emerald-200 text-emerald-700 bg-emerald-50">
                <Clock className="h-4 w-4" />
                Shift Completed
            </Button>
        );
    }

    return (
        <Button 
            onClick={handleAction}
            className={status ? "bg-amber-500 hover:bg-amber-600 gap-2" : "bg-emerald-600 hover:bg-emerald-700 gap-2"}
        >
            {status ? <LogOut className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
            {status ? "Check Out" : "Check In"}
        </Button>
    );
}
