const { MongoClient } = require('mongodb');

async function main() {
    const url = 'mongodb://127.0.0.1:27017';
    const client = new MongoClient(url);

    try {
        await client.connect();
        console.log('Connected to MongoDB.');

        const adminDb = client.db('admin');
        const status = await adminDb.command({ replSetGetStatus: 1 }).catch(() => null);

        if (status) {
            console.log('Replica set is already initiated.');
        } else {
            console.log('Initiating replica set...');
            const result = await adminDb.command({
                replSetInitiate: {
                    _id: 'rs0',
                    members: [
                        { _id: 0, host: '127.0.0.1:27017' }
                    ]
                }
            });
            console.log('Replica set initiated:', result);
        }
    } catch (err) {
        console.error('Failed to initiate replica set:', err.message || err);
    } finally {
        await client.close();
    }
}

main();
