import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@/lib/jmap/types";
import { buildImipInvitationHtml } from "../calendar-imip-html";

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    "@type": "Event",
    id: "e1",
    uid: "uid@test",
    title: "Team Sync",
    description: "Agenda items",
    start: "2026-06-11T16:00:00",
    duration: "PT1H",
    timeZone: "America/New_York",
    ...overrides,
  } as CalendarEvent;
}

describe("buildImipInvitationHtml", () => {
  it("includes Pulse branding, logo, and join button", () => {
    const html = buildImipInvitationHtml(
      makeEvent({
        virtualLocations: {
          vl1: {
            "@type": "VirtualLocation",
            uri: "https://meet.example.com/room",
            name: null,
            description: null,
            features: null,
          },
        },
      }),
    );

    expect(html).toContain("Pulse_Favicon.svg");
    expect(html).toContain("#0B1426");
    expect(html).toContain("#3574D4");
    expect(html).toContain("Join meeting");
    expect(html).toContain("https://meet.example.com/room");
    expect(html).toContain("pulsebusiness.ai");
    expect(html).toContain("Agenda items");
  });

  it("escapes HTML in event title", () => {
    const html = buildImipInvitationHtml(makeEvent({ title: "<script>alert(1)</script>" }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
