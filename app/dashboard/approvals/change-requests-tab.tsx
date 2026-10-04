"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { approveChangeRequest, rejectChangeRequest } from "@/app/lib/actions/change-requests";
import { toast } from "sonner";
import { CheckCircle2, XCircle, FileText, Clock, User, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

const SENSITIVE_FIELD_LABELS: Record<string, string> = {
  passportNumber: "Passport Number",
  passportExpiry: "Passport Expiry",
  emiratesId: "Emirates ID",
  emiratesIdExpiry: "Emirates ID Expiry",
  visaNumber: "Visa Number",
  visaExpiry: "Visa Expiry",
  visaType: "Visa Type",
  address: "Current Address",
  permanentAddress: "Permanent Address",
  governmentId: "Government ID",
  medicalInsuranceExpiry: "Medical Insurance Expiry",
  iloeInsuranceExpiry: "ILOE Insurance Expiry",
};

const DOC_TYPE_LABELS: Record<string, string> = {
  PASSPORT: "Passport",
  EMIRATES_ID: "Emirates ID",
  VISA: "Visa",
  ADDRESS_PROOF: "Address Proof",
  MEDICAL_INSURANCE: "Medical Insurance",
  GOVERNMENT_ID: "Government ID",
};

interface ChangeRequestRow {
  id: string;
  status: string;
  requestedBy: string;
  approvedBy: string | null;
  approvedAt: Date | null;
  rejectionReason: string | null;
  createdAt: Date;
  changes: Record<string, any>;
  employee: { id: string; firstName: string; lastName: string; employeeCode: string | null };
  documents: { id: string; documentType: string; documentUrl: string }[];
}

interface ChangeRequestsTabProps {
  requests: ChangeRequestRow[];
}

export function ChangeRequestsTab({ requests }: ChangeRequestsTabProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [localRequests, setLocalRequests] = useState(requests);

  const pending = localRequests.filter((r) => r.status === "PENDING");
  const resolved = localRequests.filter((r) => r.status !== "PENDING");

  async function handleApprove(id: string) {
    setBusy(id);
    try {
      const result = await approveChangeRequest(id);
      if (result.success) {
        toast.success(result.message ?? "Change request approved. Employee record updated.");
        setLocalRequests((prev) =>
          prev.map((r) => r.id === id ? { ...r, status: "APPROVED" } : r)
        );
      } else {
        toast.error(result.message ?? "Could not approve.");
      }
    } catch {
      toast.error("An unexpected error occurred.");
    } finally {
      setBusy(null);
    }
  }

  async function handleReject(id: string) {
    if (!rejectReason.trim()) {
      toast.error("Please enter a rejection reason.");
      return;
    }
    setBusy(id);
    try {
      const result = await rejectChangeRequest(id, rejectReason);
      if (result.success) {
        toast.success("Change request rejected.");
        setLocalRequests((prev) =>
          prev.map((r) => r.id === id ? { ...r, status: "REJECTED", rejectionReason: rejectReason } : r)
        );
        setRejecting(null);
        setRejectReason("");
      } else {
        toast.error(result.message ?? "Could not reject.");
      }
    } catch {
      toast.error("An unexpected error occurred.");
    } finally {
      setBusy(null);
    }
  }

  if (localRequests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800">
          <CheckCircle2 className="h-8 w-8 text-emerald-500" />
        </div>
        <h3 className="text-base font-black uppercase tracking-tight text-slate-900 dark:text-white">
          All clear
        </h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          No employee data change requests pending review.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {pending.length > 0 && (
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-amber-600 dark:text-amber-400">
            <Clock className="h-3.5 w-3.5" /> Awaiting Approval ({pending.length})
          </p>
          {pending.map((req) => (
            <ChangeRequestCard
              key={req.id}
              req={req}
              busy={busy}
              rejecting={rejecting}
              rejectReason={rejectReason}
              setRejecting={setRejecting}
              setRejectReason={setRejectReason}
              onApprove={handleApprove}
              onReject={handleReject}
            />
          ))}
        </div>
      )}

      {resolved.length > 0 && (
        <div className="space-y-3">
          <p className="mt-6 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
            <CheckCircle2 className="h-3.5 w-3.5" /> Resolved ({resolved.length})
          </p>
          {resolved.map((req) => (
            <ChangeRequestCard
              key={req.id}
              req={req}
              busy={busy}
              rejecting={rejecting}
              rejectReason={rejectReason}
              setRejecting={setRejecting}
              setRejectReason={setRejectReason}
              onApprove={handleApprove}
              onReject={handleReject}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ChangeRequestCard({
  req,
  busy,
  rejecting,
  rejectReason,
  setRejecting,
  setRejectReason,
  onApprove,
  onReject,
}: {
  req: ChangeRequestRow;
  busy: string | null;
  rejecting: string | null;
  rejectReason: string;
  setRejecting: (id: string | null) => void;
  setRejectReason: (v: string) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const isPending = req.status === "PENDING";
  const isApproved = req.status === "APPROVED";
  const changes = req.changes as Record<string, any>;

  return (
    <div
      className={cn(
        "rounded-2xl border p-5 transition-all duration-200",
        isPending
          ? "border-amber-200 bg-amber-50/50 dark:border-amber-800/60 dark:bg-amber-950/20"
          : isApproved
          ? "border-emerald-200 bg-emerald-50/30 dark:border-emerald-800/60 dark:bg-emerald-950/10"
          : "border-rose-200 bg-rose-50/30 dark:border-rose-800/60 dark:bg-rose-950/10"
      )}
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-black text-sm",
            isPending ? "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
            : isApproved ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"
            : "bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300"
          )}>
            <User className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-black text-slate-900 dark:text-white">
              {req.employee.firstName} {req.employee.lastName}
            </p>
            <p className="text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400">
              {req.employee.employeeCode} · Requested by {req.requestedBy}
            </p>
          </div>
        </div>
        <Badge
          className={cn(
            "rounded-lg px-3 py-1 text-[10px] font-black uppercase tracking-widest border-0",
            isPending ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
            : isApproved ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
            : "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
          )}
        >
          {req.status}
        </Badge>
      </div>

      {/* Proposed Changes */}
      {/* The border was `border-white/60` on a `bg-white/60` panel sitting inside
          an already-pale tinted card (amber-50/50). White on near-white: the
          panel had no visible edge, so it read as loose text rather than a
          grouped block. A slate border gives it a defined edge in light mode
          while the dark pair keeps the nested-surface feel. */}
      <div className="mb-4 rounded-xl border border-slate-200 bg-white/80 p-3 dark:border-slate-700/70 dark:bg-slate-900/50">
        <p className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
          Proposed Changes
        </p>
        <dl className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {Object.entries(changes).map(([field, value]) => (
            <div key={field} className="flex flex-col">
              <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {SENSITIVE_FIELD_LABELS[field] ?? field}
              </dt>
              <dd className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">
                {value instanceof Date
                  ? new Date(value).toLocaleDateString("en-GB")
                  : String(value ?? "—")}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Supporting Documents */}
      {req.documents.length > 0 && (
        <div className="mb-4">
          <p className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
            Supporting Documents
          </p>
          <div className="flex flex-wrap gap-2">
            {req.documents.map((doc) => (
              <a
                key={doc.id}
                href={doc.documentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-lg bg-indigo-50 px-3 py-1.5 text-[11px] font-bold text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-950/70 transition-colors"
              >
                <FileText className="h-3.5 w-3.5" />
                {DOC_TYPE_LABELS[doc.documentType] ?? doc.documentType}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Rejection reason display */}
      {req.status === "REJECTED" && req.rejectionReason && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 dark:border-rose-800/50 dark:bg-rose-950/20">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />
          <p className="text-xs font-semibold text-rose-700 dark:text-rose-300">{req.rejectionReason}</p>
        </div>
      )}

      {/* Actions */}
      {isPending && (
        <div className="space-y-3">
          {rejecting === req.id ? (
            <div className="space-y-2">
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Enter rejection reason (required)..."
                rows={3}
                className="w-full rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-rose-400 dark:border-rose-800/50 dark:bg-slate-900 dark:text-slate-200"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={busy === req.id}
                  onClick={() => onReject(req.id)}
                  className="h-9 rounded-xl bg-rose-600 hover:bg-rose-700 text-[10px] font-black uppercase tracking-widest"
                >
                  {busy === req.id ? "Rejecting…" : "Confirm Reject"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => { setRejecting(null); setRejectReason(""); }}
                  className="h-9 rounded-xl text-[10px] font-black uppercase tracking-widest"
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={busy === req.id}
                onClick={() => onApprove(req.id)}
                className="h-9 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-[10px] font-black uppercase tracking-widest gap-1.5"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                {busy === req.id ? "Approving…" : "Approve & Apply"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy === req.id}
                onClick={() => setRejecting(req.id)}
                className="h-9 rounded-xl border-rose-200 text-rose-600 hover:bg-rose-50 text-[10px] font-black uppercase tracking-widest gap-1.5 dark:border-rose-800 dark:text-rose-400 dark:hover:bg-rose-950/30"
              >
                <XCircle className="h-3.5 w-3.5" />
                Reject
              </Button>
            </div>
          )}
        </div>
      )}

      <p className="mt-3 text-[10px] text-slate-400">
        Submitted {new Date(req.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
        {req.approvedAt && ` · Resolved ${new Date(req.approvedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`}
      </p>
    </div>
  );
}
