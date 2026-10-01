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

        console.log('Creating Letter Templates...');
        const templates = [
            {
                name: "Salary Certificate",
                type: "SALARY_CERTIFICATE",
                content_en: "To Whom It May Concern,\n\nThis is to certify that {{employee.name}} is employed by Al Barakah Group as {{employee.designation}} since {{employee.joiningDate}}. \n\nHis current monthly salary is AED {{salary.total}}.\n\nThis certificate is issued at the employee's request without any liability on the part of the company.",
                content_ar: "إلى من يهمه الأمر،\n\nنشهد بموجب هذه الوثيقة أن السيد/ {{employee.name}} يعمل لدى مجموعة البركة بمهنة {{employee.designation}} منذ تاريخ {{employee.joiningDate}}.\n\nراتبه الشهري الإجمالي الحالي هو {{salary.total}} درهم إماراتي.\n\nتم إصدار هذه الشهادة بناءً على طلب الموظف دون أدنى مسؤولية على الشركة."
            },
            {
                name: "No Objection Certificate",
                type: "NOC",
                content_en: "To Whom It May Concern,\n\nAl Barakah Group has no objection for {{employee.name}} (Emirates ID: {{employee.emiratesId}}) to apply for {{request.purpose}}.\n\nThis NOC is valid for 30 days from the date of issue.",
                content_ar: "إلى من يهمه الأمر،\n\nتفيد مجموعة البركة بأنه لا مانع لديها من قيام السيد/ {{employee.name}} (رقم الهوية: {{employee.emiratesId}}) بالتقدم بطلب {{request.purpose}}.\n\nهذه الشهادة صالحة لمدة 30 يوماً من تاريخ الإصدار."
            },
            {
                name: "Offer Letter",
                type: "OFFER",
                content_en: "Dear Candidate,\n\nWe are pleased to offer you the position of {{employee.designation}} at Al Barakah Group. \n\nYour joining date is set for {{employee.joiningDate}} with a starting salary of AED {{salary.total}} per month.",
                content_ar: "عزيزي المرشح،\n\nيسرنا أن نعرض عليك وظيفة {{employee.designation}} في مجموعة البركة.\n\nتم تحديد تاريخ انضمامك في {{employee.joiningDate}} براتب أساسي قدره {{salary.total}} درهم إماراتي شهرياً."
            }
        ];

        for (const t of templates) {
            await prisma.letterTemplate.upsert({
                where: { id: t.name.replace(/\s+/g, '_').toLowerCase() }, // Using a predictable ID for upsert
                update: t,
                create: {
                    id: t.name.replace(/\s+/g, '_').toLowerCase(),
                    ...t
                }
            });
        }

        console.log('Admin created:', user);
        return NextResponse.json({ message: 'Database seeded successfully with templates', user, templatesCount: templates.length });
    } catch (e) {
        console.error('Seed Error:', e);
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error', stack: e instanceof Error ? e.stack : undefined }, { status: 500 });
    }
}
