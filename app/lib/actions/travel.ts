"use server";

/**
 * Business travel and air ticket entitlement — server actions.
 *
 * A `"use server"` file may only export async functions, so these are thin
 * adapters over `lib/workflow/business-travel.ts` rather than re-exports. This
 * layer owns exactly three things:
 *
 *  1. INPUT VALIDATION at the trust boundary. Everything here arrives from the
 *     browser, so a hidden `<input>` is an attacker-controlled value and is
 *     treated as one. The employee id in particular is NEVER trusted to mean
 *     "me": `requestBusinessTravel` refuses a request for another employee
 *     unless the server-side session holds `travel.request.any`.
 *  2. CACHE INVALIDATION, because a completed request changes the entitlement
 *     counter the register renders.
 *  3. THE `{ success, message }` SHAPE the existing actions return.
 *
 * `fileBusinessTravelDocument` additionally reads the uploaded bytes and hands
 * the workflow a `data:` URL, so the workflow has one input format whether it is
 * driven from here or from a verification script.
 *
 * The session check itself is not here: the workflow module calls
 * `requireSubject()` and resolves permissions against the role re-read from the
 * database, so a forged role in the browser cannot reach any of these functions.
 */

import { revalidatePath } from "next/cache";
import {
    requestTravel,
    advanceTravelRequest,
    grantTravelAmount,
    verifyTravelDocument,
    setEntitlement,
    uploadTravelDocument,
    AIR_TICKET_TRAVEL_CLASSES,
    TRAVEL_REQUEST_DECISIONS,
    TRAVEL_DOCUMENT_KINDS,
    TRAVEL_DOCUMENT_MIME_TYPES,
    MAX_TRAVEL_DOCUMENT_BYTES,
    type TravelActionResult,
} from "@/lib/workflow/business-travel";

/** Parses a numeric form field, refusing NaN rather than coercing it to 0. */
function parseNumber(raw: FormDataEntryValue | null): number | undefined {
    if (raw === null) return undefined;
    const text = String(raw).trim();
    if (!text) return undefined;
    const value = Number(text);
    return Number.isFinite(value) ? value : NaN;
}

/** Reads a text field, trimmed, so a whitespace-only value is "absent". */
function text(raw: FormDataEntryValue | null): string | undefined {
    if (raw === null) return undefined;
    const value = String(raw).trim();
    return value.length > 0 ? value : undefined;
}

function revalidateTravelViews(): void {
    revalidatePath("/travel");
    revalidatePath("/employees");
    revalidatePath("/visa");
    revalidatePath("/dashboard/approvals");
}

/**
 * Raises a business travel request from the request form.
 *
 * `employeeId` is read from the form so HR can file on someone's behalf, and is
 * then checked against the session: an employee may only ever submit their own.
 */
export async function requestBusinessTravel(formData: FormData): Promise<TravelActionResult> {
    const estimatedCost = parseNumber(formData.get("estimatedCost"));
    if (estimatedCost !== undefined && Number.isNaN(estimatedCost)) {
        return { success: false, message: "Estimated cost must be a number." };
    }

    return requestTravel({
        employeeId: String(formData.get("employeeId") ?? ""),
        purpose: text(formData.get("purpose")) ?? "",
        destinationCountry: text(formData.get("destinationCountry")) ?? "",
        destinationCity: text(formData.get("destinationCity")),
        departureDate: text(formData.get("departureDate")) ?? "",
        returnDate: text(formData.get("returnDate")),
        estimatedCost: estimatedCost ?? 0,
        travelClass: text(formData.get("travelClass")) ?? "ECONOMY",
        ticketCostBorneBy: text(formData.get("ticketCostBorneBy")) ?? "COMPANY",
    });
}

/**
 * Moves a request to APPROVED / REJECTED / COMPLETED / CANCELLED.
 *
 * The target is validated against the workflow's own vocabulary before it is
 * passed on. `assertTransition` would reject an unknown state anyway, but this
 * keeps the browser from spending a database round trip to be told no, and stops
 * an unexpected string reaching an audit row.
 */
export async function decideBusinessTravelRequest(
    requestId: string,
    to: string,
    note?: string
): Promise<TravelActionResult> {
    if (!TRAVEL_REQUEST_DECISIONS.includes(to as (typeof TRAVEL_REQUEST_DECISIONS)[number])) {
        return { success: false, message: `Unknown travel request state: ${to}` };
    }
    if (!requestId || requestId.length > 64) {
        return { success: false, message: "Travel request not found." };
    }
    if (note && note.length > 1000) {
        return { success: false, message: "Notes must be 1,000 characters or fewer." };
    }

    const result = await advanceTravelRequest({ requestId, to, note });
    if (result.success) revalidateTravelViews();
    return result;
}

/**
 * Records what HR has agreed to pay for one trip.
 *
 * `requestId`, `approvedAmount` and the override tick all arrive from the
 * browser, so none of them is trusted: the workflow resolves the approver's
 * role from the session, reloads the request, re-reads the employee's annual
 * budget from the database and refuses an over-budget amount unless the override
 * was explicitly ticked. A hidden override input buys nothing — it is the same
 * request either way, and the audit row records which one it was.
 */
export async function grantBusinessTravelAmount(formData: FormData): Promise<TravelActionResult> {
    const approvedAmount = parseNumber(formData.get("approvedAmount"));
    if (approvedAmount === undefined) {
        return { success: false, message: "Enter the amount HR is approving for this trip." };
    }

    const requestId = text(formData.get("requestId")) ?? "";
    if (!requestId || requestId.length > 64) {
        return { success: false, message: "Travel request not found." };
    }

    const note = text(formData.get("note"));
    if (note && note.length > 1000) {
        return { success: false, message: "Notes must be 1,000 characters or fewer." };
    }

    const result = await grantTravelAmount({
        requestId,
        // NaN reaches the workflow on purpose rather than being swallowed here:
        // its refusal names the amount, and a second copy of the rule in this
        // layer is a second thing to keep in step.
        approvedAmount,
        note,
        overrideBudget: formData.get("overrideBudget") === "on",
    });
    if (result.success) revalidateTravelViews();
    return result;
}

/**
 * Marks a filed travel document verified, or withdraws that verification.
 *
 * `kind` is checked against the workflow's vocabulary here purely to keep an
 * unknown string out of the audit row; `verifyTravelDocument` checks it again.
 */
export async function setBusinessTravelDocumentVerification(
    requestId: string,
    kind: string,
    verified: boolean
): Promise<TravelActionResult> {
    if (!(TRAVEL_DOCUMENT_KINDS as readonly string[]).includes(kind)) {
        return { success: false, message: "Choose a valid document type: ticket or boarding pass." };
    }
    if (!requestId || requestId.length > 64) {
        return { success: false, message: "Travel request not found." };
    }

    const result = await verifyTravelDocument({ requestId, kind, verified });
    if (result.success) revalidateTravelViews();
    return result;
}

/**
 * Files a ticket or boarding pass against one travel request.
 *
 * The file arrives as multipart form data rather than as a base64 string in a
 * field, so a 10 MB scan crosses the wire as 10 MB instead of the ~13 MB its
 * base64 form would need. `MAX_TRAVEL_DOCUMENT_BYTES` is 10 MB and
 * `next.config.ts` allows an 11 MB action body, so the two agree.
 *
 * Everything below is the trust boundary: `kind`, `requestId`, the MIME type
 * and the size are all attacker-controlled, and the browser's own view of a
 * file's type is a claim rather than a fact. The workflow re-checks the decoded
 * payload; this layer rejects the obviously bad before spending a round trip.
 */
export async function fileBusinessTravelDocument(formData: FormData): Promise<TravelActionResult> {
    const kind = text(formData.get("kind")) ?? "";
    if (!(TRAVEL_DOCUMENT_KINDS as readonly string[]).includes(kind)) {
        return { success: false, message: "Choose a valid document type: ticket or boarding pass." };
    }

    const requestId = text(formData.get("requestId")) ?? "";
    if (!requestId || requestId.length > 64) {
        return { success: false, message: "Travel request not found." };
    }

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
        return { success: false, message: "Choose a file to upload." };
    }
    if (file.size > MAX_TRAVEL_DOCUMENT_BYTES) {
        return {
            success: false,
            message: `That file is ${(file.size / (1024 * 1024)).toFixed(1)} MB. The limit is ${
                MAX_TRAVEL_DOCUMENT_BYTES / (1024 * 1024)
            } MB.`,
        };
    }
    // `file.type` is empty for types the browser does not recognise, which is
    // itself a refusal: an empty type must not pass as "not on the deny list".
    const fileType = file.type.toLowerCase();
    if (!fileType || !(TRAVEL_DOCUMENT_MIME_TYPES as readonly string[]).includes(fileType)) {
        return { success: false, message: "Only PNG, JPEG or PDF files can be filed against a travel request." };
    }

    const dataUrl = `data:${fileType};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`;

    const result = await uploadTravelDocument({
        requestId,
        kind,
        fileName: file.name || `${kind.toLowerCase()}`,
        dataUrl,
        reference: text(formData.get("reference")),
    });
    if (result.success) revalidateTravelViews();
    return result;
}

/**
 * Sets an employee's yearly entitlement, cabin class, anchor date and annual
 * travel budget.
 *
 * A window that has already opened is deliberately left alone for the ticket
 * count, so that applies from the next entitlement window. The budget is read
 * live off the employee and applies immediately. The workflow's messages say so.
 */
export async function updateAirTicketEntitlement(formData: FormData): Promise<TravelActionResult> {
    const entitledPerYear = parseNumber(formData.get("entitledPerYear"));
    if (entitledPerYear === undefined) {
        return { success: false, message: "Enter how many tickets the employee is entitled to per year." };
    }
    if (Number.isNaN(entitledPerYear)) {
        return { success: false, message: "Entitlement must be a whole number of tickets." };
    }

    const travelClass = text(formData.get("travelClass")) ?? null;
    if (travelClass && !(AIR_TICKET_TRAVEL_CLASSES as readonly string[]).includes(travelClass)) {
        return { success: false, message: "Choose a valid travel class." };
    }

    // An empty budget field means "not set", which is different from zero and is
    // passed as null so the column is cleared rather than set to 0.
    const rawBudget = text(formData.get("annualBudget"));
    let annualBudget: number | null | undefined;
    if (rawBudget === undefined) {
        annualBudget = undefined;
    } else {
        const parsed = Number(rawBudget);
        annualBudget = Number.isFinite(parsed) ? parsed : NaN;
        if (Number.isNaN(annualBudget)) {
            return { success: false, message: "The annual travel budget must be a number." };
        }
    }

    const result = await setEntitlement({
        employeeId: String(formData.get("employeeId") ?? ""),
        entitledPerYear,
        travelClass,
        anchorDate: text(formData.get("anchorDate")) ?? null,
        annualBudget,
    });
    if (result.success) revalidateTravelViews();
    return result;
}