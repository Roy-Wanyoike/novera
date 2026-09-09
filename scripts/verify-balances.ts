/** Post-seed financial sanity check: wallet balances + invariants.
 * Exits non-zero when ANY invariant fails — usable as a CI/ops gate. */
import { db } from '../src/lib/db'
import { walletLedgerBalance, trialBalance } from '../src/lib/ledger'
import { Money } from '@novera/money'

async function main(): Promise<number> {
  let failures = 0
  const org = await db.organization.findUnique({ where: { slug: 'acme-kenya' } })
  const wallets = await db.wallet.findMany({ where: { organizationId: org!.id } })
  console.log('── wallet balances (corrected posting) ──')
  for (const w of wallets) {
    const bal = await walletLedgerBalance(w.id)
    console.log(`   ${w.label.padEnd(12)} ${w.currency.padEnd(5)} ${Money.fromMinor(bal, w.currency).format()}`)
  }
  const tb = await trialBalance(org!.id)
  console.log('── trial balance per currency ──')
  for (const c of tb.perCurrency) {
    console.log(`   ${c.currency}: debits ${c.debits} credits ${c.credits} → ${c.balanced ? 'OK' : 'BROKEN'}`)
    if (!c.balanced) failures++
  }
  if (!tb.balanced) failures++
  // negative-balance assertion: wallets must not be negative
  const negatives: string[] = []
  for (const w of wallets) {
    const bal = await walletLedgerBalance(w.id)
    if (bal < 0n) negatives.push(`${w.label} (${w.currency}): ${bal}`)
  }
  if (negatives.length === 0) {
    console.log('── PASS: no negative wallet balances')
  } else {
    failures++
    console.log(`── FAIL: negative balances: ${negatives.join('; ')}`)
  }
  const settled = await db.payment.count({ where: { organizationId: org!.id, status: 'SETTLED' } })
  const vol = await db.payment.aggregate({ where: { organizationId: org!.id, status: 'SETTLED' }, _sum: { amountMinor: true } })
  console.log(`── ${settled} settled payments, volume ${vol._sum.amountMinor?.toString()} minor`)
  return failures
}

main()
  .then((failures) => {
    if (failures > 0) {
      console.error(`── verify-balances: ${failures} invariant failure(s) — exiting 1`)
      process.exitCode = 1
    }
  })
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
