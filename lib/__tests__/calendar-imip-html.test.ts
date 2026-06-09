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

    expect(html).toContain("#0B1426");
    expect(html).toContain("#3574D4");
    expect(html).toContain("Join meeting");
    expect(html).toContain("https://meet.example.com/room");
    expect(html).toContain("pulsebusiness.ai");
    expect(html).toContain("Agenda items");
  });

  it("uses a text-only wordmark header (no logo image — Outlook drops SVGs/remote images)", () => {
    const html = buildImipInvitationHtml(makeEvent());
    expect(html).toContain("Pulse Business AI");
    expect(html).not.toContain("<img");
    expect(html).not.toContain(".svg");
  });

  it("matches the transactional shell chrome (force-light, wordmark, callout, 4-link footer)", () => {
    const html = buildImipInvitationHtml(makeEvent());
    // Bulwark iframe invert survival + Apple Mail dark mode.
    expect(html).toContain("pulse-force-light");
    expect(html).toContain("prefers-color-scheme: dark");
    // Navy header carries the wordmark, not just the logo.
    expect(html).toContain("Pulse Business AI");
    // Single bordered card + detail callout, matching shell.html.j2.
    expect(html).toContain("pulse-email-card");
    expect(html).toContain("pulse-callout-cell");
    // Footer links mirror brand.yaml (4 links incl. Business OS).
    expect(html).toContain("Business OS");
    expect(html).toContain("The Pulse Business AI team");
  });

  it("escapes HTML in event title", () => {
    const html = buildImipInvitationHtml(makeEvent({ title: "<script>alert(1)</script>" }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
