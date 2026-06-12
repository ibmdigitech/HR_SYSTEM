const { PrismaClient } = require('./prisma/generated/client');
const prisma = new PrismaClient();

async function main() {
    console.log("Seeding letter templates...");
    
    const templates = [
        {
            name: "Appointment Letter",
            type: "APPOINTMENT",
            content_en: "Dear [Employee Name],\n\nWe are pleased to appoint you as [Designation] in the [Department] department...",
            content_ar: "عزيزي [Employee Name]،\n\nيسعدنا تعيينك في منصب [Designation]..."
        },
        {
            name: "Offer Letter",
            type: "OFFER",
            content_en: "Dear [Candidate Name],\n\nWe are thrilled to offer you the position of [Job Title]...",
            content_ar: "عزيزي [Candidate Name]،\n\nيسعدنا أن نعرض عليك منصب [Job Title]..."
        },
        {
            name: "Relieving Letter",
            type: "RELIEVING",
            content_en: "To Whom It May Concern,\n\nThis is to certify that [Employee Name] was employed with us...",
            content_ar: "إلى من يهمه الأمر،\n\nنشهد بأن [Employee Name] كان يعمل لدينا..."
        }
    ];

    for (const t of templates) {
        const exists = await prisma.letterTemplate.findFirst({ where: { type: t.type } });
        if (!exists) {
            await prisma.letterTemplate.create({ data: t });
            console.log("Created template: " + t.name);
        } else {
            console.log("Template already exists: " + t.name);
        }
    }
    console.log("Done seeding templates.");
}

main().finally(() => prisma.$disconnect());
