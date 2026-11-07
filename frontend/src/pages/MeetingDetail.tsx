import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { api } from '../api/client'
import { useApiMutation, useMeeting, useMemberName } from '../api/hooks'
import type { MeetingStance, MeetingStanceValue } from '../api/types'
import { Avatar } from '../components/ui/Avatar'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Select } from '../components/ui/Field'
import { ConfirmModal } from '../components/ui/Modal'
import { PageHeader } from '../components/ui/PageHeader'
import { ErrorState, SkeletonCard } from '../components/ui/States'
import { MEETING_STANCE_LABEL, MeetingStanceBadge } from '../components/ui/StatusBadges'
import { formatDate, plural } from '../lib/format'
import { providerLabel } from '../lib/providers'
import { useUI } from '../lib/ui'

export function MeetingDetail() {
  const { id } = useParams<{ id: string }>()
  const meeting = useMeeting(id)
  const nameOf = useMemberName()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { toast } = useUI()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const update = useApiMutation((v: { stanceId: string; verified?: boolean; stance?: MeetingStanceValue }) =>
    api.updateStance(id as string, v.stanceId, { verified: v.verified, stance: v.stance }),
  )
  const remove = useMutation({
    mutationFn: () => api.deleteMeeting(id as string),
    onSuccess: () => {
      navigate('/meetings')
      toast('Meeting deleted')
      qc.removeQueries({ queryKey: ['meeting', id] })
      qc.invalidateQueries()
    },
  })

  if (meeting.isError) return <ErrorState error={meeting.error} onRetry={() => meeting.refetch()} />
  const m = meeting.data
  if (!m) {
    return (
      <div className="page">
        <SkeletonCard lines={2} />
        <SkeletonCard lines={5} />
      </div>
    )
  }

  const label = (s: MeetingStance) => (s.memberId ? nameOf(s.memberId) : s.speaker)
  const people = Array.from(new Set(m.stances.map(label)))
  const latest = (person: string, topic: string) => [...m.stances].reverse().find((s) => label(s) === person && s.topic === topic)

  return (
    <div className="page">
      <PageHeader
        breadcrumb={[{ label: 'Meetings', to: '/meetings' }, { label: 'Meeting' }]}
        title={m.title}
        description={`${formatDate(m.date)} · ${plural(m.participants.length + m.unknownSpeakers.length, 'participant')} · ${plural(m.stanceCount, 'stance')}, ${m.verifiedCount} verified`}
        actions={
          <Button variant="ghost" icon={<Trash2 />} onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
        }
      />

      {m.unknownSpeakers.length > 0 && (
        <p className="small subtle">
          Not matched to a team member: {m.unknownSpeakers.join(', ')}. Add them in Settings → Members to track their stances over time.
        </p>
      )}

      <Card title="Stance map" description="Each person's latest position per topic. Hover a cell to read the quote.">
        <div className="table-wrap">
          <table className="table stance-table">
            <thead>
              <tr>
                <th scope="col">Person</th>
                {m.topics.map((topic) => (
                  <th key={topic} scope="col">
                    {topic}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {people.map((person) => (
                <tr key={person}>
                  <th scope="row">
                    <span className="person">
                      <Avatar name={person} size="xs" />
                      {person}
                    </span>
                  </th>
                  {m.topics.map((topic) => {
                    const stance = latest(person, topic)
                    return (
                      <td key={topic}>
                        {stance ? (
                          <span title={`“${stance.quote}”`}>
                            <MeetingStanceBadge stance={stance.stance} />
                          </span>
                        ) : (
                          <span className="subtle">No stance</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="Extracted stances"
        description={
          m.extractedBy === 'heuristic'
            ? 'Extracted with a keyword heuristic in demo mode. Correct any wrong labels and mark the ones you have checked.'
            : `Extracted by ${providerLabel(m.extractedBy)}. Mark each stance verified once someone has checked it.`
        }
        actions={m.origin === 'sample' ? <Badge>Sample data</Badge> : undefined}
      >
        <ul className="stances">
          {m.stances.map((s) => (
            <li key={s.id} className="stance">
              <div className="stance-head">
                <span className="person">
                  <Avatar name={label(s)} size="sm" />
                  {label(s)}
                </span>
                <span className="subtle small">
                  on <strong>{s.topic}</strong>
                </span>
              </div>
              <blockquote className="stance-quote">“{s.quote}”</blockquote>
              <div className="stance-controls">
                <Select
                  aria-label={`Stance of ${label(s)} on ${s.topic}`}
                  value={s.stance}
                  onChange={(event) => update.mutate({ stanceId: s.id, stance: event.target.value as MeetingStanceValue })}
                >
                  {(Object.keys(MEETING_STANCE_LABEL) as MeetingStanceValue[]).map((value) => (
                    <option key={value} value={value}>
                      {MEETING_STANCE_LABEL[value]}
                    </option>
                  ))}
                </Select>
                <label className="check">
                  <input type="checkbox" checked={s.verified} onChange={(event) => update.mutate({ stanceId: s.id, verified: event.target.checked })} />
                  Verified
                </label>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Transcript">
        <details className="transcript-details">
          <summary>Show the full transcript</summary>
          <pre className="transcript">{m.transcript}</pre>
        </details>
      </Card>

      <ConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this meeting?"
        description="The transcript and its extracted stances are removed."
        confirmLabel="Delete meeting"
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  )
}
