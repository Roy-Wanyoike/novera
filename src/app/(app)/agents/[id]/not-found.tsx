import Link from 'next/link'
import { EmptyState } from '@/components/novera/empty-state'
import { Button } from '@/components/ui/button'
import { Bot, ArrowLeft } from 'lucide-react'

export default function AgentNotFound() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <EmptyState
        icon={<Bot className="h-6 w-6" />}
        title="Agent not found"
        description="This agent does not exist in your organization, or you do not have access to it."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/agents">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to agents
            </Link>
          </Button>
        }
      />
    </div>
  )
}
