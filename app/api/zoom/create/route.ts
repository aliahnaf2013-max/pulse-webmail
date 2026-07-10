import { NextRequest, NextResponse } from 'next/server';
import { getStalwartCredentials } from '@/lib/stalwart/credentials';
import { logger } from '@/lib/logger';
import { resolveDefaultZoom } from '@/lib/zoom-defaults';

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readDuration(value: unknown): number {
  const duration = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(duration) || duration <= 0) return 60;
  return Math.min(24 * 60, Math.max(1, Math.floor(duration)));
}

function fallbackResponse(reason: string, status = 200) {
  const fallback = resolveDefaultZoom();
  if (!fallback.url) {
    return NextResponse.json({ success: false, error: reason }, { status: status >= 500 ? 502 : status });
  }

  return NextResponse.json(
    {
      success: true,
      fallback: true,
      fallback_reason: reason,
      meeting: {
        id: fallback.id ? Number(fallback.id) : null,
        join_url: fallback.url,
        topic: 'Pulse Zoom',
      },
    },
    { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } },
  );
}

type ZoomMeeting = { id?: number; join_url?: string; topic?: string };

function readZoomMeeting(value: unknown): ZoomMeeting | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.join_url === 'string') {
    return {
      id: typeof record.id === 'number' ? record.id : undefined,
      join_url: record.join_url,
      topic: typeof record.topic === 'string' ? record.topic : undefined,
    };
  }
  return readZoomMeeting(record.data);
}

async function createViaAgentHub(topic: string, startTime: string, duration: number): Promise<ZoomMeeting | null> {
  const secret = process.env.AGENT_HUB_SIGNING_SECRET?.trim();
  if (!secret) return null;

  const hubBase = (process.env.AGENT_HUB_URL || 'https://agent-hub.pulsebusiness.ai').replace(/\/$/, '');
  const response = await fetch(`${hubBase}/tools/zoom_meeting_create`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      topic,
      start_time: startTime,
      duration,
      timezone: 'UTC',
    }),
  });

  const responseBody = await response.json().catch(() => null) as {
    ok?: boolean;
    data?: unknown;
  } | null;
  const meeting = readZoomMeeting(responseBody?.data);
  if (!response.ok || !responseBody?.ok || !meeting?.join_url) return null;
  return meeting;
}

export async function POST(request: NextRequest) {
  try {
    const credentials = await getStalwartCredentials(request);
    if (!credentials) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const topic = readString(body.topic) || 'Scheduled Meeting';
    const startTime = readString(body.startTime);
    const duration = readDuration(body.duration);

    if (!startTime || Number.isNaN(new Date(startTime).getTime())) {
      return NextResponse.json({ error: 'startTime must be a valid ISO date' }, { status: 400 });
    }

    const agentHubMeeting = await createViaAgentHub(topic, startTime, duration).catch((error) => {
      logger.warn('Agent Hub Zoom creation failed; trying Pulse API', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    });
    if (agentHubMeeting?.join_url) {
      return NextResponse.json(
        { success: true, fallback: false, meeting: agentHubMeeting },
        { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } },
      );
    }

    const authHeader = credentials.authHeader || '';
    if (!authHeader.startsWith('Bearer ')) {
      return fallbackResponse('No SSO bearer context available for Pulse API Zoom fallback');
    }

    const apiBase = (process.env.PULSE_API_URL || process.env.PULSE_APP_API_URL || 'https://api.pulsebusiness.ai').replace(/\/$/, '');
    const response = await fetch(`${apiBase}/api/v1/auth/zoom/create-meeting`, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ topic, startTime, duration }),
    });

    const responseBody = await response.json().catch(() => null) as {
      success?: boolean;
      meeting?: { id?: number; join_url?: string; topic?: string };
      error?: string;
    } | null;

    if (!response.ok || !responseBody?.success || !responseBody.meeting?.join_url) {
      logger.warn('Dynamic Zoom creation failed; using configured default Zoom fallback', {
        status: response.status,
        error: responseBody?.error || response.statusText,
      });
      return fallbackResponse(responseBody?.error || `Zoom API returned ${response.status}`, response.status);
    }

    return NextResponse.json(
      {
        success: true,
        fallback: false,
        meeting: responseBody.meeting,
      },
      { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } },
    );
  } catch (error) {
    logger.error('Dynamic Zoom creation failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return fallbackResponse(error instanceof Error ? error.message : 'Failed to create Zoom meeting', 502);
  }
}
