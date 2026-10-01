"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { routeExitCaseForApproval } from "@/app/lib/actions/exit";
import { Button } from "@/components/ui/button";

export function RouteExitCaseButton({ exitCaseId }: { exitCaseId: string }) {
    const [pending, setPending] = useState(false);
    const router = useRouter();

    async function route() {
        setPending(true);
        try {
            const result = await routeExitCaseForApproval(exitCaseId);
            if (result.success) {
                toast.success(result.message);
                router.refresh();
            } else {
                toast.error(result.message);
            }
        } catch {
            toast.error("Could not route the case. Please try again.");
        } finally {
            setPending(false);
        }
    }

    return <Button size="sm" disabled={pending} onClick={route}>{pending ? "Sending…" : "Send for approval"}</Button>;
}
