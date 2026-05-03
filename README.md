import prisma from "@/lib/prisma";

export type LogAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'APPROVE';

/**
 * Records an audit log entry for system transparency.
 */
export async function createAuditLog(
  userId: string,
  action: LogAction,
  entity: string,
  details: string
) {
  try {
    return await prisma.auditLog.create({
      data: {
        userId,
        action,
        entity,
        details,
        timestamp: new Date(),
      },
    });
  } catch (error) {
    console.error("Failed to create audit log:", error);
  }
}

export async function sendEmailNotification(to: string, subject: string, body: string) {
  // Placeholder for SMTP integration (Nodemailer/SendGrid)
  console.log(`[EMAIL SENT] To: ${to} | Subject: ${subject}`);
  return { success: true };
}
# 1. Install dependencies
npm install --legacy-peer-deps

# 2. Generate Prisma Client and setup the database
npx prisma generate
npx prisma db push

# 3. Seed the database with initial users (Admin, Manager, Staff)
node scripts/seed-standalone.js

# 4. Start the development server
npm run dev


