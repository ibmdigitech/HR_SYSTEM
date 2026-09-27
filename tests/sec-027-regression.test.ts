/**
 * Regression guard for SEC-027 and the seed defect it exposed.
 *
 * The shared default password `password123` must never appear as a working
 * credential, and the seed must never write a password onto an existing
 * account. Both are static source checks: the seed is CommonJS, so the rule is
 * enforced by inspecting its source rather than by importing it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkPasswordStrength } from "@/lib/workflow/credentials";

const ROOT = process.cwd();
const SEED = join(ROOT, "scripts", "seed-standalone.js");

function readSeed(): string {
    return readFileSync(SEED, "utf8");
}

describe("SEC-027 — the shared default password", () => {
    it("is rejected by the password policy", () => {
        expect(checkPasswordStrength("password123").ok).toBe(false);
    });

    it("the seed never assigns a password to an EXISTING account", () => {
        const source = readSeed();

        // Every `data: { password: ... }` must sit inside a `create({` block.
        // If one appears in an `update({` block the seed would revert a
        // password the user has since changed — the defect found in P1.
        const lines = source.split(/\r?\n/);
        let inUpdateBlock = false;
        const offendingLines: number[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            if (/\.update\(\{/.test(line)) inUpdateBlock = true;
            if (inUpdateBlock && /password\s*:\s*(password|rawPassword|.*hash)/.test(line)) {
                offendingLines.push(i + 1);
            }
            // A create() block closes the update scope.
            if (inUpdateBlock && /\}\);/.test(line)) inUpdateBlock = false;
        }

        expect(
            offendingLines,
            `seed writes a password inside an update() at line(s): ${offendingLines.join(", ")}`
        ).toHaveLength(0);
    });

    it("the seed still creates accounts WITH a password (new accounts need one)", () => {
        const source = readSeed();
        // A brand-new account must get a password, otherwise it could never sign
        // in. The guard above only forbids writes to EXISTING accounts.
        expect(source).toMatch(/\.create\(\{[\s\S]{0,400}?password:/);
    });

    it("the rotation script is dry-run by default", () => {
        const source = readFileSync(
            join(ROOT, "scripts", "force-password-rotation.cjs"),
            "utf8"
        );
        // A destructive script must not write without an explicit flag.
        expect(source).toContain('process.argv.includes("--apply")');
    });

    it("the rotation script does not delete users", () => {
        const source = readFileSync(
            join(ROOT, "scripts", "force-password-rotation.cjs"),
            "utf8"
        );
        expect(source).not.toMatch(/user\.(delete|deleteMany)/);
    });

    it("onboarding does not assign a default password", () => {
        const source = readFileSync(join(ROOT, "app", "lib", "actions", "employees.ts"), "utf8");
        // The User must be created with a null password and activated via a
        // one-time token, not a shared default.
        expect(source).not.toMatch(/password:\s*hashed\s*Password/);
        expect(source).toMatch(/password:\s*null/);
        expect(source).toMatch(/issueActivationToken/);
    });

    it("sign-in is refused while a forced password change is outstanding", () => {
        const source = readFileSync(join(ROOT, "auth.ts"), "utf8");
        // After a successful password match the account must still be refused
        // when a forced change is pending, otherwise setting a password would
        // not be mandatory.
        expect(source).toMatch(/mustChangePassword\(user\.id\)/);
    });
});
