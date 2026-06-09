import { format, parseISO } from "date-fns";
import type { CalendarEvent } from "@/lib/jmap/types";
import { formatEventSummary } from "@/lib/calendar-invitation";
import {
  resolvePhysicalLocationName,
  resolveVirtualMeetingUri,
} from "@/lib/calendar-ics-export";

/**
 * Pulse-branded HTML for client-side iMIP REQUEST.
 *
 * Mirrors the transactional mail chrome in `ops/mail-templates/shell.html.j2`
 * (brand tokens from `ops/mail-templates/brand.yaml`) so calendar invites look
 * identical to password-reset / mail-setup emails: navy logo header, single
 * bordered card, Bricolage headline, light-blue detail callout, blue CTA, and
 * the `.pulse-force-light` dark-mode survival classes that stop Bulwark webmail
 * from filter-inverting the body.
 */

// Brand tokens — kept in sync with ops/mail-templates/brand.yaml.
const BRAND = {
  publicSiteUrl: "https://pulsebusiness.ai",
  // Wordmark only — Outlook (Word renderer) drops SVGs and blocks remote images
  // by default, so a logo <img> shows a broken box. Text always renders.
  logoText: "Pulse Business AI",
  colors: {
    navy: "#0B1426",
    blue: "#3574D4",
    background: "#f8fafc",
    card: "#ffffff",
    text: "#172033",
    muted: "#46566f",
    footer: "#6b7890",
    border: "#dbe4f0",
    callout: "#eef4fb",
  },
  fonts: {
    heading:
      "Bricolage Grotesque, Outfit, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif",
    body: "Outfit, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif",
  },
  footerLinks: [
    { label: "pulsebusiness.ai", url: "https://pulsebusiness.ai" },
    { label: "Sign in", url: "https://auth.pulsebusiness.ai" },
    { label: "Webmail", url: "https://webmail.pulsebusiness.ai" },
    { label: "Business OS", url: "https://businessos.pulsebusiness.ai" },
  ],
} as const;

export interface ImipHtmlOptions {
  /** Card headline. Defaults to "You're invited". */
  headline?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Force-light CSS ported from shell_styles.inc.css (classes this template uses). */
function shellStyles(): string {
  const c = BRAND.colors;
  const rules = `
      .pulse-force-light,
      .pulse-force-light .pulse-body-cell,
      .pulse-force-light .pulse-footer-cell { background-color: ${c.card} !important; }
      .pulse-force-light .pulse-outer-cell { background-color: ${c.background} !important; }
      .pulse-force-light .pulse-header-cell { background-color: ${c.navy} !important; }
      .pulse-force-light h1,
      .pulse-force-light .pulse-body-text { color: ${c.text} !important; }
      .pulse-force-light .pulse-muted-text { color: ${c.muted} !important; }
      .pulse-force-light .pulse-footer-text { color: ${c.footer} !important; }
      .pulse-force-light .pulse-cta-link { background-color: ${c.blue} !important; color: #ffffff !important; }
      .pulse-force-light .pulse-callout-cell { background-color: ${c.callout} !important; border-color: ${c.border} !important; }`;
  return `${rules}
      @media (prefers-color-scheme: dark) {${rules}
      }`;
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

/** One labelled line inside the detail callout (uppercase muted label + value). */
function calloutRow(label: string, value: string, htmlValue?: string): string {
  const safeValue = htmlValue ?? escapeHtml(value);
  return `
                <tr>
                  <td style="padding:4px 0;">
                    <div class="pulse-muted-text" style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${BRAND.colors.muted};">${escapeHtml(label)}</div>
                    <div class="pulse-body-text" style="font-size:15px;color:${BRAND.colors.text};margin-top:2px;word-break:break-word;">${safeValue}</div>
                  </td>
                </tr>`;
}

/** Navy header wordmark — text only (mirrors shell.html.j2 _logo_block image-off fallback). */
function logoBlock(): string {
  return `<span style="font-size:20px;font-weight:700;color:#ffffff;line-height:1.2;">${escapeHtml(BRAND.logoText)}</span>`;
}

function footerLinksHtml(): string {
  return BRAND.footerLinks
    .map(
      (l) =>
        `<a href="${l.url}" style="color:${BRAND.colors.blue};text-decoration:none;">${escapeHtml(l.label)}</a>`,
    )
    .join('<span style="color:' + BRAND.colors.footer + ';"> &middot; </span>');
}

/** Pulse-branded HTML body for client-side iMIP REQUEST. */
export function buildImipInvitationHtml(
  event: CalendarEvent,
  options: ImipHtmlOptions = {},
): string {
  const c = BRAND.colors;
  const headline = options.headline ?? "You're invited";
  const title = event.title || "Event";
  const when = formatWhenLabel(event);
  const physical = resolvePhysicalLocationName(event);
  const joinUri = resolveVirtualMeetingUri(event);
  const organizer = getOrganizerLabel(event);
  const preheader = `${title}${when ? ` — ${when}` : ""}`;
  const greeting = organizer
    ? `${escapeHtml(organizer)} invited you to the following event.`
    : "You have been invited to the following event.";

  const rows: string[] = [calloutRow("Event", title)];
  if (when) rows.push(calloutRow("When", when));
  if (physical) rows.push(calloutRow("Location", physical));
  if (joinUri) {
    rows.push(
      calloutRow(
        "Join online",
        joinUri,
        `<a href="${escapeHtml(joinUri)}" style="color:${c.blue};font-weight:600;text-decoration:none;" target="_blank" rel="noopener noreferrer">${escapeHtml(joinUri)}</a>`,
      ),
    );
  }
  if (event.description?.trim()) {
    rows.push(calloutRow("Description", event.description.trim()));
  }

  const ctaButton = joinUri
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 8px;">
                <tr>
                  <td bgcolor="${c.blue}" style="border-radius:8px;background-color:${c.blue};">
                    <a class="pulse-email-cta pulse-cta-link" href="${escapeHtml(joinUri)}" style="display:inline-block;background-color:${c.blue};color:#ffffff;text-decoration:none;font-weight:700;padding:14px 24px;border-radius:8px;min-height:44px;line-height:18px;mso-padding-alt:14px 24px;" target="_blank" rel="noopener noreferrer">Join meeting</a>
                  </td>
                </tr>
              </table>`
    : "";

  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />
    <meta name="x-apple-disable-message-reformatting" />
    <title>${escapeHtml(headline)}: ${escapeHtml(title)}</title>
    <!--[if mso]>
    <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
    <![endif]-->
    <style>
      :root { color-scheme: light; supported-color-schemes: light; }
      @media (max-width:480px) {
        .pulse-email-card { border-radius: 0 !important; }
        .pulse-email-pad { padding-left: 20px !important; padding-right: 20px !important; }
        .pulse-email-cta { display: block !important; width: 100% !important; box-sizing: border-box !important; text-align: center !important; }
      }
${shellStyles()}
    </style>
  </head>
  <body class="pulse-force-light" style="margin:0;padding:0;background-color:${c.background};font-family:${BRAND.fonts.body};color:${c.text};line-height:1.5;">
    <!-- prefers-color-scheme: dark — Bulwark webmail detects this marker and skips iframe filter-invert -->
    <style>
${shellStyles()}
    </style>
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${c.background};">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" class="pulse-outer-cell" bgcolor="${c.background}" style="background-color:${c.background};margin:0;padding:28px 12px;">
      <tr><td align="center" class="pulse-outer-cell" bgcolor="${c.background}" style="background-color:${c.background};">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" class="pulse-email-card pulse-force-light" bgcolor="${c.card}" style="max-width:584px;background-color:${c.card};border:1px solid ${c.border};border-radius:12px;overflow:hidden;">
          <tr>
            <td class="pulse-email-pad pulse-header-cell" bgcolor="${c.navy}" style="padding:24px 28px 20px;background-color:${c.navy};">
              <a href="${BRAND.publicSiteUrl}" style="text-decoration:none;color:#ffffff;">
                ${logoBlock()}
              </a>
            </td>
          </tr>
          <tr>
            <td class="pulse-email-pad pulse-body-cell" bgcolor="${c.card}" style="padding:30px 28px 26px;background-color:${c.card};">
              <h1 style="font-family:${BRAND.fonts.heading};font-size:26px;line-height:1.25;margin:0 0 12px;color:${c.text};font-weight:700;">${escapeHtml(headline)}</h1>
              <p class="pulse-body-text" style="font-size:16px;margin:0 0 18px;color:${c.text};">${greeting}</p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" class="pulse-callout-cell" style="margin:0 0 22px;">
                <tr><td class="pulse-callout-cell" bgcolor="${c.callout}" style="padding:14px 18px;background-color:${c.callout};border:1px solid ${c.border};border-radius:8px;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${rows.join("")}
                  </table>
                </td></tr>
              </table>
              ${ctaButton}
            </td>
          </tr>
          <tr>
            <td class="pulse-email-pad pulse-footer-cell" bgcolor="${c.background}" style="padding:18px 28px;background-color:${c.background};border-top:1px solid #e6edf6;">
              <p class="pulse-footer-text" style="font-size:13px;color:${c.footer};margin:0 0 8px;">&mdash; The ${escapeHtml(BRAND.logoText)} team</p>
              <p class="pulse-footer-text" style="font-size:12px;color:${c.footer};margin:0;">${footerLinksHtml()}</p>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}
