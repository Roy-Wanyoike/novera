'use client'

import { Bar, BarChart, CartesianGrid, XAxis } from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'

const chartConfig = {
  entries: {
    label: 'Ledger entries',
    color: 'var(--chart-1)',
  },
} satisfies ChartConfig

export interface ActivityPoint {
  day: string
  entries: number
}

/** Entries posted to this wallet's ledger account, by day, last 14 days. */
export function WalletActivityChart({ data }: { data: ActivityPoint[] }) {
  const total = data.reduce((a, d) => a + d.entries, 0)
  return (
    <div className="space-y-2">
      <ChartContainer config={chartConfig} className="aspect-auto h-[140px] w-full">
        <BarChart data={data} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="day"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={20}
            fontSize={10}
          />
          <ChartTooltip content={<ChartTooltipContent />} cursor={{ fill: 'var(--muted)' }} />
          <Bar dataKey="entries" fill="var(--color-entries)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ChartContainer>
      <p className="text-[11px] text-muted-foreground">
        {total} entr{total === 1 ? 'y' : 'ies'} in the last 14 days
        {total === 0 ? ' — no recent activity' : ''}
      </p>
    </div>
  )
}
