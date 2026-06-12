const { PrismaClient } = require('../prisma/generated/client');
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "mongodb://127.0.0.1:27018/admin"
    }
  }
});

async function run() {
    console.log("Connecting to local MongoDB on port 27018/admin...");
    try {
        const res = await prisma.$runCommandRaw({ 
            replSetInitiate: { 
                _id: "rs0", 
                members: [
                    { _id: 0, host: "127.0.0.1:27018" }
                ] 
            } 
        });
        console.log("Replica set initiated successfully:", res);
    } catch (err) {
        console.log("Replica set initiation finished or skipped:", err.message || err);
    }
}

run()
  .catch(console.error)
  .finally(async () => {
      await prisma.$disconnect();
  });
