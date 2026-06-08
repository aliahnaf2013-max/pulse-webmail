import type { IJMAPClient } from './client-interface';

const CALENDARS_CAPABILITY = 'urn:ietf:params:jmap:calendars';

/**
 * When "1", trust Stalwart CalendarEvent/set + sendSchedulingMessages for iMIP.
 * Must be baked at build time (NEXT_PUBLIC_*). Until server iMIP is verified on
 * Pulse fleet, leave unset so Bulwark client sendImipInvitation runs.
 */
function isPulseServerImipEnabled(): boolean {
  if (typeof process === 'undefined') return false;
  return process.env.NEXT_PUBLIC_PULSE_SERVER_IMIP === '1';
}

export interface JMAPSessionLike {
  capabilities?: Record<string, unknown>;
}

/** Debug override: force Bulwark client-side iMIP even when the server can schedule. */
export function isClientImipForced(): boolean {
  if (typeof process !== 'undefined') {
    if (process.env.BULWARK_FORCE_CLIENT_IMIP === '1') return true;
    if (process.env.NEXT_PUBLIC_BULWARK_FORCE_CLIENT_IMIP === '1') return true;
  }
  return false;
}

/**
 * True when the JMAP server exposes calendars and should own iMIP scheduling
 * (Stalwart CalendarEvent/set + sendSchedulingMessages).
 */
export function serverHandlesCalendarScheduling(
  capabilities?: Record<string, unknown> | null,
): boolean {
  if (isClientImipForced()) return false;
  if (!isPulseServerImipEnabled()) return false;
  return Boolean(capabilities?.[CALENDARS_CAPABILITY]);
}

/** True when Bulwark must send client-side iMIP (no server scheduling). */
export function shouldUseClientImip(client: Pick<IJMAPClient, 'getCapabilities'>): boolean {
  return !serverHandlesCalendarScheduling(client.getCapabilities());
}
