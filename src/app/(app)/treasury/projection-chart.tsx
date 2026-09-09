'use client'

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'

/**
 * 30-day forward cash projection (KES).
 * The line is dashed on purpose: this is an ESTIMATE (trailing 60-day
 * average net payment flow), never a fact. Server computes every value
 * in BigInt minor units; the numbers here are recharts coordinates only.
 */

const chartConfig = {
  value: { label: 'Projected cash (KES)', color: 'var(--chart-1)' },
} satisfies ChartConfig

function fmtKes(v: number): string {
  return `KSh ${v.toLocaleString('en-KE', { maximumFractionDigits: 0 })}`
}

export function ProjectionChart({ points }: { points: { label: string; value: number }[] }) {
  return (
    <ChartContainer config={chartConfig} className="h-[230px] w-full">
      <LineChart data={points} margin={{ left: 4, right: 16, top: 8, bottom: 4 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          interval={6}
          tick={{ fontSize: 11 }}
          stroke="var(--muted-foreground)"
        />
        <YAxis
          tickFormatter={fmtKes}
          tickLine={false}
          axisLine={false}
          width={76}
          tick={{ fontSize: 11 }}
          domain={['auto', 'auto']}
        />
        <ChartTooltip
          content={<ChartTooltipContent indicator="dashed" hideLabel formatter={(value) => fmtKes(Number(value))} />}
        />
        <Line
          dataKey="value"
          name="Projected"
          type="monotone"
          stroke="var(--chart-1)"
          strokeWidth={2}
          strokeDasharray="7 5"
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ChartContainer>
  )
}
