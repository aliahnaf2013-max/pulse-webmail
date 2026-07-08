import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// getTokenEndpoint must support a static OAUTH_TOKEN_ENDPOINT override so a
// production deployment (e.g. behind Supabase Kong, where discovery hinges on
// a single well-known URL) does not depend on runtime discovery at all.

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/security/url-guard', () => ({
  isPublicHttpUrl: vi.fn(async () => true),
}));

vi.mock('@/lib/admin/config-manager', () => ({
  configManager: {
    get: vi.fn(<T,>(_key: string, defaultValue: T): T => defaultValue),
  },
}));

const discoverOAuthMock = vi.fn();
vi.mock('@/lib/oauth/discovery', () => ({
  discoverOAuth: (...args: unknown[]) => discoverOAuthMock(...args),
}));

describe('oauth/token-exchange getTokenEndpoint', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.OAUTH_CLIENT_ID = 'test-client';
    process.env.JMAP_SERVER_URL = 'https://mail.example.com';
    process.env.OAUTH_ISSUER_URL = 'https://supabase.example.com/auth/v1';
    delete process.env.OAUTH_TOKEN_ENDPOINT;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  async function importModule() {
    return import('@/lib/oauth/token-exchange');
  }

  it('returns OAUTH_TOKEN_ENDPOINT without running discovery when set', async () => {
    process.env.OAUTH_TOKEN_ENDPOINT = 'https://supabase.example.com/auth/v1/token';
    const { getTokenEndpoint } = await importModule();

    const endpoint = await getTokenEndpoint();

    expect(endpoint).toBe('https://supabase.example.com/auth/v1/token');
    expect(discoverOAuthMock).not.toHaveBeenCalled();
  });

  it('trims whitespace in the override', async () => {
    process.env.OAUTH_TOKEN_ENDPOINT = '  https://supabase.example.com/auth/v1/token \n';
    const { getTokenEndpoint } = await importModule();

    expect(await getTokenEndpoint()).toBe('https://supabase.example.com/auth/v1/token');
  });

  it('falls back to discovery when the override is not set', async () => {
    discoverOAuthMock.mockResolvedValueOnce({
      issuer: 'https://supabase.example.com/auth/v1',
      authorization_endpoint: 'https://supabase.example.com/auth/v1/authorize',
      token_endpoint: 'https://supabase.example.com/auth/v1/token',
    });
    const { getTokenEndpoint } = await importModule();

    const endpoint = await getTokenEndpoint();

    expect(endpoint).toBe('https://supabase.example.com/auth/v1/token');
    expect(discoverOAuthMock).toHaveBeenCalledWith(
      'https://supabase.example.com/auth/v1',
      expect.anything(),
    );
  });

  it('still throws when discovery fails and no override is set', async () => {
    discoverOAuthMock.mockResolvedValueOnce(null);
    const { getTokenEndpoint } = await importModule();

    await expect(getTokenEndpoint()).rejects.toThrow('OAuth token endpoint not found');
  });

  it('adds Supabase apikey headers for Supabase token requests', async () => {
    process.env.SUPABASE_URL = 'https://supabase.example.com';
    process.env.SUPABASE_ANON_KEY = 'anon-key-123';
    const { buildTokenRequestHeaders } = await importModule();

    expect(buildTokenRequestHeaders('https://supabase.example.com/auth/v1/token')).toEqual({
      'Content-Type': 'application/x-www-form-urlencoded',
      apikey: 'anon-key-123',
      Authorization: 'Bearer anon-key-123',
    });
  });

  it('does not add Supabase apikey headers for non-Supabase token requests', async () => {
    process.env.SUPABASE_ANON_KEY = 'anon-key-123';
    const { buildTokenRequestHeaders } = await importModule();

    expect(buildTokenRequestHeaders('https://idp.example.com/oauth/token')).toEqual({
      'Content-Type': 'application/x-www-form-urlencoded',
    });
  });
});
