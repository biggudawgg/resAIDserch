import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import type { Belief, DeadEnd } from '../../api/types'
import { pct, plural } from '../../lib/format'
import { CardStack, type StackItem } from '../ui/CardStack'

interface ReviewItem extends StackItem {
  to: string
}

/** Drafts waiting for a decision, as a deck: throw a card to see the next, tap the top one to review it. */
export function ReviewDeck({ beliefs, deadEnds }: { beliefs: Belief[]; deadEnds: DeadEnd[] }) {
  const navigate = useNavigate()

  const items = useMemo<ReviewItem[]>(
    () => [
      ...beliefs.map((b) => ({
        id: `belief-${b.id}`,
        label: `Draft belief: ${b.statement}. Open to review`,
        to: b.questionId ? `/research/${b.questionId}` : `/beliefs?focus=${b.id}`,
        content: (
          <>
            <span className="rcard-kind is-belief">
              <span>Draft belief</span>
              <span>{pct(b.confidence)} confident</span>
            </span>
            <span className="rcard-title">{b.statement}</span>
            {b.question && <span className="rcard-body">From “{b.question.question}”</span>}
            <span className="rcard-foot">
              <span>{plural(b.sourcePapers.length, 'source')}</span>
              <span className="rcard-open">
                Open to review <ArrowRight aria-hidden />
              </span>
            </span>
          </>
        ),
      })),
      ...deadEnds.map((d) => ({
        id: `deadend-${d.id}`,
        label: `Proposed dead end: ${d.title}. Open to review`,
        to: d.questionId ? `/research/${d.questionId}` : `/dead-ends?focus=${d.id}`,
        content: (
          <>
            <span className="rcard-kind is-deadend">
              <span>Proposed dead end</span>
            </span>
            <span className="rcard-title">{d.title}</span>
            <span className="rcard-body">{d.reason}</span>
            <span className="rcard-foot">
              <span>{plural(d.papers.length, 'paper')}</span>
              <span className="rcard-open">
                Open to review <ArrowRight aria-hidden />
              </span>
            </span>
          </>
        ),
      })),
    ],
    [beliefs, deadEnds],
  )

  return (
    <CardStack
      items={items}
      label="Drafts waiting for review. Drag a card away or use the arrow keys to see the next; open the top card to review it."
      onOpen={(item) => navigate((item as ReviewItem).to)}
    />
  )
}
