/**
 * Thin fetch wrapper for the privileged Implenix API (Fastify on Render).
 * Every request carries the Supabase access token as a Bearer credential;
 * the API verifies it and re-checks workspace membership server-side.
 */
import type { BookingRequest, BookingResponse, BookingSlot } from '@implenix/shared';
import { supabase } from './supabase';
import type { StatsResponse } from './types';

export const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function parseError(res: Response): Promise<ApiError> {
  let message = `Request failed (${res.status})`;
  try {
    const payload = (await res.json()) as { error?: string; message?: string };
    message = payload.error ?? payload.message ?? message;
  } catch {
    // non-JSON error body — keep the generic message
  }
  return new ApiError(res.status, message);
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

  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Public sign-page URL for a contract (served by the API). */
export function contractSignUrl(signToken: string): string {
  return `${API_URL}/c/${signToken}`;
}

/**
 * Available booking slots for a date — public endpoint, no auth needed
 * (the same one the landing-site widget uses).
 */
export async function fetchBookingSlots(date: string, tz: string): Promise<BookingSlot[]> {
  if (!API_URL) {
    throw new ApiError(0, 'VITE_API_URL is not configured.');
  }
  let res: Response;
  try {
    res = await fetch(
      `${API_URL}/api/booking/slots?date=${encodeURIComponent(date)}&tz=${encodeURIComponent(tz)}`,
    );
  } catch {
    throw new ApiError(0, 'Could not reach the Implenix API. Check your connection and try again.');
  }
  if (!res.ok) throw await parseError(res);
  const payload = (await res.json()) as { slots: BookingSlot[] };
  return payload.slots;
}

export const api = {
  getStats(days: number): Promise<StatsResponse> {
    return apiFetch(`/api/stats?days=${days}`);
  },

  /** Book an appointment (creates/updates the contact server-side). 409 = slot taken. */
  createAppointment(request: BookingRequest): Promise<BookingResponse> {
    return apiFetch('/api/appointments', { method: 'POST', body: request });
  },

  setAppointmentOutcome(appointmentId: string, outcome: 'showed' | 'no_show'): Promise<void> {
    return apiFetch(`/api/appointments/${appointmentId}/outcome`, {
      method: 'POST',
      body: { outcome },
    });
  },

  cancelAppointment(appointmentId: string): Promise<void> {
    return apiFetch(`/api/appointments/${appointmentId}/cancel`, { method: 'POST', body: {} });
  },

  sendFollowupTest(stepId: string, to: string): Promise<void> {
    return apiFetch(`/api/followups/${stepId}/test-send`, { method: 'POST', body: { to } });
  },

  createContract(input: {
    contact_id: string;
    template_id: string;
    practice_name?: string;
    practice_address?: string;
  }): Promise<{ id: string; sign_url: string }> {
    return apiFetch('/api/contracts', { method: 'POST', body: input });
  },

  remindContract(contractId: string): Promise<void> {
    return apiFetch(`/api/contracts/${contractId}/remind`, { method: 'POST', body: {} });
  },

  voidContract(contractId: string): Promise<void> {
    return apiFetch(`/api/contracts/${contractId}/void`, { method: 'POST', body: {} });
  },

  remindPayment(paymentId: string): Promise<void> {
    return apiFetch(`/api/payments/${paymentId}/remind`, { method: 'POST', body: {} });
  },

  /** Send a reply to an inbound message from the approval inbox. */
  replyAgentAction(actionId: string, reply: { subject?: string; body: string }): Promise<void> {
    return apiFetch(`/api/agent-actions/${actionId}/reply`, { method: 'POST', body: reply });
  },

  dismissAgentAction(actionId: string): Promise<void> {
    return apiFetch(`/api/agent-actions/${actionId}/dismiss`, { method: 'POST', body: {} });
  },
};
