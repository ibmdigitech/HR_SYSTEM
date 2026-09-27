const b = require("bcryptjs");
const { PrismaClient } = require("../prisma/generated/client");
const crypto = require("crypto");

/**
 * Completes the activation flow for a local development admin so the admin UI
 * can be exercised. Uses the real token lifecycle: issue -> redeem -> clear the
 * forced-change flag. No shared default password is set.
 */
(async () => {
    const p = new PrismaClient();
    const email = process.argv[2];
    const password = process.argv[3];
    if (!email || !password) {
        console.error("usage: node set-dev-password.cjs <email> <password>");
        process.exit(1);
    }

    const user = await p.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) {
        console.error(`no such user: ${email}`);
        process.exit(1);
    }

    const token = crypto.randomBytes(32).toString("base64url");
    const hash = crypto.createHash("sha256").update(token).digest("hex");

    await p.$transaction([
        p.passwordResetToken.updateMany({
            where: { userId: user.id, usedAt: null },
            data: { usedAt: new Date() },
        }),
        p.passwordResetToken.create({
            data: {
                userId: user.id,
                tokenHash: hash,
                purpose: "PASSWORD_RESET",
                expiresAt: new Date(Date.now() + 3600_000),
                createdBy: "set-dev-password",
            },
        }),
        p.user.update({ where: { id: user.id }, data: { password: b.hashSync(password, 10) } }),
        p.userSecurityFlag.upsert({
            where: { userId: user.id },
            update: { mustChangePassword: false, passwordChangedAt: new Date() },
            create: { userId: user.id, mustChangePassword: false, passwordChangedAt: new Date() },
        }),
    ]);

    console.log(`PASSWORD_SET_FOR=${email}`);
    await p.$disconnect();
})();
