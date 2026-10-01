# 🚀 ANTIGRAVITY ENTERPRISE HRMS
### The Ultimate Modern HR & Operations Management System

A state-of-the-art, **Premium Glassmorphic** HRMS built with **Next.js 16**, **TypeScript**, **Prisma**, and **Tailwind CSS**. Designed for enterprise-grade performance, aesthetic excellence, and UAE compliance.

---

## ✨ Key Features & Capabilities

### 🎨 1. Next-Gen UI/UX
- **Premium Glassmorphism**: High-fidelity translucent interfaces with `backdrop-blur-xl` and deep indigo/violet gradients.
- **Dynamic Dashboard**: Real-time organizational health analytics, system stability indicators, and activity streams.
- **Responsive Layout**: Optimized for both high-density desktop views and fluid mobile experiences.

### 💰 2. Advanced Payroll Module
- **UAE WPS Compliance**: Standardized for UAE Labour Law with fields for Basic, HRA, Transport, and Medical allowances.
- **Automated Processing**: One-click monthly payroll generation with intelligent net salary calculations.
- **Digital Payslips**: High-performance PDF engine for instant salary record generation.
- **Dynamic Configuration**: Adjust overtime rates and late penalties via a central **Service Config** hub.

### 📄 3. Bilingual Letter Engine
- **English & Arabic Templates**: Generate official documents (Salary Certificates, NOCs, Offer Letters) in both languages.
- **Digital Stamp & Signature**: Documents are automatically appended with verified corporate stamps and manager signatures.
- **Live Document Viewer**: A4-ready preview modal for reviewing, printing, and downloading official correspondence.

### 🛡️ 4. Visa & Compliance Vault
- **Document Tracking**: Securely monitor Emirates ID, Passport, and Visa expiration dates.
- **Vault Interface**: High-impact UI for managing critical workforce compliance documents with real-time status alerts.

### 🤝 5. Staff Services Hub
- **Self-Service Requests**: Streamlined portal for staff to request reimbursements, overtime, and letters.
- **Audit Log Timeline**: Real-time status tracking for all requests from "Draft" to "Approved".

---

## 📁 Technical Architecture

### 🏢 Core Stack
- **Framework**: [Next.js 16](https://nextjs.org/) (App Router & Server Actions)
- **Language**: [TypeScript](https://www.typescriptlang.org/) for type-safe development.
- **ORM**: [Prisma](https://www.prisma.io/) with SQLite (Production-ready for PostgreSQL/MySQL).
- **Styling**: [Tailwind CSS 4.0](https://tailwindcss.com/) with custom Glassmorphic tokens.
- **Components**: Radix UI primitives & Lucide Icons.

### 📂 Directory Overview
- **`/app`**: Business logic, API routes, and Page components.
- **`/components`**: Reusable UI library (Glassmorphic variants).
- **`/lib`**: Shared services (Prisma client, Config Service, PDF Generators).
- **`/prisma`**: Data modeling and automated migration history.
- **`/public/assets`**: Verified digital stamps, signatures, and brand assets.

---

## 🛠️ Rapid Setup

1. **Environment Configuration**:
   ```env
   DATABASE_URL="file:./dev.db"
   AUTH_SECRET="your_secret_key"
   ```

2. **Installation & Initialization**:
   ```bash
   npm install --legacy-peer-deps
   npx prisma generate
   npx prisma db push
   node scripts/seed-letters.mjs
   ```

3. **Launch**:
   ```bash
   npm run dev
   ```

---

## 🚀 Performance & Deployment
- **Turbopack**: Optimized development builds for rapid iteration.
- **Docker Support**: Multi-stage `Dockerfile` included for containerized deployment.
- **Enterprise Grade**: PM2 Cluster Mode and automated deployment scripts (`deploy.sh`) for high-availability hosting.

---
*© 2026 Antigravity Systems | Enterprise HRMS | UAE*
