import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [signUpSuccess, setSignUpSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password.trim()) return
    setSubmitting(true)
    setError(null)

    if (isSignUp) {
      const { error: err } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      })
      if (err) {
        setError(err.message)
      } else {
        setSignUpSuccess(true)
      }
    } else {
      const { error: err } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (err) {
        setError(err.message)
      }
    }

    setSubmitting(false)
  }

  return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Branding */}
        <div className="text-center mb-8">
          <h1 className="font-heading text-4xl font-bold tracking-wide text-val-red">
            VAL MASTER
          </h1>
          <p className="font-heading text-sm font-semibold tracking-[0.25em] text-text-muted mt-1 uppercase">
            Your Competitive Edge
          </p>
        </div>

        <div className="bg-bg-card border border-bg-elevated rounded-xl p-6 space-y-5">
          <h2 className="font-heading text-xl font-bold text-text-primary text-center">
            {isSignUp ? 'Create Account' : 'Sign In'}
          </h2>

          {signUpSuccess ? (
            <div className="text-center space-y-3">
              <p className="text-sm text-val-green">
                Account created! Check your email to confirm, then sign in.
              </p>
              <button
                onClick={() => { setIsSignUp(false); setSignUpSuccess(false) }}
                className="text-sm text-val-cyan hover:text-val-cyan/80 transition-colors"
              >
                Back to Sign In
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <label className="block space-y-1.5">
                <span className="text-xs text-text-secondary uppercase tracking-wider font-medium">Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="w-full bg-bg-elevated border border-bg-elevated rounded-lg px-3 py-2.5 text-text-primary text-sm placeholder:text-text-muted focus:outline-none focus:border-val-cyan/50 transition-colors"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs text-text-secondary uppercase tracking-wider font-medium">Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={isSignUp ? 'Min 6 characters' : 'Enter password'}
                  required
                  minLength={6}
                  className="w-full bg-bg-elevated border border-bg-elevated rounded-lg px-3 py-2.5 text-text-primary text-sm placeholder:text-text-muted focus:outline-none focus:border-val-cyan/50 transition-colors"
                />
              </label>

              {error && (
                <p className="text-sm text-val-red">{error}</p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 rounded-lg bg-val-red text-white font-heading font-bold text-sm tracking-wide hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {submitting
                  ? (isSignUp ? 'Creating...' : 'Signing in...')
                  : (isSignUp ? 'Create Account' : 'Sign In')
                }
              </button>
            </form>
          )}

          {!signUpSuccess && (
            <p className="text-center text-xs text-text-muted">
              {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
              <button
                onClick={() => { setIsSignUp(!isSignUp); setError(null) }}
                className="text-val-cyan hover:text-val-cyan/80 transition-colors font-medium"
              >
                {isSignUp ? 'Sign In' : 'Sign Up'}
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
