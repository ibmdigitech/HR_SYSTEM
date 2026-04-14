const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('Seeding database...');

    // Create Employees
    const emp1 = await prisma.employee.create({
        data: {
            firstName: 'John',
            lastName: 'Doe',
            email: 'john.doe@example.com',
            designation: 'Software Engineer',
            department: 'Engineering',
            joiningDate: new Date('2023-01-15'),
            salaryStructure: {
                create: {
                    ctc: 1200000,
                    basic: 600000,
                    hra: 300000,
                    allowances: 200000,
                    deductions: 100000,
                },
            },
        },
    });

    const emp2 = await prisma.employee.create({
        data: {
            firstName: 'Jane',
            lastName: 'Smith',
            email: 'jane.smith@example.com',
            designation: 'HR Manager',
            department: 'Human Resources',
            joiningDate: new Date('2022-05-10'),
            salaryStructure: {
                create: {
                    ctc: 1500000,
                    basic: 750000,
                    hra: 375000,
                    allowances: 250000,
                    deductions: 125000,
                },
            },
        },
    });

    console.log({ emp1, emp2 });
    console.log('Seeding finished.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
