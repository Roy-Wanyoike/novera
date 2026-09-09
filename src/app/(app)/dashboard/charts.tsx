'use client'

/**
 * Dashboard volume chart — daily settled KES volume, stacked by payment method.
 *
 * Contract with the server page: plain numbers only (minor units as JS
 * numbers — exact for any value < 2^53, far above sandbox volumes). BigInt
 * never crosses the client boundary. Values remain in minor units end-to-end;
 * division to major units happens only inside display formatters.
 */

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { MoneyText } from '@/components/novera/money-text'
import { METHOD_META } from '@novera/domain'

export interface VolumePoint {
  /** YYYY-MM-DD, bucketed in the organization timezone (Africa/Nairobi). */
  date: string
  /** Settled KES minor units received via M-Pesa that day. */
  MPESA: number
  /** Settled KES minor units received via card that day. */
  CARD: number
  /** Settled KES minor units received via bank transfer that day. */
  BANK: number
  /** Settled KES minor units received via internal wallet that day. */
  WALLET: number
}

/** Chart series → theme chart tokens (no indigo/blue accents). */
const SERIES = [
  { key: 'MPESA', color: 'var(--chart-1)' },
  { key: 'CARD', color: 'var(--chart-3)' },
  { key: 'BANK', color: 'var(--chart-2)' },
  { key: 'WALLET', color: 'var(--chart-5)' },
] as const

type SeriesKey = (typeof SERIES)[number]['key']

const chartConfig = {
  MPESA: { label: METHOD_META.MPESA.label, color: 'var(--chart-1)' },
  CARD: { label: METHOD_META.CARD.label, color: 'var(--chart-3)' },
  BANK: { label: METHOD_META.BANK.label, color: 'var(--chart-2)' },
  WALLET: { label: METHOD_META.WALLET.label, color: 'var(--chart-5)' },
} satisfies ChartConfig

const TZ = 'Africa/Nairobi'
const dayTickFmt = new Intl.DateTimeFormat('en-KE', {
  day: 'numeric',
  month: 'short',
  timeZone: TZ,
})
const dayFullFmt = new Intl.DateTimeFormat('en-KE', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: TZ,
})
const compactFmt = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

function parseDay(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`)
}

/** X tick: "8 Sep". */
function dayTick(iso: string): string {
  return dayTickFmt.format(parseDay(iso))
}

/** Tooltip title: "Tue, 8 Sep 2026". */
function dayFull(iso: string): string {
  return dayFullFmt.format(parseDay(iso))
}

/** Y tick: minor units → compact major ("KSh 3.2k"). Display-only rounding. */
function kesTick(minor: number): string {
  if (!minor) return 'KSh 0'
  return `KSh ${compactFmt.format(minor / 100)}`
}

export function VolumeChart({ data }: { data: VolumePoint[] }) {
  return (
    <ChartContainer
      config={chartConfig}
      className="aspect-auto h-[240px] w-full sm:h-[300px]"
      role="img"
      aria-label="Stacked area chart of daily settled KES volume by payment method over the last 30 days"
    >
      <AreaChart data={data} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          tickFormatter={(value: string) => dayTick(value)}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={68}
          tickFormatter={(value: number) => kesTick(value)}
        />
        <ChartTooltip
          cursor={{ stroke: 'var(--border)' }}
          content={
            <ChartTooltipContent
              labelFormatter={(label) => dayFull(String(label))}
              formatter={(value, name, item) => (
                <div className="flex w-full items-center justify-between gap-6 leading-none">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <span
                      className="h-2 w-2 shrink-0 rounded-[2px]"
                      style={{ backgroundColor: item?.color }}
                      aria-hidden
                    />
                    {String(name)}
                  </span>
                  <MoneyText
                    minor={Number(value)}
                    currency="KES"
                    className="font-mono font-medium"
                  />
                </div>
              )}
            />
          }
        />
        {SERIES.map((s) => (
          <Area
            key={s.key}
            dataKey={s.key satisfies SeriesKey}
            stackId="kes-settled"
            type="monotone"
            stroke={`var(--color-${s.key})`}
            fill={`var(--color-${s.key})`}
            fillOpacity={0.2}
            strokeWidth={2}
          />
        ))}
        <ChartLegend content={<ChartLegendContent />} />
      </AreaChart>
    </ChartContainer>
  )
}
