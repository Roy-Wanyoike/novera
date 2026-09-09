import Link from 'next/link'
import { EmptyState } from '@/components/novera/empty-state'
import { Button } from '@/components/ui/button'
import { Wallet, ArrowLeft } from 'lucide-react'

export default function WalletNotFound() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <EmptyState
        icon={<Wallet className="h-6 w-6" />}
        title="Wallet not found"
        description="This wallet does not exist in your organization, or you do not have access to it."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/wallets">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to wallets
            </Link>
          </Button>
        }
      />
    </div>
  )
}
