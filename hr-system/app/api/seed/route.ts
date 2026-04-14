import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
// import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

export async function GET() {
    try {
        console.log('Seeding database...');
        // Temporary simplistic approach to debug
        const hashedUserPassword = 'hashed-password-placeholder';

        console.log('Creating Admin...');
        // Admin
        const user = await prisma.user.upsert({
            where: { email: 'admin@company.com' },
            update: {},
            create: {
                email: 'admin@company.com',
                password: hashedUserPassword,
                role: 'ADMIN',
                name: 'Admin User',
            },
        });

        console.log('Admin created:', user);
        return NextResponse.json({ message: 'Database seeded successfully', user });
    } catch (e) {
        console.error('Seed Error:', e);
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error', stack: e instanceof Error ? e.stack : undefined }, { status: 500 });
    }
}
