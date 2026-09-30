import { z } from "zod";
import { REQUISITION_STATUS } from "@/lib/workflow/recruitment-machine";

/**
 * Job requisition input validation.
 *
 * WHY A SEPARATE FILE: `app/lib/validation.ts` is the shared employee/service
 * schema module and another agent owns it, so the requisition rules live here
 * rather than being appended to a file that is in flux.
 *
 * SERVER-SIDE VALIDATION IS AUTHORITATIVE. The client form imports this exact
 * module for immediate feedback, but a crafted request that skips the client is
 * rejected by `parseRequisitionFormData` inside the server action before a
 * single row is written. The client check is a convenience, never the rule.
 *
 * WHY THE ENUMS MATTER SO MUCH: in `prisma/schema.prisma`,
 * `JobRequisition.employmentType`, `positionType`, `priority` and `status` are
 * plain `String` columns, not database enums. The database will happily store
 * `"priority = 'TREASURER'"`. THIS FILE IS THE ONLY THING ENFORCING THEM, so a
 * value outside these lists is a corrupt requisition that no later screen can
 * reason about (a badge falls back to printing the raw string, an approval
 * filter silently drops it). The same is true of `status`, which is why a new
 * requisition is always written as `REQUISITION_STATUS.DRAFT` and never
 * submitted automatically.
 */

/* ------------------------------------------------------------------ */
/* Controlled vocabulary                                               */
/* ------------------------------------------------------------------ */

/** `JobRequisition.priority` — LOW | MEDIUM | HIGH | URGENT. */
export const REQUISITION_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export type RequisitionPriority = (typeof REQUISITION_PRIORITIES)[number];

/** `JobRequisition.positionType` — NEW_POSITION | REPLACEMENT. */
export const REQUISITION_POSITION_TYPES = ["NEW_POSITION", "REPLACEMENT"] as const;
export type RequisitionPositionType = (typeof REQUISITION_POSITION_TYPES)[number];

/**
 * `JobRequisition.employmentType`. The model stores a free-text String, so the
 * allowed values are taken from the one list the project already commits to —
 * `Employee.employmentType` in `app/lib/validation.ts` — rather than invented
 * here. A requisition that offers a contract and an employee record that says
 * "fixed term" are the same fact stated twice.
 */
export const REQUISITION_EMPLOYMENT_TYPES = [
    "FULL_TIME",
    "PART_TIME",
    "CONTRACT",
    "PROBATION",
    "INTERN",
] as const;
export type RequisitionEmploymentType = (typeof REQUISITION_EMPLOYMENT_TYPES)[number];

export const REQUISITION_DEFAULT_PRIORITY = "MEDIUM" satisfies RequisitionPriority;
export const REQUISITION_DEFAULT_EMPLOYMENT_TYPE = "FULL_TIME" satisfies RequisitionEmploymentType;
export const REQUISITION_DEFAULT_POSITION_TYPE = "NEW_POSITION" satisfies RequisitionPositionType;
export const REQUISITION_POSITION_TYPE_REPLACEMENT = "REPLACEMENT" satisfies RequisitionPositionType;

/** A new requisition is always a draft. See the note above on auto-submission. */
export const REQUISITION_INITIAL_STATUS = REQUISITION_STATUS.DRAFT;

/** A headcount beyond this is a data-entry error, not a vacancy. */
export const MAX_REQUISITION_POSITIONS = 500;
/** Mirrors the ceiling used for employee amounts in `app/lib/validation.ts`. */
export const MAX_REQUISITION_AMOUNT = 100_000_000;

/** Human labels for the form. Kept next to the values so the two cannot drift. */
export const REQUISITION_PRIORITY_LABELS: Record<RequisitionPriority, string> = {
    LOW: "Low",
    MEDIUM: "Medium",
    HIGH: "High",
    URGENT: "Urgent",
};

export const REQUISITION_EMPLOYMENT_TYPE_LABELS: Record<RequisitionEmploymentType, string> = {
    FULL_TIME: "Full time",
    PART_TIME: "Part time",
    CONTRACT: "Contract",
    PROBATION: "Probation",
    INTERN: "Intern",
};

export const REQUISITION_POSITION_TYPE_LABELS: Record<RequisitionPositionType, string> = {
    NEW_POSITION: "New position",
    REPLACEMENT: "Replacement",
};

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

/**
 * Treats a missing value as absent.
 *
 * `FormData.get()` answers `null` for a key that was never sent, and a form
 * that skipped an untouched text field sends `""`. Both mean "not supplied" —
 * neither may be allowed through as a value, and neither may be confused with
 * a field the user actually filled in badly.
 */
const blankToUndefined = (value: unknown) =>
    value === null || value === undefined || (typeof value === "string" && value.trim() === "")
        ? undefined
        : value;

/** Optional short text: trimmed, length-bounded, absent tolerated. */
const optionalText = (max: number) =>
    z.preprocess(blankToUndefined, z.string().trim().max(max).optional());

/** Optional amount: absent tolerated, negatives and NaN rejected. */
const optionalAmount = z.preprocess(
    blankToUndefined,
    z
        .coerce.number({ error: "Enter a number" })
        .min(0, "Must not be negative")
        .max(MAX_REQUISITION_AMOUNT, "Value is unrealistically large")
        .optional()
);

/**
 * Optional date: absent tolerated, an unparseable string refused.
 *
 * The two cases are deliberately different. "not a date" is a mistake the user
 * must fix; an empty field is a decision not to set one.
 */
const optionalDate = z.preprocess(
    blankToUndefined,
    z.coerce.date({ error: "Enter a valid date" }).optional()
);

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

export const requisitionSchema = z
    .object({
        // ── What the role is ────────────────────────────────────────────
        // Preprocessed so a key that was never sent and a key that was sent
        // blank produce the same instruction. "expected string, received null"
        // is true and useless to the person filling the form in.
        title: z.preprocess(
            blankToUndefined,
            z
                .string({ error: "Job title is required" })
                .trim()
                .min(1, "Job title is required")
                .max(120, "Job title is too long")
        ),
        department: z.preprocess(
            blankToUndefined,
            z
                .string({ error: "Department is required" })
                .trim()
                .min(1, "Department is required")
                .max(120, "Department is too long")
        ),
        branch: optionalText(120),
        location: optionalText(120),

        // ── Shape of the vacancy ────────────────────────────────────────
        employmentType: z.enum(REQUISITION_EMPLOYMENT_TYPES),
        positionsCount: z.preprocess(
            blankToUndefined,
            z
                .coerce.number({ error: "Enter the number of positions" })
                .int("Whole numbers only")
                .min(1, "At least one position must be requested")
                .max(MAX_REQUISITION_POSITIONS, `At most ${MAX_REQUISITION_POSITIONS} positions`)
        ),
        positionType: z.enum(REQUISITION_POSITION_TYPES),
        replacementEmployeeId: z.preprocess(
            blankToUndefined,
            z.string().trim().min(1, "Select the employee being replaced").max(64).optional()
        ),

        // ── Why the vacancy exists ──────────────────────────────────────
        reason: optionalText(500),
        requiredSkills: optionalText(500),
        requiredExperience: optionalText(300),
        requiredEducation: optionalText(200),

        // ── Money ───────────────────────────────────────────────────────
        budget: optionalAmount,
        minSalary: optionalAmount,
        maxSalary: optionalAmount,

        // ── Timing ──────────────────────────────────────────────────────
        priority: z.enum(REQUISITION_PRIORITIES),
        targetJoiningDate: optionalDate,
    })
    /**
     * Both or neither. Half a range is not a range: an approvals screen
     * filtering on `minSalary <= X` cannot mean anything when `maxSalary` is
     * unknown, and a lone number reads as a mistake rather than a decision.
     */
    .refine((data) => (data.minSalary === undefined) === (data.maxSalary === undefined), {
        message: "Enter both the minimum and maximum salary, or leave both blank",
        path: ["minSalary"],
    })
    .refine((data) => data.minSalary === undefined || data.maxSalary === undefined || data.minSalary <= data.maxSalary, {
        message: "The minimum salary cannot be above the maximum",
        path: ["minSalary"],
    })
    .refine(
        (data) =>
            data.positionType !== REQUISITION_POSITION_TYPE_REPLACEMENT ||
            Boolean(data.replacementEmployeeId),
        {
            message: "Select the employee being replaced, or choose New position",
            path: ["replacementEmployeeId"],
        }
    );

export type RequisitionInput = z.infer<typeof requisitionSchema>;

/* ------------------------------------------------------------------ */
/* FormData entry point                                                */
/* ------------------------------------------------------------------ */

export type RequisitionFieldErrors = Record<string, string>;

export type RequisitionParseResult =
    | { ok: true; value: RequisitionInput }
    | { ok: false; fieldErrors: RequisitionFieldErrors; formError: string };

/** Flattens a ZodError into `{ field: message }` for inline form display. */
export function requisitionFieldErrors(error: z.ZodError): RequisitionFieldErrors {
    const out: RequisitionFieldErrors = {};
    for (const issue of error.issues) {
        const key = issue.path.join(".") || "_form";
        if (!out[key]) out[key] = issue.message;
    }
    return out;
}

/**
 * Reads the raw `FormData` a request can actually carry — every field is
 * attacker-controlled, so this is the only place the values are trusted, and it
 * is the gate the server action runs before touching the database.
 *
 * The returned `value` is fully typed and bounded, so the action can pass it
 * straight to Prisma without a second round of coercion.
 */
export function parseRequisitionFormData(formData: FormData): RequisitionParseResult {
    const raw: Record<string, unknown> = {
        title: formData.get("title"),
        department: formData.get("department"),
        branch: formData.get("branch"),
        location: formData.get("location"),
        employmentType: formData.get("employmentType") ?? REQUISITION_DEFAULT_EMPLOYMENT_TYPE,
        positionsCount: formData.get("positionsCount"),
        positionType: formData.get("positionType") ?? REQUISITION_DEFAULT_POSITION_TYPE,
        replacementEmployeeId: formData.get("replacementEmployeeId"),
        reason: formData.get("reason"),
        requiredSkills: formData.get("requiredSkills"),
        requiredExperience: formData.get("requiredExperience"),
        requiredEducation: formData.get("requiredEducation"),
        budget: formData.get("budget"),
        minSalary: formData.get("minSalary"),
        maxSalary: formData.get("maxSalary"),
        priority: formData.get("priority") ?? REQUISITION_DEFAULT_PRIORITY,
        targetJoiningDate: formData.get("targetJoiningDate"),
    };

    const parsed = requisitionSchema.safeParse(raw);
    if (parsed.success) return { ok: true, value: parsed.data };

    return {
        ok: false,
        fieldErrors: requisitionFieldErrors(parsed.error),
        formError: "Please correct the highlighted fields.",
    };
}

/* ------------------------------------------------------------------ */
/* Requisition code — REQ-<year>-<0001>                                */
/* ------------------------------------------------------------------ */

/**
 * The schema comment on `requisitionCode` is the requirement this format
 * serves: "Unique so a requisition is addressable in approvals." The column is
 * `String? @unique`, so the sequence has to be both human-quotable and
 * collision-free.
 */
export function requisitionCodePrefix(year: number): string {
    return `REQ-${year}-`;
}

export function formatRequisitionCode(year: number, sequence: number): string {
    return `${requisitionCodePrefix(year)}${String(sequence).padStart(4, "0")}`;
}

/**
 * Next code for a calendar year, given the highest code already issued for it.
 *
 * Built from the highest EXISTING code rather than `count() + 1`. A count is
 * wrong in two ways a live system hits immediately: a deleted or imported
 * requisition shifts every later number, and two rows sharing a number (one
 * from a backfill) make `count()` hand out a code that is already taken.
 * Reading the maximum is monotonic — the sequence only ever moves forward.
 */
export function nextRequisitionCode(
    latest: string | null | undefined,
    year: number = new Date().getFullYear()
): string {
    const prefix = requisitionCodePrefix(year);
    const parsed = latest && latest.startsWith(prefix)
        ? Number.parseInt(latest.slice(prefix.length), 10)
        : Number.NaN;
    const next = Number.isInteger(parsed) && parsed > 0 ? parsed + 1 : 1;
    return formatRequisitionCode(year, next);
}
