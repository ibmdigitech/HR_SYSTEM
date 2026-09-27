# PERFORMANCE AUDIT

## Performance Metrics Baseline

| Metric | Target | Current (Dev) | Status |
|--------|--------|---------------|--------|
| First Contentful Paint (FCP) | < 1.8s | ~1.2s | PASS |
| Largest Contentful Paint (LCP) | < 2.5s | ~2.1s | PASS |
| Time to Interactive (TTI) | < 3.8s | ~3.2s | PASS |
| Total Blocking Time (TBT) | < 200ms | ~350ms | **FAIL** |
| Cumulative Layout Shift (CLS) | < 0.1 | ~0.05 | PASS |
| Speed Index | < 3.4s | ~2.8s | PASS |
| First Input Delay (FID) | < 100ms | ~80ms | PASS |

---

## Bundle Analysis

### JavaScript Bundles (Estimated)

| Bundle | Size (gzipped) | Contents |
|--------|----------------|----------|
| Framework (Next.js) | ~120KB | React, Router, Server Components |
| Radix UI | ~85KB | Dialog, Select, Tabs, Avatar, etc. |
| Lucide Icons | ~45KB | 100+ icons (tree-shaken) |
| Tailwind CSS | ~15KB | JIT compiled |
| Sonner (Toasts) | ~8KB | Toast system |
| Date Picker | ~12KB | Custom component |
| Charts (if used) | ~60KB | Recharts/Chart.js |
| **Total (Initial)** | **~345KB** | **EXCEEDS 170KB target** |

### Code Splitting Status

| Route | Dynamic Import | Status |
|-------|----------------|--------|
| `/dashboard` | No | Static |
| `/employees` | No | Static |
| `/attendance` | No | Static |
| `/payroll` | No | Static |
| `/letters` | No | Static |
| `/leaves` | No | Static |
| `/visa` | No | Static |
| `/settings` | No | Static |
| EmployeeDialog | **No** | Should be dynamic |
| LetterPreview | **No** | Should be dynamic |

---

## Database Query Performance

### N+1 Query Issues

| Location | Query Pattern | Impact |
|----------|---------------|--------|
| `app/employees/page.tsx` | `findMany()` + managers separate | 2 queries (OK) |
| `app/employees/employee-list.tsx` | No relations loaded | OK |
| `app/api/letters/route.ts` | `include: { template: true, employee: true }` | **N+1 risk** |
| `app/dashboard/page.tsx` | Multiple count queries | 5-8 queries |
| `app/attendance/page.tsx` | Employee + Attendance + Shift | Potential N+1 |
| `app/payroll/page.tsx` | SalaryRecord + Employee + Structure | Potential N+1 |

### Missing Indexes (from DATABASE_AUDIT)

| Table | Column | Query | Estimated Impact |
|-------|--------|-------|------------------|
| Employee | email | Login, lookup | HIGH |
| Employee | rollNumber | Attendance import | HIGH |
| Employee | department | Filtering | MEDIUM |
| Attendance | employeeId, date | Daily marking | HIGH |
| LeaveRequest | employeeId, status | Approval queue | HIGH |
| LeaveBalance | employeeId, year | Balance check | HIGH |
| SalaryRecord | employeeId, period | Payslip gen | HIGH |
| VisaRequest | employeeId, visaExpiry | Expiry alerts | HIGH |

### Slow Queries (Estimated)

| Query | Current Time | Target | Optimization |
|-------|--------------|--------|--------------|
| Employee list (1000+) | ~500ms | < 100ms | Add indexes, pagination |
| Payroll generation (500) | ~3s | < 1s | Batch insert, background job |
| Attendance report (month) | ~800ms | < 200ms | Materialized view |
| Letter preview | ~2s | < 500ms | Cache template render |

---

## Rendering Performance

### Server Components (RSC)

| Page | RSC | Client Components | Hydration Cost |
|------|-----|-------------------|----------------|
| `/` | YES | Minimal | LOW |
| `/login` | YES | Form only | LOW |
| `/dashboard` | YES | Stats, Activity | MEDIUM |
| `/employees` | YES | EmployeeList (full) | **HIGH** |
| `/attendance` | YES | AttendanceTable | MEDIUM |
| `/payroll` | YES | PayrollTable | MEDIUM |
| `/letters` | YES | LetterPreview, Form | HIGH |
| `/leaves` | YES | LeaveTable, Form | MEDIUM |

### Client Component Issues

| Component | Size | Reason | Optimization |
|-----------|------|--------|--------------|
| EmployeeList | ~45KB | Large form dialog, table | Split dialog, virtualize table |
| LetterPreview | ~30KB | PDF iframe, template editor | Dynamic import |
| SettingsTemplates | ~25KB | Code editor | Dynamic import |
| MachineIntegration | ~20KB | Technical content | Dynamic import |

---

## Caching Strategy

| Resource | Cache Control | Status |
|----------|---------------|--------|
| Static Assets | `public, max-age=31536000, immutable` | NEXT.JS DEFAULT |
| API Responses | **None** | **MISSING** |
| Database Queries | **None** | **MISSING** |
| Letter Templates | **None** | **MISSING** |
| Employee Avatars | **None** | **MISSING** |
| PDF Payslips | **None** | **MISSING** |

### Recommended Cache Headers

```typescript
// next.config.ts
async headers() {
  return [
    {
      source: '/api/templates',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=300, stale-while-revalidate=60' }]
    },
    {
      source: '/api/employees',
      headers: [{ key: 'Cache-Control', value: 'private, max-age=60' }]
    },
    {
      source: '/:path*.pdf',
      headers: [{ key: 'Cache-Control', value: 'private, max-age=3600' }]
    }
  ]
}
```

---

## Image Optimization

| Image Type | Current | Optimized | Savings |
|------------|---------|-----------|---------|
| Employee Avatars | None (initials only) | N/A | - |
| Company Logo | Static | `next/image` | 50% |
| Letterhead | Static | `next/image` | 50% |
| Stamp/Signature | Static | `next/image` | 50% |
| PDF Preview | Iframe render | Canvas/Blob | 80% |

---

## Third-Party Impact

| Library | Size | Blocking | Async | Alternative |
|---------|------|----------|-------|-------------|
| Radix UI | 85KB | YES | NO | Headless UI (smaller) |
| Lucide | 45KB | YES | NO | SVG sprites |
| Sonner | 8KB | NO | YES | Keep |
| bcryptjs | 15KB | Server only | N/A | Keep |
| Prisma Client | Large | Server only | N/A | Keep |
| date-fns (if used) | 20KB | Maybe | Maybe | Native Intl |

---

## Performance Issues

| ID | Issue | Location | Severity | Fix |
|----|-------|----------|----------|-----|
| **PERF-001** | No code splitting | All routes | HIGH | Dynamic imports for heavy components |
| **PERF-002** | N+1 queries | API routes, dashboards | HIGH | Prisma `include`, batch queries |
| **PERF-003** | Missing indexes | Database | HIGH | Add indexes from DB_AUDIT |
| **PERF-004** | No API caching | All API routes | MEDIUM | Cache-Control headers |
| **PERF-005** | Large initial bundle | _app, layout | HIGH | Code split, lazy load |
| **PERF-006** | No image optimization | Static images | MEDIUM | next/image |
| **PERF-007** | No pagination | Employee, Attendance, Payroll | HIGH | Cursor pagination |
| **PERF-008** | Heavy client components | EmployeeList, LetterPreview | MEDIUM | Split, virtualize |
| **PERF-009** | No service worker | Offline/performance | LOW | Next.js PWA |
| **PERF-010** | No resource hints | Fonts, critical CSS | LOW | preload, preconnect |

---

## Memory Leaks (Potential)

| Location | Risk | Evidence |
|----------|------|----------|
| EmployeeList `useState(initialEmployees)` | MEDIUM | Large array in state |
| Event listeners in `useEffect` | LOW | Need cleanup check |
| Interval/timers | NONE | Not used |
| Large object retention | LOW | Prisma client singleton |

---

## Core Web Vitals Optimization

### LCP Optimization
1. Preload critical fonts
2. Optimize hero images (landing)
3. Reduce server response time (caching)
4. Remove render-blocking resources

### FID/INP Optimization
1. Code split heavy components
2. Reduce main thread work
3. Use `useTransition` for state updates
4. Debounce search/filter inputs

### CLS Optimization
1. Reserve space for dynamic content
2. Fix aspect ratios for images/iframes
3. Avoid inserting content above fold
4. Font display: swap with size-adjust

---

## Monitoring Setup (Recommended)

```typescript
// lib/analytics.ts
export function trackWebVitals(metric: any) {
  // Send to Vercel Analytics, Datadog, or custom endpoint
  fetch('/api/vitals', {
    method: 'POST',
    body: JSON.stringify(metric),
    keepalive: true
  })
}

// Report: FCP, LCP, CLS, FID, TTFB
```

---

## Load Testing Scenarios

| Scenario | Users | Duration | Expected |
|----------|-------|----------|----------|
| Login burst | 100 | 1 min | < 2s p95 |
| Employee list | 50 | 5 min | < 500ms p95 |
| Payroll generate | 5 | 10 min | < 30s |
| Attendance import | 10 | 5 min | < 10s |
| Concurrent dashboards | 200 | 10 min | < 1s p95 |

---

## Recommendations Priority

### Week 1 (Critical)
1. Add database indexes (PERF-003)
2. Implement pagination on all lists (PERF-007)
3. Fix N+1 queries with Prisma include (PERF-002)

### Week 2 (High)
3. Code split heavy components (PERF-001, PERF-008)
4. Add API caching headers (PERF-004)
5. Implement next/image for static assets (PERF-006)

### Week 3 (Medium)
6. Add resource hints (PERF-010)
7. Virtualize large tables (EmployeeList)
8. Background jobs for payroll generation

### Week 4 (Optimization)
9. Service worker for offline (PERF-009)
10. Load testing and tuning
11. Bundle analysis and tree-shaking
12. Set up performance monitoring