const { PrismaClient } = require('./prisma/generated/client');
const p = new PrismaClient();

p.serviceConfig.findMany({
  where: { module: { in: ['visa', 'letters', 'COMPANY'] } }
}).then(c => console.log(JSON.stringify(c, null, 2)))
  .finally(() => p.$disconnect());