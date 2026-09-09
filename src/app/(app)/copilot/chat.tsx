'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { timeAgo, titleCase } from '@/lib/format'
import { toast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { clearCopilotHistory } from './actions'
import {
  Sparkles,
  Send,
  Loader2,
  Trash2,
  Database,
  ShieldCheck,
  TrendingUp,
  HelpCircle,
  ArrowUpRight,
} from 'lucide-react'

export interface CopilotChatMessage {
  id: string
  role: string
  content: string
  toolName: string | null
  grounding: string | null
  createdAt: string
}

const SUGGESTIONS = [
  'What is my cash position?',
  'Who owes me money?',
  'Why did payments fail this month?',
  'What are my biggest expenses?',
  "What's my projected cash?",
]

const GROUNDING_META: Record<
  string,
  { label: string; icon: React.ElementType; className: string }
> = {
  GROUNDED: {
    label: 'Grounded',
    icon: ShieldCheck,
    className: 'border-success/25 bg-success/10 text-success',
  },
  ESTIMATED: {
    label: 'Estimated',
    icon: TrendingUp,
    className: 'border-warning/30 bg-warning/10 text-warning',
  },
  UNKNOWN: {
    label: 'General',
    icon: HelpCircle,
    className: 'border-border bg-muted/50 text-muted-foreground',
  },
}

// ── tiny deterministic markdown renderer (bold + bullets) ───────────

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={`${keyPrefix}-${i}`} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      )
    }
    return <span key={`${keyPrefix}-${i}`}>{part}</span>
  })
}

function MessageBody({ content }: { content: string }) {
  const lines = content.split('\n')
  return (
    <div className="space-y-1.5 break-words">
      {lines.map((line, i) => {
        const trimmed = line.trim()
        if (trimmed === '') return null
        const isBullet = /^[-•*]\s+/.test(trimmed)
        if (isBullet) {
          return (
            <div key={i} className="flex gap-2">
              <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-primary" />
              <p className="min-w-0 leading-relaxed">{renderInline(trimmed.replace(/^[-•*]\s+/, ''), `b${i}`)}</p>
            </div>
          )
        }
        return (
          <p key={i} className="leading-relaxed">
            {renderInline(line, `l${i}`)}
          </p>
        )
      })}
    </div>
  )
}

// ── provenance chip: tool + grounding (the trust feature) ───────────

function Provenance({ toolName, grounding }: { toolName: string | null; grounding: string | null }) {
  if (!toolName && !grounding) return null
  const meta = grounding ? GROUNDING_META[grounding] : null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {toolName ? (
        <span
          className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
          title={`Answered by deterministic tool: ${toolName}`}
        >
          <Database className="h-3 w-3" aria-hidden />
          {titleCase(toolName)}
        </span>
      ) : null}
      {meta ? (
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
            meta.className
          )}
          title={
            grounding === 'GROUNDED'
              ? 'Every figure is derived from ledger rows — no model invention.'
              : grounding === 'ESTIMATED'
                ? 'Projection from trailing flows — labelled as an estimate.'
                : 'Conversational answer — not ledger-derived.'
          }
        >
          <meta.icon className="h-3 w-3" aria-hidden />
          {meta.label}
        </span>
      ) : null}
    </div>
  )
}

// ── main chat component ─────────────────────────────────────────────

export function CopilotChat({ initialMessages }: { initialMessages: CopilotChatMessage[] }) {
  const router = useRouter()
  const [messages, setMessages] = useState<CopilotChatMessage[]>(initialMessages)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [isPending, startTransition] = useTransition()
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, sending])

  const autoResize = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`
  }, [])

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || sending) return

      const optimistic: CopilotChatMessage = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'user',
        content: trimmed,
        toolName: null,
        grounding: null,
        createdAt: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, optimistic])
      setInput('')
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
      setSending(true)

      try {
        const res = await fetch('/api/copilot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: trimmed }),
        })

        if (res.status === 401) {
          toast({ title: 'Session expired', description: 'Please sign in again to continue.' })
          router.push('/login')
          return
        }

        const json = (await res.json()) as {
          ok: boolean
          error?: string
          reply?: CopilotChatMessage
          userMessageId?: string
        }
        const reply = json.reply
        if (!res.ok || !json.ok || !reply) {
          throw new Error(json.error ?? 'The copilot request failed')
        }

        setMessages((prev) =>
          prev
            .map((m) => (m.id === optimistic.id && json.userMessageId ? { ...m, id: json.userMessageId } : m))
            .concat(reply)
        )
      } catch (err) {
        // Network/transport failure: the exchange never completed — restore the draft.
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
        setInput(trimmed)
        toast({
          title: 'Copilot unavailable',
          description: err instanceof Error ? err.message : 'Could not reach the copilot service.',
        })
      } finally {
        setSending(false)
        textareaRef.current?.focus()
      }
    },
    [router, sending]
  )

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    void send(input)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send(input)
    }
  }

  function onClear() {
    startTransition(async () => {
      const res = await clearCopilotHistory()
      if (res.ok) {
        setMessages([])
        toast({ title: 'Conversation cleared', description: 'Copilot history for this organization was deleted.' })
      } else {
        toast({ title: 'Could not clear history', description: res.error ?? 'Please try again.' })
      }
    })
  }

  const empty = messages.length === 0

  return (
    <section
      aria-label="Financial copilot chat"
      className="flex h-[calc(100dvh-12.5rem)] min-h-[30rem] flex-col overflow-hidden rounded-xl border bg-card shadow-sm"
    >
      {/* Header */}
      <div className="flex items-center gap-3 border-b px-4 py-3 sm:px-5">
        <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-primary/25 bg-primary/10">
          <Sparkles className="h-4.5 w-4.5 text-primary" aria-hidden />
          <span aria-hidden className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-success" />
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="text-sm font-semibold">Novera Copilot</p>
          <p className="truncate text-[11px] text-muted-foreground">
            Deterministic tools · grounded answers · never guesses
          </p>
        </div>
        {messages.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClear}
            disabled={isPending || sending}
            className="h-9 gap-1.5 text-muted-foreground hover:text-danger"
            aria-label="Clear conversation history"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">{isPending ? 'Clearing…' : 'Clear'}</span>
          </Button>
        ) : null}
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="scroll-thin flex-1 overflow-y-auto overscroll-contain"
        role="log"
        aria-live="polite"
        aria-label="Copilot conversation"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 sm:p-6">
          {empty ? (
            <div className="flex flex-col items-center gap-5 py-8 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 novera-glow">
                <Sparkles className="h-6 w-6 text-primary" aria-hidden />
              </div>
              <div className="space-y-1.5">
                <p className="text-base font-semibold">Ask your ledger anything</p>
                <p className="mx-auto max-w-md text-xs leading-relaxed text-muted-foreground">
                  I answer with deterministic, organization-scoped queries against your Novera ledger —
                  every number is traceable to a tool, nothing invented.
                </p>
              </div>
              <div className="w-full space-y-3">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                  Try asking
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => void send(s)}
                      disabled={sending}
                      className="group flex min-h-11 items-center justify-between gap-2 rounded-lg border bg-background/40 px-3.5 py-2.5 text-left text-sm transition-colors hover:border-primary/40 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    >
                      <span>{s}</span>
                      <ArrowUpRight
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-primary"
                        aria-hidden
                      />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            messages.map((m) =>
              m.role === 'user' ? (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] space-y-1 sm:max-w-[75%]">
                    <div className="rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground shadow-sm">
                      <p className="whitespace-pre-wrap break-words leading-relaxed">{m.content}</p>
                    </div>
                    <p suppressHydrationWarning className="text-right text-[10px] text-muted-foreground">
                      {timeAgo(m.createdAt)} · you
                    </p>
                  </div>
                </div>
              ) : (
                <div key={m.id} className="flex gap-3">
                  <div
                    className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/25 bg-primary/10"
                    aria-hidden
                  >
                    <Sparkles className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0 max-w-[85%] space-y-2 sm:max-w-[75%]">
                    <div className="rounded-2xl rounded-tl-md border bg-muted/40 px-4 py-3 text-sm">
                      <MessageBody content={m.content} />
                    </div>
                    <Provenance toolName={m.toolName} grounding={m.grounding} />
                    <p suppressHydrationWarning className="text-[10px] text-muted-foreground">
                      {timeAgo(m.createdAt)}
                    </p>
                  </div>
                </div>
              )
            )
          )}

          {/* Typing indicator */}
          {sending ? (
            <div className="flex gap-3" aria-label="Copilot is typing">
              <div
                className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/25 bg-primary/10"
                aria-hidden
              >
                <Sparkles className="h-4 w-4 text-primary" />
              </div>
              <div className="rounded-2xl rounded-tl-md border bg-muted/40 px-4 py-3.5">
                <div className="flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:0ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:300ms]" />
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Composer */}
      <div className="border-t bg-card/80 p-3 sm:p-4">
        <form onSubmit={onSubmit} className="mx-auto flex w-full max-w-3xl items-end gap-2">
          <label htmlFor="copilot-input" className="sr-only">
            Message the financial copilot
          </label>
          <textarea
            id="copilot-input"
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              autoResize()
            }}
            onKeyDown={onKeyDown}
            rows={1}
            maxLength={2000}
            disabled={sending}
            placeholder="Ask about balances, invoices, failed payments, projections…"
            className="scroll-thin min-h-11 flex-1 resize-none rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60"
          />
          <Button
            type="submit"
            size="icon"
            disabled={!input.trim() || sending}
            aria-label="Send message"
            className="h-11 w-11 shrink-0"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Send className="h-4 w-4" aria-hidden />
            )}
          </Button>
        </form>
        <p className="mx-auto mt-2 max-w-3xl text-[10px] leading-relaxed text-muted-foreground">
          AI proposes · deterministic tools answer · every response is grounded in your ledger. TEST mode —
          simulated funds. Enter to send, Shift+Enter for a new line.
        </p>
      </div>
    </section>
  )
}
