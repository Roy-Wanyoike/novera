import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { getSessionUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { recordAudit } from '@/lib/audit'
import { truncateMiddle } from '@/lib/format'
import {
  isToolName,
  runTool,
  TOOL_DESCRIPTIONS,
  TOOL_NAMES,
  type Grounding,
  type ToolResult,
} from '@/app/(app)/copilot/tools'

/**
 * COPILOT API — the Intelligence Plane endpoint.
 *
 * Two-call pattern, deterministic grounding:
 *   Call 1 (router):   the LLM classifies the question into ONE tool (or 'general').
 *                      Its output is JSON-parsed defensively and validated against
 *                      a fixed catalog — it is never executed as code.
 *   Tool execution:    pure, org-scoped, deterministic ledger queries.
 *   Call 2 (answerer): the LLM writes prose using ONLY the tool result JSON.
 *
 * The LLM never touches the database. If the model is unreachable we persist an
 * honest fallback — we never fabricate financial data.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── prompts ──────────────────────────────────────────────────────────

const ROUTER_PROMPT = `You are Novera's financial copilot router. Given the user's question, respond ONLY with JSON: {"tool": "<tool_name or 'general'>", "args": {...}}

Available tools:
${TOOL_NAMES.map((name) => `- ${name}: ${TOOL_DESCRIPTIONS[name]}`).join('\n')}
- general: anything not answerable by the tools above (greetings, capability questions, chatter).

Examples:
"What is my cash position?" -> {"tool": "get_cash_position", "args": {}}
"How much is in each wallet?" -> {"tool": "get_balances", "args": {}}
"Who owes me money?" -> {"tool": "get_overdue_invoices", "args": {}}
"Why did payments fail this month?" -> {"tool": "get_failed_payments", "args": {}}
"What are my biggest expenses?" -> {"tool": "get_expenses_by_category", "args": {}}
"What's my projected cash?" -> {"tool": "get_projected_cash", "args": {}}
"Show my recent transactions" -> {"tool": "get_recent_transactions", "args": {"limit": 10}}
"What happened to payment pay_9x2k1ab4" -> {"tool": "get_payment_status", "args": {"reference": "pay_9x2k1ab4"}}
"What can you do?" -> {"tool": "general", "args": {}}
"Hello!" -> {"tool": "general", "args": {}}

Respond with JSON only. No markdown, no extra text.`

const ANSWERER_PROMPT = `You are Novera's financial copilot. Answer using ONLY the tool result JSON provided. Ground every number in the data. If the data doesn't contain the answer, say so. Mark estimates as estimates. Never invent figures. Be concise (≤120 words) and warm-professional.

Formatting rules: short plain sentences; simple "- " bullets when listing; you may bold key figures with **double asterisks**; never use headings or tables. Copy money exactly as it appears in "formatted" fields of the data.`

const GENERAL_CONTEXT = {
  note: 'No deterministic tool matched this question, so there is no ledger data to quote. Do NOT state any numbers.',
  platform:
    'Novera is programmable financial infrastructure (currently a TEST-mode sandbox — never imply real settlement). The copilot can answer with grounded data about: wallet balances and cash position, recent ledger transactions, expenses by category, overdue invoices, failed payments, projected cash, and individual payment status. Broader platform capabilities: double-entry ledger, payments across M-Pesa/card/bank/USDC rails, invoices, virtual cards, AI agents with policy approvals, FX, split rules, reconciliation, and a tamper-evident audit trail.',
}

const MODEL_UNAVAILABLE_FALLBACK =
  "I couldn't reach the model — but your ledger is fine. Try again in a moment; nothing was answered with made-up numbers."

// ── types & helpers ──────────────────────────────────────────────────

interface ChatMessage {
  role: 'assistant' | 'user'
  content: string
}

interface SerializedMessage {
  id: string
  role: string
  content: string
  toolName: string | null
  grounding: string | null
  createdAt: string
}

function serialize(m: {
  id: string
  role: string
  content: string
  toolName: string | null
  grounding: string | null
  createdAt: Date
}): SerializedMessage {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    toolName: m.toolName,
    grounding: m.grounding,
    createdAt: m.createdAt.toISOString(),
  }
}

/** Defensive JSON extraction: strips fences, grabs the outermost object. */
function parseRouterJson(raw: string): { tool: string; args: Record<string, unknown> } {
  let text = (raw ?? '').trim()
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) text = fenced[1].trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return { tool: 'general', args: {} }
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { tool: 'general', args: {} }
    }
    const obj = parsed as Record<string, unknown>
    const tool = typeof obj.tool === 'string' ? obj.tool.trim() : 'general'
    const args =
      typeof obj.args === 'object' && obj.args !== null && !Array.isArray(obj.args)
        ? (obj.args as Record<string, unknown>)
        : {}
    return { tool, args }
  } catch {
    return { tool: 'general', args: {} }
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function complete(
  zai: Awaited<ReturnType<typeof ZAI.create>>,
  messages: ChatMessage[]
): Promise<string> {
  const completion = await withTimeout(
    zai.chat.completions.create({ messages, thinking: { type: 'disabled' } }),
    45_000,
    'chat completion'
  )
  const content = completion.choices[0]?.message?.content
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('empty completion content')
  }
  return content.trim()
}

// ── endpoint ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Session gate — org scoping is derived from the session, never the request body.
  const session = await getSessionUser()
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  const organizationId = session.organization.id

  let message = ''
  try {
    const body = (await req.json()) as unknown
    if (typeof body === 'object' && body !== null && typeof (body as { message?: unknown }).message === 'string') {
      message = ((body as { message: string }).message).trim().slice(0, 2000)
    }
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!message) {
    return NextResponse.json({ ok: false, error: 'A non-empty "message" is required' }, { status: 400 })
  }

  // Persist the user message first — history is honest even when the model is down.
  let userRow: Awaited<ReturnType<typeof db.copilotMessage.create>> | null = null
  try {
    userRow = await db.copilotMessage.create({
      data: { organizationId, role: 'user', content: message },
    })
  } catch (err) {
    console.error('[copilot] failed to persist user message:', err)
    return NextResponse.json({ ok: false, error: 'Could not save the message' }, { status: 500 })
  }

  const persistAssistant = async (content: string, toolName: string | null, grounding: Grounding) => {
    const row = await db.copilotMessage.create({
      data: { organizationId, role: 'assistant', content, toolName, grounding },
    })
    return serialize(row)
  }

  try {
    const zai = await ZAI.create()

    // ── Call 1: classifier (proposes a tool; output is validated, never executed) ──
    const rawRoute = await complete(zai, [
      { role: 'assistant', content: ROUTER_PROMPT },
      { role: 'user', content: `Question: ${message}` },
    ])
    const route = parseRouterJson(rawRoute)
    const toolName = isToolName(route.tool) ? route.tool : 'general'

    // ── Deterministic tool execution (org-scoped) ──
    let toolResult: ToolResult | null = null
    let toolError = false
    if (toolName !== 'general') {
      try {
        toolResult = await runTool(toolName, route.args, organizationId)
      } catch (err) {
        console.error(`[copilot] tool ${toolName} failed:`, err)
        toolError = true
      }
    }

    if (toolError) {
      // Honest deterministic failure — no numbers, no model invention.
      const reply = await persistAssistant(
        'I hit an error reading that data from the ledger, so I would rather not answer than guess. Nothing was fabricated — please ask again in a moment.',
        toolName,
        'UNKNOWN'
      )
      await recordAudit({
        organizationId,
        actorType: 'USER',
        actorId: session.user.id,
        actorLabel: session.user.name,
        action: 'copilot.tool_failed',
        resourceType: 'CopilotMessage',
        resourceId: reply.id,
        description: `Copilot tool ${toolName} failed for question "${truncateMiddle(message, 60)}"`,
        severity: 'WARN',
        metadata: { tool: toolName },
      })
      return NextResponse.json({ ok: true, reply, userMessageId: userRow.id })
    }

    // ── Call 2: answerer (prose from tool output ONLY) ──
    const grounding: Grounding =
      toolName === 'general' ? 'UNKNOWN' : (toolResult?.grounding ?? 'UNKNOWN')
    const toolPayload: ToolResult | typeof GENERAL_CONTEXT =
      toolName === 'general'
        ? GENERAL_CONTEXT
        : (toolResult ?? { tool: toolName, grounding: 'UNKNOWN', data: {} })

    const answer = await complete(zai, [
      { role: 'assistant', content: ANSWERER_PROMPT },
      {
        role: 'user',
        content: `Question: ${message}\n\nTool: ${toolName}\n\nTool result JSON (deterministic, organization-scoped):\n${JSON.stringify(toolPayload)}`,
      },
    ])

    const reply = await persistAssistant(
      answer,
      toolName === 'general' ? null : toolName,
      grounding
    )

    await recordAudit({
      organizationId,
      actorType: 'USER',
      actorId: session.user.id,
      actorLabel: session.user.name,
      action: 'copilot.query',
      resourceType: 'CopilotMessage',
      resourceId: reply.id,
      description: `Copilot answered "${truncateMiddle(message, 60)}" via ${toolName} (${grounding})`,
      metadata: { tool: toolName, grounding, questionLength: message.length },
    })

    return NextResponse.json({ ok: true, reply, userMessageId: userRow.id })
  } catch (err) {
    // SDK / model failure → friendly fallback. NEVER fake data.
    console.error('[copilot] model unavailable:', err)
    let reply: SerializedMessage
    try {
      reply = await persistAssistant(MODEL_UNAVAILABLE_FALLBACK, null, 'UNKNOWN')
    } catch (persistErr) {
      console.error('[copilot] failed to persist fallback:', persistErr)
      return NextResponse.json(
        { ok: false, error: 'The copilot is unavailable right now' },
        { status: 503 }
      )
    }
    await recordAudit({
      organizationId,
      actorType: 'USER',
      actorId: session.user.id,
      actorLabel: session.user.name,
      action: 'copilot.model_unavailable',
      resourceType: 'CopilotMessage',
      resourceId: reply.id,
      description: `Copilot model call failed for question "${truncateMiddle(message, 60)}"`,
      severity: 'WARN',
    }).catch(() => undefined)
    return NextResponse.json({ ok: true, reply, userMessageId: userRow.id })
  }
}
