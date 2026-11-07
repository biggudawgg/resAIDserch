import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { CalendarDays, FileUp, Plus, Users } from 'lucide-react'
import { api } from '../api/client'
import { useApiMutation, useMeetings, useMemberName } from '../api/hooks'
import { AvatarStack } from '../components/ui/Avatar'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Field, Input, Textarea } from '../components/ui/Field'
import { Modal } from '../components/ui/Modal'
import { PageHeader } from '../components/ui/PageHeader'
import { EmptyState, ErrorState, SkeletonCard } from '../components/ui/States'
import { formatDate, plural } from '../lib/format'
import { providerLabel } from '../lib/providers'
import { useUI } from '../lib/ui'

const EXAMPLE = {
  title: 'Design review: FP8 fine-tuning rollout',
  topics: 'FP8 fine-tuning, Rollout plan',
  transcript: [
    'Priya: I agree we should move the 7B fine-tunes to FP8 next sprint.',
    "Marco: I don't think our kernels are ready; we saw instability on the last pilot.",
    'Aisha: I support FP8 fine-tuning only if we keep FP32 master weights and loss scaling.',
    'Tom: Not sure about the rollout plan yet. I need eval numbers before we switch.',
    "Lena: Let's do the rollout plan in two stages so we can roll back quickly.",
  ].join('\n'),
}

export function Meetings() {
  const meetings = useMeetings()
  const nameOf = useMemberName()
  const [params, setParams] = useSearchParams()
  const newOpen = params.get('new') === '1'

  const setNewOpen = (open: boolean) => {
    const next = new URLSearchParams(params)
    if (open) next.set('new', '1')
    else next.delete('new')
    setParams(next, { replace: true })
  }

  if (meetings.isError) return <ErrorState error={meetings.error} onRetry={() => meetings.refetch()} />

  return (
    <div className="page">
      <PageHeader
        title="Meetings"
        description="Turn meeting transcripts into a record of who stands where on each topic, with the exact quote behind every stance."
        actions={
          <Button variant="primary" icon={<Plus />} onClick={() => setNewOpen(true)}>
            Add transcript
          </Button>
        }
      />

      {!meetings.data ? (
        <div className="meeting-grid">
          {[0, 1].map((i) => (
            <SkeletonCard key={i} lines={3} />
          ))}
        </div>
      ) : meetings.data.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title="No meetings yet"
          description="Paste a transcript and Hindsight extracts each person's position on the topics you discussed."
          action={
            <Button variant="primary" icon={<Plus />} onClick={() => setNewOpen(true)}>
              Add transcript
            </Button>
          }
        />
      ) : (
        <div className="meeting-grid">
          {meetings.data.map((m) => (
            <Link key={m.id} to={`/meetings/${m.id}`} className="meeting-card">
              <div className="meeting-card-head">
                <span className="meeting-date">
                  <CalendarDays aria-hidden />
                  {formatDate(m.date)}
                </span>
                <Badge tone={m.extractedBy === 'heuristic' ? 'neutral' : 'accent'}>
                  {m.extractedBy === 'heuristic' ? 'Demo extraction' : `Extracted by ${providerLabel(m.extractedBy)}`}
                </Badge>
              </div>
              <h3 className="meeting-title">{m.title}</h3>
              <div className="chips">
                {m.topics.map((topic) => (
                  <span key={topic} className="chip chip-static">
                    {topic}
                  </span>
                ))}
              </div>
              <div className="meeting-card-foot">
                <AvatarStack names={[...m.participants.map(nameOf), ...m.unknownSpeakers]} />
                <span className="subtle small">
                  {plural(m.stanceCount, 'stance')} · {m.verifiedCount} verified
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <NewMeetingModal open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  )
}

function NewMeetingModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const today = new Date().toISOString().slice(0, 10)
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(today)
  const [topics, setTopics] = useState('')
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const { toast } = useUI()
  const create = useApiMutation((body: { title: string; date: string; topics: string[]; transcript: string }) => api.createMeeting(body))

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (title.trim().length < 2 || transcript.trim().length < 10) {
      setError('Add a title and paste the transcript.')
      return
    }
    create.mutate(
      {
        title: title.trim(),
        date,
        topics: topics
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        transcript,
      },
      {
        onSuccess: (meeting) => {
          toast(`Extracted ${plural(meeting.stances.length, 'stance')}`, { description: 'Verify each one before relying on it.' })
          setTitle('')
          setTopics('')
          setTranscript('')
          setError(null)
          navigate(`/meetings/${meeting.id}`)
        },
        onError: (err) => setError(err.message),
      },
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Add a meeting transcript"
      description="One line per remark, formatted as “Name: what they said”. Names are matched to your team members."
      footer={
        <>
          <Button
            variant="ghost"
            icon={<FileUp />}
            onClick={() => {
              setTitle(EXAMPLE.title)
              setTopics(EXAMPLE.topics)
              setTranscript(EXAMPLE.transcript)
            }}
          >
            Use an example
          </Button>
          <span className="modal-spacer" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="meeting-form" loading={create.isPending}>
            Extract stances
          </Button>
        </>
      }
    >
      <form id="meeting-form" className="form" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Title" htmlFor="mt-title" error={error}>
            <Input id="mt-title" data-autofocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Weekly sync" />
          </Field>
          <Field label="Date" htmlFor="mt-date">
            <Input id="mt-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </Field>
        </div>
        <Field label="Topics" htmlFor="mt-topics" optional hint="Comma-separated. Each remark is matched to the topic it mentions.">
          <Input id="mt-topics" value={topics} onChange={(event) => setTopics(event.target.value)} placeholder="FP8 fine-tuning, Rollout plan" />
        </Field>
        <Field label="Transcript" htmlFor="mt-transcript">
          <Textarea
            id="mt-transcript"
            rows={9}
            className="mono"
            value={transcript}
            onChange={(event) => setTranscript(event.target.value)}
            placeholder={'Priya: I think we should try FP8 next sprint.\nMarco: I disagree, the kernels are not ready.'}
          />
        </Field>
      </form>
    </Modal>
  )
}
