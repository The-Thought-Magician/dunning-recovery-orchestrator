'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { authClient } from '@/lib/auth/client'

export default function SignUp() {
  const router = useRouter()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const fd = new FormData(e.currentTarget)
    const { error } = await authClient.signUp.email({
      name: fd.get('name') as string,
      email: fd.get('email') as string,
      password: fd.get('password') as string,
    })
    setLoading(false)
    if (error) {
      setError(error.message ?? 'Failed to create account')
      return
    }
    router.push('/dashboard')
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" className="inline-flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500 text-base font-black text-slate-950">D</span>
            <span className="text-xl font-black tracking-tight text-white">DunningRecovery<span className="text-emerald-400">Orchestrator</span></span>
          </Link>
          <h1 className="mt-6 text-2xl font-bold text-white">Create your account</h1>
          <p className="mt-1 text-sm text-slate-500">Free for every signed-in user.</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-8">
          {error && (
            <div className="rounded-lg border border-red-700 bg-red-900/30 p-3 text-sm text-red-400">{error}</div>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">Name</label>
            <input
              name="name"
              type="text"
              required
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              placeholder="Your name"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">Email</label>
            <input
              name="email"
              type="email"
              required
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              placeholder="you@company.com"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">Password</label>
            <input
              name="password"
              type="password"
              required
              minLength={8}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-emerald-500 py-3 font-semibold text-slate-950 transition-colors hover:bg-emerald-400 disabled:opacity-50"
          >
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
          <p className="text-center text-sm text-slate-400">
            Already have an account?{' '}
            <Link href="/auth/sign-in" className="text-emerald-400 hover:text-emerald-300">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </main>
  )
}
