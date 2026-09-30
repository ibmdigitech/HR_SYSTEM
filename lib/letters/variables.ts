/**
 * Letter template variable resolution.
 *
 * THE BUG THIS FIXES
 * ------------------
 * Every `LetterTemplate` row in the database writes its placeholders in
 * snake_case — `{{employee_name}}`, `{{joining_date}}`, `{{basic_salary}}` — but
 * `app/api/letters/route.ts` defined its variable map in dotted form
 * (`employee.name`, `salary.basic`). The two sets have ZERO overlap, so no
 * substitution ever fired and all three shipped letter types rendered their
 * placeholders literally into the document:
 *
 *     "This is to certify that {{employee_name}} (Employee ID: {{employee_id}})"
 *
 * The failure was silent: the letter was created, the reference number was
 * assigned, and the request reported success. Only reading the generated
 * document revealed that none of the employee's details had been substituted.
 *
 * WHY A SHARED MODULE
 * -------------------
 * The substitution rule is business logic, not transport. It is expressed here
 * as two pure functions so it can be unit-tested directly, and reused by the
 * generation route and any regeneration path, instead of living inline where a
 * silent mismatch can hide again.
 *
 * TWO SYNTAXES, ON PURPOSE
 * ------------------------
 * Both the dotted and the snake_case spelling resolve. Templates already in the
 * database use snake_case and must keep working; the dotted form is the
 * canonical key and is what the variable map is authored in. Dotted keys are
 * automatically exposed under their snake_case alias rather than being
 * enumerated by hand, so a new variable cannot be added in one form and
 * forgotten in the other.
 */

/** Matches `{{anything}}`, tolerating whitespace inside the braces. */
const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

/**
 * The employee fields a letter may interpolate.
 *
 * A structural subset, declared here rather than typed as `Employee`, so that
 * the resolver keeps working — and keeps compiling — if the schema changes, and
 * so the test can supply a plain object. Note the absence of salary fields:
 * money is read from `salaryStructure`, not from the employee row.
 */
export interface LetterEmployee {
    firstName: string;
    lastName: string;
    /**
     * Optional, and NOT because employees may lack one. A letter can be issued
     * against a CANDIDATE — an offer letter is generated before the person has
     * an employee record, so there is no roll number to print — and
     * `app/api/letters/route.ts` passes whichever of the two rows it loaded to
     * this same builder. Declaring it required made that call site impossible to
     * type-check and pushed it toward an unchecked assertion.
     *
     * When it is genuinely absent, `or()` renders the MISSING placeholder, which
     * is the same treatment every other nullable field on this interface gets.
     * The alternative — two separate interfaces — would not survive the first
     * schema change that added a shared field.
     */
    rollNumber?: string | null;
    employeeCode?: string | null;
    designation?: string | null;
    department?: string | null;
    joiningDate?: Date | string | null;
    nationality?: string | null;
    governmentId?: string | null;
    emiratesId?: string | null;
    passportNumber?: string | null;
    visaNumber?: string | null;
    salaryStructure?: {
        basic?: number | null;
        housingAllowance?: number | null;
        transportAllowance?: number | null;
        medicalAllowance?: number | null;
        otherAllowances?: number | null;
        ctc?: number | null;
    } | null;
}

export interface LetterVariableOptions {
    referenceNumber: string;
    companyName?: string;
    authorizedSignatory?: string;
    /** Callers may add or override fields (an NOC "purpose", for example). */
    customFields?: Record<string, string> | null;
    /** Injected so formatting is deterministic and testable. */
    today?: Date;
}

/** Rendered where a value is genuinely absent, rather than printing "null". */
const MISSING = "—";

/**
 * `new Date(null)` does not throw — it yields 1 Jan 1970 — so an unguarded
 * nullable date prints "employed since 01/01/1970" on a signed certificate.
 */
function formatDate(value: Date | string | null | undefined): string {
    if (!value) return MISSING;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return MISSING;
    return date.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    });
}

function or(value: string | number | null | undefined, fallback: string = MISSING): string {
    if (value === null || value === undefined || value === "") return fallback;
    return String(value);
}

function allowancesOf(employee: LetterEmployee): number {
    const s = employee.salaryStructure;
    if (!s) return 0;
    return (
        (s.housingAllowance || 0) +
        (s.transportAllowance || 0) +
        (s.medicalAllowance || 0) +
        (s.otherAllowances || 0)
    );
}

/**
 * Builds the canonical dotted-key variable map.
 *
 * Callers should pass the result through `withAliases` rather than using it
 * directly, so both placeholder spellings resolve.
 */
export function buildLetterVariables(
    employee: LetterEmployee,
    options: LetterVariableOptions
): Record<string, string> {
    const {
        referenceNumber,
        companyName = "Al Barakah Group",
        authorizedSignatory = "CEO / HR Manager",
        customFields,
        today = new Date(),
    } = options;

    const salary = employee.salaryStructure;
    const fullName = `${employee.firstName} ${employee.lastName}`.trim();

    // Authored in dotted form. Every key is also exposed in snake_case by
    // `withAliases`.
    const dotted: Record<string, string> = {
        "employee.name": fullName,
        "employee.rollNumber": or(employee.rollNumber),
        "employee.employeeCode": or(employee.employeeCode),
        "employee.designation": or(employee.designation),
        "employee.department": or(employee.department),
        "employee.nationality": or(employee.nationality),
        "employee.emiratesId": or(employee.emiratesId || employee.governmentId),
        "employee.governmentId": or(employee.governmentId),
        "employee.passportNumber": or(employee.passportNumber),
        "employee.visaNumber": or(employee.visaNumber),
        "employee.joiningDate": formatDate(employee.joiningDate),
        "salary.basic": String(salary?.basic ?? 0),
        "salary.allowances": String(allowancesOf(employee)),
        "salary.total": String(salary?.ctc ?? 0),
        "company.name": companyName,
        "company.authorizedSignatory": authorizedSignatory,
        "date.today": formatDate(today),
        "letter.number": referenceNumber,
    };

    // Placeholders that exist in the shipped templates with no dotted
    // equivalent. These are the names HR actually wrote into the documents, so
    // they are part of the contract rather than sugar.
    const templateNames: Record<string, string> = {
        employee_name: fullName,
        // "Employee ID" reads as the auto-generated code; rollNumber is the
        // guaranteed-unique fallback when a provisional record has no code yet.
        employee_id: or(employee.employeeCode, employee.rollNumber ?? undefined),
        designation: or(employee.designation),
        department: or(employee.department),
        joining_date: formatDate(employee.joiningDate),
        passport_number: or(employee.passportNumber),
        emirates_id: or(employee.emiratesId || employee.governmentId),
        nationality: or(employee.nationality),
        basic_salary: String(salary?.basic ?? 0),
        gross_salary: String(salary?.ctc ?? 0),
        allowances: String(allowancesOf(employee)),
        company_name: companyName,
        company_signatory: authorizedSignatory,
        reference_number: referenceNumber,
        date_today: formatDate(today),
    };

    const merged = { ...dotted, ...templateNames };
    return withAliases(merged, customFields);
}

/**
 * Adds the snake_case alias of every dotted key (`employee.name` ->
 * `employee_name`). Caller-supplied `customFields` win over both, so a request
 * can still override a built-in value.
 */
export function withAliases(
    variables: Record<string, string>,
    customFields?: Record<string, string> | null
): Record<string, string> {
    const out: Record<string, string> = { ...variables };

    for (const [key, value] of Object.entries(variables)) {
        if (!key.includes(".")) continue;
        const alias = key.replace(/\./g, "_");
        // Do not clobber an explicit key that a template author already uses.
        if (out[alias] === undefined) out[alias] = value;
    }

    if (customFields) {
        for (const [key, value] of Object.entries(customFields)) {
            if (value === null || value === undefined) continue;
            out[key] = String(value);
        }
    }

    return out;
}

/**
 * Substitutes `{{key}}` occurrences.
 *
 * The key is matched as a LITERAL. The previous implementation built its regex
 * with `new RegExp(\`{{${key}}}\`)` unescaped, so the `.` in `employee.name` was
 * a regex wildcard — `{{employeeXname}}` would have been substituted too. The
 * difference is invisible in normal use and only shows up in adversarial input.
 */
export function renderTemplate(text: string, variables: Record<string, string>): string {
    return text.replace(PLACEHOLDER, (match, key: string) => {
        const value = variables[key];
        return value === undefined ? match : value;
    });
}

/**
 * Placeholders present in the text that no variable resolves.
 *
 * This exists because the original bug was invisible: the letter was created
 * and reported success while every placeholder stayed literal. A caller can log
 * this, and tests can assert on it, so a mismatch surfaces immediately instead
 * of shipping a broken document to an employee.
 */
export function unresolvedPlaceholders(
    text: string,
    variables: Record<string, string>
): string[] {
    const found = new Set<string>();
    for (const match of text.matchAll(PLACEHOLDER)) {
        const key = match[1];
        if (variables[key] === undefined) found.add(key);
    }
    return [...found].sort();
}
