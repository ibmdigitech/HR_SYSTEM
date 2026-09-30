/**
 * Letter template variable resolution.
 *
 * THE REGRESSION THIS GUARDS
 * --------------------------
 * `app/api/letters/route.ts` defined its variable map in dotted form
 * (`employee.name`, `salary.basic`) while every `LetterTemplate` row in the
 * database writes placeholders in snake_case (`{{employee_name}}`,
 * `{{basic_salary}}`). The two sets had ZERO overlap. The result was that all
 * three shipped letter types — Salary Certificate, Standard Employment
 * Certificate, Travel NOC — rendered their placeholders LITERALLY into the
 * document, and the API still returned success.
 *
 * The placeholders below are transcribed from the live `LetterTemplate` rows.
 * If a template is edited, this list is the thing that must be updated too, and
 * `unresolvedPlaceholders` is the mechanism that reports a new one in the log.
 */
import { describe, it, expect } from "vitest";

import {
    buildLetterVariables,
    renderTemplate,
    unresolvedPlaceholders,
    withAliases,
    type LetterEmployee,
} from "@/lib/letters/variables";

const employee: LetterEmployee = {
    firstName: "Amina",
    lastName: "Rahman",
    rollNumber: "EMP-0042",
    employeeCode: "EMP-0042",
    designation: "Senior Engineer",
    department: "Engineering",
    nationality: "Emirati",
    emiratesId: "784-1990-1234567-1",
    governmentId: "784-1990-1234567-1",
    passportNumber: "P1234567",
    visaNumber: "V7654321",
    joiningDate: new Date("2023-04-17T00:00:00.000Z"),
    salaryStructure: {
        basic: 12000,
        housingAllowance: 2500,
        transportAllowance: 1000,
        medicalAllowance: 500,
        otherAllowances: 300,
        ctc: 16300,
    },
};

const options = { referenceNumber: "LTR-UAE-2026-007", today: new Date("2026-09-29T00:00:00.000Z") };

/** Every placeholder any shipped template uses today. */
const SHIPPED_PLACEHOLDERS = [
    "allowances",
    "basic_salary",
    "company_name",
    "department",
    "designation",
    "employee_id",
    "employee_name",
    "gross_salary",
    "joining_date",
    "passport_number",
];

describe("letter variables — the placeholders templates actually use", () => {
    const variables = buildLetterVariables(employee, options);

    it.each(SHIPPED_PLACEHOLDERS)("resolves {{%s}}", (key) => {
        expect(variables[key]).toBeDefined();
        expect(variables[key]).not.toContain("{{");
    });

    it("substitutes the employee's real details into an employment certificate", () => {
        const text =
            "To Whom It May Concern,\n\n" +
            "This is to certify that {{employee_name}} (Employee ID: {{employee_id}}) is currently " +
            "employed with {{company_name}} in the capacity of {{designation}} within the " +
            "{{department}} department, effective from {{joining_date}}.";

        const out = renderTemplate(text, variables);

        expect(out).toContain("Amina Rahman");
        expect(out).toContain("EMP-0042");
        expect(out).toContain("Al Barakah Group");
        expect(out).toContain("Senior Engineer");
        expect(out).toContain("Engineering");
        expect(out).toContain("17 Apr 2023");
        expect(out).not.toContain("{{");
    });

    it("resolves the salary certificate placeholders", () => {
        const text =
            "This certifies that {{employee_name}} receives a basic salary of {{basic_salary}} " +
            "with total allowances of {{allowances}} and a gross of {{gross_salary}}.";

        const out = renderTemplate(text, variables);

        expect(out).toContain("12000");
        expect(out).toContain("4300"); // 2500 + 1000 + 500 + 300
        expect(out).toContain("16300");
        expect(out).not.toContain("{{");
    });

    it("resolves passport_number for the NOC template", () => {
        expect(renderTemplate("Passport: {{passport_number}}", variables)).toBe("Passport: P1234567");
    });

    it("leaves no unresolved placeholder in any shipped template", () => {
        // The check that would have caught the original bug: had it existed.
        expect(unresolvedPlaceholders("{{employee_name}} {{basic_salary}} {{passport_number}}", variables))
            .toEqual([]);
    });
});

describe("letter variables — both placeholder spellings resolve", () => {
    const variables = buildLetterVariables(employee, options);

    it("resolves the canonical dotted keys", () => {
        expect(variables["employee.name"]).toBe("Amina Rahman");
        expect(variables["salary.basic"]).toBe("12000");
        expect(variables["company.name"]).toBe("Al Barakah Group");
        expect(variables["letter.number"]).toBe("LTR-UAE-2026-007");
    });

    it("exposes every dotted key under its snake_case alias", () => {
        expect(variables["employee_name"]).toBe(variables["employee.name"]);
        expect(variables["salary_basic"]).toBe(variables["salary.basic"]);
        expect(variables["company_name"]).toBe(variables["company.name"]);
        expect(variables["date_today"]).toBe(variables["date.today"]);
    });

    it("does not let a derived alias overwrite an explicit template name", () => {
        const merged = withAliases({ "a.b": "derived", a_b: "explicit" });
        expect(merged.a_b).toBe("explicit");
    });
});

describe("letter variables — missing data must not lie", () => {
    it("renders a marker, not 1970, for a null joining date", () => {
        // `new Date(null)` is 1 Jan 1970, not a throw. An unguarded join date
        // would certify that a provisional employee has worked since 1970.
        const provisional = { ...employee, joiningDate: null };
        const out = renderTemplate("since {{joining_date}}", buildLetterVariables(provisional, options));

        expect(out).toContain("—");
        expect(out).not.toContain("1970");
    });

    it("renders a marker, not 'null', for absent optional fields", () => {
        const sparse = { ...employee, department: null, nationality: null, passportNumber: null };
        const out = renderTemplate(
            "{{department}}|{{nationality}}|{{passport_number}}",
            buildLetterVariables(sparse, options)
        );

        expect(out).not.toContain("null");
        expect(out).not.toContain("undefined");
        expect(out).toBe("—|—|—");
    });

    it("falls back to rollNumber when a provisional employee has no code", () => {
        const provisional = { ...employee, employeeCode: null };
        expect(buildLetterVariables(provisional, options).employee_id).toBe("EMP-0042");
    });

    it("does not crash when there is no salary structure at all", () => {
        const noSalary = { ...employee, salaryStructure: null };
        const out = renderTemplate("{{basic_salary}}/{{gross_salary}}", buildLetterVariables(noSalary, options));
        expect(out).toBe("0/0");
    });
});

describe("renderTemplate — literal matching, not regex wildcards", () => {
    const variables = buildLetterVariables(employee, options);

    it("matches the key literally rather than as a pattern", () => {
        // The old implementation built `new RegExp("{{employee.name}}")`
        // UNESCAPED, so `.` was a wildcard and `{{employeeXname}}` matched.
        const text = "{{employeeXname}} and {{employee.name}}";
        const out = renderTemplate(text, variables);

        expect(out).toContain("{{employeeXname}}");
        expect(out).toContain("Amina Rahman");
    });

    it("substitutes every occurrence of a repeated placeholder", () => {
        const out = renderTemplate("{{employee_name}} / {{employee_name}}", variables);
        expect(out).toBe("Amina Rahman / Amina Rahman");
    });

    it("tolerates whitespace inside the braces", () => {
        expect(renderTemplate("{{ employee_name }}", variables)).toBe("Amina Rahman");
    });

    it("leaves an unknown placeholder visible rather than blanking it", () => {
        // Blanking would hide the mistake. Leaving it visible makes the
        // `unresolvedPlaceholders` warning match what a reader actually sees.
        expect(renderTemplate("{{not_a_field}}", variables)).toBe("{{not_a_field}}");
    });
});

describe("unresolvedPlaceholders", () => {
    it("reports exactly the keys no variable defines", () => {
        const variables = buildLetterVariables(employee, options);
        expect(unresolvedPlaceholders("{{employee_name}} {{mystery}} {{also_missing}}", variables)).toEqual([
            "also_missing",
            "mystery",
        ]);
    });

    it("returns empty for a fully resolvable template", () => {
        const variables = buildLetterVariables(employee, options);
        expect(unresolvedPlaceholders("{{employee_name}}", variables)).toEqual([]);
    });
});

describe("custom fields", () => {
    it("can add a value no built-in variable provides", () => {
        const variables = buildLetterVariables(employee, {
            ...options,
            customFields: { "request.purpose": "Attending a medical conference" },
        });
        expect(renderTemplate("{{request.purpose}}", variables)).toBe("Attending a medical conference");
    });

    it("can override a built-in value", () => {
        const variables = buildLetterVariables(employee, {
            ...options,
            customFields: { company_name: "Al Barakah Group LLC" },
        });
        expect(variables.company_name).toBe("Al Barakah Group LLC");
    });

    it("ignores null and undefined custom values instead of printing them", () => {
        const variables = buildLetterVariables(employee, {
            ...options,
            customFields: { blank: null, alsoBlank: undefined } as any,
        });
        expect(renderTemplate("[{{blank}}]", variables)).toBe("[{{blank}}]");
    });
});
