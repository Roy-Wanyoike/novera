'use client'

import { Button } from '@/components/ui/button'
import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'

export function CopyButton({ value, className, label }: { value: string; className?: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn('h-7 gap-1.5 px-2 text-xs text-muted-foreground', className)}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
        } catch {
          // clipboard unavailable — ignore
        }
        setCopied(true)
        setTimeout(() => setCopied(false), 1600)
      }}
      aria-label={`Copy ${label ?? 'value'}`}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
      {label ? <span>{copied ? 'Copied' : label}</span> : null}
    </Button>
  )
}

export function CodeBlock({ code, language, className }: { code: string; language?: string; className?: string }) {
  return (
    <div className={cn('group relative rounded-lg border bg-muted/40 overflow-hidden', className)}>
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{language ?? 'text'}</span>
        <CopyButton value={code} className="opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      <pre className="scroll-thin overflow-x-auto p-3 text-xs leading-relaxed font-mono">
        <code>{code}</code>
      </pre>
    </div>
  )
}
