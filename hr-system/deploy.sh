#!/bin/bash
#
# ⛔ LEGACY TREE — DO NOT DEPLOY FROM HERE.
#
# This directory is an ARCHIVED copy of an earlier version of the HR system.
# It is NOT the application. The real application is the repository ROOT, one
# level up.
#
# Deploying from here ships a build that predates every security and correctness
# fix made since (no login rate limiting, no centralized RBAC, no session
# invalidation on role change, and a committed CSRF hash). It also targets
# SQLite — `prisma/schema.prisma` here is `provider = "sqlite"` — while the
# live system is PostgreSQL. Step 4 (`prisma db push`) would therefore push the
# wrong schema to the wrong datastore and report success.
#
# This tree is excluded from `tsconfig.json`, so it is never typechecked and
# nothing here fails to warn you that it has rotted.
#
# To deploy the real application, cd to the repository root and use its tooling.
# To run this anyway, you must opt in explicitly:
#
#     HRMS_ALLOW_LEGACY_DEPLOY=1 ./deploy.sh
#
set -euo pipefail

if [ "${HRMS_ALLOW_LEGACY_DEPLOY:-}" != "1" ]; then
    cat >&2 <<'EOF'
========================================================================
 REFUSING TO DEPLOY THE LEGACY TREE
========================================================================
 hr-system/ is an archived snapshot, not the application.

   * It predates all P0 security remediation.
   * It has no login rate limiting.
   * It targets SQLite; the live system is PostgreSQL.
   * It is excluded from tsconfig.json, so it is never typechecked.
   * It contains committed secrets (csrf_hash.txt).

 The application to deploy is the repository root, one level up.

 To override deliberately (you almost certainly should not):
     HRMS_ALLOW_LEGACY_DEPLOY=1 ./deploy.sh
========================================================================
EOF
    exit 1
fi

echo "⚠️  WARNING: deploying the ARCHIVED legacy tree by explicit override."
echo "⚠️  This build has none of the security remediation applied to the root app."

echo "🚀 Starting HRMS Deployment..."

# 1. Pull latest code (if using git)
# git pull origin main

# 2. Install dependencies
echo "📦 Installing dependencies..."
npm install --legacy-peer-deps

# 3. Generate Prisma Client
echo "💎 Generating Prisma client..."
npx prisma generate

# 4. Sync Database
echo "🗄️ Syncing database schema..."
npx prisma db push

# 5. Build the application
echo "🏗️ Building optimized application..."
npm run build

# 6. Restart the application using PM2
echo "🔄 Restarting application..."
pm2 restart ecosystem.config.js || pm2 start ecosystem.config.js

echo "✅ Deployment complete!"
