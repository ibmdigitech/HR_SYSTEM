import { z } from 'zod';

// Schema for creating a ServiceConfig entry
export const serviceConfigCreateSchema = z.object({
  module: z.string().min(1),
  key: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(['text', 'number', 'boolean', 'select', 'json', 'date', 'time']),
  value: z.string(),
  options: z.any().optional(), // JSON for select options
  isActive: z.boolean().optional().default(true),
});

// Schema for updating a ServiceConfig entry (partial)
export const serviceConfigUpdateSchema = serviceConfigCreateSchema.partial();

/* ───────────────────────────────────────────────────────────────────────────
 * Employee validation (P0-10 / P0-14)
 *
 * Server-side validation is AUTHORITATIVE. The client uses the same schema for
 * immediate feedback, but a crafted request that skips the client is still
 * rejected here before anything is written.
 *
 * Lengths are bounded to keep a single request from storing unbounded text in
 * a column intended for a name or a code.
 * ─────────────────────────────────────────────────────────────────────────── */

/** Treats "" / "null" / "undefined" / whitespace as absent. */
const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

/** Optional short text: trimmed, length-bounded, blank tolerated. */
const optionalText = (max: number) =>
  z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());

/** Optional amount: accepts "" as absent, rejects negatives and NaN. */
const optionalAmount = z.preprocess(
  (value) => (value === '' || value === null || value === undefined ? undefined : value),
  z.coerce.number().min(0, 'Must not be negative').max(100_000_000, 'Value is unrealistically large').optional()
);

/** Optional date: accepts "" as absent, rejects an unparseable string. */
const optionalDate = z.preprocess(
  (value) => (value === '' || value === null || value === undefined ? undefined : value),
  z.coerce.date({ error: 'Enter a valid date' }).optional()
);

/**
 * UAE phone numbers are 9 digits starting with 5, optionally prefixed with +971
 * or 0. The pattern is permissive on separators so real entries are not
 * rejected over formatting.
 */
const PHONE_PATTERN = /^(?:\+?971|0)?5\d{8}$/;

export const employeeSchema = z
  .object({
    // ── Identity ────────────────────────────────────────────────────────
    firstName: z.string().trim().min(1, 'First name is required').max(80, 'First name is too long'),
    lastName: z.string().trim().min(1, 'Last name is required').max(80, 'Last name is too long'),
    email: z
      .string()
      .trim()
      .min(1, 'Email is required')
      .max(200, 'Email is too long')
      .email('Enter a valid email address')
      .transform((value) => value.toLowerCase()),
    rollNumber: z
      .string()
      .trim()
      .min(1, 'Roll number is required')
      .max(40, 'Roll number is too long')
      .regex(/^[A-Za-z0-9\-_/]+$/, 'Use only letters, numbers, hyphen, underscore or slash'),

    // ── Employment ──────────────────────────────────────────────────────
    designation: z.string().trim().min(1, 'Designation is required').max(120),
    department: z.string().trim().min(1, 'Department is required').max(120),
    joiningDate: z.coerce.date({ error: 'Enter a valid joining date' }),
    employmentType: z
      .enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'PROBATION', 'INTERN'])
      .default('FULL_TIME'),
    workLocation: optionalText(120),
    currentStatus: z.enum(['ACTIVE', 'ON_LEAVE', 'RESIGNED', 'TERMINATED']).default('ACTIVE'),
    managerId: z.preprocess((v) => (v === 'none' ? null : emptyToUndefined(v)), z.string().optional().nullable()),

    // ── Contact ─────────────────────────────────────────────────────────
    phone: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .trim()
        .regex(PHONE_PATTERN, 'Enter a valid UAE mobile number (e.g. 0501234567)')
        .optional()
    ),
    gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
    maritalStatus: z.enum(['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED']).optional(),
    nationality: optionalText(80),
    dateOfBirth: optionalDate,
    probationDays: z.coerce.number().int().min(0).max(365).default(90),

    address: optionalText(300),
    permanentAddress: optionalText(300),
    emergencyContact: optionalText(120),
    emergencyPhone: z.preprocess(
      emptyToUndefined,
      z.string().trim().regex(PHONE_PATTERN, 'Enter a valid UAE mobile number').optional()
    ),

    // ── Bank ────────────────────────────────────────────────────────────
    bankName: optionalText(120),
    accountNumber: optionalText(50),
    // IBAN: 15-34 alphanumerics after stripping spaces.
    iban: z.preprocess(
      (v) => (typeof v === 'string' ? v.replace(/\s+/g, '').toUpperCase() : emptyToUndefined(v)),
      z
        .string()
        .regex(/^[A-Z0-9]{15,34}$/, 'Enter a valid IBAN (15-34 letters and digits)')
        .optional()
    ),
    ifscCode: optionalText(20),

    // ── Salary ──────────────────────────────────────────────────────────
    basicSalary: optionalAmount,
    housingAllowance: optionalAmount,
    transportAllowance: optionalAmount,
    otherAllowance: optionalAmount,

    // ── Documents ───────────────────────────────────────────────────────
    governmentId: optionalText(60),
    passportNumber: optionalText(40),
    passportExpiry: optionalDate,
    emiratesId: optionalText(60),
    emiratesIdExpiry: optionalDate,
    visaNumber: optionalText(40),
    visaExpiry: optionalDate,
    visaType: optionalText(40),
    medicalInsuranceExpiry: optionalDate,
    iloeInsuranceExpiry: optionalDate,
  })
  .refine((data) => !data.visaExpiry || data.visaExpiry > new Date(), {
    message: 'Visa expiry must be in the future',
    path: ['visaExpiry'],
  })
  .refine((data) => !data.passportExpiry || data.passportExpiry > new Date(), {
    message: 'Passport expiry must be in the future',
    path: ['passportExpiry'],
  })
  .refine((data) => !data.joiningDate || data.joiningDate <= new Date(), {
    message: 'Joining date cannot be in the future',
    path: ['joiningDate'],
  })
  .refine((data) => !data.dateOfBirth || data.joiningDate === undefined || data.dateOfBirth < data.joiningDate, {
    message: 'Date of birth must be before the joining date',
    path: ['dateOfBirth'],
  });

export type EmployeeInput = z.infer<typeof employeeSchema>;

/** Flattens a ZodError into `{ field: message }` for inline form display. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_form';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
