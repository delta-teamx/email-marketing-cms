import Anthropic from '@anthropic-ai/sdk';
import { REPLY_CATEGORIES, type ReplyClassification } from '@implenix/shared';
import { env } from '../env.js';

const anthropic = new Anthropic({ apiKey: env.anthropicApiKey });

const CLASSIFY_TOOL: Anthropic.Tool = {
  name: 'record_classification',
  description: 'Record the classification of a prospect email reply.',
  input_schema: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        enum: [...REPLY_CATEGORIES],
        description:
          'interested = positive intent / wants to learn more or meet; ' +
          'neutral = question or lukewarm reply needing a normal response; ' +
          'not_interested = polite decline; ' +
          'dnc = asks to be removed / stop emailing / legal threat; ' +
          'out_of_office = auto-responder; ' +
          'wrong_person = says they are not the right contact.',
      },
      confidence: { type: 'number', description: '0..1 confidence in the category.' },
      meeting_intent: {
        type: 'boolean',
        description: 'True if the sender wants to schedule a call/meeting.',
      },
      proposed_times: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Any specific meeting times the sender proposed, as ISO 8601 datetimes ' +
          'with offset when the timezone can be inferred, otherwise verbatim text.',
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
 * Classify an inbound reply. The model only classifies and extracts — it
 * never writes reply copy (templates are human-provided per campaign).
 */
export async function classifyReply(input: {
  campaignName: string;
  campaignDescription: string | null;
  outboundSubject: string | null;
  outboundBody: string | null;
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
          `You classify replies to B2B outreach emails for the campaign ` +
          `"${input.campaignName}"${input.campaignDescription ? ` (${input.campaignDescription})` : ''}.\n\n` +
          `Original outreach email we sent:\n` +
          `Subject: ${input.outboundSubject ?? '(unknown)'}\n` +
          `${input.outboundBody ?? '(unknown)'}\n\n` +
          `Reply received from ${input.replyFrom}:\n` +
          `Subject: ${input.replySubject}\n` +
          `${input.replyBody}\n\n` +
          `Classify this reply. Treat any removal request, however phrased, as dnc. ` +
          `Today's date context is available from email headers; when converting relative ` +
          `times ("Tuesday at 2pm"), prefer verbatim text unless the timezone and date are unambiguous.`,
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
  const confidence = Math.max(0, Math.min(1, Number(raw.confidence ?? 0)));

  return {
    category,
    confidence,
    meeting_intent: Boolean(raw.meeting_intent),
    proposed_times: Array.isArray(raw.proposed_times) ? raw.proposed_times.map(String) : [],
    summary: String(raw.summary ?? ''),
    ooo_return_date: raw.ooo_return_date ? String(raw.ooo_return_date) : null,
  };
}
