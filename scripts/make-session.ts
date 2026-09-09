import { db } from '../src/lib/db'
import { randomBytes } from 'crypto'
import { sha256Hex } from '../src/lib/crypto'

async function main() {
  const user = await db.user.findUnique({ where: { email: 'demo@novera.africa' } })
  if (!user) throw new Error('demo user missing — run seed')
  const membership = await db.membership.findFirst({
    where: { userId: user.id },
    include: { organization: true },
    orderBy: { createdAt: 'asc' },
  })
  const token = randomBytes(32).toString('hex')
  await db.session.create({
    data: {
      userId: user.id,
      // sessions store ONLY the sha256 hash; the raw token is printed once
      tokenHash: sha256Hex(token),
      activeOrganizationId: membership!.organizationId,
      expiresAt: new Date(Date.now() + 3600_000),
    },
  })
  console.log(token)
}
main().finally(() => db.$disconnect())
