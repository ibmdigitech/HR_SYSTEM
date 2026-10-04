"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { screenApplication } from "@/app/lib/actions/recruitment";

export function CandidatePipelineActions({
    applicationId,
    status,
}: {
    applicationId?: string;
    status?: string;
}) {
    const router = useRouter();
    const [busy, setBusy] = useState(false);

    if (!applicationId || !status) return null;

    const move = async (to: "SCREENING" | "SHORTLISTED" | "REJECTED") => {
        if (busy) return;
        setBusy(true);
        const formData = new FormData();
        formData.set("applicationId", applicationId);
        formData.set("to", to);
        if (to === "SHORTLISTED") formData.set("recommendation", "SHORTLIST");
        if (to === "REJECTED") formData.set("recommendation", "REJECT");
        const result = await screenApplication(null, formData);
        setBusy(false);
        if (result.success) {
            toast.success(result.message);
            router.refresh();
        } else {
            toast.error(result.message);
        }
    };

    if (status === "APPLIED") {
        return <Button size="sm" disabled={busy} onClick={() => void move("SCREENING")}>Start screening</Button>;
    }
    if (status === "SCREENING") {
        return (
            <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={busy} onClick={() => void move("SHORTLISTED")}>Shortlist</Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void move("REJECTED")}>Reject</Button>
            </div>
        );
    }
    if (["SHORTLISTED", "INTERVIEW", "ASSESSMENT"].includes(status)) {
        return (
            <Button asChild size="sm" variant="outline">
                <Link href={`/recruitment/interviews?applicationId=${encodeURIComponent(applicationId)}`}>
                    Open interview scheduling
                </Link>
            </Button>
        );
    }
    return null;
}
