import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { decryptSession } from '@/lib/auth/crypto';
import { sessionCookieName } from '@/lib/auth/session-cookie';
import { MAX_ACCOUNT_SLOTS } from '@/lib/account-utils';
import { logger } from '@/lib/logger';

function getSlot(request: NextRequest): number {
  const raw = request.nextUrl.searchParams.get('slot');
  if (raw === null) return 0;
  const slot = parseInt(raw, 10);
  if (Number.isNaN(slot) || slot < 0 || slot >= MAX_ACCOUNT_SLOTS) return 0;
  return slot;
}

function normalizeZoomUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:') return null;
    if (!/(^|\.)zoom\.us$/i.test(url.hostname)) return null;
    if (!/^\/(j|my|s)\//i.test(url.pathname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function resolveDefaultZoom() {
  const configuredUrl =
    process.env.PULSE_DEFAULT_ZOOM_URL ||
    process.env.PULSE_ZOOM_DEFAULT_URL ||
    process.env.NEXT_PUBLIC_PULSE_DEFAULT_ZOOM_URL ||
    '';
  const configuredId =
    process.env.PULSE_DEFAULT_ZOOM_ID ||
    process.env.PULSE_ZOOM_DEFAULT_ID ||
    process.env.NEXT_PUBLIC_PULSE_DEFAULT_ZOOM_ID ||
    '';

  const id = /^\d{10,11}$/.test(configuredId.trim()) ? configuredId.trim() : null;
  const url = normalizeZoomUrl(configuredUrl) ?? (id ? `https://zoom.us/j/${id}` : null);
  const inferredId = id ?? url?.match(/\/j\/(\d{10,11})/i)?.[1] ?? null;

  return { id: inferredId, url };
}

export async function GET(request: NextRequest) {
  try {
    const slot = getSlot(request);
    const cookieStore = await cookies();
    const token = cookieStore.get(sessionCookieName(slot))?.value;

    if (!token || !decryptSession(token)) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const zoom = resolveDefaultZoom();
    if (!zoom.url && !zoom.id) {
      return NextResponse.json(
        { configured: false, zoom_meeting_id: null, zoom_meeting_url: null },
        { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } },
      );
    }

    return NextResponse.json(
      {
        configured: true,
        zoom_meeting_id: zoom.id,
        zoom_meeting_url: zoom.url,
      },
      { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } },
    );
  } catch (error) {
    logger.error('Default Zoom profile read failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
