/**
 * Field selection for the employee detail surface.
 *
 * Shared by `app/employees/[id]/page.tsx` and `app/api/employees/[id]/route.ts`
 * so the page and its API can never drift apart in what they expose.
 *
 * WHY AN EXPLICIT LIST AND NOT THE WHOLE ROW
 * `app/employees/page.tsx` loads the master record with no `select`, because
 * every caller there already holds `employees.view` — an HR/ADMIN capability.
 * The detail surface is reachable by a wider set of roles (a MANAGER reads
 * their own department, a STAFF member reads themselves), so the row can no
 * longer be handed over whole. Two selects express that:
 *
 *   PROFILE_SELECT      non-sensitive profile + the employment stage. Safe for
 *                       any caller that passed the guard AND the scope check.
 *   RESTRICTED_SELECT   the columns the master entry/edit form owns — pay,
 *                       bank details, government identity, date of birth,
 *                       nationality and the identity-document NUMBERS. Only
 *                       merged in for a caller holding `employees.view`, which
 *                       is the same capability that lets them see those columns
 *                       on the list page today.
 *
 * Note that document EXPIRY dates are in PROFILE_SELECT while document
 * NUMBERS are not. Expiry drives the compliance picture that every reader
 * legitimately needs; the passport/Emirates/visa numbers are identity
 * documents and behave like `governmentId`.
 */

/** Columns every authorised, in-scope reader may see. */
export const PROFILE_SELECT = {
    id: true,
    employeeCode: true,
    firstName: true,
    lastName: true,
    email: true,
    rollNumber: true,
    photo: true,
    phone: true,
    gender: true,
    maritalStatus: true,

    designation: true,
    department: true,
    joiningDate: true,
    employmentType: true,
    workLocation: true,
    probationDays: true,

    /**
     * The AUTHORITATIVE employment stage. This is the field the lifecycle
     * CHECK constraint and `LIFECYCLE_TRANSITIONS` reason about, and the only
     * one of the three competing state columns that is machine-governed.
     */
    lifecycle: true,
    /**
     * Non-authoritative. It is written by the entry/edit form and by offboarding
     * without advancing `lifecycle`, so the two can disagree. It is selected
     * only so the detail page can RUN the consistency check and show a
     * divergence — never as a status badge of its own.
     */
    currentStatus: true,
    /** Third competing column. Read by payroll/attendance/accrual. */
    isActive: true,

    address: true,
    permanentAddress: true,
    emergencyContact: true,
    emergencyPhone: true,

    managerId: true,
    manager: { select: { firstName: true, lastName: true, department: true } },

    // Expiry dates only — see the header note.
    passportExpiry: true,
    emiratesIdExpiry: true,
    visaExpiry: true,
    visaType: true,
    medicalInsuranceExpiry: true,
    iloeInsuranceExpiry: true,

    createdAt: true,
    updatedAt: true,
};

/** Columns that stay behind `employees.view`, as on the master list page. */
export const RESTRICTED_SELECT = {
    dateOfBirth: true,
    nationality: true,
    governmentId: true,

    bankName: true,
    accountNumber: true,
    iban: true,
    ifscCode: true,

    basicSalary: true,
    housingAllowance: true,
    transportAllowance: true,
    otherAllowance: true,

    passportNumber: true,
    emiratesId: true,
    visaNumber: true,
};

/**
 * Both sets merged. Used ONLY on the branch taken by an `employees.view`
 * holder; the other branch selects `PROFILE_SELECT` alone, so the restricted
 * columns are never even read from the database for a lesser caller.
 */
export const FULL_SELECT = { ...PROFILE_SELECT, ...RESTRICTED_SELECT };
