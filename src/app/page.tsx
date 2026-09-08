import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { getSessionUser } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { SiteHeader } from '@/components/marketing/site-header'
import { Hero } from '@/components/marketing/hero'
import { Architecture } from '@/components/marketing/architecture'
import { FeatureGrid } from '@/components/marketing/feature-grid'
import { Kernel } from '@/components/marketing/kernel'
import { Agentic } from '@/components/marketing/agentic'
import { Rails } from '@/components/marketing/rails'
import { Developers } from '@/components/marketing/developers'
import { SiteFooter } from '@/components/marketing/site-footer'
import { Reveal } from '@/components/marketing/reveal'

export default async function Home() {
  const session = await getSessionUser()
  const ctaHref = session ? '/dashboard' : '/login'

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <SiteHeader authenticated={Boolean(session)} />

      <main className="flex-1">
        <Hero authenticated={Boolean(session)} ctaHref={ctaHref} />
        <Architecture />
        <FeatureGrid />
        <Kernel />
        <Agentic />
        <Rails />
        <Developers />

        {/* Final CTA band */}
        <section className="border-b border-border/60">
          <div className="relative overflow-hidden">
            <div
              aria-hidden
              className="grid-bg absolute inset-0 [mask-image:radial-gradient(ellipse_60%_80%_at_50%_50%,black,transparent)]"
            />
            <div className="relative mx-auto max-w-3xl space-y-6 px-4 py-20 text-center sm:px-6 md:py-24">
              <Reveal>
                <h2 className="text-3xl font-semibold tracking-tight leading-tight text-balance md:text-4xl">
                  See it running — with <span className="novera-gradient-text">real seeded data.</span>
                </h2>
                <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
                  Explore the dashboard behind the demo login: 200 payments through the real kernel,
                  four AI agents with live policy gates, a pending approval, and a verified audit
                  hash chain.
                </p>
                <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
                  <Button asChild size="lg" className="h-12 gap-2 px-6 text-base">
                    <Link href={ctaHref}>
                      {session ? 'Open your dashboard' : 'Enter the interactive demo'}
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="lg" className="h-12 px-6 text-base">
                    <Link href="/register">Create an organization</Link>
                  </Button>
                </div>
              </Reveal>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}
