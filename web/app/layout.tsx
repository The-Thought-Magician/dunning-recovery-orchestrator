import type { Metadata } from 'next'
import { IBM_Plex_Sans } from 'next/font/google'
import './globals.css'

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-ibm-plex-sans',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'DunningRecoveryOrchestrator',
  description: 'Turn failed recurring-payment retries into recovered cash by modeling decline reasons, retry timing, and card-updater gaps.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={ibmPlexSans.variable}>
      <body className="bg-zinc-950 text-zinc-100 min-h-screen antialiased font-sans">{children}</body>
    </html>
  )
}
