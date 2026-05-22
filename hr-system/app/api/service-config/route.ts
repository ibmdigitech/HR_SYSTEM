import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { auth } from '@/auth';
import { z } from 'zod';
import { serviceConfigCreateSchema, serviceConfigUpdateSchema } from '@/app/lib/validation';

/**
 * GET /api/service-config
 * Returns all active ServiceConfig entries.
 */
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const configs = await prisma.serviceConfig.findMany({
      where: { isActive: true },
      orderBy: { module: 'asc' },
    });
    return NextResponse.json(configs);
  } catch (error: any) {
    console.error('[SERVICE_CONFIG_GET]', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch configs' }, { status: 500 });
  }
}

/**
 * POST /api/service-config
 * Create a new ServiceConfig. Only ADMIN users allowed.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session || (session.user as any).role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const parse = serviceConfigCreateSchema.safeParse(body);
  if (!parse.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parse.error.format() }, { status: 400 });
  }

  try {
    const config = await prisma.serviceConfig.create({ data: parse.data });
    return NextResponse.json(config, { status: 201 });
  } catch (error: any) {
    console.error('[SERVICE_CONFIG_POST]', error);
    return NextResponse.json({ error: error.message || 'Failed to create config' }, { status: 500 });
  }
}

/**
 * PATCH /api/service-config?id=xxx
 * Update an existing ServiceConfig. Only ADMIN.
 */
export async function PATCH(req: Request) {
  const session = await auth();
  if (!session || (session.user as any).role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const body = await req.json();
  const parse = serviceConfigUpdateSchema.safeParse(body);
  if (!parse.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parse.error.format() }, { status: 400 });
  }

  try {
    const config = await prisma.serviceConfig.update({
      where: { id },
      data: parse.data,
    });
    return NextResponse.json(config);
  } catch (error: any) {
    console.error('[SERVICE_CONFIG_PATCH]', error);
    return NextResponse.json({ error: error.message || 'Failed to update config' }, { status: 500 });
  }
}

/**
 * DELETE /api/service-config?id=xxx
 * Soft‑delete (set isActive = false). Only ADMIN.
 */
export async function DELETE(req: Request) {
  const session = await auth();
  if (!session || (session.user as any).role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  try {
    const config = await prisma.serviceConfig.update({
      where: { id },
      data: { isActive: false },
    });
    return NextResponse.json(config);
  } catch (error: any) {
    console.error('[SERVICE_CONFIG_DELETE]', error);
    return NextResponse.json({ error: error.message || 'Failed to delete config' }, { status: 500 });
  }
}
