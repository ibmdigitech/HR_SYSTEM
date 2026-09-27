import { requirePageUser } from "@/lib/auth/page-guard";
// Any authenticated employee may submit a leave request for themselves.

import { ApplyLeavePage } from "./page-client";

export default async function Page() {
    await requirePageUser();
    return <ApplyLeavePage />;
}