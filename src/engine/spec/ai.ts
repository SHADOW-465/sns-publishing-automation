// =============================================================================================
// Optional AI matching of free-form requirements to rules, through Groq's API (free tier, fast
// open models). Off unless an API key is entered in Settings, and the operator starts it with a
// click: the requirement text is sent to Groq, the book files are not.
//
// Model: openai/gpt-oss-120b with strict JSON-schema output (constrained decoding: the answer
// always parses). openai/gpt-oss-20b is the lighter choice. The free tier allows about 30
// requests and 8,000 tokens a minute, so requirements go in small batches.
// =============================================================================================
import { RULES, ruleById, coerce } from './rules.ts'
import type { Requirement, Suggestion } from './requirements.ts'

export const GROQ_MODELS: [string, string][] = [
  ['openai/gpt-oss-120b', 'GPT-OSS 120B (best matches)'],
  ['openai/gpt-oss-20b', 'GPT-OSS 20B (faster, lighter)'],
]
const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'
const BATCH = 20

export interface AiConfig {
  apiKey: string
  model: string
}

const KEY = 'automation:ai'
/** kept in this browser only; never in exported settings or spec files */
export function aiConfig(): AiConfig {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<AiConfig>
    return { apiKey: c.apiKey ?? '', model: c.model ?? GROQ_MODELS[0][0] }
  } catch {
    return { apiKey: '', model: GROQ_MODELS[0][0] }
  }
}
export function saveAiConfig(c: AiConfig) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c))
  } catch {
    /* storage blocked: the key lasts for this session only */
  }
}

/** The rule list as the model sees it: ID, meaning and allowed values, one line each. */
export function ruleCatalogue(): string {
  return RULES.filter((r) => r.type !== 'fixed').map((r) => {
    const values = r.type === 'choice' || r.type === 'multi' ? r.choices!.map(([v, l]) => `${v} (${l})`).join(' | ') : r.type === 'bool' ? 'true | false' : r.type === 'number' ? `number ${r.min}–${r.max} ${r.unit ?? ''}` : r.type === 'list' ? 'phrases separated by ;' : 'CSS text'
    return `${r.id}: ${r.title}. ${r.help} Values: ${values}`
  }).join('\n')
}

const SCHEMA = {
  type: 'object',
  properties: {
    matches: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          ruleId: { type: ['string', 'null'] },
          value: { type: ['string', 'null'] },
          confidence: { type: 'number' },
          reason: { type: 'string' },
        },
        required: ['index', 'ruleId', 'value', 'confidence', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['matches'],
  additionalProperties: false,
}

const SYSTEM = `You map an e-book client's requirements to the rules of an EPUB conversion tool.
For each numbered requirement, pick the one rule it is about and the value it asks for, using only the rule IDs and values listed.
If a requirement is not about any listed rule, or is too vague to act on, return ruleId null and explain in reason what the client must clarify.
The requirements may be in Spanish or English. Be literal: do not invent values the requirement does not ask for.
confidence is 0 to 1. reason is one short sentence in English.

Rules:
${ruleCatalogue()}`

type Fetch = typeof fetch

/** Suggestions for every requirement, in batches. Errors name the cause (bad key, rate limit, network). */
export async function matchWithAi(items: Requirement[], cfg: AiConfig, doFetch: Fetch = fetch): Promise<Suggestion[]> {
  if (!cfg.apiKey.trim()) throw new Error('Enter a Groq API key in Settings → AI to use AI matching.')
  const out: Suggestion[] = []
  for (let start = 0; start < items.length; start += BATCH) {
    const batch = items.slice(start, start + BATCH)
    const res = await doFetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey.trim()}` },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: batch.map((r, i) => `${i}. ${r.text}`).join('\n') },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'rule_matches', strict: true, schema: SCHEMA } },
      }),
    })
    if (!res.ok) {
      const why = res.status === 401 ? 'the API key was refused — check it in Settings → AI' : res.status === 429 ? 'Groq’s free-tier limit was reached — wait a minute and try again' : `Groq answered ${res.status}`
      throw new Error(`AI matching stopped after ${out.length} of ${items.length} requirements: ${why}.`)
    }
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    let parsed: { matches: { index: number; ruleId: string | null; value: string | null; confidence: number; reason: string }[] }
    try {
      parsed = JSON.parse(body.choices?.[0]?.message?.content ?? '')
    } catch {
      throw new Error('The AI answer could not be read. Try again, or use keyword matching.')
    }
    batch.forEach((req, i) => {
      const m = parsed.matches.find((x) => x.index === i)
      const r = m?.ruleId ? ruleById.get(m.ruleId) : undefined
      out.push({
        req, ruleId: r?.id, value: r && m?.value !== null && m?.value !== undefined ? coerce(r, m.value) : undefined, by: 'ai',
        confidence: r ? Math.max(0, Math.min(1, m?.confidence ?? 0)) : 0,
        reason: m?.reason ?? 'No answer for this requirement.',
      })
    })
  }
  return out
}
