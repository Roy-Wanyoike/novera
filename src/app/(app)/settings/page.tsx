import { PageHeader } from '@/components/novera/page-header'

export const metadata = { title: 'Settings' }

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Organization settings." />
      <div className="rounded-lg border border-dashed p-16 text-center text-sm text-muted-foreground">
        Module in active build — agent squad dispatching.
      </div>
    </div>
  )
}
