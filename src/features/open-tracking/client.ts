import {
  workerEndpoint,
  type CreatedTracking,
  type TrackingRequest,
  type TrackingResponse,
  type TrackingSnapshot,
} from './types';

async function send(message: TrackingRequest) {
  let result: TrackingResponse;
  try {
    result = (await chrome.runtime.sendMessage(message)) as TrackingResponse;
  } catch {
    throw new Error('Vynlo could not connect. Reload this page and try again.');
  }
  if (!result || typeof result.ok !== 'boolean')
    throw new Error('Tracking is unavailable. Reload the extension and Gmail.');
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
export const trackingClient = {
  snapshot: async (accountId?: string) =>
    (await send({ type: 'tracking-snapshot', accountId })) as TrackingSnapshot,
  connect: async (value: string, secret: string) => {
    const endpoint = workerEndpoint(value);
    // Call permissions.request before awaiting: Chrome requires this to follow the user's click.
    const granted = await chrome.permissions.request({ origins: [`${endpoint}/*`] });
    if (!granted)
      throw new Error('Connection was not enabled. Allow access to your Worker to connect.');
    await send({ type: 'tracking-connect', endpoint, secret });
  },
  disconnect: async () => {
    await send({ type: 'tracking-disconnect' });
  },
  create: async (accountId: string, label: string) =>
    (await send({ type: 'tracking-create', accountId, label })) as CreatedTracking,
  refresh: async (accountId: string) =>
    (await send({ type: 'tracking-refresh', accountId })) as TrackingSnapshot,
  remove: async (accountId: string, id: string) => {
    await send({ type: 'tracking-remove', accountId, id });
  },
  activate: async (accountId: string, id: string) => {
    await send({ type: 'tracking-activate', accountId, id });
  },
};
