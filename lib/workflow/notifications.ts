/**
 * Notification delivery (P1.8).
 *
 * CORE RULE: a notification failure must NEVER roll back the business
 * transaction that produced it. The business operation commits first; delivery
 * is then attempted and its outcome recorded separately in
 * `NotificationDelivery`.
 *
 *   Leave approved
 *     └─ business transaction COMMITS
 *          └─ queueDelivery() attempted
 *               ├─ SENT
 *               └─ FAILED  (business result is unchanged)
 *
 * The existing `Notification` model is untouched and remains the in-app record.
 * Delivery rows are additive and reference the notification by id where one
 * exists.
 *
 * CHANNELS: only channels that are actually configured are enabled. No email
 * provider is bundled; until one is configured, EMAIL attempts are recorded as
 * SKIPPED rather than failing loudly, so nothing pretends to have been sent.
 */

import prisma from "@/lib/prisma";

export type Channel = "IN_APP" | "EMAIL" | "SMS";
export type DeliveryStatus = "PENDING" | "SENT" | "FAILED" | "RETRYING" | "SKIPPED";

export interface QueueDeliveryInput {
    channel: Channel;
    recipient: string;
    templateKey?: string;
    subject?: string;
    body?: string;
    /** Set when the in-app Notification row already exists. */
    notificationId?: string;
    metadata?: Record<string, unknown>;
}

export interface DeliveryResult {
    queued: boolean;
    status: DeliveryStatus;
    reason: string;
    deliveryId?: string;
}

/** Which channels are usable right now. */
export function enabledChannels(): Channel[] {
    const channels: Channel[] = ["IN_APP"];
    // No provider is configured, so EMAIL and SMS are not offered. They are
    // reported as unavailable rather than silently "succeeding".
    if (process.env.RESEND_API_KEY || process.env.SENDGRID_API_KEY || process.env.SMTP_HOST) {
        channels.push("EMAIL");
    }
    if (process.env.TWILIO_ACCOUNT_SID || process.env.SMS_PROVIDER) {
        channels.push("SMS");
    }
    return channels;
}

/**
 * Records the intent to deliver, then attempts it.
 *
 * Never throws. A caller inside a business transaction can call this without
 * risk of aborting that transaction.
 */
export async function queueDelivery(input: QueueDeliveryInput): Promise<DeliveryResult> {
    const available = enabledChannels();

    if (!available.includes(input.channel)) {
        // Recorded as SKIPPED with a reason, so it is visible that nothing was
        // sent — rather than an absent row that looks like an oversight.
        try {
            const row = await prisma.notificationDelivery.create({
                data: {
                    notificationId: input.notificationId ?? null,
                    channel: input.channel,
                    recipient: input.recipient,
                    templateKey: input.templateKey ?? null,
                    status: "SKIPPED",
                    lastError: `Channel ${input.channel} is not configured`,
                    externalId: JSON.stringify(input.metadata ?? {}).slice(0, 500),
                },
                select: { id: true },
            });
            return {
                queued: false,
                status: "SKIPPED",
                reason: `Channel ${input.channel} is not configured`,
                deliveryId: row.id,
            };
        } catch {
            return { queued: false, status: "SKIPPED", reason: "Channel not configured" };
        }
    }

    try {
        const row = await prisma.notificationDelivery.create({
            data: {
                notificationId: input.notificationId ?? null,
                channel: input.channel,
                recipient: input.recipient,
                templateKey: input.templateKey ?? null,
                status: "PENDING",
                attempts: 0,
            },
            select: { id: true },
        });

        if (input.channel === "IN_APP") {
            await prisma.notificationDelivery.update({
                where: { id: row.id },
                data: { status: "SENT", sentAt: new Date(), attempts: 1 },
            });
            return { queued: true, status: "SENT", reason: "In-app", deliveryId: row.id };
        }

        // EMAIL / SMS would go through a provider here. With none configured,
        // the row stays PENDING for a worker to pick up rather than being
        // marked sent.
        return { queued: true, status: "PENDING", reason: "Queued for delivery", deliveryId: row.id };
    } catch (error) {
        console.error("[NOTIFICATION_QUEUE_FAILED]", error);
        return {
            queued: false,
            status: "FAILED",
            reason: "Could not record delivery",
        };
    }
}

/**
 * In-app notification plus an optional out-of-band delivery.
 *
 * Use inside a business transaction when the in-app row must be atomic with
 * the business change. The external channel is queued AFTER, and cannot fail
 * the transaction.
 */
export async function notifyInApp(params: {
    employeeId: string;
    title: string;
    message: string;
    type?: string;
    link?: string;
    /** Optional recipient address for a future email/SMS channel. */
    deliverTo?: string | null;
    templateKey?: string;
    /** Pass the transaction client to make the in-app row atomic. */
    tx?: PrismaTransactionLike;
}): Promise<void> {
    const client = params.tx ?? prisma;
    try {
        const notification = await client.notification.create({
            data: {
                employeeId: params.employeeId,
                title: params.title,
                message: params.message,
                type: params.type ?? "INFO",
                link: params.link ?? null,
            },
            select: { id: true },
        });

        // Outside the transaction on purpose: delivery must not be able to
        // abort the business change that already succeeded.
        if (params.deliverTo) {
            await queueDelivery({
                channel: "EMAIL",
                recipient: params.deliverTo,
                templateKey: params.templateKey,
                notificationId: notification.id,
            });
        }
    } catch (error) {
        // Never propagate. A missing notification is a defect, not a reason to
        // fail the business operation.
        console.error("[NOTIFY_IN_APP_FAILED]", error);
    }
}

type PrismaTransactionLike = Pick<typeof prisma, "notification">;

/** Delivery health, for the operations view. */
export async function deliverySummary(): Promise<{
    byStatus: Record<string, number>;
    pendingOlderThan1h: number;
}> {
    const grouped = await prisma.notificationDelivery.groupBy({
        by: ["status"],
        _count: { _all: true },
    });

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const stale = await prisma.notificationDelivery.count({
        where: { status: { in: ["PENDING", "RETRYING"] }, updatedAt: { lt: oneHourAgo } },
    });

    const byStatus: Record<string, number> = {};
    for (const row of grouped) byStatus[row.status] = row._count._all;

    return { byStatus, pendingOlderThan1h: stale };
}

/** Re-queues failed deliveries that are still within their attempt budget. */
export async function retryFailedDeliveries(limit = 50): Promise<{ requeued: number }> {
    const due = await prisma.notificationDelivery.findMany({
        where: {
            status: { in: ["FAILED", "RETRYING"] },
            attempts: { lt: 3 },
            OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
        },
        orderBy: { createdAt: "asc" },
        take: limit,
        select: { id: true, channel: true },
    });

    let requeued = 0;
    for (const row of due) {
        const available = enabledChannels();
        await prisma.notificationDelivery.update({
            where: { id: row.id },
            data: available.includes(row.channel as Channel)
                ? { status: "RETRYING", nextRetryAt: null, lastError: null }
                : { status: "SKIPPED", lastError: "Channel not configured" },
        });
        requeued++;
    }
    return { requeued };
}
