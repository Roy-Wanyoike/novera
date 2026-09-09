'use client'

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'

/**
 * Expected collections — stacked bar by due-date bucket (KES).
 * Values arrive as KES major-unit numbers; every underlying figure was
 * computed in BigInt minor units on the server (Number is display-only
 * here, used solely to position recharts points).
 */

const chartConfig = {
  overdue: { label: 'Overdue', color: 'var(--danger)' },
  thisWeek: { label: 'This week', color: 'var(--chart-1)' },
  thisMonth: { label: 'This month', color: 'var(--chart-2)' },
  later: { label: 'Later', color: 'var(--chart-3)' },
} satisfies ChartConfig

function fmtKes(v: number): string {
  return `KSh ${v.toLocaleString('en-KE', { maximumFractionDigits: 0 })}`
}

export function CollectionsChart({
  buckets,
}: {
  buckets: { overdue: number; thisWeek: number; thisMonth: number; later: number }
}) {
  const data = [{ name: 'Expected collections', ...buckets }]
  return (
    <ChartContainer config={chartConfig} className="h-[150px] w-full">
      <BarChart data={data} layout="vertical" margin={{ left: 4, right: 24, top: 4, bottom: 4 }} barSize={26}>
        <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis
          type="number"
          tickFormatter={fmtKes}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11 }}
          stroke="var(--muted-foreground)"
        />
        <YAxis type="category" dataKey="name" hide />
        <ChartTooltip
          cursor={{ fill: 'var(--muted)', opacity: 0.25 }}
          content={<ChartTooltipContent indicator="line" hideLabel formatter={(value) => fmtKes(Number(value))} />}
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="overdue" stackId="a" fill="var(--danger)" />
        <Bar dataKey="thisWeek" stackId="a" fill="var(--chart-1)" />
        <Bar dataKey="thisMonth" stackId="a" fill="var(--chart-2)" />
        <Bar dataKey="later" stackId="a" fill="var(--chart-3)" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ChartContainer>
  )
}
