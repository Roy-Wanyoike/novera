'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Money, CURRENCIES, type CurrencyCode } from '@novera/money'
import { toast } from '@/hooks/use-toast'
import { createInvoiceAction, type NewInvoiceLineInput } from './actions'
import { MoneyText } from '@/components/novera/money-text'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Loader2, Plus, Receipt, Trash2 } from 'lucide-react'

interface CustomerOption {
  id: string
  name: string
  email: string | null
}

interface LineDraft {
  key: number
  description: string
  quantity: string
  unitMajor: string
}

const CURRENCY_OPTIONS = Object.keys(CURRENCIES) as CurrencyCode[]

/** Half-up tax in pure BigInt — mirrors the server computation exactly. */
function taxOf(subtotalMinor: bigint, taxRatePct: string): bigint | null {
  const rate = Number(taxRatePct)
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) return null
  const bps = Math.round(rate * 100)
  const scaled = subtotalMinor * BigInt(bps)
  const quotient = scaled / 10000n
  const remainder = scaled % 10000n
  return remainder * 2n >= 10000n ? quotient + 1n : quotient
}

let lineKey = 0
function newLine(): LineDraft {
  lineKey += 1
  return { key: lineKey, description: '', quantity: '1', unitMajor: '' }
}

export function NewInvoiceDialog({ customers }: { customers: CustomerOption[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const [customerId, setCustomerId] = useState('')
  const [currency, setCurrency] = useState<CurrencyCode>('KES')
  const [taxRatePct, setTaxRatePct] = useState('16')
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([newLine()])

  const preview = useMemo(() => {
    let subtotal = 0n
    let completeCount = 0
    let error: string | null = null
    for (const l of lines) {
      if (l.description.trim() === '' && l.unitMajor.trim() === '') continue
      completeCount += 1
      try {
        const unit = Money.fromMajor(l.unitMajor.trim() === '' ? '0' : l.unitMajor, currency)
        if (unit.isNegative()) {
          error = 'Unit prices cannot be negative'
          continue
        }
        const qty = Math.max(1, Math.min(1_000_000, Math.floor(Number(l.quantity) || 1)))
        subtotal += unit.minor * BigInt(qty)
      } catch {
        error = `A unit price has more precision than ${currency} supports`
      }
    }
    const tax = subtotal > 0n ? taxOf(subtotal, taxRatePct) : 0n
    const invalidTax = subtotal > 0n && tax === null
    return {
      subtotal,
      tax: tax ?? 0n,
      total: subtotal + (tax ?? 0n),
      completeCount,
      error: invalidTax ? 'Tax rate must be 0–100' : error,
      taxInvalid: invalidTax,
    }
  }, [lines, currency, taxRatePct])

  function updateLine(key: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function removeLine(key: number) {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev))
  }

  function submit(mode: 'DRAFT' | 'ISSUED') {
    if (customers.length === 0) {
      toast({ title: 'No customers yet', description: 'Create a customer first — then invoice them.', variant: 'destructive' })
      return
    }
    if (!customerId) {
      toast({ title: 'Pick a customer', description: 'Every invoice is billed to a customer in this organization.', variant: 'destructive' })
      return
    }
    const items: NewInvoiceLineInput[] = lines
      .filter((l) => l.description.trim() !== '' || l.unitMajor.trim() !== '')
      .map((l) => ({
        description: l.description.trim(),
        quantity: Math.max(1, Math.min(1_000_000, Math.floor(Number(l.quantity) || 1))),
        unitMajor: l.unitMajor.trim(),
      }))
    if (items.length === 0) {
      toast({ title: 'Add at least one line item', description: 'Description and unit price are required per line.', variant: 'destructive' })
      return
    }
    if (preview.error) {
      toast({ title: 'Fix the line items', description: preview.error, variant: 'destructive' })
      return
    }

    startTransition(async () => {
      const result = await createInvoiceAction(
        {
          customerId,
          currency,
          taxRatePct,
          dueDate: dueDate || null,
          notes,
          items,
        },
        mode
      )
      if (!result.ok || !result.invoiceId) {
        toast({ title: 'Invoice not created', description: result.error ?? 'Unexpected error', variant: 'destructive' })
        return
      }
      setOpen(false)
      toast({
        title: mode === 'ISSUED' ? `Invoice ${result.number} issued` : `Draft ${result.number} saved`,
        description:
          mode === 'ISSUED'
            ? 'Totals were computed server-side in exact minor units and audited.'
            : 'Issue it when you are ready to send it to the customer.',
      })
      router.push(`/invoices/${result.invoiceId}`)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-9">
          <Plus className="h-4 w-4" />
          New invoice
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[88vh] w-full flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-muted-foreground" />
            New invoice
          </DialogTitle>
          <DialogDescription>
            Line items, tax and totals are validated and computed on the server in integer minor
            units (BigInt). The number is allocated as INV-2026-XXXX on creation.
          </DialogDescription>
        </DialogHeader>

        <div className="scroll-thin -mx-1 flex-1 overflow-y-auto px-1 py-1">
          <div className="space-y-5">
            {/* customer + currency + due date */}
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2 sm:col-span-1">
                <Label htmlFor="invoice-customer">Customer</Label>
                <Select value={customerId} onValueChange={setCustomerId}>
                  <SelectTrigger id="invoice-customer" className="w-full" aria-label="Customer">
                    <SelectValue placeholder={customers.length === 0 ? 'No customers' : 'Select customer'} />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="invoice-currency">Currency</Label>
                <Select
                  value={currency}
                  onValueChange={(v) => setCurrency(v as CurrencyCode)}
                  disabled={lines.some((l) => l.unitMajor.trim() !== '')}
                >
                  <SelectTrigger id="invoice-currency" className="w-full" aria-label="Currency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCY_OPTIONS.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c} · {CURRENCIES[c].name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="invoice-due">Due date</Label>
                <Input
                  id="invoice-due"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  aria-label="Due date"
                />
              </div>
            </div>

            {/* line items */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Line items</Label>
                <span className="text-xs text-muted-foreground">
                  {preview.completeCount} line{preview.completeCount === 1 ? '' : 's'}
                </span>
              </div>
              <div className="space-y-2">
                {lines.map((l, idx) => {
                  let lineMinor: bigint | null = null
                  try {
                    if (l.unitMajor.trim() !== '') {
                      const qty = Math.max(1, Math.min(1_000_000, Math.floor(Number(l.quantity) || 1)))
                      lineMinor = Money.fromMajor(l.unitMajor, currency).minor * BigInt(qty)
                    }
                  } catch {
                    lineMinor = null
                  }
                  return (
                    <div
                      key={l.key}
                      className="grid grid-cols-[1fr_repeat(2,minmax(0,84px))_minmax(84px,100px)_36px] items-center gap-2 rounded-lg border bg-card/50 p-2 sm:grid-cols-[1fr_72px_110px_110px_36px]"
                    >
                      <div className="min-w-0">
                        <Label htmlFor={`line-desc-${l.key}`} className="sr-only">
                          Line {idx + 1} description
                        </Label>
                        <Input
                          id={`line-desc-${l.key}`}
                          value={l.description}
                          onChange={(e) => updateLine(l.key, { description: e.target.value })}
                          placeholder={idx === 0 ? 'e.g. Cement supply — 50 bags' : 'Description'}
                          className="h-9 border-transparent bg-transparent focus-visible:border-input"
                        />
                      </div>
                      <div>
                        <Label htmlFor={`line-qty-${l.key}`} className="sr-only">
                          Line {idx + 1} quantity
                        </Label>
                        <Input
                          id={`line-qty-${l.key}`}
                          type="number"
                          min={1}
                          step={1}
                          value={l.quantity}
                          onChange={(e) => updateLine(l.key, { quantity: e.target.value })}
                          aria-label="Quantity"
                          className="h-9 tabular"
                        />
                      </div>
                      <div>
                        <Label htmlFor={`line-unit-${l.key}`} className="sr-only">
                          Line {idx + 1} unit price
                        </Label>
                        <Input
                          id={`line-unit-${l.key}`}
                          inputMode="decimal"
                          value={l.unitMajor}
                          onChange={(e) => updateLine(l.key, { unitMajor: e.target.value })}
                          placeholder="0.00"
                          aria-label={`Unit price in ${currency}`}
                          className="h-9 tabular"
                        />
                      </div>
                      <div className="text-right text-sm">
                        {lineMinor !== null ? (
                          <MoneyText minor={lineMinor} currency={currency} />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9"
                        onClick={() => removeLine(l.key)}
                        disabled={lines.length === 1}
                        aria-label={lines.length === 1 ? 'Cannot remove the only line' : `Remove line ${idx + 1}`}
                      >
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </div>
                  )
                })}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 w-full border-dashed"
                onClick={() => setLines((prev) => [...prev, newLine()])}
                disabled={lines.length >= 40}
              >
                <Plus className="h-4 w-4" />
                Add line item
              </Button>
            </div>

            {/* tax + notes */}
            <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
              <div className="space-y-2">
                <Label htmlFor="invoice-tax">Tax rate</Label>
                <div className="relative">
                  <Input
                    id="invoice-tax"
                    inputMode="decimal"
                    value={taxRatePct}
                    onChange={(e) => setTaxRatePct(e.target.value)}
                    aria-label="Tax rate percent"
                    aria-describedby="invoice-tax-suffix"
                    className="h-9 pr-7 tabular"
                  />
                  <span
                    id="invoice-tax-suffix"
                    className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
                  >
                    %
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="invoice-notes">Notes (optional)</Label>
                <Textarea
                  id="invoice-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Payment terms, bank details, thank-you note…"
                  className="min-h-[72px] resize-y"
                />
              </div>
            </div>

            {/* live totals preview */}
            <div className="rounded-lg border bg-muted/40 p-4">
              <div className="ml-auto w-full max-w-xs space-y-1.5 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <MoneyText minor={preview.subtotal} currency={currency} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Tax ({taxRatePct || '0'}%)</span>
                  <MoneyText minor={preview.tax} currency={currency} />
                </div>
                <Separator className="my-2" />
                <div className="flex items-center justify-between font-semibold">
                  <span>Total</span>
                  <MoneyText minor={preview.total} currency={currency} strong />
                </div>
                {preview.error ? (
                  <p className="pt-1 text-xs text-warning" role="alert">
                    {preview.error}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 border-t pt-4">
          <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => submit('DRAFT')}
            disabled={pending || preview.error !== null || preview.total === 0n}
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save draft
          </Button>
          <Button
            type="button"
            onClick={() => submit('ISSUED')}
            disabled={pending || preview.error !== null || preview.total === 0n}
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Create &amp; issue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
