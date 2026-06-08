import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isClientImipForced,
  serverHandlesCalendarScheduling,
  shouldUseClientImip,
} from '../scheduling-capability';
import type { IJMAPClient } from '../client-interface';

describe('scheduling-capability', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to client iMIP until NEXT_PUBLIC_PULSE_SERVER_IMIP=1', () => {
    expect(
      serverHandlesCalendarScheduling({
        'urn:ietf:params:jmap:calendars': { maxCalendarsPerAccount: 10 },
      }),
    ).toBe(false);
  });

  it('serverHandlesCalendarScheduling when Pulse server iMIP explicitly enabled', () => {
    vi.stubEnv('NEXT_PUBLIC_PULSE_SERVER_IMIP', '1');
    expect(
      serverHandlesCalendarScheduling({
        'urn:ietf:params:jmap:calendars': { maxCalendarsPerAccount: 10 },
      }),
    ).toBe(true);
  });

  it('serverHandlesCalendarScheduling is false without calendars capability', () => {
    vi.stubEnv('NEXT_PUBLIC_PULSE_SERVER_IMIP', '1');
    expect(serverHandlesCalendarScheduling({ 'urn:ietf:params:jmap:core': {} })).toBe(false);
    expect(serverHandlesCalendarScheduling(null)).toBe(false);
  });

  it('BULWARK_FORCE_CLIENT_IMIP disables server scheduling detection', () => {
    vi.stubEnv('NEXT_PUBLIC_PULSE_SERVER_IMIP', '1');
    vi.stubEnv('BULWARK_FORCE_CLIENT_IMIP', '1');
    expect(isClientImipForced()).toBe(true);
    expect(
      serverHandlesCalendarScheduling({
        'urn:ietf:params:jmap:calendars': {},
      }),
    ).toBe(false);
  });

  it('shouldUseClientImip uses client path by default on Pulse fleet', () => {
    const withCalendars = {
      getCapabilities: () => ({ 'urn:ietf:params:jmap:calendars': {} }),
    } as Pick<IJMAPClient, 'getCapabilities'>;
    expect(shouldUseClientImip(withCalendars)).toBe(true);
  });

  it('shouldUseClientImip skips client when server iMIP enabled at build time', () => {
    vi.stubEnv('NEXT_PUBLIC_PULSE_SERVER_IMIP', '1');
    const withCalendars = {
      getCapabilities: () => ({ 'urn:ietf:params:jmap:calendars': {} }),
    } as Pick<IJMAPClient, 'getCapabilities'>;
    expect(shouldUseClientImip(withCalendars)).toBe(false);
  });
});
