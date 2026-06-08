import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCalendarStore } from '../calendar-store';
import type { Calendar, CalendarEvent, CalendarParticipant } from '@/lib/jmap/types';
import type { IJMAPClient } from '@/lib/jmap/client-interface';

function makeParticipant(overrides: Partial<CalendarParticipant> = {}): CalendarParticipant {
  return {
    '@type': 'Participant',
    name: 'Guest',
    email: 'guest@example.com',
    calendarAddress: null,
    description: null,
    sendTo: null,
    kind: 'individual',
    roles: { attendee: true },
    participationStatus: 'needs-action',
    participationComment: null,
    expectReply: true,
    scheduleAgent: 'server',
    scheduleForceSend: false,
    scheduleId: null,
    scheduleSequence: 0,
    scheduleStatus: null,
    scheduleUpdated: null,
    invitedBy: null,
    delegatedTo: null,
    delegatedFrom: null,
    memberOf: null,
    locationId: null,
    language: null,
    links: null,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'evt-new',
    calendarIds: { 'cal-1': true },
    isDraft: false,
    isOrigin: true,
    utcStart: '2026-06-10T14:00:00Z',
    utcEnd: '2026-06-10T15:00:00Z',
    '@type': 'Event',
    uid: 'uid-1',
    title: 'Team sync',
    description: 'Agenda items',
    descriptionContentType: 'text/plain',
    created: null,
    updated: '2026-06-08T12:00:00Z',
    sequence: 0,
    start: '2026-06-10T14:00:00Z',
    duration: 'PT1H',
    timeZone: 'UTC',
    showWithoutTime: false,
    status: 'confirmed',
    freeBusyStatus: 'busy',
    privacy: 'public',
    color: null,
    keywords: null,
    categories: null,
    locale: null,
    replyTo: null,
    organizerCalendarAddress: null,
    participants: {
      org: makeParticipant({
        name: 'Organizer',
        email: 'org@pulsebusiness.ai',
        roles: { owner: true },
      }),
      guest: makeParticipant(),
    },
    mayInviteSelf: false,
    mayInviteOthers: true,
    hideAttendees: false,
    recurrenceId: null,
    recurrenceIdTimeZone: null,
    recurrenceRules: null,
    recurrenceOverrides: null,
    excludedRecurrenceRules: null,
    useDefaultAlerts: false,
    alerts: null,
    locations: { loc1: { '@type': 'Location', name: 'Room A', description: null, locationTypes: null, coordinates: null, timeZone: null, links: null, relativeTo: null } },
    virtualLocations: null,
    links: null,
    relatedTo: null,
    ...overrides,
  };
}

function makeCalendar(): Calendar {
  return {
    id: 'cal-1',
    name: 'Personal',
    description: null,
    color: '#3574D4',
    sortOrder: 0,
    isVisible: true,
    isSubscribed: true,
    isDefault: true,
    includeInAvailability: 'all',
    defaultAlertsWithTime: null,
    defaultAlertsWithoutTime: null,
    timeZone: 'UTC',
    shareWith: null,
    myRights: {
      mayReadFreeBusy: true,
      mayReadItems: true,
      mayWriteAll: true,
      mayWriteOwn: true,
      mayUpdatePrivate: true,
      mayRSVP: true,
      mayShare: true,
      mayDelete: true,
    },
  };
}

function makeMockClient(overrides: Partial<IJMAPClient> = {}): IJMAPClient {
  const created = makeEvent({ id: 'evt-created' });
  return {
    getCapabilities: () => ({ 'urn:ietf:params:jmap:calendars': {} }),
    createCalendarEvent: vi.fn().mockResolvedValue(created),
    updateCalendarEvent: vi.fn().mockResolvedValue(undefined),
    getCalendarEvent: vi.fn().mockResolvedValue(created),
    deleteCalendarEvent: vi.fn().mockResolvedValue(undefined),
    sendImipInvitation: vi.fn().mockResolvedValue(undefined),
    sendImipCancellation: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as IJMAPClient;
}

describe('calendar-store iMIP gating', () => {
  beforeEach(() => {
    useCalendarStore.setState({
      calendars: [makeCalendar()],
      events: [],
      error: null,
    });
    vi.unstubAllEnvs();
  });

  it('createEvent skips client sendImipInvitation when server handles scheduling', async () => {
    const client = makeMockClient();
    await useCalendarStore.getState().createEvent(client, makeEvent(), true);

    expect(client.createCalendarEvent).toHaveBeenCalled();
    expect(client.sendImipInvitation).not.toHaveBeenCalled();
  });

  it('createEvent calls sendImipInvitation when calendars capability is absent', async () => {
    const client = makeMockClient({
      getCapabilities: () => ({ 'urn:ietf:params:jmap:core': {} }),
    });
    await useCalendarStore.getState().createEvent(client, makeEvent(), true);

    expect(client.sendImipInvitation).toHaveBeenCalledTimes(1);
  });

  it('updateEvent skips client sendImipInvitation when server handles scheduling', async () => {
    const existing = makeEvent({ id: 'evt-1' });
    useCalendarStore.setState({ events: [existing] });
    const client = makeMockClient();

    await useCalendarStore.getState().updateEvent(
      client,
      'evt-1',
      { title: 'Updated title' },
      true,
    );

    expect(client.updateCalendarEvent).toHaveBeenCalled();
    expect(client.sendImipInvitation).not.toHaveBeenCalled();
  });

  it('deleteEvent skips client sendImipCancellation when server handles scheduling', async () => {
    const existing = makeEvent({ id: 'evt-1' });
    useCalendarStore.setState({ events: [existing] });
    const client = makeMockClient();

    await useCalendarStore.getState().deleteEvent(client, 'evt-1', true);

    expect(client.deleteCalendarEvent).toHaveBeenCalled();
    expect(client.getCalendarEvent).not.toHaveBeenCalled();
    expect(client.sendImipCancellation).not.toHaveBeenCalled();
  });
});
