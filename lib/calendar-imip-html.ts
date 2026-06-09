import { format, parseISO } from "date-fns";
import type { CalendarEvent } from "@/lib/jmap/types";
import { formatEventSummary } from "@/lib/calendar-invitation";
import {
  resolvePhysicalLocationName,
  resolveVirtualMeetingUri,
} from "@/lib/calendar-ics-export";

/** Hosted logo — matches Stalwart imip.rs fallback (no CID embedding in client path). */
export const PULSE_IMIP_LOGO_URL =
  process.env.NEXT_PUBLIC_PULSE_IMIP_LOGO_URL ??
  "https://webmail.pulsebusiness.ai/branding/Pulse_Favicon.svg";

export interface ImipHtmlOptions {
  header?: string;
  logoUrl?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatWhenLabel(event: CalendarEvent): string | null {
  const summary = formatEventSummary(event);
  if (!summary.start) return null;

  try {
    if (summary.isAllDay) {
      const start = format(parseISO(summary.start), "EEEE, MMMM d, yyyy");
      if (summary.end && summary.end !== summary.start) {
        const end = format(parseISO(summary.end), "EEEE, MMMM d, yyyy");
        return `${start} – ${end}`;
      }
      return start;
    }

    const startDate = parseISO(summary.start);
    const startLabel = format(startDate, "EEEE, MMMM d, yyyy 'at' h:mm a");
    if (summary.end) {
      const endDate = parseISO(summary.end);
      if (format(startDate, "yyyy-MM-dd") === format(endDate, "yyyy-MM-dd")) {
        return `${startLabel} – ${format(endDate, "h:mm a")}`;
      }
      return `${startLabel} – ${format(endDate, "EEEE, MMMM d, yyyy 'at' h:mm a")}`;
    }
    return startLabel;
  } catch {
    return summary.start;
  }
}

function getOrganizerLabel(event: CalendarEvent): string | null {
  if (!event.participants) return null;
  for (const p of Object.values(event.participants)) {
    if (p.roles?.owner || p.roles?.chair) {
      return p.name || p.email || null;
    }
  }
  return null;
}

function detailRow(label: string, value: string, htmlValue?: string): string {
  const safeLabel = escapeHtml(label);
  const safeValue = htmlValue ?? escapeHtml(value);
  return `
    <tr>
      <td align="left" style="font-size:0px;padding:10px 25px;word-break:break-word;">
        <div style="font-family:Outfit,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:14px;line-height:1.5;text-align:left;color:#172033;">
          <div style="font-weight:bold;color:#46566f;margin-bottom:4px;">${safeLabel}</div>
          <div>${safeValue}</div>
        </div>
      </td>
    </tr>`;
}

/** Pulse-branded HTML body for client-side iMIP REQUEST (mirrors Stalwart calendar-invite.pulse.html). */
export function buildImipInvitationHtml(
  event: CalendarEvent,
  options: ImipHtmlOptions = {},
): string {
  const logoUrl = options.logoUrl ?? PULSE_IMIP_LOGO_URL;
  const header = options.header ?? `Invitation: ${event.title || "Event"}`;
  const when = formatWhenLabel(event);
  const physical = resolvePhysicalLocationName(event);
  const joinUri = resolveVirtualMeetingUri(event);
  const organizer = getOrganizerLabel(event);

  const rows: string[] = [];
  rows.push(detailRow("Event", event.title || "Event"));
  if (organizer) rows.push(detailRow("Organizer", organizer));
  if (when) rows.push(detailRow("When", when));
  if (physical) rows.push(detailRow("Location", physical));
  if (joinUri) {
    rows.push(
      detailRow(
        "Join online",
        joinUri,
        `<a href="${escapeHtml(joinUri)}" style="color:#3574D4;font-weight:600;text-decoration:none;" target="_blank" rel="noopener noreferrer">${escapeHtml(joinUri)}</a>`,
      ),
    );
  }
  if (event.description?.trim()) {
    rows.push(detailRow("Description", event.description.trim()));
  }

  const joinButton = joinUri
    ? `<tr>
        <td align="center" style="font-size:0px;padding:16px 25px 24px;word-break:break-word;">
          <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:separate;line-height:100%;">
            <tr>
              <td align="center" bgcolor="#3574D4" role="presentation" style="border:none;border-radius:8px;cursor:auto;">
                <a href="${escapeHtml(joinUri)}" style="display:inline-block;background:#3574D4;color:#ffffff;font-family:Outfit,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:14px;font-weight:bold;line-height:120%;margin:0;text-decoration:none;padding:12px 24px;border-radius:8px;" target="_blank" rel="noopener noreferrer">Join meeting</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(header)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f8fafc;word-spacing:normal;">
  <div style="background-color:#f8fafc;padding:24px 12px;">
    <div class="color-info" style="margin:0 auto;max-width:600px;background:#3574D4;background-color:#3574D4;border-radius:12px 12px 0 0;">
      <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;">
        <tr>
          <td align="center" style="padding:14px 25px;font-family:Outfit,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:16px;font-weight:bold;line-height:1.4;color:#ffffff;">
            ${escapeHtml(header)}
          </td>
        </tr>
      </table>
    </div>
    <div style="background:#ffffff;margin:0 auto;max-width:600px;border:1px solid #dbe4f0;border-top:none;">
      <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;">
        <tr>
          <td style="padding:0;">
            <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;">
              <tr>
                <td align="left" style="padding:20px 25px 10px;background-color:#0B1426;">
                  <img src="${escapeHtml(logoUrl)}" alt="Pulse" width="36" height="36" style="border:0;display:block;height:36px;width:36px;">
                </td>
              </tr>
              ${rows.join("")}
              ${joinButton}
            </table>
          </td>
        </tr>
      </table>
    </div>
    <div style="background:#f8fafc;margin:0 auto;max-width:600px;border:1px solid #dbe4f0;border-top:none;border-radius:0 0 12px 12px;">
      <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;">
        <tr>
          <td align="center" style="padding:20px 25px;font-family:Outfit,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:12px;line-height:1.6;color:#6b7890;">
            <a href="https://pulsebusiness.ai" style="color:#3574D4;text-decoration:none;margin:0 6px;">pulsebusiness.ai</a>
            <a href="https://webmail.pulsebusiness.ai" style="color:#3574D4;text-decoration:none;margin:0 6px;">Webmail</a>
            <a href="https://auth.pulsebusiness.ai" style="color:#3574D4;text-decoration:none;margin:0 6px;">Sign in</a>
          </td>
        </tr>
      </table>
    </div>
  </div>
</body>
</html>`;
}
