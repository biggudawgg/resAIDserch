import { Link } from 'react-router-dom'
import { useMemberName } from '../api/hooks'
import type { Activity } from '../api/types'
import { formatDateTime, timeAgo } from '../lib/format'
import { linkPath } from '../lib/links'
import { Avatar } from './ui/Avatar'

const LINK_TEXT = { question: 'Question', belief: 'Belief', dead_end: 'Dead end', paper: 'Paper', meeting: 'Meeting' }

export function ActivityFeed({ items }: { items: Activity[] }) {
  const nameOf = useMemberName()
  return (
    <ol className="feed">
      {items.map((item) => {
        const name = nameOf(item.actor)
        return (
          <li key={item.id} className="feed-item">
            <Avatar name={name} size="sm" agent={item.actor === 'agent'} />
            <div className="feed-body">
              <p className="feed-text">
                <strong>{name}</strong> {item.text}
              </p>
              <p className="feed-meta">
                <time dateTime={item.at} title={formatDateTime(item.at)}>
                  {timeAgo(item.at)}
                </time>
                {item.link && (
                  <>
                    <span aria-hidden> · </span>
                    <Link to={linkPath(item.link.type, item.link.id)}>Open {LINK_TEXT[item.link.type].toLowerCase()}</Link>
                  </>
                )}
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
