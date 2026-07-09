import { NextRequest, NextResponse } from 'next/server';
import { getStalwartCredentials } from '@/lib/stalwart/credentials';
import { logger } from '@/lib/logger';
import { resolveDefaultZoom } from '@/lib/zoom-defaults';

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
