import Link from 'next/link'
import { EmptyState } from '@/components/novera/empty-state'
import { Button } from '@/components/ui/button'
import { CreditCard, ArrowLeft } from 'lucide-react'

export default function CardNotFound() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <EmptyState
        icon={<CreditCard className="h-6 w-6" />}
        title="Card not found"
        description="This card does not exist in your organization, or you do not have access to it."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/cards">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to cards
            </Link>
          </Button>
        }
      />
    </div>
  )
}
