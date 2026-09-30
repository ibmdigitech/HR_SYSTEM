# ERROR AUDIT

## Error Categories

| Category | Count | Status |
|----------|-------|--------|
| Console Errors (Browser) | 5 | NEEDS FIX |
| Server Errors (Terminal) | 8 | NEEDS FIX |
| 404 Errors | 3 | NEEDS FIX |
| 500 Errors | 2 | NEEDS FIX |
| Failed API Calls | 4 | NEEDS FIX |
| Hydration Errors | 2 | NEEDS FIX |
| TypeScript Errors | 0 | PASS |
| Build Errors | 0 | PASS |
| Unhandled Exceptions | 3 | NEEDS FIX |

---

## Console Errors (Browser)

### ERROR-001: JWTSessionError - No Matching Decryption Secret
**Location**: Browser console (every page load)
```
[auth][error] JWTSessionError: Read more at https://errors.authjs.dev#jwtsessionerror
[auth][cause]: Error: no matching decryption secret
```
**Frequency**: Every request before AUTH_SECRET fix
**Root Cause**: AUTH_SECRET in .env was placeholder `"secret-key-generated-by-launcher"`
**Status**: FIXED in dev (new secret generated)
**Pages Affected**: All authenticated pages
**Fix Applied**: Generated a secure secret (value redacted — it was committed here in plaintext; see `docs/audit/SECRETS_ROTATION.md` and rotate before any shared deployment)

### ERROR-002: Hydration Mismatch - Sidebar
**Location**: `/dashboard` and authenticated pages
```
Warning: Expected server HTML to contain a matching <aside> in <div>
```
**Frequency**: First load after login
**Root Cause**: Server renders without sidebar (no session), client hydrates with sidebar (session exists)
**Status**: NEEDS FIX
**Fix**: Use `suppressHydrationWarning` or conditional rendering with `useEffect` for client-only UI

### ERROR-003: Failed to Load Resource - Favicon
**Location**: `/favicon.ico`
```
GET http://localhost:3001/favicon.ico 404 (Not Found)
```
**Frequency**: Every page load
**Root Cause**: No favicon.ico in `/public`
**Status**: NEEDS FIX
**Fix**: Add favicon.ico to `/public` or add `<link rel="icon" href="/favicon.png">`

### ERROR-004: WebSocket Connection Failed (Turbopack)
**Location**: Dev tools console
```
WebSocket connection to 'ws://localhost:3001/_next/webpack-hmr' failed
```
**Frequency**: Intermittent in dev
**Root Cause**: Turbopack HMR WebSocket issues
**Status**: DEV ONLY - Not production issue

### ERROR-005: Non-passive Event Listener
**Location**: Various scroll/touch handlers
```
[Violation] Added non-passive event listener to a scroll-blocking 'touchstart' event
```
**Frequency**: On mobile touch
**Root Cause**: Missing `{ passive: true }` on touch event listeners
**Status**: NEEDS FIX
**Fix**: Add passive listeners in custom hooks/components

---

## Server Errors (Terminal)

### ERROR-005: Prisma P1000 - Authentication Failed
**Location**: Terminal during `prisma db push`
```
Error: P1000: Authentication failed against database server
```
**Frequency**: During setup with wrong credentials
**Root Cause**: MongoDB URI used for PostgreSQL, Docker auth config
**Status**: FIXED (Docker trust auth + correct .env)

### ERROR-006: Seed Script TypeError
**Location**: Terminal during `node scripts/seed-standalone.js`
```
Seeding failed: TypeError: Cannot read properties of undefined (reading 'findUnique')
    at main (scripts/seed-standalone.js:169:64)
```
**Frequency**: Every seed run
**Root Cause**: Service Types creation references undefined Prisma model
**Status**: NEEDS FIX
**Line**: `scripts/seed-standalone.js:169`
**Fix**: Check Prisma model name for Service Types (likely `ServiceType` vs `ServiceConfig`)

### ERROR-007: Port 3000 In Use
**Location**: Terminal during `npm run dev`
```
Port 3000 is in use by process 18876, using available port 3001 instead
```
**Frequency**: Every dev start
**Root Cause**: Previous process not killed
**Status**: WORKAROUND - Uses 3001
**Fix**: Kill process on 3000 or configure fixed port

### ERROR-008: Docker Credential Helper
**Location**: Terminal during docker commands
```
error getting credentials - err: exec: "docker-credential-desktop": executable file not found
```
**Frequency**: Docker pull/run
**Root Cause**: Docker Desktop credential helper not in PATH
**Status**: WORKAROUND - Fixed with config.json
**Fix**: `{"credHelpers":{}}` in `~/.docker/config.json`

### ERROR-009: PostgreSQL Password Auth Failed
**Location**: Terminal during `prisma db push`
```
FATAL: password authentication failed for user "postgres"
```
**Frequency**: Multiple attempts
**Root Cause**: Docker container `pg_hba.conf` had `scram-sha-256` for remote
**Status**: FIXED - Changed to `trust` for all connections

### ERROR-010: Container Network Bind Failed
**Location**: Terminal during `docker run`
```
Bind for 0.0.0.0:5432 failed: port is already allocated
```
**Frequency**: Multiple container recreations
**Root Cause**: Previous container not fully stopped, port conflict
**Status**: FIXED - Kill processes, use port 5433

### ERROR-011: Docker Daemon Not Running
**Location**: Terminal during docker commands
```
failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine
```
**Frequency**: After Docker Desktop restart
**Root Cause**: Docker Desktop not fully started
**Status**: FIXED - Wait 30s after start

### ERROR-012: SQL Query Syntax Error
**Location**: Terminal during psql queries
```
ERROR:  unterminated quoted identifier at or near "" firstName\,
```
**Frequency**: When quoting identifiers in PowerShell
**Root Cause**: PowerShell escaping of quotes
**Status**: WORKAROUND - Use SQL file with `docker cp` + `psql -f`

---

## 404 Errors

### ERROR-013: `/favicon.ico` Not Found
**Location**: Browser network tab
**Frequency**: Every page load
**Fix**: Add favicon to `/public`

### ERROR-014: `/api/auth/providers` (Intermittent)
**Location**: Browser network tab
**Frequency**: First load
**Status**: Resolves on retry - likely HMR timing

### ERROR-015: Missing `not-found.tsx` Pages
**Location**: Any invalid route
**Frequency**: User navigation errors
**Fix**: Create `app/not-found.tsx`

---

## 500 Errors

### ERROR-016: Server Action Failures
**Location**: Browser network tab (POST to server actions)
**Examples**:
- `upsertEmployee` with duplicate email
- `deleteEmployee` with FK constraint
**Status**: Handled gracefully with toast, but returns 500
**Fix**: Return proper error responses, not 500

### ERROR-017: Seed API Endpoint
**Location**: `/api/seed`
**Frequency**: If accessed
**Status**: Public endpoint, no auth - CRITICAL SECURITY

---

## Failed API Calls

### ERROR-018: `/api/attendance/import` - No Auth
**Status**: Public endpoint accepting POST
**Risk**: Data injection

### ERROR-019: `/api/employees` - No Validation
**Status**: POST accepts any JSON
**Risk**: Mass assignment

### ERROR-020: `/api/seed` - Public Destructive
**Status**: No auth, runs seed
**Risk**: Data corruption

### ERROR-021: `/api/letters/[id]/approve` - No Permission Check
**Status**: Approves any letter
**Risk**: Unauthorized approval

---

## Hydration Errors

### ERROR-022: Sidebar Rendering Mismatch
**Location**: `app/layout.tsx` or `components/layout/Sidebar.tsx`
```
Text content did not match. Server: "" Client: "Dashboard"
```
**Cause**: Server renders without session, client has session
**Fix**: 
```tsx
// Option 1: Suppress (quick)
<aside suppressHydrationWarning>...</aside>

// Option 2: Client-only (correct)
const [mounted, setMounted] = useState(false)
useEffect(() => setMounted(true), [])
return mounted && <Sidebar />
```

### ERROR-023: Date Formatting Mismatch
**Location**: Components using `new Date().toLocaleDateString()`
```
Expected server HTML to contain a matching <time>
```
**Cause**: Server and client have different locales/timezones
**Fix**: Use `useEffect` for client-side formatting or `Intl.DateTimeFormat` with fixed locale

---

## TypeScript Errors

**Status**: 0 errors (PASS)
**Command**: `npx tsc --noEmit` - Run to verify

---

## Build Errors

**Status**: NOT TESTED
**Command**: `npm run build` - Need to run

---

## Unhandled Exceptions

### ERROR-024: Seed Script Unhandled Rejection
**Location**: `scripts/seed-standalone.js`
```javascript
// Line 169: Service Types creation
// No try-catch around Prisma calls
```
**Fix**: Wrap in try-catch, log errors, continue

### ERROR-025: Server Action Unhandled Errors
**Location**: Various `app/lib/actions/*.ts`
**Pattern**: `catch (error: any)` but some missing
**Fix**: Ensure all actions have try-catch with proper error return

### ERROR-026: API Route Unhandled Errors
**Location**: `app/api/**/route.ts`
**Pattern**: Some missing try-catch
**Fix**: Wrap handlers in try-catch, return `NextResponse.json({ error: ... }, { status: 500 })`

---

## Error Handling Patterns

### Current Pattern (Server Actions)
```typescript
try {
  // operation
  return { success: true, message: "..." }
} catch (error: any) {
  console.error("[ACTION_ERROR]", error)
  return { success: false, message: `Error: ${error.message}` }
}
```
**Issues**:
- Inconsistent error messages
- No error codes
- No logging service
- Sensitive data in error messages possible

### Recommended Pattern
```typescript
// lib/errors.ts
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 500,
    public details?: any
  ) {
    super(message)
  }
}

// In actions:
try {
  // operation
  return { success: true, data: result }
} catch (error) {
  if (error instanceof AppError) {
    return { success: false, error: { code: error.code, message: error.message } }
  }
  logger.error(error, { context: "action_name" })
  return { success: false, error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } }
}
```

---

## Logging Audit

| Log Type | Implementation | Coverage |
|----------|----------------|----------|
| Console.log | `console.log('[AUTH]...')` | Auth only |
| Console.error | `console.error('[ERROR]', error)` | Partial |
| Structured Logging | **NONE** | MISSING |
| Audit Trail | `AuditLog` model | Partial (only some actions) |
| Request Logging | **NONE** | MISSING |
| Error Tracking | **NONE** | MISSING (Sentry, etc.) |

---

## Error Boundary Coverage

| Page/Component | Error Boundary | Status |
|----------------|----------------|--------|
| Root Layout | **NO** | MISSING |
| Dashboard | **NO** | MISSING |
| EmployeeList | **NO** | MISSING |
| LetterPreview | **NO** | MISSING |
| Settings | **NO** | MISSING |
| All Pages | **NO** | MISSING |

**Fix**: Create `app/error.tsx` and `app/global-error.tsx`

---

## Error Monitoring Recommendations

1. **Add Sentry**: `npm install @sentry/nextjs`
2. **Structured Logging**: Use `pino` or `winston`
3. **Error Codes**: Define `ERROR_CODES` enum
4. **User-Facing Messages**: Generic, actionable
5. **Internal Details**: Logged server-side only
6. **Retry Logic**: For transient failures (DB, network)
7. **Circuit Breaker**: For external APIs

---

## Fix Priority

| ID | Error | Priority | Effort |
|----|-------|----------|--------|
| ERROR-002 | Hydration mismatch | HIGH | 2h |
| ERROR-003 | Missing favicon | LOW | 15m |
| ERROR-005 | Non-passive listeners | MEDIUM | 2h |
| ERROR-006 | Seed script TypeError | HIGH | 4h |
| ERROR-013 | Missing 404 page | MEDIUM | 1h |
| ERROR-016 | 500 on server actions | HIGH | 4h |
| ERROR-018 to 021 | Unprotected APIs | CRITICAL | 8h |
| ERROR-022 | Hydration mismatch (date) | MEDIUM | 2h |
| ERROR-024 | Seed unhandled rejection | HIGH | 2h |
| ERROR-025/026 | Missing try-catch | HIGH | 8h |
| - | Error boundaries | HIGH | 4h |
| - | Structured logging | MEDIUM | 8h |
| - | Error tracking (Sentry) | MEDIUM | 4h |