import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { signOut } from '../lib/auth'
import { useProfile, resolveRiotAccount } from '../lib/profile'

const REGIONS = [
  { value: 'ap', label: 'AP — Asia-Pacific' },
  { value: 'na', label: 'NA — North America' },
  { value: 'eu', label: 'EU — Europe' },
  { value: 'kr', label: 'KR — Korea' },
  { value: 'latam', label: 'LATAM — Latin America' },
  { value: 'br', label: 'BR — Brazil' },
]

const TIMEZONES = [
  'Asia/Singapore',
  'Asia/Tokyo',
  'Europe/Paris',
  'Europe/London',
  'America/New_York',
  'America/Los_Angeles',
  'UTC',
]

type Status =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'ok'; msg: string }
  | { kind: 'err'; msg: string }

function SectionCard({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="bg-bg-card border border-bg-elevated rounded-xl p-5 space-y-4">
      <div>
        <h2 className="font-heading text-lg font-bold text-text-primary">{title}</h2>
        {description && <p className="text-xs text-text-secondary mt-1">{description}</p>}
      </div>
      {children}
    </section>
  )
}

function StatusLine({ status }: { status: Status }) {
  if (status.kind === 'ok') return <p className="text-xs text-val-green">{status.msg}</p>
  if (status.kind === 'err') return <p className="text-xs text-val-red">{status.msg}</p>
  return null
}

const inputClass =
  'w-full bg-bg-elevated border border-bg-elevated rounded-lg px-3 py-2 text-text-primary text-sm placeholder:text-text-muted focus:outline-none focus:border-val-cyan/50 transition-colors'

const btnPrimary =
  'inline-flex items-center gap-2 px-4 py-2 bg-val-cyan/10 text-val-cyan border border-val-cyan/20 rounded-lg hover:bg-val-cyan/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium'

export default function Settings() {
  const { profile, loading, save } = useProfile()

  // Riot ID
  const [riotName, setRiotName] = useState('')
  const [riotTag, setRiotTag] = useState('')
  const [region, setRegion] = useState('ap')
  const [riotStatus, setRiotStatus] = useState<Status>({ kind: 'idle' })

  // Timezone
  const [timezone, setTimezone] = useState('Asia/Singapore')
  const [tzStatus, setTzStatus] = useState<Status>({ kind: 'idle' })

  // Weekly goal
  const [weeklyGoal, setWeeklyGoal] = useState('')
  const [goalStatus, setGoalStatus] = useState<Status>({ kind: 'idle' })

  // Account
  const [email, setEmail] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [pwStatus, setPwStatus] = useState<Status>({ kind: 'idle' })

  useEffect(() => {
    if (loading) return
    setRiotName(profile.riot_name)
    setRiotTag(profile.riot_tag)
    setRegion(profile.region || 'ap')
    setTimezone(profile.timezone || 'Asia/Singapore')
    setWeeklyGoal(profile.weekly_goal || '')
  }, [loading, profile])

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null))
  }, [])

  const handleSaveRiot = async () => {
    const name = riotName.trim()
    const tag = riotTag.trim().replace(/^#/, '')
    if (!name || !tag) {
      setRiotStatus({ kind: 'err', msg: 'Enter both name and tag.' })
      return
    }
    setRiotStatus({ kind: 'saving' })
    const resolved = await resolveRiotAccount(name, tag)
    if ('error' in resolved) {
      setRiotStatus({ kind: 'err', msg: resolved.error })
      return
    }
    const finalRegion = (resolved.region || region || 'ap').toLowerCase()
    const res = await save({
      riot_name: name,
      riot_tag: tag,
      riot_puuid: resolved.puuid,
      region: finalRegion,
    })
    if (res.error) {
      setRiotStatus({ kind: 'err', msg: res.error })
      return
    }
    setRegion(finalRegion)
    setRiotTag(tag)
    setRiotStatus({
      kind: 'ok',
      msg: 'Verified — go to Matches and hit Load Latest.',
    })
  }

  const handleSaveTimezone = async () => {
    setTzStatus({ kind: 'saving' })
    const res = await save({ timezone })
    if (res.error) setTzStatus({ kind: 'err', msg: res.error })
    else setTzStatus({ kind: 'ok', msg: 'Saved.' })
  }

  const handleSaveGoal = async () => {
    setGoalStatus({ kind: 'saving' })
    const res = await save({ weekly_goal: weeklyGoal })
    if (res.error) {
      setGoalStatus({ kind: 'err', msg: res.error })
      return
    }
    localStorage.setItem('weeklyGoal', weeklyGoal)
    setGoalStatus({ kind: 'ok', msg: 'Saved.' })
  }

  const handleChangePassword = async () => {
    if (newPassword.length < 6) {
      setPwStatus({ kind: 'err', msg: 'Password must be at least 6 characters.' })
      return
    }
    setPwStatus({ kind: 'saving' })
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) {
      setPwStatus({ kind: 'err', msg: error.message })
      return
    }
    setNewPassword('')
    setPwStatus({ kind: 'ok', msg: 'Password updated.' })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-val-cyan" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text-secondary transition-colors"
        >
          <ArrowLeft className="w-3 h-3" />
          Back to Matches
        </Link>
        <h1 className="text-3xl font-heading font-bold mt-2">Settings</h1>
      </div>

      <SectionCard
        title="Riot ID"
        description="Required to sync your matches. We verify it with Henrik on save."
      >
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
          <label className="block space-y-1.5">
            <span className="text-xs text-text-secondary uppercase tracking-wider font-medium">
              Name
            </span>
            <input
              type="text"
              value={riotName}
              onChange={(e) => setRiotName(e.target.value)}
              placeholder="RiotName"
              className={inputClass}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs text-text-secondary uppercase tracking-wider font-medium">
              Tag
            </span>
            <div className="flex items-center">
              <span className="px-2 py-2 bg-bg-elevated border border-r-0 border-bg-elevated rounded-l-lg text-text-muted text-sm">
                #
              </span>
              <input
                type="text"
                value={riotTag}
                onChange={(e) => setRiotTag(e.target.value.replace(/^#/, ''))}
                placeholder="1234"
                className={`${inputClass} rounded-l-none w-24`}
              />
            </div>
          </label>
        </div>
        <label className="block space-y-1.5">
          <span className="text-xs text-text-secondary uppercase tracking-wider font-medium">
            Region
          </span>
          <select
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            className={inputClass}
          >
            {REGIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-3">
          <button
            onClick={handleSaveRiot}
            disabled={riotStatus.kind === 'saving'}
            className={btnPrimary}
          >
            {riotStatus.kind === 'saving' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Save Riot ID
          </button>
          <StatusLine status={riotStatus} />
        </div>
      </SectionCard>

      <SectionCard title="Timezone" description="Used later for week and session boundaries.">
        <label className="block space-y-1.5">
          <span className="text-xs text-text-secondary uppercase tracking-wider font-medium">
            Timezone
          </span>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className={inputClass}
          >
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-3">
          <button
            onClick={handleSaveTimezone}
            disabled={tzStatus.kind === 'saving'}
            className={btnPrimary}
          >
            {tzStatus.kind === 'saving' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Save Timezone
          </button>
          <StatusLine status={tzStatus} />
        </div>
      </SectionCard>

      <SectionCard
        title="Weekly Goal"
        description="Shown on Dashboard and Check-In."
      >
        <label className="block space-y-1.5">
          <span className="text-xs text-text-secondary uppercase tracking-wider font-medium">
            Goal
          </span>
          <input
            type="text"
            value={weeklyGoal}
            onChange={(e) => setWeeklyGoal(e.target.value)}
            placeholder="e.g. Reach Diamond 2"
            className={inputClass}
          />
        </label>
        <div className="flex items-center gap-3">
          <button
            onClick={handleSaveGoal}
            disabled={goalStatus.kind === 'saving'}
            className={btnPrimary}
          >
            {goalStatus.kind === 'saving' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Save Weekly Goal
          </button>
          <StatusLine status={goalStatus} />
        </div>
      </SectionCard>

      <SectionCard title="Account">
        <div className="space-y-1.5">
          <span className="text-xs text-text-secondary uppercase tracking-wider font-medium">
            Signed in as
          </span>
          <p className="text-sm text-text-primary">{email ?? '—'}</p>
        </div>
        <label className="block space-y-1.5">
          <span className="text-xs text-text-secondary uppercase tracking-wider font-medium">
            Change password
          </span>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password (min 6 characters)"
            minLength={6}
            className={inputClass}
          />
        </label>
        <div className="flex items-center gap-3">
          <button
            onClick={handleChangePassword}
            disabled={pwStatus.kind === 'saving' || !newPassword}
            className={btnPrimary}
          >
            {pwStatus.kind === 'saving' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Update Password
          </button>
          <StatusLine status={pwStatus} />
        </div>
        <div className="pt-2 border-t border-bg-elevated">
          <button
            onClick={() => signOut()}
            className="text-xs text-val-red hover:text-val-red/80 transition-colors"
          >
            Sign out
          </button>
        </div>
      </SectionCard>
    </div>
  )
}
