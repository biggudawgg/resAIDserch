import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { EmptyState } from '../components/ui/States'

export function NotFound() {
  return (
    <div className="page">
      <EmptyState
        icon={<Compass />}
        title="Page not found"
        description="That address doesn't match anything in Hindsight."
        action={
          <Link className="btn btn-primary btn-md" to="/">
            Back to overview
          </Link>
        }
      />
    </div>
  )
}
