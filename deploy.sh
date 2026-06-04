#!/bin/bash

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
