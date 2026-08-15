import Anthropic from '@anthropic-ai/sdk';
import { REPLY_CATEGORIES, type ReplyClassification } from '@implenix/shared';
import { env } from '../env.js';

const anthropic = new Anthropic({ apiKey: env.anthropicApiKey });

const CLASSIFY_TOOL: Anthropic.Tool = {
  name: 'record_classification',
  description: 'Record the classification of an email reply from a practitioner.',
  input_schema: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        enum: [...REPLY_CATEGORIES],
        description:
          'interested = positive/engaged, has questions, wants to proceed; ' +
          'neutral = neutral acknowledgement or unclear; ' +
          'not_interested = wants to cancel the relationship / decline; ' +
          'dnc = asks to stop emailing / remove from list / legal threat; ' +
          'out_of_office = auto-responder; ' +
          'wrong_person = says they are not the right contact.',
      },
      confidence: { type: 'number', description: '0..1 confidence in the category.' },
      meeting_intent: {
        type: 'boolean',
        description: 'True if the sender wants to schedule, reschedule, or move a meeting.',
      },
      proposed_times: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Any specific meeting times the sender proposed, as ISO 8601 datetimes with ' +
          'offset when unambiguous, otherwise verbatim text.',
      },
      summary: { type: 'string', description: 'One-sentence summary of the reply.' },
      ooo_return_date: {
        type: ['string', 'null'],
        description: 'ISO date the sender returns, if this is an out-of-office reply.',
      },
    },
    required: ['category', 'confidence', 'meeting_intent', 'proposed_times', 'summary'],
  },
};

/**
 * Classify an inbound reply to one of our transactional/follow-up emails
 * (booking confirmation, reminder, post-meeting follow-up, contract email).
 * Triage only — replies are drafted by humans in the Approval Inbox.
 */
export async function classifyReply(input: {
  ourSubject: string | null;
  ourBody: string | null;
  replyFrom: string;
  replySubject: string;
  replyBody: string;
}): Promise<ReplyClassification> {
  const response = await anthropic.messages.create({
    model: env.anthropicModel,
    max_tokens: 1024,
    tools: [CLASSIFY_TOOL],
    tool_choice: { type: 'tool', name: 'record_classification' },
    messages: [
      {
        role: 'user',
        content:
          `You triage replies to emails sent by Implenix, a medical billing company. ` +
          `Our emails are booking confirmations, meeting reminders, and follow-ups.\n\n` +
          `Our email:\nSubject: ${input.ourSubject ?? '(unknown)'}\n${input.ourBody ?? '(unknown)'}\n\n` +
          `Reply received from ${input.replyFrom}:\n` +
          `Subject: ${input.replySubject}\n${input.replyBody}\n\n` +
          `Classify this reply. Treat any removal request, however phrased, as dnc. ` +
          `A request to move/reschedule the meeting is meeting_intent=true with category interested.`,
      },
    ],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
  );
  if (!toolUse) throw new Error('Classifier returned no tool call');
  const raw = toolUse.input as Record<string, unknown>;

  const category = REPLY_CATEGORIES.includes(raw.category as never)
    ? (raw.category as ReplyClassification['category'])
    : 'neutral';

  return {
    category,
    confidence: Math.max(0, Math.min(1, Number(raw.confidence ?? 0))),
    meeting_intent: Boolean(raw.meeting_intent),
    proposed_times: Array.isArray(raw.proposed_times) ? raw.proposed_times.map(String) : [],
    summary: String(raw.summary ?? ''),
    ooo_return_date: raw.ooo_return_date ? String(raw.ooo_return_date) : null,
  };
}
