import { mkdir, writeFile } from 'fs/promises'
import path from 'path'

/** Generate minimal, compiling stub pages for every app route. */
const ROUTES: { dir: string; title: string; desc: string }[] = [
  { dir: 'dashboard', title: 'Dashboard', desc: 'Cash position, KPIs and live activity.' },
  { dir: 'wallets', title: 'Wallets', desc: 'Multi-currency wallets backed by ledger accounts.' },
  { dir: 'wallets/[id]', title: 'Wallet', desc: 'Wallet detail, entries and transfers.' },
  { dir: 'transactions', title: 'Ledger', desc: 'Double-entry transaction explorer.' },
  { dir: 'treasury', title: 'Treasury', desc: 'Cash position, liquidity and forecast.' },
  { dir: 'fx', title: 'FX', desc: 'Quotes, locked rates and conversions.' },
  { dir: 'payments', title: 'Payments', desc: 'Payment lifecycle across all rails.' },
  { dir: 'payments/[id]', title: 'Payment', desc: 'Payment detail and timeline.' },
  { dir: 'payment-links', title: 'Payment Links', desc: 'Shareable links that resolve to payment intents.' },
  { dir: 'invoices', title: 'Invoices', desc: 'Invoice lifecycle and collection status.' },
  { dir: 'invoices/[id]', title: 'Invoice', desc: 'Invoice detail.' },
  { dir: 'customers', title: 'Customers', desc: 'Payer profiles and risk tiers.' },
  { dir: 'cards', title: 'Cards', desc: 'Virtual and physical card controls.' },
  { dir: 'cards/[id]', title: 'Card', desc: 'Card detail, controls and authorizations.' },
  { dir: 'agents', title: 'Agents', desc: 'Know Your Agent registry.' },
  { dir: 'agents/[id]', title: 'Agent', desc: 'Agent detail, policy and intents.' },
  { dir: 'approvals', title: 'Approvals', desc: 'Human approval queue for agent intents.' },
  { dir: 'rules', title: 'Rules', desc: 'Programmable money: split rules.' },
  { dir: 'risk', title: 'Risk', desc: 'Evaluations, rules and review queue.' },
  { dir: 'reconciliation', title: 'Reconciliation', desc: 'Ledger ↔ provider matching operations.' },
  { dir: 'audit', title: 'Audit', desc: 'Tamper-evident event trail.' },
  { dir: 'developers', title: 'Developers', desc: 'API keys, logs and webhooks.' },
  { dir: 'settings', title: 'Settings', desc: 'Organization settings.' },
  { dir: 'copilot', title: 'Copilot', desc: 'Financial copilot grounded in ledger data.' },
]

const APP = '/home/z/my-project/src/app/(app)'

function page(title: string, desc: string) {
  return `import { PageHeader } from '@/components/novera/page-header'

export const metadata = { title: '${title}' }

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader title="${title}" description="${desc}" />
      <div className="rounded-lg border border-dashed p-16 text-center text-sm text-muted-foreground">
        Module in active build — agent squad dispatching.
      </div>
    </div>
  )
}
`
}

async function main() {
  for (const r of ROUTES) {
    const dir = path.join(APP, r.dir)
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'page.tsx'), page(r.title, r.desc))
    console.log('stub:', r.dir)
  }
}
main()
