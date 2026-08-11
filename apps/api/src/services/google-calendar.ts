import { google, type calendar_v3 } from 'googleapis';
import { env } from '../env.js';

/**
 * Google Calendar access for the owner's personal Gmail account via an OAuth
 * refresh token (obtained once with scripts/google-auth.mjs).
 */
function calendarClient(): calendar_v3.Calendar {
  const oauth2 = new google.auth.OAuth2(env.google.clientId, env.google.clientSecret);
  oauth2.setCredentials({ refresh_token: env.google.refreshToken });
  return google.calendar({ version: 'v3', auth: oauth2 });
}

export interface BusyInterval {
  start: Date;
  end: Date;
}

export async function getBusyIntervals(timeMin: Date, timeMax: Date): Promise<BusyInterval[]> {
  const cal = calendarClient();
  const { data } = await cal.freebusy.query({
    requestBody: {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: [{ id: env.google.calendarId }],
    },
  });
  const busy = data.calendars?.[env.google.calendarId]?.busy ?? [];
  return busy
    .filter((b) => b.start && b.end)
    .map((b) => ({ start: new Date(b.start!), end: new Date(b.end!) }));
}

export interface CalendarEventInput {
  summary: string;
  description: string;
  start: Date;
  end: Date;
  attendeeEmail: string;
  attendeeName?: string;
}

export interface CreatedEvent {
  eventId: string;
  meetLink: string | null;
}

/** Create the event with a Google Meet link and email invites to attendees. */
export async function createEvent(input: CalendarEventInput): Promise<CreatedEvent> {
  const cal = calendarClient();
  const { data } = await cal.events.insert({
    calendarId: env.google.calendarId,
    conferenceDataVersion: 1,
    sendUpdates: 'all',
    requestBody: {
      summary: input.summary,
      description: input.description,
      start: { dateTime: input.start.toISOString() },
      end: { dateTime: input.end.toISOString() },
      attendees: [{ email: input.attendeeEmail, displayName: input.attendeeName }],
      conferenceData: {
        createRequest: {
          requestId: `implenix-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
      reminders: { useDefault: true },
    },
  });
  const meetLink =
    data.hangoutLink ??
    data.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri ??
    null;
  return { eventId: data.id!, meetLink };
}

export async function cancelEvent(eventId: string): Promise<void> {
  const cal = calendarClient();
  await cal.events.delete({
    calendarId: env.google.calendarId,
    eventId,
    sendUpdates: 'all',
  });
}
