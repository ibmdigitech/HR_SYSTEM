import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const templates = await prisma.letterTemplate.findMany();
    console.log('Templates in DB:', JSON.stringify(templates, null, 2));
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
