import { describe, it, expect, vi, beforeEach } from 'vitest';

// PUT /api/auth/token must distinguish transient upstream failures (IdP 5xx,
// 429, discovery outage) from definitive rejections (IdP 4xx / invalid_grant).
// Deleting the refresh-token cookie on a transient blip is unrecoverable — it
// force-logs-out the user even though their grant is still valid at the IdP
// (2026-07-08 incident).

vi.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => data,
    }),
  },
}));

const cookieStoreMock = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};

vi.mock('next/headers', () => ({
  cookies: async () => cookieStoreMock,
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/oauth/cookie-config', () => ({
  getCookieOptions: () => ({ httpOnly: true, path: '/' }),
}));

const getTokenEndpointMock = vi.fn();
vi.mock('@/lib/oauth/token-exchange', () => ({
  getTokenEndpoint: (...args: unknown[]) => getTokenEndpointMock(...args),
  buildOAuthParams: (base: Record<string, string>) => new URLSearchParams(base),
  exchangeCodeForTokens: vi.fn(),
  getMetadata: vi.fn(),
}));

function mockRequest(): unknown {
  return { nextUrl: { searchParams: { get: () => null } } };
}

describe('PUT /api/auth/token', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookieStoreMock.get.mockImplementation((name: string) =>
      name === 'jmap_rt' ? { value: 'refresh-token-abc' } : undefined,
    );
    getTokenEndpointMock.mockResolvedValue('https://idp.example.com/token');
  });

  async function callPut() {
    const { PUT } = await import('@/app/api/auth/token/route');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return PUT(mockRequest() as any);
  }

  it('returns 503 and keeps the refresh cookie when the IdP responds 5xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => 'bad gateway',
    }));

    const res = await callPut();

    expect(res.status).toBe(503);
    expect(cookieStoreMock.delete).not.toHaveBeenCalled();
  });

  it('returns 503 and keeps the refresh cookie when the IdP responds 429', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    }));

    const res = await callPut();

    expect(res.status).toBe(503);
    expect(cookieStoreMock.delete).not.toHaveBeenCalled();
  });

  it('returns 401 and deletes the refresh cookies on a definitive IdP rejection (400 invalid_grant)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => '{"error":"invalid_grant"}',
    }));

    const res = await callPut();

    expect(res.status).toBe(401);
    expect(cookieStoreMock.delete).toHaveBeenCalledWith('jmap_rt');
    expect(cookieStoreMock.delete).toHaveBeenCalledWith('jmap_rts');
  });

  it('keeps the refresh cookie when token-endpoint resolution (discovery) fails', async () => {
    getTokenEndpointMock.mockRejectedValueOnce(new Error('OAuth token endpoint not found'));

    const res = await callPut();

    expect(res.status).toBeGreaterThanOrEqual(500); // transient server error, not 401
    expect(cookieStoreMock.delete).not.toHaveBeenCalled();
  });

  it('refreshes successfully and rotates the cookie on IdP success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'at-new', expires_in: 3600, refresh_token: 'rt-new' }),
    }));

    const res = await callPut();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ access_token: 'at-new', expires_in: 3600 });
    expect(cookieStoreMock.set).toHaveBeenCalledWith('jmap_rt', 'rt-new', expect.anything());
  });
});
