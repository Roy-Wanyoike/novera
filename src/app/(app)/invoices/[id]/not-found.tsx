import Link from 'next/link'
import { EmptyState } from '@/components/novera/empty-state'
import { Button } from '@/components/ui/button'
import { FileStack, ArrowLeft } from 'lucide-react'

export default function InvoiceNotFound() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <EmptyState
        icon={<FileStack className="h-6 w-6" />}
        title="Invoice not found"
        description="This invoice does not exist in your organization, or you do not have access to it."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/invoices">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to invoices
            </Link>
          </Button>
        }
      />
    </div>
  )
}
