function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const env = {
  port: Number(optional('PORT', '8080')),
  apiPublicUrl: optional('API_PUBLIC_URL', 'http://localhost:8080'),
  corsOrigins: optional('CORS_ORIGINS', '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),

  redisUrl: optional('REDIS_URL', 'redis://localhost:6379'),

  resendApiKey: required('RESEND_API_KEY'),
  resendWebhookSecret: optional('RESEND_WEBHOOK_SECRET', ''),

  anthropicApiKey: optional('ANTHROPIC_API_KEY', ''),
  anthropicModel: optional('ANTHROPIC_MODEL', 'claude-haiku-4-5-20251001'),

  google: {
    clientId: optional('GOOGLE_CLIENT_ID', ''),
    clientSecret: optional('GOOGLE_CLIENT_SECRET', ''),
    refreshToken: optional('GOOGLE_REFRESH_TOKEN', ''),
    calendarId: optional('GOOGLE_CALENDAR_ID', 'primary'),
  },

  booking: {
    timezone: optional('BOOKING_TIMEZONE', 'America/New_York'),
    dayStart: Number(optional('BOOKING_DAY_START', '9')),
    dayEnd: Number(optional('BOOKING_DAY_END', '17')),
    slotMinutes: Number(optional('BOOKING_SLOT_MINUTES', '30')),
    bufferMinutes: Number(optional('BOOKING_BUFFER_MINUTES', '15')),
    minNoticeHours: Number(optional('BOOKING_MIN_NOTICE_HOURS', '12')),
    days: optional('BOOKING_DAYS', '1,2,3,4,5').split(',').map(Number),
    from: optional('BOOKING_FROM', 'Implenix <hello@e.implenix.net>'),
  },

  unsubscribeSecret: required('UNSUBSCRIBE_SECRET'),
  landingUrl: optional('LANDING_URL', 'https://implenix.net'),
} as const;
