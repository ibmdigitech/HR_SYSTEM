"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
    CheckCircle2,
    FileText,
    PlaneTakeoff,
    ShieldCheck,
    ShieldX,
    Ticket,
    TriangleAlert,
    Upload,
    X,
} from "lucide-react";
import { fileBusinessTravelDocument, setBusinessTravelDocumentVerification } from "@/app/lib/actions/travel";
import { Button } from "@/components/ui/button";

/**
 * Mirrors TRAVEL_DOCUMENT_MIME_TYPES and MAX_TRAVEL_DOCUMENT_BYTES in
 * lib/workflow/business-travel.ts. The copy exists because that module imports
 * the Prisma client and cannot be pulled into a browser bundle; the server
 * re-checks both, so this copy only saves the operator a round trip.
 */
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/jpg", "application/pdf"];
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = "image/png,image/jpeg,image/jpg,application/pdf,.png,.jpg,.jpeg,.pdf";

const KINDS = [
    {
        kind: "TICKET",
        label: "Air ticket",
        Icon: Ticket,
        hint: "Proof of booking. Expected once the trip is approved.",
        referenceLabel: "Booking reference / PNR",
    },
    {
        kind: "BOARDING_PASS",
        label: "Boarding pass",
        Icon: PlaneTakeoff,
        hint: "Proof the traveller flew. Required before this trip can be completed.",
        referenceLabel: "Flight or seat reference",
    },
] as const;

export type TravelDocumentView = {
    id: string;
    kind: string;
    fileName: string;
    fileType: string;
    fileBytes: number | null;
    reference: string | null;
    uploadedBy: string;
    uploadedAt: Date;
    /** Who checked the scan, or null until an approver has. */
    verifiedBy: string | null;
    verifiedAt: Date | null;
};

type Draft = { file: File; preview: string };

const stamp = (value: Date | string): string =>
    new Date(value).toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });

const size = (bytes: number | null): string =>
    bytes === null ? "" : bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * Ticket and boarding-pass upload for one travel request.
 *
 * The interaction is the same drag/drop-or-browse-then-preview surface the
 * employee document uploader uses, so neither upload feels like a different
 * system: indigo panel, hidden file input behind a button, a preview of what was
 * chosen, and a Replace control once something is on file.
 *
 * UPLOADING AND VERIFYING ARE DIFFERENT ACTS. Who sent the file is not who
 * checked it, so each filed document carries its own verdict: the approver's
 * name and the time, or a clear "not verified". Re-uploading clears that verdict
 * server-side, because a replacement document is a new claim, and the card says
 * so as soon as a file is on file.
 *
 * `canUpload` and `canVerify` only decide what is drawn. Every rule — whose
 * request this may be, whether the trip is approved yet, the size, the type, the
 * permission — is re-checked server-side, so hiding the control buys nothing.
 */
export function TravelDocumentUpload({
    requestId,
    status,
    documents,
    canUpload,
    canVerify,
}: {
    requestId: string;
    status: string;
    documents: TravelDocumentView[];
    canUpload: boolean;
    /** Approver's call: mark a scan verified, or withdraw that verification. */
    canVerify: boolean;
}) {
    const [drafts, setDrafts] = useState<Record<string, Draft | undefined>>({});
    const [references, setReferences] = useState<Record<string, string>>({});
    const [busyKind, setBusyKind] = useState<string | null>(null);
    const [reviewingKind, setReviewingKind] = useState<string | null>(null);
    const [draggingKind, setDraggingKind] = useState<string | null>(null);
    const inputs = useRef<Record<string, HTMLInputElement | null>>({});
    const router = useRouter();

    const openable = status === "APPROVED" || status === "COMPLETED";

    function pick(kind: string, file: File | undefined) {
        if (!file) return;
        if (!ALLOWED_TYPES.includes(file.type.toLowerCase())) {
            toast.error("Choose a PNG, JPEG or PDF file.");
            return;
        }
        if (file.size > MAX_BYTES) {
            toast.error("That file is larger than 10 MB.");
            return;
        }
        const reader = new FileReader();
        // A PDF is not previewable inline, so the chip shows the name instead and
        // the preview is only built for images.
        reader.onload = (event) => {
            const result = event.target?.result;
            setDrafts((current) => ({
                ...current,
                [kind]: {
                    file,
                    preview:
                        file.type === "application/pdf" || typeof result !== "string"
                            ? ""
                            : result,
                },
            }));
        };
        reader.readAsDataURL(file);
    }

    async function save(kind: string, file: File) {
        setBusyKind(kind);
        try {
            const formData = new FormData();
            formData.append("requestId", requestId);
            formData.append("kind", kind);
            formData.append("file", file);
            const reference = references[kind]?.trim();
            if (reference) formData.append("reference", reference);

            const result = await fileBusinessTravelDocument(formData);
            if (result.success) {
                toast.success(result.message);
                setDrafts((current) => ({ ...current, [kind]: undefined }));
                setReferences((current) => ({ ...current, [kind]: "" }));
                router.refresh();
            } else {
                toast.error(result.message, { duration: 7000 });
            }
        } catch {
            toast.error("Could not upload the document. Please try again.");
        } finally {
            setBusyKind(null);
        }
    }

    async function review(kind: string, verified: boolean) {
        setReviewingKind(kind);
        try {
            const result = await setBusinessTravelDocumentVerification(requestId, kind, verified);
            if (result.success) toast.success(result.message);
            else toast.error(result.message, { duration: 7000 });
            router.refresh();
        } catch {
            toast.error("Could not record the verification. Please try again.");
        } finally {
            setReviewingKind(null);
        }
    }

    return (
        <div className="mt-2 space-y-2">
            {KINDS.map(({ kind, label, Icon, hint, referenceLabel }) => {
                const filed = documents.find((doc) => doc.kind === kind) ?? null;
                const draft = drafts[kind];
                const busy = busyKind === kind;
                const reviewing = reviewingKind === kind;

                return (
                    <div
                        key={kind}
                        onDragOver={(event) => {
                            if (!canUpload || !openable) return;
                            event.preventDefault();
                            setDraggingKind(kind);
                        }}
                        onDragLeave={() => setDraggingKind((current) => (current === kind ? null : current))}
                        onDrop={(event) => {
                            if (!canUpload || !openable) return;
                            event.preventDefault();
                            setDraggingKind(null);
                            pick(kind, event.dataTransfer.files?.[0]);
                        }}
                        className={`rounded-xl border p-3 transition-colors ${
                            draggingKind === kind
                                ? "border-indigo-400 bg-indigo-50 dark:border-indigo-700 dark:bg-indigo-950/40"
                                : "border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/40"
                        }`}
                    >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-600 dark:text-slate-300">
                                <Icon className="h-3.5 w-3.5 text-indigo-500" aria-hidden="true" />
                                {label}
                            </p>
                            {filed && (
                                <a
                                    href={`/api/travel/documents/${filed.id}/file`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
                                >
                                    <FileText className="h-3 w-3" aria-hidden="true" />
                                    Open
                                </a>
                            )}
                        </div>
                        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{hint}</p>

                        {filed ? (
                            <div className="mt-2 space-y-2 rounded-lg border border-emerald-200 bg-white p-2.5 dark:border-emerald-800 dark:bg-slate-900">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex min-w-0 items-center gap-2">
                                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
                                        <div className="min-w-0">
                                            <p className="truncate text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                                                {filed.fileName}
                                                {filed.reference ? ` · ${filed.reference}` : ""}
                                            </p>
                                            <p className="truncate text-[10px] text-slate-500">
                                                {filed.uploadedBy} · {stamp(filed.uploadedAt)}
                                                {filed.fileBytes ? ` · ${size(filed.fileBytes)}` : ""}
                                            </p>
                                        </div>
                                    </div>
                                    {canUpload && openable && (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="h-6 px-2 text-[10px] font-bold text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
                                            onClick={() => inputs.current[kind]?.click()}
                                        >
                                            <Upload className="h-3 w-3" aria-hidden="true" />
                                            Replace
                                        </Button>
                                    )}
                                </div>

                                {/* The verdict, separate from the uploader: this is who
                                    CHECKED the file, and it is what gates approval. */}
                                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-2 dark:border-slate-800">
                                    {filed.verifiedAt ? (
                                        <p className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                                            <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                                            Verified by {filed.verifiedBy} · {stamp(filed.verifiedAt)}
                                        </p>
                                    ) : (
                                        <p className="flex items-center gap-1.5 text-[10px] font-bold text-amber-700 dark:text-amber-400">
                                            <TriangleAlert className="h-3 w-3" aria-hidden="true" />
                                            Not verified — this trip cannot be approved until it is
                                        </p>
                                    )}
                                    {canVerify && (
                                        <div className="flex items-center gap-1">
                                            {filed.verifiedAt ? (
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    disabled={reviewing}
                                                    className="h-6 px-2 text-[10px] font-bold text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                                                    onClick={() => review(kind, false)}
                                                    title="Withdraws your verification. The file stays on the request and the audit trail keeps both."
                                                >
                                                    <ShieldX className="h-3 w-3" aria-hidden="true" />
                                                    {reviewing ? "Saving…" : "Reject"}
                                                </Button>
                                            ) : (
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    disabled={reviewing}
                                                    className="h-6 px-2 text-[10px] font-bold"
                                                    onClick={() => review(kind, true)}
                                                    title="Records that you opened the file and checked it against the booking."
                                                >
                                                    <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                                                    {reviewing ? "Saving…" : "Verify"}
                                                </Button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : !openable ? (
                            <p className="mt-2 rounded-lg border border-dashed p-2 text-[11px] text-slate-500">
                                {status === "REJECTED" || status === "CANCELLED"
                                    ? "This trip was closed, so nothing is filed against it."
                                    : "Available once the request is approved."}
                            </p>
                        ) : !canUpload ? null : (
                            <p className="mt-2 rounded-lg border border-dashed border-indigo-200 bg-indigo-50/50 p-2 text-[11px] text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/20 dark:text-indigo-300">
                                Drag a file here, or
                                <button
                                    type="button"
                                    className="mx-1 font-bold underline"
                                    onClick={() => inputs.current[kind]?.click()}
                                >
                                    choose one
                                </button>
                                — PNG, JPEG or PDF, up to 10 MB.
                            </p>
                        )}

                        {canUpload && openable && (
                            <>
                                <input
                                    ref={(element) => {
                                        inputs.current[kind] = element;
                                    }}
                                    id={`travel-doc-${requestId}-${kind}`}
                                    type="file"
                                    className="sr-only"
                                    accept={ACCEPT}
                                    onChange={(event) => {
                                        pick(kind, event.target.files?.[0]);
                                        event.target.value = "";
                                    }}
                                />
                                {draft && (
                                    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-indigo-200 bg-white p-2.5 dark:border-indigo-900 dark:bg-slate-900">
                                        {draft.preview ? (
                                            // A local data: URL for a file the operator just chose. It
                                            // never leaves the browser, so next/image has nothing to
                                            // optimise and a plain element is the honest choice.
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img
                                                src={draft.preview}
                                                alt="Selected document preview"
                                                className="h-12 w-16 rounded-md object-cover ring-1 ring-slate-200 dark:ring-slate-700"
                                            />
                                        ) : (
                                            <span className="flex h-12 w-16 items-center justify-center rounded-md bg-rose-50 text-rose-500 ring-1 ring-rose-100 dark:bg-rose-950/30 dark:ring-rose-900">
                                                <FileText className="h-5 w-5" aria-hidden="true" />
                                            </span>
                                        )}
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-[11px] font-semibold">{draft.file.name}</p>
                                            <p className="text-[10px] text-slate-500">{size(draft.file.size)}</p>
                                        </div>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            disabled={busy}
                                            className="h-6 px-2 text-[10px] font-bold text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
                                            onClick={() => save(kind, draft.file)}
                                        >
                                            <Upload className="h-3 w-3" aria-hidden="true" />
                                            {busy ? "Uploading…" : filed ? "Replace" : "Upload"}
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            disabled={busy}
                                            className="h-6 px-2 text-[10px] text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                                            onClick={() => setDrafts((current) => ({ ...current, [kind]: undefined }))}
                                        >
                                            <X className="h-3 w-3" aria-hidden="true" />
                                        </Button>
                                    </div>
                                )}
                                <div className="mt-2">
                                    <label
                                        htmlFor={`travel-doc-ref-${requestId}-${kind}`}
                                        className="mb-1 block text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500"
                                    >
                                        {referenceLabel} (optional)
                                    </label>
                                    <input
                                        id={`travel-doc-ref-${requestId}-${kind}`}
                                        type="text"
                                        maxLength={100}
                                        defaultValue={filed?.reference ?? references[kind] ?? ""}
                                        onChange={(event) =>
                                            setReferences((current) => ({ ...current, [kind]: event.target.value }))
                                        }
                                        className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs sm:max-w-[16rem] dark:border-slate-800 dark:bg-slate-900"
                                    />
                                </div>
                            </>
                        )}
                    </div>
                );
            })}
        </div>
    );
}