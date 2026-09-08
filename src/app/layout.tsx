import type { Metadata } from 'next'
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"
import { Toaster } from "@/components/ui/toaster"
import { Providers } from "@/components/novera/providers"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: {
    default: "Novera — Programmable Financial Infrastructure",
    template: "%s · Novera",
  },
  description:
    "Novera is programmable financial infrastructure: wallets, payments, cards, treasury and controlled AI agents on a deterministic double-entry financial kernel. AI proposes. Policy authorizes. The ledger records.",
  keywords: [
    "fintech", "payments", "financial infrastructure", "double-entry ledger", "agentic finance",
    "mobile money", "M-Pesa", "stablecoins", "treasury", "developer platform",
  ],
  openGraph: {
    title: "Novera — Programmable Financial Infrastructure",
    description: "AI proposes. Policy authorizes. The ledger records.",
    siteName: "Novera",
    type: "website",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}>
        <Providers>{children}</Providers>
        <Toaster />
      </body>
    </html>
  )
}
