import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Ban, Plus } from 'lucide-react'
import { api } from '../api/client'
import { useApiMutation, useDeadEnds } from '../api/hooks'
import type { DeadEndStatus } from '../api/types'
import { DeadEndCard } from '../components/DeadEndCard'
import { Button } from '../components/ui/Button'
import { Field, FilterTabs, Input, Textarea } from '../components/ui/Field'
import { Modal } from '../components/ui/Modal'
import { PageHeader } from '../components/ui/PageHeader'
import { EmptyState, ErrorState, SkeletonCard } from '../components/ui/States'
import { useUI } from '../lib/ui'

export function DeadEnds() {
  const deadEnds = useDeadEnds()
  const [params] = useSearchParams()
  const focus = params.get('focus')
  const [filter, setFilter] = useState<DeadEndStatus>('confirmed')
  const [logOpen, setLogOpen] = useState(false)
  const scrolledFor = useRef<string | null>(null)

  useEffect(() => {
    if (!focus || !deadEnds.data || scrolledFor.current === focus) return
    const target = deadEnds.data.find((d) => d.id === focus)
    if (!target) return
    scrolledFor.current = focus
    setFilter(target.status)
    requestAnimationFrame(() => document.getElementById(`dead-end-${focus}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
  }, [focus, deadEnds.data])

  if (deadEnds.isError) return <ErrorState error={deadEnds.error} onRetry={() => deadEnds.refetch()} />
  const all = deadEnds.data ?? []
  const visible = all.filter((d) => d.status === filter)
  const count = (status: DeadEndStatus) => all.filter((d) => d.status === status).length

  return (
    <div className="page">
      <PageHeader
        title="Dead ends"
        description="Approaches the team ruled out, why, and what would make them worth another look. This is how the team avoids re-litigating old decisions."
        actions={
          <Button variant="primary" icon={<Plus />} onClick={() => setLogOpen(true)}>
            Log a dead end
          </Button>
        }
      />

      <div className="toolbar">
        <FilterTabs
          label="Filter dead ends by status"
          value={filter}
          onChange={setFilter}
          items={[
            { value: 'confirmed', label: 'Ruled out', count: count('confirmed') },
            { value: 'proposed', label: 'Proposed', count: count('proposed') },
            { value: 'reopened', label: 'Reopened', count: count('reopened') },
            { value: 'dismissed', label: 'Dismissed', count: count('dismissed') },
          ]}
        />
      </div>

      {!deadEnds.data ? (
        <div className="deadend-grid">
          {[0, 1].map((i) => (
            <SkeletonCard key={i} lines={4} />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<Ban />}
          title="Nothing here"
          description={filter === 'proposed' ? 'The research agent proposes dead ends when the evidence argues against an approach.' : undefined}
        />
      ) : (
        <div className="deadend-grid">
          {visible.map((d) => (
            <DeadEndCard key={d.id} deadEnd={d} />
          ))}
        </div>
      )}

      <LogDeadEndModal open={logOpen} onClose={() => setLogOpen(false)} />
    </div>
  )
}

function LogDeadEndModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [title, setTitle] = useState('')
  const [reason, setReason] = useState('')
  const [revisit, setRevisit] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { toast } = useUI()
  const create = useApiMutation((body: { title: string; reason: string; revisitTrigger?: string }) => api.createDeadEnd(body))

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (title.trim().length < 4 || reason.trim().length < 4) {
      setError('Add a title and a reason (at least a few words each).')
      return
    }
    create.mutate(
      { title: title.trim(), reason: reason.trim(), revisitTrigger: revisit.trim() || undefined },
      {
        onSuccess: () => {
          toast('Dead end logged')
          setTitle('')
          setReason('')
          setRevisit('')
          setError(null)
          onClose()
        },
        onError: (err) => setError(err.message),
      },
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Log a dead end"
      description="Record an approach the team decided not to pursue, so nobody spends a sprint rediscovering why."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="dead-end-form" loading={create.isPending}>
            Save dead end
          </Button>
        </>
      }
    >
      <form id="dead-end-form" className="form" onSubmit={submit}>
        <Field label="What was ruled out?" htmlFor="de-title" error={error}>
          <Input id="de-title" data-autofocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Training our own draft model for speculative decoding" />
        </Field>
        <Field label="Why" htmlFor="de-reason">
          <Textarea id="de-reason" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
        <Field label="Revisit if…" htmlFor="de-revisit" optional hint="The evidence or change that would make this worth reconsidering.">
          <Input id="de-revisit" value={revisit} onChange={(event) => setRevisit(event.target.value)} />
        </Field>
      </form>
    </Modal>
  )
}
