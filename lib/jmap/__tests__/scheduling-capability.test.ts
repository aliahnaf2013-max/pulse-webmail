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

  it('serverHandlesCalendarScheduling is true when calendars capability is present', () => {
    expect(
      serverHandlesCalendarScheduling({
        'urn:ietf:params:jmap:calendars': { maxCalendarsPerAccount: 10 },
      }),
    ).toBe(true);
  });

  it('serverHandlesCalendarScheduling is false without calendars capability', () => {
    expect(serverHandlesCalendarScheduling({ 'urn:ietf:params:jmap:core': {} })).toBe(false);
    expect(serverHandlesCalendarScheduling(null)).toBe(false);
  });

  it('BULWARK_FORCE_CLIENT_IMIP disables server scheduling detection', () => {
    vi.stubEnv('BULWARK_FORCE_CLIENT_IMIP', '1');
    expect(isClientImipForced()).toBe(true);
    expect(
      serverHandlesCalendarScheduling({
        'urn:ietf:params:jmap:calendars': {},
      }),
    ).toBe(false);
  });

  it('shouldUseClientImip mirrors capability presence on client', () => {
    const withCalendars = {
      getCapabilities: () => ({ 'urn:ietf:params:jmap:calendars': {} }),
    } as Pick<IJMAPClient, 'getCapabilities'>;
    const withoutCalendars = {
      getCapabilities: () => ({ 'urn:ietf:params:jmap:core': {} }),
    } as Pick<IJMAPClient, 'getCapabilities'>;

    expect(shouldUseClientImip(withCalendars)).toBe(false);
    expect(shouldUseClientImip(withoutCalendars)).toBe(true);
  });
});
