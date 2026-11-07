import { useEffect, useState, type FormEvent } from 'react'
import { Link, NavLink, useLocation, useParams } from 'react-router-dom'
import { ArrowRight, Building2, CheckCircle2, Download, Eye, EyeOff, KeyRound, PlugZap, ShieldCheck, Trash2, UserPlus, Users, Wallet, XCircle } from 'lucide-react'
import { api } from '../api/client'
import { useApiMutation, useProviders, useWorkspace } from '../api/hooks'
import type { Member, Provider, Role, Workspace } from '../api/types'
import { Avatar } from '../components/ui/Avatar'
import { Badge } from '../components/ui/Badge'
import { Button, IconButton } from '../components/ui/Button'
import { Callout, Card } from '../components/ui/Card'
import { Field, Input, Select, Switch } from '../components/ui/Field'
import { ConfirmModal } from '../components/ui/Modal'
import { PageHeader } from '../components/ui/PageHeader'
import { ProviderDot } from '../components/ui/ProviderChip'
import { SkeletonCard } from '../components/ui/States'
import { ProviderStatusBadge } from '../components/ui/StatusBadges'
import { cx } from '../lib/cx'
import { formatDate, timeAgo } from '../lib/format'
import { useUI } from '../lib/ui'
import { NotFound } from './NotFound'

const TABS = [
  { id: 'general', label: 'General', icon: Building2 },
  { id: 'keys', label: 'API keys', icon: KeyRound },
  { id: 'members', label: 'Members', icon: Users },
  { id: 'data', label: 'Data & retention', icon: ShieldCheck },
  { id: 'budget', label: 'Budget & research', icon: Wallet },
]

const ROLES: Array<{ value: Role; label: string }> = [
  { value: 'lead', label: 'Lead' },
  { value: 'researcher', label: 'Researcher' },
  { value: 'engineer', label: 'Engineer' },
  { value: 'viewer', label: 'Viewer' },
]

export function Settings() {
  const { tab = 'general' } = useParams<{ tab: string }>()
  const workspace = useWorkspace()
  if (!TABS.some((t) => t.id === tab)) return <NotFound />

  return (
    <div className="page">
      <PageHeader title="Settings" description="Workspace details, AI provider keys, team members, and data policies." />
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {TABS.map((t) => (
            <NavLink key={t.id} to={`/settings/${t.id}`} className={({ isActive }) => cx('settings-link', isActive && 'is-active')}>
              <t.icon aria-hidden />
              {t.label}
            </NavLink>
          ))}
        </nav>
        <div className="settings-panel">
          {tab === 'keys' ? (
            <ApiKeys />
          ) : !workspace.data ? (
            <SkeletonCard lines={5} />
          ) : tab === 'general' ? (
            <General ws={workspace.data} />
          ) : tab === 'members' ? (
            <Members ws={workspace.data} />
          ) : tab === 'data' ? (
            <DataRetention ws={workspace.data} />
          ) : (
            <BudgetResearch ws={workspace.data} />
          )}
        </div>
      </div>
    </div>
  )
}

function useSaveSettings() {
  const { toast } = useUI()
  const save = useApiMutation((body: Parameters<typeof api.saveSettings>[0]) => api.saveSettings(body))
  const run = (body: Parameters<typeof api.saveSettings>[0], message = 'Settings saved') =>
    save.mutate(body, { onSuccess: () => toast(message), onError: (error) => toast(error.message, { tone: 'error' }) })
  return { run, pending: save.isPending }
}

function General({ ws }: { ws: Workspace }) {
  const [teamName, setTeamName] = useState(ws.team.name)
  const [projectName, setProjectName] = useState(ws.team.projectName)
  const [endDate, setEndDate] = useState(ws.team.projectEndDate ?? '')
  const save = useSaveSettings()

  const submit = (event: FormEvent) => {
    event.preventDefault()
    save.run({ teamName: teamName.trim(), projectName: projectName.trim(), projectEndDate: endDate })
  }

  return (
    <Card title="Workspace" description="Shown in the sidebar and on exported briefings.">
      <form className="form form-narrow" onSubmit={submit}>
        <Field label="Team name" htmlFor="team-name">
          <Input id="team-name" value={teamName} onChange={(event) => setTeamName(event.target.value)} required maxLength={120} />
        </Field>
        <Field label="Project" htmlFor="project-name">
          <Input id="project-name" value={projectName} onChange={(event) => setProjectName(event.target.value)} maxLength={160} />
        </Field>
        <Field label="Project end date" htmlFor="project-end" hint={`All team data is deleted ${ws.settings.retentionMonths} months after this date.`}>
          <Input id="project-end" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        </Field>
        <div className="form-actions">
          <Button variant="primary" type="submit" loading={save.pending}>
            Save changes
          </Button>
        </div>
      </form>
    </Card>
  )
}

function ApiKeys() {
  const providers = useProviders()
  const location = useLocation()

  useEffect(() => {
    if (!location.hash || !providers.data) return
    document.getElementById(`provider-${location.hash.slice(1)}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [location.hash, providers.data])

  return (
    <>
      <Callout tone="info" title="How keys are handled">
        The demo server keeps keys in memory only (they are cleared when it restarts) and never sends them back to the browser. Testing a key calls the
        provider's model-list endpoint, which uses no tokens.
      </Callout>
      {providers.data ? providers.data.map((p) => <ProviderKeyCard key={p.id} provider={p} />) : <SkeletonCard lines={4} />}
    </>
  )
}

function ProviderKeyCard({ provider: p }: { provider: Provider }) {
  const [key, setKey] = useState('')
  const [show, setShow] = useState(false)
  const [model, setModel] = useState(p.model)
  const [baseUrl, setBaseUrl] = useState(p.baseUrl)
  const { toast } = useUI()
  const save = useApiMutation((body: { apiKey?: string; model?: string; baseUrl?: string }) => api.saveProvider(p.id, body))
  const test = useApiMutation(() => api.testProvider(p.id))
  const dirty = key.trim() !== '' || model !== p.model || (p.id === 'custom' && baseUrl !== p.baseUrl)

  const onSave = () =>
    save.mutate(
      { apiKey: key.trim() || undefined, model, baseUrl: p.id === 'custom' ? baseUrl : undefined },
      {
        onSuccess: () => {
          setKey('')
          toast(`${p.short} settings saved`, { description: key.trim() ? 'Run a connection test to confirm the key works.' : undefined })
        },
        onError: (error) => toast(error.message, { tone: 'error' }),
      },
    )

  const onTest = () =>
    test.mutate(undefined, {
      onSuccess: (result) =>
        toast(result.ok ? `${p.short} key works` : `${p.short}: ${result.message}`, {
          tone: result.ok ? 'success' : 'error',
          description: `Responded in ${result.latencyMs} ms`,
        }),
      onError: (error) => toast(error.message, { tone: 'error' }),
    })

  const keyHint = p.hasKey ? (
    `A key ending in ${p.keyHint ?? '••••'} is saved. Enter a new one to replace it.`
  ) : p.consoleUrl ? (
    <>
      Create one in the{' '}
      <a href={p.consoleUrl} target="_blank" rel="noreferrer">
        {p.short} console
      </a>
      .
    </>
  ) : (
    'The key for your endpoint, if it needs one.'
  )

  return (
    <Card
      id={`provider-${p.id}`}
      title={
        <span className="provider-name">
          <ProviderDot provider={p.id} />
          {p.name}
        </span>
      }
      description={p.blurb}
      actions={<ProviderStatusBadge status={p.status} />}
    >
      <div className="form-grid">
        <Field label="API key" htmlFor={`key-${p.id}`} hint={keyHint}>
          <div className="input-group">
            <Input
              id={`key-${p.id}`}
              type={show ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              placeholder={p.hasKey ? `••••••••${p.keyHint?.replace('…', '') ?? ''}` : p.keyPlaceholder}
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
            <IconButton label={show ? 'Hide key' : 'Show key'} icon={show ? <EyeOff /> : <Eye />} variant="secondary" onClick={() => setShow((v) => !v)} />
          </div>
        </Field>
        <Field label="Model" htmlFor={`model-${p.id}`} hint="Pick a suggestion or type any model ID.">
          <Input id={`model-${p.id}`} className="mono" list={`models-${p.id}`} value={model} onChange={(event) => setModel(event.target.value)} spellCheck={false} />
        </Field>
        <datalist id={`models-${p.id}`}>
          {p.models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        {p.id === 'custom' && (
          <Field label="Base URL" htmlFor="custom-base" hint="OpenAI-compatible endpoint, e.g. https://openrouter.ai/api/v1 or http://localhost:11434/v1">
            <Input id="custom-base" className="mono" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} spellCheck={false} />
          </Field>
        )}
      </div>
      {p.lastTestedAt && (
        <p className={cx('test-result', p.status === 'connected' ? 'is-ok' : 'is-bad')}>
          {p.status === 'connected' ? <CheckCircle2 aria-hidden /> : <XCircle aria-hidden />}
          {p.lastTestMessage} · {p.lastLatencyMs} ms · tested {timeAgo(p.lastTestedAt)}
        </p>
      )}
      <div className="form-actions">
        <Button variant="primary" onClick={onSave} disabled={!dirty} loading={save.isPending}>
          Save
        </Button>
        <Button icon={<PlugZap />} onClick={onTest} disabled={!p.hasKey} loading={test.isPending}>
          Test connection
        </Button>
        {p.hasKey && (
          <Button
            variant="ghost"
            onClick={() => save.mutate({ apiKey: '' }, { onSuccess: () => toast(`${p.short} key removed`) })}
          >
            Remove key
          </Button>
        )}
      </div>
    </Card>
  )
}

function Members({ ws }: { ws: Workspace }) {
  const { toast } = useUI()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('researcher')
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<Member | null>(null)
  const add = useApiMutation((body: { name: string; email: string; role: Role }) => api.addMember(body))
  const updateRole = useApiMutation((v: { id: string; role: Role }) => api.updateMember(v.id, v.role))
  const remove = useApiMutation((id: string) => api.removeMember(id))

  const submit = (event: FormEvent) => {
    event.preventDefault()
    add.mutate(
      { name: name.trim(), email: email.trim(), role },
      {
        onSuccess: (member) => {
          toast(`${member.name} added to the team`)
          setName('')
          setEmail('')
          setRole('researcher')
          setError(null)
        },
        onError: (err) => setError(err.message),
      },
    )
  }

  return (
    <>
      <Card title="Team members" description={`${ws.members.length} people can see this workspace.`} flush>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Role</th>
                <th scope="col">Joined</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {ws.members.map((m) => {
                const me = m.id === ws.currentUserId
                return (
                  <tr key={m.id}>
                    <td>
                      <span className="person">
                        <Avatar name={m.name} size="sm" />
                        <span>
                          <span className="table-title-static">
                            {m.name} {me && <Badge>You</Badge>}
                          </span>
                          <span className="table-sub">{m.email}</span>
                        </span>
                      </span>
                    </td>
                    <td>
                      <Select
                        value={m.role}
                        disabled={me}
                        aria-label={`Role for ${m.name}`}
                        onChange={(event) =>
                          updateRole.mutate({ id: m.id, role: event.target.value as Role }, { onSuccess: () => toast(`${m.name} is now ${event.target.value}`) })
                        }
                      >
                        {ROLES.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="subtle nowrap">{timeAgo(m.joinedAt)}</td>
                    <td className="num">{!me && <IconButton label={`Remove ${m.name}`} icon={<Trash2 />} onClick={() => setRemoving(m)} />}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Add a member" description="In the demo, members are added straight away. With sign-in enabled they would get an invite email.">
        <form className="form-inline" onSubmit={submit}>
          <Field label="Name" htmlFor="member-name">
            <Input id="member-name" value={name} onChange={(event) => setName(event.target.value)} required />
          </Field>
          <Field label="Email" htmlFor="member-email" error={error}>
            <Input id="member-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </Field>
          <Field label="Role" htmlFor="member-role">
            <Select id="member-role" value={role} onChange={(event) => setRole(event.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>
          <Button variant="primary" type="submit" icon={<UserPlus />} loading={add.isPending}>
            Add
          </Button>
        </form>
      </Card>

      <ConfirmModal
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={`Remove ${removing?.name ?? 'member'}?`}
        description="They lose access to this workspace. Their past stances and approvals stay in the record."
        confirmLabel="Remove member"
        loading={remove.isPending}
        onConfirm={() =>
          removing &&
          remove.mutate(removing.id, {
            onSuccess: () => {
              toast(`${removing.name} removed`)
              setRemoving(null)
            },
            onError: (err) => toast(err.message, { tone: 'error' }),
          })
        }
      />
    </>
  )
}

function DataRetention({ ws }: { ws: Workspace }) {
  const { toast } = useUI()
  const [exporting, setExporting] = useState(false)

  const exportAll = async () => {
    setExporting(true)
    try {
      const [workspace, questions, beliefs, deadEnds, papers, meetings] = await Promise.all([
        api.workspace(),
        api.questions(),
        api.beliefs(),
        api.deadEnds(),
        api.papers(''),
        api.meetings(),
      ])
      const payload = { exportedAt: new Date().toISOString(), workspace, questions, beliefs, deadEnds, papers, meetings }
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `hindsight-export-${new Date().toISOString().slice(0, 10)}.json`
      link.click()
      URL.revokeObjectURL(url)
      toast('Workspace export downloaded')
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Export failed', { tone: 'error' })
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <Card title="Automatic deletion" description="Data is kept only as long as the project needs it.">
        <div className="retention">
          <div className="retention-item">
            <span className="retention-label">Project ends</span>
            <span className="retention-value">{formatDate(ws.team.projectEndDate)}</span>
          </div>
          <ArrowRight aria-hidden />
          <div className="retention-item">
            <span className="retention-label">Plus {ws.settings.retentionMonths} months</span>
            <span className="retention-value">{formatDate(ws.retentionDeleteOn)}</span>
            <span className="retention-sub">Questions, papers, beliefs, meetings and usage logs are deleted.</span>
          </div>
        </div>
        <p className="small subtle">
          Change the project end date under <Link to="/settings/general">General</Link>.
        </p>
      </Card>
      <Card title="Export" description="Download everything in this workspace as one JSON file.">
        <Button icon={<Download />} onClick={exportAll} loading={exporting}>
          Export workspace data
        </Button>
      </Card>
      <Card title="Delete workspace" description="Permanently delete this workspace and everything in it.">
        <Button variant="danger" disabled>
          Delete workspace
        </Button>
        <p className="field-hint spaced">Disabled in the demo workspace.</p>
      </Card>
    </>
  )
}

function BudgetResearch({ ws }: { ws: Workspace }) {
  const [budget, setBudget] = useState(String(ws.settings.monthlyBudgetUsd))
  const [threshold, setThreshold] = useState(String(ws.settings.alertThreshold))
  const [maxPapers, setMaxPapers] = useState(String(ws.settings.maxPapers))
  const save = useSaveSettings()

  const submit = (event: FormEvent) => {
    event.preventDefault()
    save.run({ monthlyBudgetUsd: Number(budget), alertThreshold: Number(threshold), maxPapers: Number(maxPapers) })
  }

  return (
    <>
      <Card title="Budget and alerts" description="Spend is tracked per call, per provider, in real time.">
        <form className="form form-narrow" onSubmit={submit}>
          <div className="form-grid">
            <Field label="Monthly budget (USD)" htmlFor="budget">
              <Input id="budget" type="number" min={0} step={1} value={budget} onChange={(event) => setBudget(event.target.value)} />
            </Field>
            <Field label="Warn at" htmlFor="threshold">
              <Select id="threshold" value={threshold} onChange={(event) => setThreshold(event.target.value)}>
                {[0.5, 0.75, 0.8, 0.9, 1].map((v) => (
                  <option key={v} value={String(v)}>
                    {Math.round(v * 100)}% of budget
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Papers per research run" htmlFor="max-papers" hint="How many arXiv results each run screens. More papers, more cost.">
            <Input id="max-papers" type="number" min={3} max={50} value={maxPapers} onChange={(event) => setMaxPapers(event.target.value)} />
          </Field>
          <div className="form-actions">
            <Button variant="primary" type="submit" loading={save.pending}>
              Save changes
            </Button>
          </div>
        </form>
      </Card>
      <Card title="Automation">
        <Switch
          checked={ws.settings.backgroundWatch}
          onChange={(value) => save.run({ backgroundWatch: value }, value ? 'Weekly paper watch is on' : 'Weekly paper watch is off')}
          label="Weekly paper watch"
          description="Re-checks answered questions for new papers and flags beliefs that may need re-scoring."
        />
        <Switch
          checked={ws.settings.groqFreeTier}
          onChange={(value) => save.run({ groqFreeTier: value }, 'Cost accounting updated')}
          label="Count Groq calls as free tier"
          description="Turn off if you are on a paid Groq plan. Applies to new calls."
        />
      </Card>
    </>
  )
}
