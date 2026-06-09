import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '@/lib/jmap/types';
import {
  buildImipInvitationBody,
  buildImipRequestIcs,
  normalizeMeetingUri,
  resolveEventLocation,
  resolveVirtualMeetingUri,
} from '../calendar-ics-export';

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    '@type': 'Event',
    id: 'e1',
    uid: 'uid@test',
    title: 'Team Sync',
    start: '2026-06-11T16:00:00',
    duration: 'PT1H',
    ...overrides,
  } as CalendarEvent;
}

describe('normalizeMeetingUri', () => {
  it('prepends https when scheme is missing', () => {
    expect(normalizeMeetingUri('zoom.example.com/j/123')).toBe('https://zoom.example.com/j/123');
  });

  it('preserves existing http(s) URLs', () => {
    expect(normalizeMeetingUri('https://meet.example.com/abc')).toBe('https://meet.example.com/abc');
  });
});

describe('resolveVirtualMeetingUri', () => {
  it('normalizes bare hostnames', () => {
    const event = makeEvent({
      virtualLocations: {
        vl1: { '@type': 'VirtualLocation', uri: 'zoom.pulsebusiness.ai', name: null, description: null, features: null },
      },
    });
    expect(resolveVirtualMeetingUri(event)).toBe('https://zoom.pulsebusiness.ai');
  });
});

describe('resolveEventLocation', () => {
  it('prefers virtual join URL over physical location label', () => {
    const event = makeEvent({
      locations: {
        loc1: { '@type': 'Location', name: 'zoom', description: null, locationTypes: null, coordinates: null, timeZone: null, links: null, relativeTo: null },
      },
      virtualLocations: {
        vl1: { '@type': 'VirtualLocation', uri: 'https://zoom.us/j/123', name: null, description: null, features: null },
      },
    });
    expect(resolveEventLocation(event)).toBe('https://zoom.us/j/123');
  });
});

describe('buildImipInvitationBody', () => {
  it('includes both physical location and join link when both exist', () => {
    const event = makeEvent({
      title: 'test 2.1',
      description: 'updated',
      locations: {
        loc1: { '@type': 'Location', name: 'zoom', description: null, locationTypes: null, coordinates: null, timeZone: null, links: null, relativeTo: null },
      },
      virtualLocations: {
        vl1: { '@type': 'VirtualLocation', uri: 'zoom.pulsebusiness.ai', name: null, description: null, features: null },
      },
    });

    const body = buildImipInvitationBody(event);
    expect(body).toContain('Location: zoom');
    expect(body).toContain('Join: https://zoom.pulsebusiness.ai');
  });
});

describe('buildImipRequestIcs', () => {
  it('writes normalized URL and LOCATION for virtual meetings', () => {
    const event = makeEvent({
      virtualLocations: {
        vl1: { '@type': 'VirtualLocation', uri: 'meet.example.com/room', name: null, description: null, features: null },
      },
    });

    const ics = buildImipRequestIcs(event);
    expect(ics).toContain('URL:https://meet.example.com/room');
    expect(ics).toContain('LOCATION:https://meet.example.com/room');
  });
});
