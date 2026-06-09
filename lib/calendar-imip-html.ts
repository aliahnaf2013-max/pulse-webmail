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
  logoText: "Pulse Business AI",
  // PNG (not SVG) so it can render in Outlook once images are downloaded — the
  // bind-mounted asset at /branding/Pulse_Favicon.png. The wordmark text sits
  // beside it as a fallback (image-blocked / not-downloaded clients still read).
  logoUrl:
    process.env.NEXT_PUBLIC_PULSE_IMIP_LOGO_URL ??
    "https://webmail.pulsebusiness.ai/branding/Pulse_Favicon.png",
  logoWidth: 36,
  colors: {
    navy: "#0B1426",
    blue: "#3574D4",
    amber: "#f59e0b",
    background: "#f8fafc",
    card: "#ffffff",
    text: "#172033",
    muted: "#46566f",
    footer: "#6b7890",
    border: "#dbe4f0",
    callout: "#eef4fb",
  },
  // Two-layer band from the compose signature: amber bloom anchored bottom-right
  // + faint blue glow top-centre, over solid navy. Email clients that ignore
  // gradients (Outlook) fall back to the navy background-color.
  headerGradient:
    "radial-gradient(ellipse 80% 85% at 100% 100%, rgba(217,119,6,0.72) 0%, rgba(245,158,11,0.42) 28%, rgba(245,158,11,0.14) 56%, rgba(11,20,38,0) 84%), radial-gradient(ellipse 70% 55% at 52% -10%, rgba(53,116,212,0.22) 0%, rgba(53,116,212,0) 66%)",
  fonts: {
    heading:
      "Bricolage Grotesque, Outfit, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif",
    body: "Outfit, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif",
  },
  footerLinks: [
    { label: "pulsebusiness.ai", url: "https://pulsebusiness.ai" },
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

/**
 * Brand lockup mirroring the compose signature: PNG logo + "Pulse" wordmark with
 * a small amber "Business AI" sub-label. Wordmark text is the fallback when the
 * image is blocked/undownloaded.
 */
function logoBlock(): string {
  const w = BRAND.logoWidth;
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
                <td valign="middle" style="padding-right:10px;"><img src="${escapeHtml(BRAND.logoUrl)}" width="${w}" height="${w}" alt="Pulse" style="display:block;width:${w}px;height:${w}px;border:0;" /></td>
                <td valign="middle">
                  <span style="display:block;font-size:22px;font-weight:800;color:#ffffff;letter-spacing:0.02em;line-height:1.05;">Pulse</span>
                  <span style="display:block;margin-top:1px;font-size:8px;font-weight:800;letter-spacing:0.22em;text-transform:uppercase;color:${BRAND.colors.amber};">Business AI</span>
                </td>
              </tr></table>`;
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
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" class="pulse-email-card pulse-force-light" bgcolor="${c.card}" style="max-width:640px;background-color:${c.card};border:1px solid ${c.border};border-radius:12px;overflow:hidden;">
          <tr>
            <td class="pulse-email-pad pulse-header-cell" bgcolor="${c.navy}" style="padding:24px 28px 20px;background-color:${c.navy};background-image:${BRAND.headerGradient};">
              <a href="${BRAND.publicSiteUrl}" style="text-decoration:none;color:#ffffff;">
                ${logoBlock()}
              </a>
            </td>
          </tr>
          <tr>
            <td class="pulse-email-pad pulse-body-cell" bgcolor="${c.card}" style="padding:30px 28px 26px;background-color:${c.card};">
              <h1 style="font-family:${BRAND.fonts.heading};font-size:26px;line-height:1.25;margin:0 0 12px;color:${c.text};font-weight:700;">${escapeHtml(headline)}</h1>
              <p class="pulse-body-text" style="font-size:16px;margin:0 0 18px;color:${c.text};">${greeting}</p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" class="pulse-callout-cell" style="margin:0;">
                <tr><td class="pulse-callout-cell" bgcolor="${c.callout}" style="padding:14px 18px;background-color:${c.callout};border:1px solid ${c.border};border-radius:8px;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${rows.join("")}
                  </table>
                </td></tr>
              </table>
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
