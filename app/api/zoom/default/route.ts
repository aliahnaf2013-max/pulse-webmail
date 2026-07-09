import { NextRequest, NextResponse } from 'next/server';
import { getStalwartCredentials } from '@/lib/stalwart/credentials';
import { logger } from '@/lib/logger';

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
    const credentials = await getStalwartCredentials(request);
    if (!credentials) {
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
