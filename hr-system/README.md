c# IBM DIGITECH HRMS - Enterprise Human Resource Management System

A comprehensive HR & Operations Management System built with **Next.js 16**, **TypeScript**, and **Prisma (SQLite)**. This system manages the complete employee lifecycle, payroll, attendance, and document generation.

## 📁 Project Structure & File Details

### 🏢 Root Directory
- **`auth.ts`** & **`auth.config.ts`**: Core NextAuth v5 (Beta) configuration for role-based authentication.
- **`middleware.ts`**: Route protection logic (Redirects unauthorized users to `/login`).
- **`prisma/`**: Database configuration and migration files.
  - `schema.prisma`: The primary data model (SQLite).
  - `seed.js`: Initial database seeding script.
- **`scripts/`**: Maintenance and diagnostic utilities.
  - `seed-standalone.js`: Enhanced seeding script with secure password hashing.
  - `check-users.js`: Diagnostics for account verification.
- **`.env`**: Critical environment variables (Database URL, Auth Secret).

### 🚀 Application Layer (`/app`)
The core business logic and routing using Next.js App Router.
- **`/login`**: Secure authentication gateway.
- **`/dashboard`**: Role-based landing pages for Admin, HR, and Staff.
- **`/employees`**: The "Employee Master" module for lifecycle management and bulk CSV uploads.
- **`/payroll`**: Complete salary management system.
  - `/structure`: Configure HRA, Basic, and Allowances.
  - `/generate`: Batch process monthly disbursements to the database.
  - `/payslips`: PDF generation for employee records.
- **`/attendance`**: Punch-in/out tracking and biometric logs.
- **`/leaves`**: Leave request and approval workflow.
- **`/letters`**: Automated document generation (Offer, Appointment, Relieving).
- **`/lib/actions`**: **Server Actions** handling all database mutations:
  - `employees.ts`: Create/Update/Delete staff.
  - `payroll.ts`: Monthly processing logic.
  - `bulk-upload.ts`: CSV "Master File" parser and batch importer.
  - `leave.ts`: Request handling.

### 🎨 Components & UI (`/components`)
Modular UI library built with **Shadcn UI** and **Tailwind CSS**.
- **`/layout`**: Persistent UI elements (Sidebar, Navbar, Mobile Menu).
- **`/ui`**: Atomic components (Button, Dialog, ScrollArea, Avatar, etc.).

### 🛠️ Shared Services (`/lib`)
- **`prisma.ts`**: Singleton Prisma client instance.
- **`mock-db.ts`**: Data types and legacy mock interfaces.
- **`utils.ts`**: Performance-optimized Tailwind class merging.

---

## 🛠️ Getting Started

1. **Configure Environment**:
   Create a `.env` file in the root directory:
   ```env
   DATABASE_URL="file:./dev.db"
   AUTH_SECRET="your_secure_random_secret_key"
   ```

2. **Install Dependencies**:
   ```bash
   npm install --legacy-peer-deps
   ```

3. **Setup Database**:
   ```bash
   npx prisma generate
   npx prisma db push
   node scripts/seed-standalone.js
   ```

4. **Run Development Server**:
   ```bash
   npm run dev
   ```

5. **Login Credentials**:
   - **Admin**: `admin@company.com` / `password123`
   - **Manager**: `manager@company.com` / `password123`
   - **Staff**: `staff@company.com` / `password123`

## 🚀 Production Deployment

### 1. Build for Production
When you are ready to move from development to a live server, run:
```bash
npm run build
```

### 2. Start Production Server
After the build is complete, start the optimized server:
```bash
npm run start
```

### 3. Recommended Platforms
- **Vercel**: Best for Next.js. Simply connect your GitHub repository.
- **Docker**: Build the image using the provided `Dockerfile`.
- **PM2 (Self-Hosted)**: Use the `ecosystem.config.js` and `deploy.sh` script for automated setup on a VPS.
  ```bash
  # Quick deploy on Linux:
  chmod +x deploy.sh
  ./deploy.sh
  ```

## 📄 Deployment Files Included
| File | Description |
| :--- | :--- |
| `Dockerfile` | Multi-stage production build for Docker/Kubernetes. |
| `.dockerignore`| Prevents bloat in Docker images. |
| `ecosystem.config.js` | PM2 Cluster Mode configuration for high availability. |
| `deploy.sh` | One-click automation for installation, builds, and prisma sync. |
