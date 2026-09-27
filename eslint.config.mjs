import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  /*
   * globalIgnores REPLACES the default ignore list, so everything that should
   * stay out of linting has to be listed here.
   *
   * BUILD-002: `prisma/generated/**` is machine-generated Prisma runtime code
   * that is committed to the repository. Before it was ignored it produced
   * ~3,900 of the 3,922 reported errors, which buried the real application
   * errors. Generated files must never be edited to satisfy lint.
   *
   * `hr-system/**` is the legacy duplicate application tree (see
   * docs/audit/LEGACY_APP_ANALYSIS.md). It is retained, not deleted, and is
   * excluded here only to keep the application-code lint count meaningful.
   */
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",

    // Generated code — never edit to satisfy lint.
    "prisma/generated/**",
    "prisma/migrations/**",

    // Legacy duplicate app tree — retained, see LEGACY_APP_ANALYSIS.md.
    "hr-system/**",

    // Test output and local artefacts.
    "coverage/**",
    "test-results/**",
    "playwright-report/**",
    "firebase-debug.log",

    // Agent tooling and worktree copies of this repository.
    ".kilo/**",
  ]),
  /*
   * CommonJS seed scripts are linted with TypeScript rules by the shared config,
   * which flags every `require()` as an error (BUILD-005). These are Node CLI
   * scripts, not application modules, so they get a scoped override rather
   * than a rule relaxation applied project-wide.
   */
  /*
   * Node CLI scripts are CommonJS by design — they run under `node` directly
   * and have no bundler to convert `require()` to `import`. Applying the
   * TypeScript ESM rules to them produces false errors on correct code, so the
   * rule is scoped off for these paths only. No application file is affected.
   */
  {
    files: ["scripts/**/*.js", "scripts/**/*.cjs", "*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
]);

export default eslintConfig;
