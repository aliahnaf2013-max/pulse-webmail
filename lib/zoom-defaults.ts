export function normalizeZoomUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:') return null;
    if (!/(^|\.)zoom\.us$/i.test(url.hostname)) return null;
    if (!/^\/(j|my|s)\//i.test(url.pathname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function resolveDefaultZoom() {
  const configuredUrl =
    process.env.PULSE_DEFAULT_ZOOM_URL ||
    process.env.PULSE_ZOOM_DEFAULT_URL ||
    process.env.NEXT_PUBLIC_PULSE_DEFAULT_ZOOM_URL ||
    '';
  const configuredId =
    process.env.PULSE_DEFAULT_ZOOM_ID ||
    process.env.PULSE_ZOOM_DEFAULT_ID ||
    process.env.NEXT_PUBLIC_PULSE_DEFAULT_ZOOM_ID ||
    '';

  const id = /^\d{10,11}$/.test(configuredId.trim()) ? configuredId.trim() : null;
  const url = normalizeZoomUrl(configuredUrl) ?? (id ? `https://zoom.us/j/${id}` : null);
  const inferredId = id ?? url?.match(/\/j\/(\d{10,11})/i)?.[1] ?? null;

  return { id: inferredId, url };
}
