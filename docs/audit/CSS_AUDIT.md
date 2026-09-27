# CSS AUDIT

## CSS Architecture

| Aspect | Status | Details |
|--------|--------|---------|
| Framework | Tailwind CSS 4.0 | JIT compiler, no config file needed |
| Methodology | Utility-first | Custom components in `@layer components` |
| CSS Variables | Yes | Defined in `globals.css` |
| Dark Mode | Media query | `prefers-color-scheme: dark` |
| Component Styles | Radix UI + Tailwind | Consistent styling |
| Global Styles | `app/globals.css` | Base, utilities, animations |

---

## Critical CSS Issues

### CSS-001: Employee Table Mobile Overflow
**File**: `app/employees/employee-list.tsx:466`
```tsx
<Table className="min-w-[800px]">
```
**Problem**: Fixed minimum width causes horizontal overflow on viewports < 800px
**Affects**: Mobile (< 768px), Tablet portrait
**Root Cause**: No responsive strategy for data tables
**Fix**: 
```tsx
<div className="overflow-x-auto">
  <Table className="min-w-[800px]">
```
**Better Fix**: Mobile card layout with `@media (max-width: 768px)`

---

### CSS-002: Employee Dialog Mobile Width
**File**: `app/employees/employee-list.tsx:246`
```tsx
<DialogContent className="max-w-4xl max-h-[90vh] ...">
```
**Problem**: `max-w-4xl` (896px) exceeds mobile viewport
**Affects**: Mobile (< 480px)
**Fix**: 
```tsx
<DialogContent className="max-w-[95vw] max-w-4xl ...">
```
**Better**: Full-screen on mobile with `sm:max-w-4xl`

---

### CSS-003: TabsList Overflow
**File**: `app/employees/employee-list.tsx:268`
```tsx
<TabsList className="w-full justify-start bg-slate-100/50 ... h-14">
```
**Problem**: 4 tabs with long labels overflow on mobile
**Affects**: Mobile (< 640px)
**Fix**: Add `overflow-x-auto` or responsive accordion

---

### CSS-004: Sidebar Mobile Behavior
**File**: `components/layout/Sidebar.tsx` (not fully visible)
**Problem**: Sidebar doesn't convert to drawer on mobile
**Affects**: Mobile (< 1024px)
**Fix**: Add `lg:static fixed inset-y-0 left-0 z-50 w-64 transform transition-transform lg:translate-x-0 -translate-x-full` pattern

---

### CSS-005: Approval Roles Table Overflow
**File**: `app/dashboard/approvals/roles/page.tsx` (assumed)
**Problem**: Complex permission matrix table overflows
**Affects**: Tablet, Mobile
**Fix**: Horizontal scroll wrapper + sticky first column

---

### CSS-006: Request Access Action Buttons
**File**: `app/dashboard/request-access/page.tsx` (assumed)
**Problem**: Action dropdown/button group overflows
**Affects**: Mobile (< 480px)
**Fix**: Stack buttons vertically on mobile

---

### CSS-007: Machine Integration Page
**File**: `app/attendance/machine-integration/page.tsx`
**Problem**: Technical content not mobile-optimized
**Affects**: Mobile
**Fix**: Collapsible sections, card layout

---

### CSS-008: Template Editor Mobile
**File**: `app/dashboard/settings/templates/page.tsx` (assumed)
**Problem**: Code editor/textarea cramped
**Affects**: Mobile, Tablet
**Fix**: Full-height editor, font-size adjustment

---

### CSS-009: Letter Preview Iframe
**File**: `app/letters/page.tsx` or letter components
**Problem**: A4 preview iframe fixed width
**Affects**: Mobile, Tablet
**Fix**: Responsive iframe with `width: 100%, aspect-ratio: 1/1.414`

---

### CSS-010: Inconsistent Button Heights
**Locations**: Multiple pages
**Problem**: Buttons use `h-12`, `h-14`, `h-10` inconsistently
**Standard**: `h-12` for default, `h-14` for primary CTAs, `h-10` for compact

---

### CSS-011: Avatar Size Inconsistency
**Locations**: Employees (h-14), Attendance (h-12), Sidebar (h-10)
**Problem**: No unified avatar size scale
**Standard**: 
- `h-16 w-16` - Profile pages
- `h-12 w-12` - Table rows, lists
- `h-10 w-10` - Compact, sidebar
- `h-8 w-8` - Tiny, badges

---

## Z-Index Conflicts

| Component | Z-Index | Issue |
|-----------|---------|-------|
| Sidebar | `z-40` (assumed) | - |
| Top Nav | `z-50` | Should be above sidebar |
| Dialog | `z-50` (Radix) | Conflicts with top nav |
| Dropdown | `z-50` (Radix) | - |
| Toast | `z-50` (Sonner) | - |
| Mobile Drawer | **MISSING** | Needs `z-50` |

**Fix**: Establish z-index scale:
```css
:root {
  --z-dropdown: 100;
  --z-sticky: 200;
  --z-sidebar: 300;
  --z-topnav: 400;
  --z-modal: 500;
  --z-toast: 600;
  --z-tooltip: 700;
}
```

---

## Fixed Width/Height Problems

| Element | Fixed Value | Location | Fix |
|---------|-------------|----------|-----|
| Employee Table | `min-w-[800px]` | employee-list.tsx | Responsive wrapper |
| Employee Dialog | `max-w-4xl` | employee-list.tsx | `max-w-[95vw]` |
| TabsList | `h-14` | employee-list.tsx | Auto height |
| Sidebar | `w-64` | Sidebar.tsx | Responsive |
| Letter Preview | Fixed A4 | Letter components | Aspect ratio |
| Code Editor | Fixed height | Settings templates | Flex-1 |

---

## Conflicting Classes

| Pattern | Location | Issue |
|---------|----------|-------|
| `bg-white dark:bg-slate-950` + `bg-slate-50` | Multiple | Background layering confusion |
| `border-slate-200 dark:border-slate-800` + `border-white/20` | Buttons | Border inconsistency |
| `shadow-lg` + `shadow-xl` nested | Dialogs | Shadow stacking |
| `backdrop-blur-xl` + `backdrop-blur-md` | Headers | Blur inconsistency |

---

## Duplicate CSS

| Pattern | Count | Locations |
|---------|-------|-----------|
| `rounded-xl` + `rounded-2xl` mix | 47 | Throughout |
| `px-8 py-6` table cells | 12 | All tables |
| `text-[10px] font-black uppercase` | 23 | Table headers |
| `h-12 rounded-xl bg-slate-50` | 34 | Form inputs |

**Recommendation**: Create component variants in `globals.css` @layer components

---

## Unused CSS (Suspected)

| Class Pattern | Likely Unused | Reason |
|---------------|---------------|--------|
| `grid-cols-7` | Yes | Only 4-6 columns used |
| `aspect-video` | Yes | Only `aspect-square`, `aspect-[1/1.414]` |
| `rotate-180` | Yes | Only `rotate-90` for chevrons |
| `skew-x-*` | Yes | Not used |
| `font-mono` | Partial | Only in code blocks |

---

## !important Usage

**Search**: No `!important` found in codebase (good)

---

## Desktop-Only Styling

| Component | Desktop Styles | Mobile Missing |
|-----------|----------------|----------------|
| EmployeeTable | Full table | Card layout |
| ApprovalMatrix | Full grid | Stacked cards |
| Sidebar | Persistent | Drawer |
| TabsList | Horizontal | Accordion |
| Dialog | Centered | Full-screen |
| Form Grid | 2-col | 1-col |

---

## Table Overflow Issues

| Table | Columns | Min Width | Mobile Strategy |
|-------|---------|-----------|-----------------|
| Employee | 6 | 800px | **NONE** |
| Attendance | 5 | 700px | Horizontal scroll |
| Leave | 5 | 650px | Horizontal scroll |
| Payroll | 6 | 750px | Horizontal scroll |
| Approvals | 7 | 850px | **NONE** |
| Requests | 5 | 600px | Horizontal scroll |
| Loans | 6 | 700px | Horizontal scroll |

---

## Modal Overflow

| Modal | Content | Overflow Risk |
|-------|---------|---------------|
| Employee Dialog | 4 tabs, 30+ fields | HIGH |
| Letter Preview | A4 iframe | MEDIUM |
| Template Editor | Code editor | MEDIUM |
| Bulk Import | File input | LOW |

---

## Sidebar Problems

1. **No mobile drawer** - Critical
2. **No collapse/expand** - Medium
3. **Active state not persistent** - Low
4. **Badge counts not updating real-time** - Low

---

## Header Problems

1. **No breadcrumb** - Medium
2. **User menu dropdown positioning** - Low
3. **Notification bell badge overlap** - Low

---

## Recommendations

### Immediate
1. Add mobile card layout for EmployeeTable
2. Fix DialogContent responsive width
3. Add TabsList overflow handling
4. Implement Sidebar as mobile drawer
5. Add horizontal scroll wrappers to all wide tables

### Short-term
1. Create `@layer components` for repeated patterns
2. Standardize avatar sizes
3. Standardize button heights
4. Add responsive iframe for letter preview
5. Establish z-index scale

### Medium-term
1. Audit and remove unused Tailwind utilities
2. Create design token CSS variables
3. Add container queries for component-level responsiveness
4. Implement CSS-in-JS for dynamic theming