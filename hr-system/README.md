# IBM DIGITECH HRMS - Complete Documentation & Learning Guide

## 📋 What Was Fixed

### 1. Login System Not Working
**Problem:** The login page returned 500 errors due to Turbopack cache corruption and the form used server actions that were missing CSRF tokens (NextAuth v5 requirement).

**Fix:** 
- Cleared Turbopack cache (`.next` folder)
- Changed from server action (`useFormState` + `authenticate`) to client-side `signIn` from `next-auth/react`
- Added explicit CSRF token fetching before form submission

**Files Changed:** `app/login/page.tsx`

### 2. Toast Messages Not Showing
**Problem:** The `sonner` `Toaster` component was missing from the root layout. Without it, all `toast.success()`, `toast.error()`, and `toast.loading()` calls fail silently.

**Fix:** Added `<Toaster position="top-right" richColors closeButton />` to `app/layout.tsx`

**Files Changed:** `app/layout.tsx`

### 3. Save Employee Fails When on Non-Personal Tabs
**Problem:** Radix UI's `Tabs` component unmounts inactive tab content from the DOM. When a user is on the **Finance** tab, the **Personal** tab's inputs (email, firstName, lastName, etc.) are NOT in the DOM, so the form submits `null` for required fields.

**Fix:** Added `forceMount` and `data-[state=inactive]:hidden` to all 4 `TabsContent` components. This keeps all inputs in the DOM at all times while visually hiding inactive tabs.

**Files Changed:** `app/employees/employee-list.tsx`

---

## 🏗️ Project Architecture

### Directory Structure
```
hr-system/
├── app/                          # Next.js 16 App Router
│   ├── api/                      # API routes
│   │   └── auth/[...nextauth]/   # NextAuth authentication endpoints
│   ├── login/                    # Login page
│   ├── employees/                # Employee management
│   ├── payroll/                  # Salary & payslip management
│   ├── attendance/               # Check-in/out tracking
│   ├── leaves/                   # Leave requests
│   ├── letters/                  # Document generation
│   ├── dashboard/                # Role-based dashboard
│   ├── settings/                 # System settings
│   ├── lib/                      # Server actions
│   │   └── actions/              # Database mutations
│   │       ├── employees.ts      # Create/Update/Delete employees
│   │       ├── bulk-upload.ts    # CSV master file upload
│   │       ├── payroll.ts        # Salary processing
│   │       └── leave.ts          # Leave management
│   ├── layout.tsx                # Root layout (Sidebar + Header + Toaster)
│   └── page.tsx                  # Home page redirect
├── components/                   # Reusable UI components
│   ├── layout/                   # Layout components
│   │   ├── Sidebar.tsx           # Navigation sidebar
│   │   └── Header.tsx            # Top header bar
│   └── ui/                       # Shadcn UI atomic components
├── lib/                          # Shared utilities
│   ├── prisma.ts                 # Singleton Prisma client
│   ├── utils.ts                  # Tailwind class merging
│   └── mock-db.ts                # Legacy mock interfaces
├── prisma/                       # Database configuration
│   ├── schema.prisma             # Data model definition
│   ├── dev.db                    # SQLite database
│   ├── seed.js                   # Initial user seeding
│   └── migrations/               # Database migrations
├── scripts/                      # Maintenance scripts
│   ├── seed-standalone.js        # Enhanced seeding with bcrypt
│   └── check-users.js            # Debug user accounts
├── auth.ts                       # NextAuth v5 credentials provider
├── auth.config.ts                # Auth pages & callbacks
├── middleware.ts                 # Route protection
├── .env                          # Environment variables
├── next.config.ts                # Next.js configuration
└── package.json                  # Dependencies
```

---

## 📚 Key Learning Points

### 1. NextAuth v5 with Credentials Provider

**How it works:**
- `auth.ts` defines the credentials provider that checks email/password against the database
- `middleware.ts` protects routes by checking if the user is authenticated
- `signIn('credentials', { email, password, csrfToken })` handles the login flow

**Key files:**
- `auth.ts` - Provider configuration with bcrypt password comparison
- `auth.config.ts` - Redirect rules and protected route logic
- `middleware.ts` - Route protection that runs on every request

**Important:** NextAuth v5 requires CSRF tokens for form submissions. The login page must fetch `/api/auth/csrf` before calling `signIn()`.

### 2. Server Actions Pattern

**How it works:**
- Server actions are async functions marked with `'use server'` directive
- They run on the server, can access the database directly
- Client components call them by passing a FormData object

**Example from `app/lib/actions/employees.ts`:**
```typescript
'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';

export async function upsertEmployee(formData: FormData) {
    // 1. Check authorization
    const session = await auth();
    if (!session || !['ADMIN', 'HR'].includes((session.user as any).role)) {
        return { success: false, message: 'Unauthorized' };
    }

    // 2. Extract form data
    const data = {
        firstName: formData.get('firstName') as string,
        lastName: formData.get('lastName') as string,
        // ... more fields
    };

    // 3. Database operation
    await prisma.employee.create({ data });

    // 4. Invalidate cache
    revalidatePath('/employees');

    // 5. Return result
    return { success: true, message: 'Employee saved successfully' };
}
```

### 3. Tabs Component Pattern (The `forceMount` Fix)

**The Problem:** Radix UI's `Tabs` unmounts inactive tabs from the DOM. If you submit a form while on the Finance tab, the Personal tab fields (email, name, etc.) don't exist in the DOM, so they submit as `null`.

**The Fix:**
```tsx
<TabsContent value="personal" forceMount className="m-0 space-y-6 data-[state=inactive]:hidden">
    {/* All fields stay in DOM, hidden tabs use CSS */}
</TabsContent>
```

- `forceMount` - Keeps the content mounted even when inactive
- `data-[state=inactive]:hidden` - Hides inactive tabs visually using CSS

### 4. Prisma Singleton Pattern

**File:** `lib/prisma.ts`

```typescript
import { PrismaClient } from '@prisma/client';

const prismaClientSingleton = () => new PrismaClient();

declare global {
    var prisma: undefined | ReturnType<typeof prismaClientSingleton>;
}

const prisma = globalThis.prisma ?? prismaClientSingleton();

export default prisma;

if (process.env.NODE_ENV !== 'production') globalThis.prisma = prisma;
```

**Why this pattern?** In development mode with Hot Module Replacement (HMR), creating a new PrismaClient on every file change would create multiple database connections. The singleton pattern reuses the existing client.

### 5. Toast/Notification Pattern

**Setup in `app/layout.tsx`:**
```tsx
import { Toaster } from 'sonner';

export default function RootLayout({ children }) {
    return (
        <html lang="en">
            <body>
                {children}
                <Toaster position="top-right" richColors closeButton />
            </body>
        </html>
    );
}
```

**Usage in components:**
```tsx
import { toast } from 'sonner';

// Loading state
const toastId = toast.loading('Saving...');

// Success
toast.success('Saved!', { id: toastId });

// Error
toast.error('Failed to save', { id: toastId });
```

### 6. Authentication Flow

```
User visits /dashboard
       ↓
middleware.ts checks if user is logged in
       ↓
If not logged in → redirect to /login
       ↓
User submits login form
       ↓
auth.ts validates email/password against database
       ↓
If valid → create session token → redirect to /dashboard
       ↓
If invalid → show error message
```

### 7. Bulk Upload (CSV Parsing) Pattern

**File:** `app/lib/actions/bulk-upload.ts`

```typescript
export async function uploadMasterFile(formData: FormData) {
    // 1. Get file from FormData
    const file = formData.get('file') as File;
    const text = await file.text();
    
    // 2. Parse CSV
    const rows = text.split(/\r?\n/).filter(line => line.trim() !== '');
    const headers = rows[0].split(',').map(h => h.trim().toLowerCase());
    
    // 3. Process each row
    for (const row of rows.slice(1)) {
        const values = row.split(',').map(v => v.trim());
        // Map headers to values
        // Validate required fields
        // Create user and employee records
    }
    
    // 4. Return results
    return { success: true, message: 'Processed X rows' };
}
```

---

## 🔧 Development Commands

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Start production server
npm run start

# Database operations
npx prisma generate     # Generate Prisma client
npx prisma db push      # Sync database schema
npx prisma studio       # Open database GUI

# Seed initial users
node scripts/seed-standalone.js

# Check users in database
node scripts/check-users.js
```

---

## 👤 Default Login Credentials

| Role    | Email                  | Password     |
|---------|------------------------|--------------|
| Admin   | admin@company.com      | password123  |
| Manager | manager@company.com    | password123  |
| Staff   | staff@company.com      | password123  |

---

## 📝 Key Code Patterns to Remember

### Pattern 1: Form Submission with Server Actions
```tsx
// Client component
<form onSubmit={async (e) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const result = await serverAction(formData);
    if (result.success) {
        toast.success(result.message);
        window.location.reload();
    } else {
        toast.error(result.message);
    }
}}>
```

### Pattern 2: Protected Server Action
```typescript
'use server';

import { auth } from '@/auth';

export async function protectedAction() {
    const session = await auth();
    if (!session) return { success: false, message: 'Unauthorized' };
    // ... proceed
}
```

### Pattern 3: Tabs with All Fields in DOM
```tsx
<Tabs defaultValue="tab1">
    <TabsList>
        <TabsTrigger value="tab1">Tab 1</TabsTrigger>
        <TabsTrigger value="tab2">Tab 2</TabsTrigger>
    </TabsList>
    <TabsContent value="tab1" forceMount className="data-[state=inactive]:hidden">
        {/* Fields stay in DOM */}
    </TabsContent>
    <TabsContent value="tab2" forceMount className="data-[state=inactive]:hidden">
        {/* Fields stay in DOM */}
    </TabsContent>
</Tabs>
```

### Pattern 4: Toast Notifications
```tsx
// Always include Toaster in layout
import { Toaster } from 'sonner';
<Toaster position="top-right" richColors closeButton />

// Use in components
import { toast } from 'sonner';
toast.loading('Working...');
toast.success('Done!');
toast.error('Failed!');
```

---

## 🐛 Common Issues & Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| Page shows 500 error | Turbopack cache corrupted | Delete `.next` folder and restart |
| Login returns "Invalid credentials" | Wrong password or user not seeded | Run `node scripts/seed-standalone.js` |
| Toast messages not showing | Missing `<Toaster>` component | Add to `app/layout.tsx` |
| Form submits null values | Tabs unmounting inactive content | Add `forceMount` to `TabsContent` |
| CSRF token missing | NextAuth v5 requirement | Fetch CSRF token before `signIn()` |
| Prisma validation errors | Schema out of sync with DB | Run `npx prisma generate` |

---

## 📖 Recommended Learning Resources

1. **Next.js App Router:** https://nextjs.org/docs/app
2. **Server Actions:** https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations
3. **NextAuth v5:** https://authjs.dev/
4. **Prisma:** https://www.prisma.io/docs
5. **Shadcn UI:** https://ui.shadcn.com/
6. **Radix UI Tabs:** https://www.radix-ui.com/primitives/docs/components/tabs

---

*Last Updated: April 13, 2026*
