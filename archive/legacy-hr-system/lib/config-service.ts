import prisma from "./prisma";

export async function getConfig(module: string, key: string) {
    const config = await prisma.serviceConfig.findUnique({
        where: {
            module_key: {
                module,
                key
            }
        }
    });

    if (!config || !config.isActive) return null;

    switch (config.type) {
        case 'number':
            return parseFloat(config.value);
        case 'boolean':
            return config.value === 'true';
        case 'json':
            try {
                return JSON.parse(config.value);
            } catch {
                return null;
            }
        default:
            return config.value;
    }
}

export async function setConfig(module: string, key: string, value: any, type: string = 'text', label?: string) {
    const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
    
    return await prisma.serviceConfig.upsert({
        where: {
            module_key: {
                module,
                key
            }
        },
        update: {
            value: stringValue,
            type
        },
        create: {
            module,
            key,
            value: stringValue,
            type,
            label: label || key
        }
    });
}
