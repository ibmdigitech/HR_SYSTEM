import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Vitest configuration.
 *
 * Scope: server-side authorization, RBAC, IDOR and data-validation logic.
 * These are pure TypeScript modules under lib/, so they are testable without
 * booting Next.js or a live database. Tests that need the database mock
 * `@/lib/prisma` (see tests/setup).
 */
export default defineConfig({
    test: {
        environment: "node",
        include: ["tests/**/*.test.ts"],
        globals: false,
        reporters: ["default"],
        coverage: {
            provider: "v8",
            include: ["lib/auth/**", "lib/attendance/**"],
            reporter: ["text", "json-summary"],
        },
    },
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./", import.meta.url)),
        },
    },
});
