import type { Request, Response } from '../types/messages';
import type { Snapshot } from '../types/model';

export async function request(message: Request) {
  let response: Response;
  try {
    response = (await chrome.runtime.sendMessage(message)) as Response;
  } catch {
    throw new Error('Vynlo could not connect. Reload Gmail and try again.');
  }
  if (!response || typeof response.ok !== 'boolean')
    throw new Error('Vynlo returned an unexpected response. Reload and try again.');
  if (!response.ok) throw new Error(response.error);
  return response.data;
}
export async function getSnapshot(accountId?: string): Promise<Snapshot> {
  const data = await request({ type: 'snapshot', ...(accountId ? { accountId } : {}) });
  if (!data || !('settings' in data)) throw new Error('Your local data could not be loaded.');
  return data;
}
