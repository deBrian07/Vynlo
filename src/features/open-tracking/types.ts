export interface PublicTracking {
  id: string;
  accountId: string;
  label: string;
  createdAt: number;
  expiresAt: number;
  firstOpenedAt: number | null;
  lastOpenedAt: number | null;
  openCount: number;
  armedAt: number | null;
}
export interface TrackingRecord extends PublicTracking {
  endpoint: string;
  readToken: string;
  deleteToken: string;
}
export interface TrackingSnapshot {
  connected: boolean;
  endpoint?: string;
  records: PublicTracking[];
}
export interface CreatedTracking {
  id: string;
  pixelUrl: string;
}
export type TrackingRequest =
  | { type: 'tracking-snapshot'; accountId?: string }
  | { type: 'tracking-connect'; endpoint: string; secret: string }
  | { type: 'tracking-disconnect' }
  | { type: 'tracking-create'; accountId: string; label: string }
  | { type: 'tracking-refresh'; accountId: string }
  | { type: 'tracking-activate'; accountId: string; id: string }
  | { type: 'tracking-remove'; accountId: string; id: string };
export type TrackingResponse =
  { ok: true; data: TrackingSnapshot | CreatedTracking | null } | { ok: false; error: string };

/** Restrict optional access to an explicitly selected Cloudflare Worker, never arbitrary URLs. */
export function workerEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('Enter the HTTPS Worker URL from setup.');
  }
  if (
    url.protocol !== 'https:' ||
    !/^[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['', '/'].includes(url.pathname)
  )
    throw new Error('Use your https://name.account.workers.dev URL, without a path.');
  return url.origin;
}
export const trackingAccount = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 254 &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) &&
  value === value.toLowerCase();
export const trackingToken = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
