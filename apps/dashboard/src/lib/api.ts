/**
 * Thin fetch wrapper for the privileged Implenix API (Fastify on Render).
 * Every request carries the Supabase access token as a Bearer credential;
 * the API verifies it and re-checks workspace membership server-side.
 */
import { supabase } from './supabase';
import type { CampaignStats } from './types';

const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function apiFetch<T>(
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown } = {},
): Promise<T> {
  if (!API_URL) {
    throw new ApiError(0, 'VITE_API_URL is not configured.');
  }
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new ApiError(401, 'You are signed out. Please sign in again.');
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Could not reach the Implenix API. Check your connection and try again.');
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const payload = (await res.json()) as { error?: string; message?: string };
      message = payload.error ?? payload.message ?? message;
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  /** Activate or pause a campaign. Activation sets warmup_started_at server-side. */
  setCampaignStatus(campaignId: string, status: 'active' | 'paused'): Promise<void> {
    return apiFetch(`/api/campaigns/${campaignId}/status`, {
      method: 'POST',
      body: { status },
    });
  },

  getCampaignStats(campaignId: string): Promise<CampaignStats> {
    return apiFetch(`/api/campaigns/${campaignId}/stats`);
  },

  sendTestEmail(campaignId: string, to: string): Promise<void> {
    return apiFetch(`/api/campaigns/${campaignId}/test-send`, {
      method: 'POST',
      body: { to },
    });
  },

  /** Approve a pending agent action, optionally with an edited reply body. */
  approveAgentAction(actionId: string, body?: string): Promise<void> {
    return apiFetch(`/api/agent-actions/${actionId}/approve`, {
      method: 'POST',
      body: body !== undefined ? { body } : {},
    });
  },

  rejectAgentAction(actionId: string): Promise<void> {
    return apiFetch(`/api/agent-actions/${actionId}/reject`, {
      method: 'POST',
      body: {},
    });
  },
};
