"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";import { Check, ExternalLink, Info, CheckCircle, AlertTriangle, Inbox } from "lucide-react";
import { markNotificationRead, markAllRead } from "@/app/lib/actions/notifications";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export default function NotificationsClient({ notifications }: { notifications: any[] }) {
    const router = useRouter();

    const handleRead = async (id: string, link: string | null) => {
        await markNotificationRead(id);
        if (link) {
            router.push(link);
            setTimeout(() => window.location.reload(), 300);
        } else {
            window.location.reload();
        }
    };

    const handleAllRead = async () => {
        const result = await markAllRead();
        if (result.success) {
            toast.success("All notifications marked as read!");
            window.location.reload();
        } else {
            toast.error("Failed to mark notifications read");
        }
    };

    const getIcon = (type: string) => {
        switch (type) {
            case "SUCCESS":
                return <CheckCircle className="h-5 w-5 text-emerald-500" />;
            case "WARNING":
            case "ALERT":
                return <AlertTriangle className="h-5 w-5 text-amber-500" />;
            default:
                return <Info className="h-5 w-5 text-indigo-500" />;
        }
    };

    const unreadCount = notifications.filter(n => !n.isRead).length;

    return (
        <div className="space-y-8 w-full max-w-3xl mx-auto">
            {/* Header Area */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4 bg-gradient-to-br from-slate-900 to-indigo-950 p-5 sm:p-6 md:p-8 rounded-[2rem] shadow-2xl relative overflow-hidden text-white">
                <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3"></div>
                <div className="relative z-10 min-w-0">
                    <h1 className="text-2xl sm:text-3xl font-black tracking-tight mb-2">Notification Center</h1>
                    <p className="text-indigo-200 text-sm font-medium">
                        You have {unreadCount} unread message(s) in your dashboard queue.
                    </p>
                </div>
                {unreadCount > 0 && (
                    <Button
                        onClick={handleAllRead}
                        className="relative z-10 gap-2 w-full sm:w-auto rounded-xl font-bold bg-white text-indigo-950 hover:bg-slate-100 border-0"
                    >
                        <Check className="h-4 w-4" />
                        Mark All Read
                    </Button>
                )}
            </div>

            {/* List */}
            <div className="space-y-4">
                {notifications.map((notif) => (
                    <Card 
                        key={notif.id}
                        onClick={() => handleRead(notif.id, notif.link)}
                        className={`group relative overflow-hidden transition-all duration-300 rounded-2xl cursor-pointer border ${
                            !notif.isRead 
                                ? "bg-indigo-50/40 dark:bg-indigo-950/10 border-indigo-100 dark:border-indigo-900/50 shadow-md"
                                : "bg-white dark:bg-slate-950 border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-900/50 shadow-sm"
                        }`}
                    >
                        <CardContent className="p-4 sm:p-5 flex gap-3 sm:gap-4 items-start">
                            {/* Unread indicator dot */}
                            {!notif.isRead && (
                                <span className="absolute top-3 right-3 h-2.5 w-2.5 rounded-full bg-indigo-600 dark:bg-indigo-400"></span>
                            )}

                            {/* Icon block */}
                            <div className={`p-3 rounded-xl shrink-0 ${
                                !notif.isRead
                                    ? "bg-indigo-100/50 dark:bg-indigo-900/30"
                                    : "bg-slate-50 dark:bg-slate-900"
                            }`}>
                                {getIcon(notif.type)}
                            </div>

                            {/* Text content. `min-w-0` is required here: a flex
                                item defaults to min-width:auto, so a long
                                unbroken title refuses to shrink and pushes the
                                timestamp past the card edge. */}
                            <div className="flex-1 min-w-0 space-y-1">
                                <div className="flex flex-wrap justify-between items-center gap-x-2 gap-y-0.5">
                                    <h3 className={`text-sm tracking-tight break-words ${!notif.isRead ? "font-black text-indigo-950 dark:text-indigo-200" : "font-bold text-slate-800 dark:text-slate-200"}`}>
                                        {notif.title}
                                    </h3>
                                    <span className="shrink-0 text-[10px] text-slate-400 font-bold">
                                        {new Date(notif.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                </div>
                                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 leading-relaxed pr-6">
                                    {notif.message}
                                </p>

                                {/* Deep-link indicator */}
                                {notif.link && (
                                    <div className="inline-flex items-center gap-1 text-[10px] font-black uppercase text-indigo-600 dark:text-indigo-400 pt-1 group-hover:underline">
                                        Go to feature
                                        <ExternalLink className="h-2.5 w-2.5" />
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                ))}

                {notifications.length === 0 && (
                    <div className="p-12 sm:p-24 text-center bg-white dark:bg-slate-950 border border-slate-100 dark:border-slate-800 rounded-3xl">
                        <Inbox className="h-16 w-16 mx-auto mb-6 text-slate-200 dark:text-slate-800" />
                        <h3 className="text-lg font-black text-slate-800 dark:text-white uppercase tracking-tight">Inbox is Empty</h3>
                        <p className="text-slate-400 font-medium max-w-xs mx-auto mt-2">All caught up! You don&#39;t have any notifications at the moment.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
