const { PrismaClient } = require('./prisma/generated/client');
const prisma = new PrismaClient();

async function main() {
    console.log("Seeding Loan Types...");

    const loanTypes = [
        {
            name: "Salary Advance",
            description: "Request an advance on your upcoming salary.",
            maxAmount: 10000,
            interestRate: 0,
            maxRepaymentMonths: 12,
            requiresProbation: false
        },
        {
            name: "Personal Loan",
            description: "Personal expenses, medical, or family needs.",
            maxAmount: 50000,
            interestRate: 0,
            maxRepaymentMonths: 36,
            requiresProbation: true
        },
        {
            name: "Housing Loan",
            description: "Rent advance or housing setup costs.",
            maxAmount: 100000,
            interestRate: 2,
            maxRepaymentMonths: 60,
            requiresProbation: true
        }
    ];

    for (const lt of loanTypes) {
        const exists = await prisma.loanType.findUnique({ where: { name: lt.name } });
        if (!exists) {
            await prisma.loanType.create({ data: lt });
            console.log(`Created Loan Type: ${lt.name}`);
        } else {
            console.log(`Loan Type ${lt.name} already exists.`);
        }
    }

    console.log("Seeding complete.");
}

main().finally(() => prisma.$disconnect());
