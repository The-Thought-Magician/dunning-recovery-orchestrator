import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'DunningRecoveryOrchestrator',
  description: 'Turn failed recurring-payment retries into recovered cash by modeling decline reasons, retry timing, and card-updater gaps.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-100 min-h-screen antialiased">{children}</body>
    </html>
  )
}
