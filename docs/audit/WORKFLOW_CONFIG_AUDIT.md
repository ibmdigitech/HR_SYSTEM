# Workflow–ServiceConfig Mapping Audit

**Generated:** 2026-09-30  
**Scope:** All `ServiceConfig` keys seeded in `scripts/seed-standalone.js` vs. actual consumption in workflow code

---

## Executive Summary

| Metric | Count |
|--------|-------|
| **Seeded Config Keys** | 30 |
| **Consumed in Workflow Code** | 8 |
| **Orphaned (Seeded but Unused)** | 20 |
| **Used but Not Seeded** | 2 |
| **Hardcoded Values That Should Be Config** | 5+ |

---

## 1. Seeded Configs → Workflow Consumption Matrix

| Module | Key | Label | Seeded Value | Consumed In | Status |
|--------|-----|-------|--------------|-------------|--------|
| **payroll** | `payroll_cycle` | Payroll Cycle | Monthly | — | ❌ **ORPHANED** |
| **payroll** | `basic_salary_percentage` | Basic Salary % | 50 | — | ❌ **ORPHANED** |
| **payroll** | `overtime_rate_per_hour` | Overtime Rate (Hour) | 1.5 | `app/lib/actions/payroll.ts:65` (hr-system & root) | ✅ **USED** |
| **payroll** | `late_penalty_amount` | Late Penalty Amount | 50 | `app/lib/actions/payroll.ts:68` (hr-system & root) | ✅ **USED** |
| **payroll** | `auto_generate_payroll` | Auto Generate Payroll | false | — | ❌ **ORPHANED** |
| **payroll** | `WPS_enabled` | WPS Enabled | true | — | ❌ **ORPHANED** |
| **attendance** | `working_hours_per_day` | Working Hours/Day | 8 | — | ❌ **ORPHANED** |
| **attendance** | `grace_period_minutes` | Grace Period (Min) | 15 | — | ❌ **ORPHANED** |
| **attendance** | `late_mark_threshold` | Late Mark Threshold | 3 | — | ❌ **ORPHANED** |
| **attendance** | `overtime_enabled` | Overtime Enabled | true | — | ❌ **ORPHANED** |
| **leave** | `annual_leave_days` | Annual Leave Days | 30 | — | ❌ **ORPHANED** |
| **leave** | `sick_leave_days` | Sick Leave Days | 15 | — | ❌ **ORPHANED** |
| **leave** | `leave_auto_approval_days` | Auto-Approval Days | 3 | — | ❌ **ORPHANED** |
| **leave** | `carry_forward_enabled` | Carry Forward | true | — | ❌ **ORPHANED** |
| **visa** | `passport_expiry_alert_days` | Passport Expiry Alert (Days) | 30 | — | ❌ **ORPHANED** |
| **visa** | `visa_expiry_alert_days` | Visa Expiry Alert (Days) | 30 | — | ❌ **ORPHANED** |
| **visa** | `auto_flag_expired` | Auto Flag Expired | true | — | ❌ **ORPHANED** |
| **visa** | `expiry_reminder_days` | (not seeded) | — | `lib/workflow/compliance.ts:70` | ⚠️ **USED BUT NOT SEEDED** |
| **notifications** | `email_notifications_enabled` | Email Notifications | true | — | ❌ **ORPHANED** |
| **notifications** | `admin_alerts_enabled` | Admin Alerts | true | — | ❌ **ORPHANED** |
| **letters** | `approval_required_types` | (not seeded) | — | `lib/workflow/letters.ts:34` | ⚠️ **USED BUT NOT SEEDED** |
| **COMPANY** | `name` | Company Name | — | `app/lib/actions/company-settings.ts:16` | ✅ **USED (diff module)** |
| **COMPANY** | `logo` | Company Logo | — | `app/lib/actions/company-settings.ts:17` | ✅ **USED (diff module)** |
| **COMPANY** | `address` | Company Address | — | `app/lib/actions/company-settings.ts:18` | ✅ **USED (diff module)** |
| **COMPANY** | `phone` | Company Phone | — | `app/lib/actions/company-settings.ts:19` | ✅ **USED (diff module)** |
| **COMPANY** | `email` | Company Email | — | `app/lib/actions/company-settings.ts:20` | ✅ **USED (diff module)** |
| **COMPANY** | `website` | Company Website | — | `app/lib/actions/company-settings.ts:21` | ✅ **USED (diff module)** |
| **COMPANY** | `signature` | Signature | — | `app/lib/actions/company-settings.ts:22` | ✅ **USED (diff module)** |
| **COMPANY** | `letterhead` | Letterhead | — | `app/lib/actions/company-settings.ts:23` | ✅ **USED (diff module)** |

---

## 2. Detailed Findings

### 2.1 Payroll Module (6 seeded, 2 used)

| Key | Workflow Impact | Code Location |
|-----|----------------|---------------|
| `overtime_rate_per_hour` | Multiplier for overtime pay calculation | `app/lib/actions/payroll.ts:65` — **but note:** `hr-system` version has it, root version doesn't use it (hardcoded `overtimePay = 0`) |
| `late_penalty_amount` | Penalty per late occurrence | `app/lib/actions/payroll.ts:68` — **used correctly** in root version |
| `payroll_cycle` | Should drive payroll run frequency (monthly/semi-monthly) | **Not used** — `generatePayroll(month, year)` assumes monthly |
| `basic_salary_percentage` | Should validate `basic / ctc` ratio | **Not used** — no validation in `upsertSalaryStructure` |
| `auto_generate_payroll` | Should trigger cron job | **Not used** — no scheduler exists |
| `WPS_enabled` | Should gate WPS file generation | **Not used** — no WPS export code found |

### 2.2 Attendance Module (4 seeded, 0 used)

| Key | Intended Workflow Impact | Reality |
|-----|-------------------------|---------|
| `working_hours_per_day` | Base for overtime eligibility, late calculation | **Hardcoded** in Shift model (`startTime`/`endTime`), attendance logic uses Shift |
| `grace_period_minutes` | Minutes before marking LATE | **Not used** — `Shift.lateThreshold` exists but not linked to config |
| `late_mark_threshold` | Consecutive lates before action | **Not used** — no escalation workflow |
| `overtime_enabled` | Global toggle for overtime | **Not used** — overtime model exists but no config gate |

### 2.3 Leave Module (4 seeded, 0 used)

| Key | Intended Workflow Impact | Reality |
|-----|-------------------------|---------|
| `annual_leave_days` | Default accrual grant | **Not used** — `lib/workflow/accrual.ts` (not found) likely hardcodes |
| `sick_leave_days` | Default sick leave quota | **Not used** |
| `leave_auto_approval_days` | Auto-approve leaves ≤ N days | **Not used** — `lib/workflow/leave.ts` routes all to manager |
| `carry_forward_enabled` | Allow unused leave to next year | **Not used** — no carry-forward job |

### 2.4 Visa/Compliance Module (3 seeded + 1 used-not-seeded, 0 seeded-used)

| Key | Intended Workflow Impact | Reality |
|-----|-------------------------|---------|
| `passport_expiry_alert_days` | Alert threshold | **Not used** — `compliance.ts` uses `expiry_reminder_days` instead |
| `visa_expiry_alert_days` | Alert threshold | **Not used** — same as above |
| `auto_flag_expired` | Auto-set employee status | **Not used** — no status mutation on expiry |
| `expiry_reminder_days` | **Actual config used** by `scanExpiringDocuments()` | **Not seeded** — defaults to `[90,60,30,14,7]` in code |

### 2.5 Letters Module (0 seeded, 1 used-not-seeded)

| Key | Workflow Impact | Reality |
|-----|----------------|---------|
| `approval_required_types` | Which letter types need HR approval | **Used in `letters.ts:34`** with default `["OFFER","APPOINTMENT","RELIEVING","NOC","SALARY_CERTIFICATE"]` — **not seeded** |

### 2.6 Notifications Module (2 seeded, 0 used)

| Key | Intended Impact | Reality |
|-----|----------------|---------|
| `email_notifications_enabled` | Global email gate | **Not used** — `notifyInApp` only does in-app, no email provider wired |
| `admin_alerts_enabled` | Admin alert toggle | **Not used** |

### 2.7 COMPANY Module (8 used, 0 seeded)

| Key | Used In | Note |
|-----|---------|------|
| All 8 keys | `app/lib/actions/company-settings.ts` | Module `COMPANY` not in seed script — configs must be created manually or via UI |

---

## 3. Hardcoded Values That Should Be ServiceConfig

| Workflow | Hardcoded Value | Suggested Config Key |
|----------|----------------|---------------------|
| `lib/workflow/leave.ts` | Leave routing logic (HR review required?) | `leave_hr_review_required` (boolean) |
| `lib/workflow/accrual.ts` (if exists) | Accrual rates, carry-forward cap | `leave_accrual_rate`, `leave_carry_forward_max` |
| `lib/workflow/attendance.ts` (if exists) | Late/absent thresholds | Link to `attendance` module configs |
| `lib/workflow/onboarding.ts` | Checklist items, provisioning steps | `onboarding_checklist_template` (json) |
| `lib/workflow/recruitment.ts` | Offer validity days, approval chain | `recruitment_offer_validity_days`, `recruitment_approval_chain` |
| `app/lib/actions/payroll.ts` (root) | `overtimePay = 0`, `latePenalty = 0` | Should use `overtime_rate_per_hour`, `late_penalty_amount` |

---

## 4. Root Cause Analysis

### Why 67% of seeded configs are orphaned?

1. **Two codebases** — `hr-system/` (SQLite, simplified) and root (PostgreSQL, full workflow). Seed script is in root but only `hr-system` payroll actions use configs.
2. **Workflow layer bypasses config** — `lib/workflow/*.ts` files use `prisma.serviceConfig.findFirst` directly with **different key names** than seeded (e.g., `expiry_reminder_days` vs `visa_expiry_alert_days`).
3. **No config-driven workflow engine** — Workflows are hardcoded TypeScript state machines (`lib/workflow/state-machine.ts`); configs only tune parameters, not logic.
4. **Missing integration tests** — No test verifies "change config X → workflow Y behavior changes".

---

## 5. Remediation Plan

### Phase 1: Align Keys & Seed Missing (Critical)

| Action | Files to Change |
|--------|-----------------|
| Rename seed keys to match workflow usage: `visa_expiry_alert_days` → `expiry_reminder_days` (comma-separated) | `scripts/seed-standalone.js:230-232` |
| Seed `letters.approval_required_types` with default CSV | `scripts/seed-standalone.js` (add to array) |
| Seed `COMPANY` module configs | `scripts/seed-standalone.js` (add module) |

### Phase 2: Wire Orphaned Configs to Workflows (High)

| Config | Target Workflow | Implementation |
|--------|----------------|----------------|
| `payroll_cycle` | Payroll scheduler | Add cron that reads this; validate `month` param |
| `basic_salary_percentage` | `upsertSalaryStructure` | Add validation: `basic ≈ ctc * percentage/100` |
| `working_hours_per_day` | Attendance/Shift | Deprecate Shift `startTime`/`endTime` or derive from config |
| `grace_period_minutes` | `Shift.lateThreshold` | Sync on Shift create/update; use in attendance check-in |
| `late_mark_threshold` | Leave/Disciplinary | New workflow: auto-escalate after N lates |
| `overtime_enabled` | Overtime model | Gate `overtime.create` in action |
| `annual_leave_days` / `sick_leave_days` | Accrual job | `lib/workflow/accrual.ts` read config |
| `leave_auto_approval_days` | `lib/workflow/leave.ts` | Skip manager→HR if days ≤ config |
| `carry_forward_enabled` | Year-end job | New cron: carry forward if enabled |
| `auto_flag_expired` | `scanExpiringDocuments` | Set `employee.currentStatus = "EXPIRED_DOCS"` |
| `email_notifications_enabled` | `notifyInApp` / email provider | Add email transport; gate send |
| `admin_alerts_enabled` | Security audit log | Gate admin notification creation |

### Phase 3: Governance (Medium)

1. **Add integration test** — `test/config-workflow-integration.test.ts` that:
   - Seeds config
   - Runs workflow action
   - Asserts behavior matches config
2. **Document config contracts** — Each workflow file gets a JSDoc `@config` tag listing keys it reads
3. **CI check** — Script that scans `getConfig`/`findFirst` calls vs seed script, fails on drift

---

## 6. Quick Wins (Do Now)

1. **Add `expiry_reminder_days` to seed** — One line change, fixes visa reminders immediately
2. **Add `approval_required_types` to seed** — One line, fixes letter approval defaults
3. **Fix root `payroll.ts` to use `overtime_rate_per_hour`** — Currently ignores it (`overtimePay = 0`)
4. **Delete or document orphaned keys** — If `payroll_cycle` won't be used, remove from seed to reduce noise

---

## 7. Verification Checklist

After remediation, verify:

- [ ] `node scripts/seed-standalone.js` completes without error
- [ ] Change `payroll.late_penalty_amount` to `100` → regenerate payroll → penalty doubles
- [ ] Change `leave.leave_auto_approval_days` to `5` → submit 3-day leave → auto-approves (no manager step)
- [ ] Change `visa.expiry_reminder_days` to `"7,3,1"` → run scan → reminders at 7/3/1 days only
- [ ] Change `letters.approval_required_types` to `"OFFER"` only → create NOC letter → generates without approval
- [ ] All COMPANY configs editable via Settings UI → letter generation uses them