/**
 * Classifies ESLint output by area so lint can be triaged rather than
 * triaged-by-feel. Reads the stylish-format report and attributes every
 * problem to a category and a rule.
 *
 *   node scripts/lint-classify.cjs
 */
const fs = require("fs");
const path = require("path");

const reportPath = process.argv[2] || "lint-full.txt";
const root = process.cwd().replace(/\\/g, "/") + "/";

const CATEGORIES = [
    { name: "A. Generated code", test: (r) => r.startsWith("prisma/generated/") },
    { name: "C. Auth / RBAC", test: (r) => /^(lib\/auth\/|lib\/attendance\/import|auth\.ts$|auth\.config\.ts$|proxy\.ts$)/.test(r) },
    { name: "F. Tests", test: (r) => r.startsWith("tests/") },
    { name: "D. Database / Seed", test: (r) => /^(prisma\/|scripts\/)/.test(r) },
    { name: "E. Workflow modules", test: (r) => r.startsWith("lib/workflow/") },
    { name: "B. Application source", test: (r) => /^(app\/|components\/|lib\/)/.test(r) },
    { name: "G. Config / Other", test: () => true },
];

function categorise(rel) {
    return (CATEGORIES.find((c) => c.test(rel)) || CATEGORIES[CATEGORIES.length - 1]).name;
}

const lines = fs.readFileSync(reportPath, "utf8").split(/\r?\n/);

const byCategory = {};
const byRule = {};
const errorsByCategory = {};
let currentFile = null;
let errors = 0;
let warnings = 0;

for (const raw of lines) {
    const line = raw.replace(/\r$/, "");

    if (line.trim() === "") {
        currentFile = null;
        continue;
    }

    // A file header has no leading whitespace and is an absolute path.
    if (!/^\s/.test(line) && /\.(ts|tsx|js|cjs|mjs|jsx)$/i.test(line)) {
        const abs = line.trim().split("\\").join("/");
        currentFile = abs.startsWith(root) ? abs.slice(root.length) : abs;
        continue;
    }

    const m = line.match(/^\s+(\d+):(\d+)\s+(error|warning)\s+(.*?)\s{2,}(\S+)\s*$/);
    if (!m || !currentFile) continue;

    const severity = m[3];
    const message = m[4].trim();
    const rule = m[5];

    const cat = categorise(currentFile);
    if (!byCategory[cat]) byCategory[cat] = { errors: 0, warnings: 0 };
    byCategory[cat][severity === "error" ? "errors" : "warnings"]++;

    if (severity === "error") {
        errors++;
        errorsByCategory[cat] = (errorsByCategory[cat] || 0) + 1;
    } else {
        warnings++;
    }

    const ruleKey = `${rule} (${severity})`;
    if (!byRule[ruleKey]) byRule[ruleKey] = { count: 0, files: new Set() };
    byRule[ruleKey].count++;
    byRule[ruleKey].files.add(currentFile);
}

console.log("=".repeat(72));
console.log("LINT CLASSIFICATION");
console.log("=".repeat(72));
console.log(`Total problems: ${errors + warnings}`);
console.log(`Errors:         ${errors}`);
console.log(`Warnings:       ${warnings}`);
console.log("");

console.log("BY CATEGORY");
console.log("-".repeat(72));
const ordered = ["A. Generated code", "C. Auth / RBAC", "F. Tests", "D. Database / Seed", "E. Workflow modules", "B. Application source", "G. Config / Other"];
for (const name of ordered) {
    const c = byCategory[name] || { errors: 0, warnings: 0 };
    console.log(`  ${name.padEnd(24)} errors=${String(c.errors).padEnd(5)} warnings=${c.warnings}`);
}

console.log("");
console.log("TOP 10 RULES BY ERROR COUNT");
console.log("-".repeat(72));
const topErrors = Object.entries(byRule)
    .filter(([k]) => k.endsWith("(error)"))
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10);
for (const [rule, info] of topErrors) {
    console.log(`  ${String(info.count).padStart(4)}  ${rule.replace(" (error)", "").padEnd(46)} ${info.files.size} file(s)`);
}

console.log("");
console.log("TOP 10 RULES BY WARNING COUNT");
console.log("-".repeat(72));
const topWarnings = Object.entries(byRule)
    .filter(([k]) => k.endsWith("(warning)"))
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10);
for (const [rule, info] of topWarnings) {
    console.log(`  ${String(info.count).padStart(4)}  ${rule.replace(" (warning)", "").padEnd(46)} ${info.files.size} file(s)`);
}

console.log("");
console.log("ERROR FILES BY CATEGORY (top 20)");
console.log("-".repeat(72));
const errFiles = {};
for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    if (!/^\s/.test(line) && /\.(ts|tsx|js|cjs|mjs|jsx)$/i.test(line)) {
        const abs = line.trim().split("\\").join("/");
        currentFile = abs.startsWith(root) ? abs.slice(root.length) : abs;
        errFiles[currentFile] = errFiles[currentFile] || { e: 0, w: 0 };
        continue;
    }
    const m = line.match(/^\s+\d+:\d+\s+(error|warning)\s/);
    if (m && currentFile) errFiles[currentFile][m[1] === "error" ? "e" : "w"]++;
}
const sortedErrs = Object.entries(errFiles)
    .filter(([, v]) => v.e > 0)
    .sort((a, b) => b[1].e - a[1].e);
for (const [file, v] of sortedErrs.slice(0, 20)) {
    console.log(`  ${String(v.e).padStart(4)} err  ${String(v.w).padStart(4)} warn  ${file}`);
}
