import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import * as browserNavigation from '@/lib/browser-navigation';
import { useAuthStore } from '../auth-store';
import { useAccountStore } from '../account-store';

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

// Regression tests for the 2026-07-08 incident: a transient 500 from
// PUT /api/auth/token (caused by an OAuth discovery blip) must NOT destroy
// the session. Only a definitive 401 from the refresh endpoint may log out.
describe('auth-store refreshAccessToken transient-failure handling', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    window.history.pushState({}, '', '/en');

    useAccountStore.setState({
      accounts: [],
      activeAccountId: null,
      defaultAccountId: null,
    });

    useAuthStore.setState({
      isAuthenticated: true,
      isLoading: false,
      error: null,
      serverUrl: 'https://mail.example.com',
      username: 'jim@example.com',
      client: null,
      identities: [],
      primaryIdentity: null,
      authMode: 'oauth',
      rememberMe: false,
      accessToken: 'old-token',
      tokenExpiresAt: Date.now() + 60_000,
      connectionLost: false,
      activeAccountId: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function mockRefreshResponses(handler: (call: number) => Promise<unknown> | unknown) {
    let putCalls = 0;
    const fetchMock = vi.fn(async (input: FetchInput, init?: FetchInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url === '/api/auth/token?slot=0' && method === 'PUT') {
        putCalls += 1;
        return handler(putCalls);
      }

      // logout() fires best-effort DELETE calls; absorb them.
      if (method === 'DELETE') {
        return { ok: true, json: async () => ({}) };
      }

      throw new Error(`Unexpected fetch call: ${method} ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    return { fetchMock, putCallCount: () => putCalls };
  }

  it('retries a transient 500 with backoff and keeps the session when the retry succeeds', async () => {
    vi.useFakeTimers();
    const replaceSpy = vi.spyOn(browserNavigation, 'replaceWindowLocation').mockImplementation(() => {});

    const { putCallCount } = mockRefreshResponses((call) => {
      if (call === 1) return { ok: false, status: 500, json: async () => ({ error: 'Internal server error' }) };
      return { ok: true, status: 200, json: async () => ({ access_token: 'fresh-token', expires_in: 3600 }) };
    });

    const promise = useAuthStore.getState().refreshAccessToken();
    // First backoff window; generous bound so backoff tuning doesn't break the test.
    await vi.advanceTimersByTimeAsync(5_000);
    const token = await promise;

    expect(token).toBe('fresh-token');
    expect(putCallCount()).toBe(2);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().accessToken).toBe('fresh-token');
    expect(sessionStorage.getItem('session_expired')).toBeNull();
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it('retries network errors instead of logging out', async () => {
    vi.useFakeTimers();
    const replaceSpy = vi.spyOn(browserNavigation, 'replaceWindowLocation').mockImplementation(() => {});

    const { putCallCount } = mockRefreshResponses((call) => {
      if (call === 1) return Promise.reject(new TypeError('Failed to fetch'));
      return { ok: true, status: 200, json: async () => ({ access_token: 'fresh-token', expires_in: 3600 }) };
    });

    const promise = useAuthStore.getState().refreshAccessToken();
    await vi.advanceTimersByTimeAsync(5_000);
    const token = await promise;

    expect(token).toBe('fresh-token');
    expect(putCallCount()).toBe(2);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(sessionStorage.getItem('session_expired')).toBeNull();
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it('keeps the session and schedules a later retry when 5xx persists past all backoff attempts', async () => {
    vi.useFakeTimers();
    const replaceSpy = vi.spyOn(browserNavigation, 'replaceWindowLocation').mockImplementation(() => {});

    const { putCallCount } = mockRefreshResponses(() => (
      { ok: false, status: 503, json: async () => ({ error: 'Upstream unavailable' }) }
    ));

    const promise = useAuthStore.getState().refreshAccessToken();
    await vi.advanceTimersByTimeAsync(10_000);
    const token = await promise;

    expect(token).toBeNull();
    const attemptsAfterFirstRound = putCallCount();
    expect(attemptsAfterFirstRound).toBeGreaterThanOrEqual(2);

    // Session survives:
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().accessToken).toBe('old-token');
    expect(sessionStorage.getItem('session_expired')).toBeNull();
    expect(replaceSpy).not.toHaveBeenCalled();

    // A later retry is scheduled rather than giving up silently.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(putCallCount()).toBeGreaterThan(attemptsAfterFirstRound);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('logs out immediately on a definitive 401 from the refresh endpoint', async () => {
    vi.useFakeTimers();
    const replaceSpy = vi.spyOn(browserNavigation, 'replaceWindowLocation').mockImplementation(() => {});

    window.history.pushState({}, '', '/en/calendar?view=day');
    const { putCallCount } = mockRefreshResponses(() => (
      { ok: false, status: 401, json: async () => ({ error: 'Refresh failed' }) }
    ));

    const token = await useAuthStore.getState().refreshAccessToken();
    await vi.runAllTimersAsync();

    expect(token).toBeNull();
    expect(putCallCount()).toBe(1); // no retries for a definitive rejection
    expect(sessionStorage.getItem('session_expired')).toBe('true');
    expect(sessionStorage.getItem('redirect_after_login')).toBe('/en/calendar?view=day');
    expect(replaceSpy).toHaveBeenCalledWith('/en/login');
  });
});
