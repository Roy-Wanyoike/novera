import Link from 'next/link'
import { EmptyState } from '@/components/novera/empty-state'
import { Button } from '@/components/ui/button'
import { Receipt, ArrowLeft } from 'lucide-react'

export default function PaymentNotFound() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <EmptyState
        icon={<Receipt className="h-6 w-6" />}
        title="Payment not found"
        description="This payment does not exist in your organization, or you do not have access to it."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/payments">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to payments
            </Link>
          </Button>
        }
      />
    </div>
  )
}
