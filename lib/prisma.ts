import { PrismaClient } from "../prisma/generated/client";

/**
 * Prisma client singleton.
 *
 * SECURITY / CONFIG (P0-2): this previously read
 *   `process.env.MONGODB_URI || process.env.DATABASE_URL`
 * `MONGODB_URI` was a leftover from a MongoDB era and is not defined anywhere in
 * this project, so the fallback never fired — but if it were ever set, a
 * PostgreSQL schema would be pointed at a MongoDB server at runtime and the
 * application would fail in a confusing way. The fallback is removed.
 *
 * The URL now comes only from `DATABASE_URL`, and a missing value fails
 * immediately and loudly rather than silently degrading.
 */
function resolveDatabaseUrl(): string {
    const url = process.env.DATABASE_URL;
    if (!url) {
        throw new Error(
            "DATABASE_URL is not set. Copy .env.example to .env and set it. " +
                "This project uses PostgreSQL; MONGODB_URI is not supported."
        );
    }
    if (/^mongodb(\+srv)?:\/\//i.test(url)) {
        throw new Error(
            "DATABASE_URL points at MongoDB, but prisma/schema.prisma declares the " +
                "postgresql provider. Refusing to start with a mismatched driver."
        );
    }
    return url;
}

const prismaClientSingleton = () => {
    return new PrismaClient({
        datasources: {
            db: {
                url: resolveDatabaseUrl(),
            },
        },
    });
};

declare global {
    var prisma: undefined | ReturnType<typeof prismaClientSingleton>;
}

const prisma = process.env.NODE_ENV === "production"
    ? prismaClientSingleton()
    : (globalThis.prisma ?? prismaClientSingleton());

export default prisma;

if (process.env.NODE_ENV !== "production") globalThis.prisma = prisma;
