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
  it("includes Pulse branding and the join link (no redundant button)", () => {
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
    // Join is the callout link only — the separate CTA button was removed as redundant.
    expect(html).toContain("https://meet.example.com/room");
    expect(html).not.toContain("Join meeting");
    expect(html).toContain("pulsebusiness.ai");
    expect(html).toContain("Agenda items");
  });

  it("header has the signature gradient + approved equal-width text lockup", () => {
    const html = buildImipInvitationHtml(makeEvent());
    // Amber + blue two-layer gradient (degrades to navy in Outlook).
    expect(html).toContain("radial-gradient");
    expect(html).toContain("background-color:#0B1426");
    expect(html).toContain("#f59e0b");
    expect(html).toContain('data-pulse-logo-rule="equal-width-lockup"');
    expect(html).toContain("font-size:38px");
    expect(html).toContain("letter-spacing:3.5px");
    expect(html).toContain("font-size:16px");
    expect(html).toContain("word-spacing:4px");
    expect(html).not.toContain("Pulse_Favicon.svg");
    expect(html).toContain(">PULSE<");
    expect(html).toContain(">BUSINESS AI<");
  });

  it("matches the transactional shell chrome (force-light, wordmark, callout, footer)", () => {
    const html = buildImipInvitationHtml(makeEvent());
    // Bulwark iframe invert survival + Apple Mail dark mode.
    expect(html).toContain("pulse-force-light");
    expect(html).toContain("prefers-color-scheme: dark");
    // Navy header carries the wordmark, not just the logo.
    expect(html).toContain("BUSINESS AI");
    // Single bordered card + detail callout, matching shell.html.j2.
    expect(html).toContain("pulse-email-card");
    expect(html).toContain("pulse-callout-cell");
    // Footer carries only the pulsebusiness.ai link.
    expect(html).toContain("The Pulse Business AI team");
  });

  it("escapes HTML in event title", () => {
    const html = buildImipInvitationHtml(makeEvent({ title: "<script>alert(1)</script>" }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
