const { PrismaClient } = require('../prisma/generated/client');
const prisma = new PrismaClient();

async function main() {
    console.log('Seeding UAE Letter Templates...');

    const templates = [
        {
            name: 'Salary Certificate (Standard)',
            type: 'SALARY_CERTIFICATE',
            content_en: `**SALARY CERTIFICATE**

Date: {{date.today}}
Ref: {{letter.number}}

To Whom It May Concern,

This is to certify that Mr./Ms. {{employee.name}}, holder of Emirates ID {{employee.emiratesId}}, is employed with {{company.name}} as {{employee.designation}} since {{employee.joiningDate}}.

His/Her current salary details are as follows:

* Basic Salary: AED {{salary.basic}}
* Allowances: AED {{salary.allowances}}
* Total Salary: AED {{salary.total}}

This certificate is issued upon request for official purposes without any liability on the part of the company.

Sincerely,
{{company.authorizedSignatory}}
{{company.name}}`,
            content_ar: `**شهادة راتب**

التاريخ: {{date.today}}
المرجع: {{letter.number}}

إلى من يهمه الأمر،

نشهد نحن شركة {{company.name}} بأن السيد/السيدة {{employee.name}}، حامل الهوية الإماراتية رقم {{employee.emiratesId}}، يعمل لدينا بمهنة {{employee.designation}} منذ تاريخ {{employee.joiningDate}}.

تفاصيل راتبه الحالي كما يلي:

* الراتب الأساسي: {{salary.basic}} درهم
* البدلات: {{salary.allowances}} درهم
* إجمالي الراتب: {{salary.total}} درهم

تم إصدار هذه الشهادة بناءً على طلب الموظف ولأغراض رسمية دون أدنى مسؤولية على الشركة.

مع خالص التقدير،
{{company.authorizedSignatory}}
{{company.name}}`
        },
        {
            name: 'No Objection Certificate (NOC)',
            type: 'NOC',
            content_en: `**NO OBJECTION CERTIFICATE**

Date: {{date.today}}
Ref: {{letter.number}}

To Whom It May Concern,

We, {{company.name}}, confirm that Mr./Ms. {{employee.name}}, holder of Emirates ID {{employee.emiratesId}}, is currently employed with us as {{employee.designation}}.

We have no objection for him/her to {{request.purpose}} (e.g., apply for driving license / liquor license).

This certificate is valid for 30 days from the date of issue.

Sincerely,
{{company.authorizedSignatory}}
{{company.name}}`,
            content_ar: `**شهادة ممانعة**

التاريخ: {{date.today}}
المرجع: {{letter.number}}

إلى من يهمه الأمر،

تؤكد شركة {{company.name}} بأن السيد/السيدة {{employee.name}}، حامل الهوية الإماراتية رقم {{employee.emiratesId}}، يعمل لدينا حالياً بمهنة {{employee.designation}}.

نود إفادتكم بأنه ليس لدينا أي مانع من قيامه بـ {{request.purpose}}.

هذه الشهادة صالحة لمدة 30 يوماً من تاريخ الإصدار.

مع خالص التقدير،
{{company.authorizedSignatory}}
{{company.name}}`
        }
    ];

    for (const template of templates) {
        await prisma.letterTemplate.upsert({
            where: { id: template.name }, // This is a bit hacky for a script, id should be cuid
            update: template,
            create: template
        }).catch(async () => {
             // If ID matching fails, just create
             await prisma.letterTemplate.create({ data: template });
        });
    }

    console.log('Letter templates seeded successfully!');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
