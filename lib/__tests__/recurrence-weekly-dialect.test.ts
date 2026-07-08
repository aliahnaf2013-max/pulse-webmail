import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JMAPClient } from '../jmap/client';
import { expandRecurringEvents } from '../recurrence-expansion';
import type { CalendarEvent } from '../jmap/types';

/**
 * Regression tests for the Stalwart JSCalendar recurrence dialect.
 *
 * Stalwart's calcard crate implements recurrence as a SINGULAR
 * "recurrenceRule" object (JSCalendar 2.0 / jscalendarbis draft), not the
 * RFC 8984 plural "recurrenceRules" array the client uses internally.
 * Sending the plural form is rejected with invalidProperties, and requesting
 * the plural property returns null — so a translation layer in the JMAP
 * client converts between the two on every read and write.
 *
 * These tests pin that translation end-to-end at the wire level: a weekly
 * event saved through the client must reach the server in the singular
 * dialect, and a weekly event served in the singular dialect must expand
 * into occurrences in weeks after the master start (the "Team Meeting
 * renders next week" guarantee).
 */

function makeSession() {
  return {
    capabilities: {
      'urn:ietf:params:jmap:core': {},
      'urn:ietf:params:jmap:calendars': {},
    },
    accounts: {
      'acct-1': {
        name: 'test@example.com',
        isPersonal: true,
        accountCapabilities: {
          'urn:ietf:params:jmap:mail': {},
          'urn:ietf:params:jmap:calendars': {},
        },
      },
    },
    primaryAccounts: {
      'urn:ietf:params:jmap:mail': 'acct-1',
      'urn:ietf:params:jmap:calendars': 'acct-1',
    },
    apiUrl: 'https://mail.example.com/jmap/api',
    downloadUrl: 'https://mail.example.com/jmap/download/{accountId}/{blobId}/{name}',
    uploadUrl: 'https://mail.example.com/jmap/upload/{accountId}/',
    eventSourceUrl: 'https://mail.example.com/jmap/eventsource',
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// The master event as Stalwart serves it over JMAP: note the SINGULAR
// recurrenceRule key. Mirrors the production shape of the weekly
// "Team Meeting" (Wednesdays 16:00 America/New_York starting 2026-07-15).
const SERVER_MASTER_EVENT = {
  id: 'ev-master',
  '@type': 'Event',
  uid: 'team-meeting-weekly@example.com',
  calendarIds: { 'cal-1': true },
  title: 'Team Meeting',
  start: '2026-07-15T16:00:00',
  duration: 'PT1H',
  timeZone: 'America/New_York',
  showWithoutTime: false,
  status: 'confirmed',
  recurrenceRule: {
    frequency: 'weekly',
    byDay: [{ day: 'we' }],
  },
};

describe('weekly recurrence over the Stalwart JMAP dialect', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  async function createConnectedClient(): Promise<JMAPClient> {
    fetchSpy.mockResolvedValueOnce(jsonResponse(makeSession()));
    const client = new JMAPClient('https://mail.example.com', 'test@example.com', 'pass');
    await client.connect();
    fetchSpy.mockReset();
    return client;
  }

  function requestBodies(): Array<{ methodCalls: [string, Record<string, unknown>, string][] }> {
    return fetchSpy.mock.calls.map((call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string));
  }

  it('createCalendarEvent sends the singular recurrenceRule dialect with nulls stripped', async () => {
    const client = await createConnectedClient();

    fetchSpy
      // CalendarEvent/set
      .mockResolvedValueOnce(jsonResponse({
        methodResponses: [['CalendarEvent/set', { created: { 'new-event': { id: 'ev-master' } } }, '0']],
      }))
      // follow-up CalendarEvent/get of the created event
      .mockResolvedValueOnce(jsonResponse({
        methodResponses: [['CalendarEvent/get', { list: [SERVER_MASTER_EVENT] }, '0']],
      }))
      // debug verification CalendarEvent/query by uid
      .mockResolvedValueOnce(jsonResponse({
        methodResponses: [['CalendarEvent/query', { ids: [] }, '0']],
      }));

    // Exactly what the event modal produces for "repeat weekly": the RFC 8984
    // plural array, padded with explicit nulls.
    const created = await client.createCalendarEvent({
      uid: 'team-meeting-weekly@example.com',
      title: 'Team Meeting',
      start: '2026-07-15T16:00:00',
      duration: 'PT1H',
      timeZone: 'America/New_York',
      showWithoutTime: false,
      calendarIds: { 'cal-1': true },
      status: 'confirmed',
      recurrenceRules: [{
        '@type': 'RecurrenceRule',
        frequency: 'weekly',
        interval: 1,
        rscale: 'gregorian',
        skip: 'omit',
        firstDayOfWeek: 'mo',
        byDay: null,
        byMonthDay: null,
        byMonth: null,
        count: null,
        until: null,
      }],
    } as unknown as Partial<CalendarEvent>);

    const setBody = requestBodies()[0];
    const [method, args] = setBody.methodCalls[0];
    expect(method).toBe('CalendarEvent/set');
    const sent = (args.create as Record<string, Record<string, unknown>>)['new-event'];

    // The RFC plural form must never reach the wire — Stalwart rejects it
    // with invalidProperties.
    expect(sent).not.toHaveProperty('recurrenceRules');
    expect(sent.recurrenceRule).toEqual({
      '@type': 'RecurrenceRule',
      frequency: 'weekly',
      interval: 1,
      rscale: 'gregorian',
      skip: 'omit',
      firstDayOfWeek: 'mo',
    });

    // The created event comes back through the normalization layer as the
    // internal plural form.
    expect(created.recurrenceRules).toEqual([SERVER_MASTER_EVENT.recurrenceRule]);
  });

  it('requests the singular recurrenceRule property on CalendarEvent/get', async () => {
    const client = await createConnectedClient();

    fetchSpy
      .mockResolvedValueOnce(jsonResponse({
        methodResponses: [['CalendarEvent/query', { ids: ['ev-master'] }, '0']],
      }))
      .mockResolvedValueOnce(jsonResponse({
        methodResponses: [['CalendarEvent/get', { list: [SERVER_MASTER_EVENT] }, '0']],
      }));

    await client.queryCalendarEvents({ after: '2026-07-20T00:00:00', before: '2026-07-27T00:00:00' });

    const getBody = requestBodies()[1];
    const [method, args] = getBody.methodCalls[0];
    expect(method).toBe('CalendarEvent/get');
    const properties = args.properties as string[];
    // Stalwart only understands the singular property names; requesting the
    // plural ones silently yields null and recurrence stops rendering.
    expect(properties).toContain('recurrenceRule');
    expect(properties).toContain('excludedRecurrenceRule');
    expect(properties).not.toContain('recurrenceRules');
    expect(properties).not.toContain('excludedRecurrenceRules');
  });

  it('a weekly event fetched in a later week normalizes and expands into that week', async () => {
    const client = await createConnectedClient();

    // Viewing the week AFTER the master start (Jul 20–26): the server's
    // time-window query matches the recurrence and returns the master id.
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({
        methodResponses: [['CalendarEvent/query', { ids: ['ev-master'] }, '0']],
      }))
      .mockResolvedValueOnce(jsonResponse({
        methodResponses: [['CalendarEvent/get', { list: [SERVER_MASTER_EVENT] }, '0']],
      }));

    const rangeStart = '2026-07-20T00:00:00';
    const rangeEnd = '2026-07-27T00:00:00';
    const events = await client.queryCalendarEvents({ after: rangeStart, before: rangeEnd });

    // Singular server dialect must normalize to the internal plural array.
    expect(events).toHaveLength(1);
    expect(events[0].recurrenceRules).toEqual([SERVER_MASTER_EVENT.recurrenceRule]);
    expect(events[0]).not.toHaveProperty('recurrenceRule');

    // Client-side expansion (what the calendar store renders from) must
    // produce the Wednesday occurrence inside the viewed week.
    const rendered = expandRecurringEvents(events, rangeStart, rangeEnd);
    expect(rendered).toHaveLength(1);
    expect(rendered[0].start).toBe('2026-07-22T16:00:00');
    expect(rendered[0].recurrenceId).toBe('2026-07-22T16:00:00');
    expect(rendered[0].id).toBe('ev-master:2026-07-22T16:00:00');
    expect(rendered[0].title).toBe('Team Meeting');
  });

  it('expansion keeps producing occurrences many weeks out', async () => {
    const client = await createConnectedClient();

    fetchSpy
      .mockResolvedValueOnce(jsonResponse({
        methodResponses: [['CalendarEvent/query', { ids: ['ev-master'] }, '0']],
      }))
      .mockResolvedValueOnce(jsonResponse({
        methodResponses: [['CalendarEvent/get', { list: [SERVER_MASTER_EVENT] }, '0']],
      }));

    // Four weeks after the master start.
    const rangeStart = '2026-08-10T00:00:00';
    const rangeEnd = '2026-08-17T00:00:00';
    const events = await client.queryCalendarEvents({ after: rangeStart, before: rangeEnd });
    const rendered = expandRecurringEvents(events, rangeStart, rangeEnd);

    expect(rendered).toHaveLength(1);
    expect(rendered[0].start).toBe('2026-08-12T16:00:00');
  });
});
