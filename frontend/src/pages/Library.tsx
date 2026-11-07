import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { LibraryBig, Plus, Search } from 'lucide-react'
import { api } from '../api/client'
import { useApiMutation, usePapers } from '../api/hooks'
import type { Paper } from '../api/types'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Field, Input, Select } from '../components/ui/Field'
import { Modal } from '../components/ui/Modal'
import { PageHeader } from '../components/ui/PageHeader'
import { EmptyState, ErrorState, SkeletonCard } from '../components/ui/States'
import { cx } from '../lib/cx'
import { formatAuthors, plural, timeAgo } from '../lib/format'
import { useDebounced } from '../lib/hooks'
import { useUI } from '../lib/ui'

type Sort = 'recent' | 'evidence' | 'year'

export function Library() {
  const [query, setQuery] = useState('')
  const debounced = useDebounced(query.trim(), 200)
  const papers = usePapers(debounced)
  const [sort, setSort] = useState<Sort>('recent')
  const [params, setParams] = useSearchParams()
  const addOpen = params.get('add') === '1'

  const updateParams = (change: (next: URLSearchParams) => void, replace = true) => {
    const next = new URLSearchParams(params)
    change(next)
    setParams(next, { replace })
  }
  const openPaper = (id: string) => updateParams((next) => next.set('paper', id), false)

  if (papers.isError) return <ErrorState error={papers.error} onRetry={() => papers.refetch()} />

  const sorted = [...(papers.data ?? [])].sort((a, b) => {
    if (sort === 'evidence') return b.claimCount + b.beliefCount * 2 - (a.claimCount + a.beliefCount * 2)
    if (sort === 'year') return (b.year ?? 0) - (a.year ?? 0)
    return b.addedAt.localeCompare(a.addedAt)
  })

  return (
    <div className="page">
      <PageHeader
        title="Library"
        description="Every paper the agent or your team has read, with the claims taken from it and the beliefs it supports."
        actions={
          <Button variant="primary" icon={<Plus />} onClick={() => updateParams((next) => next.set('add', '1'))}>
            Add paper
          </Button>
        }
      />

      <div className="toolbar">
        <label className="search-input search-input-wide">
          <Search aria-hidden />
          <input
            className="input"
            type="search"
            placeholder="Search titles, authors, abstracts or arXiv IDs"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search the library"
          />
        </label>
        <div className="toolbar-right">
          {papers.data && <span className="subtle small">{plural(sorted.length, 'paper')}</span>}
          <Select value={sort} onChange={(event) => setSort(event.target.value as Sort)} aria-label="Sort papers">
            <option value="recent">Recently added</option>
            <option value="evidence">Most used as evidence</option>
            <option value="year">Newest publication</option>
          </Select>
        </div>
      </div>

      {!papers.data ? (
        <SkeletonCard lines={6} />
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={<LibraryBig />}
          title={debounced ? 'No papers match that search' : 'The library is empty'}
          description={debounced ? 'Try fewer words, an author name, or an arXiv ID.' : 'Papers appear here as research runs read them.'}
        />
      ) : (
        <Card flush className={cx(papers.isPlaceholderData && 'is-refreshing')}>
          <div className="table-wrap">
            <table className="table table-hover">
              <thead>
                <tr>
                  <th scope="col">Paper</th>
                  <th scope="col" className="num">
                    Year
                  </th>
                  <th scope="col">Used as evidence</th>
                  <th scope="col">Added</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((p) => (
                  <tr key={p.id} onClick={() => openPaper(p.id)}>
                    <td>
                      <button
                        type="button"
                        className="table-title"
                        onClick={(event) => {
                          event.stopPropagation()
                          openPaper(p.id)
                        }}
                      >
                        {p.title}
                      </button>
                      <span className="table-sub">
                        {formatAuthors(p.authors, p.etAl)}
                        {p.arxivId && ` · arXiv:${p.arxivId}`}
                      </span>
                    </td>
                    <td className="num">{p.year ?? '—'}</td>
                    <td>
                      <span className="evidence-cell">
                        <span>{plural(p.claimCount, 'claim')}</span>
                        {p.beliefCount > 0 && <Badge tone="accent">{plural(p.beliefCount, 'belief')}</Badge>}
                      </span>
                    </td>
                    <td className="nowrap subtle">{timeAgo(p.addedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <AddPaperModal
        open={addOpen}
        onClose={() => updateParams((next) => next.delete('add'))}
        onAdded={(paper) =>
          updateParams((next) => {
            next.delete('add')
            next.set('paper', paper.id)
          })
        }
      />
    </div>
  )
}

function AddPaperModal({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (paper: Paper) => void }) {
  const [ref, setRef] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { toast } = useUI()
  const add = useApiMutation((value: string) => api.addPaper(value))

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (ref.trim().length < 4) {
      setError('Paste an arXiv ID or link.')
      return
    }
    add.mutate(ref.trim(), {
      onSuccess: (paper) => {
        toast('Paper added to the library', { description: paper.title })
        setRef('')
        setError(null)
        onAdded(paper)
      },
      onError: (err) => setError(err.message),
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a paper"
      description="Paste an arXiv ID or link. The title, authors and abstract are fetched from arXiv."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="add-paper-form" loading={add.isPending}>
            Add paper
          </Button>
        </>
      }
    >
      <form id="add-paper-form" className="form" onSubmit={submit}>
        <Field label="arXiv ID or URL" htmlFor="paper-ref" error={error} hint="For example 2309.06180 or https://arxiv.org/abs/2309.06180">
          <Input id="paper-ref" data-autofocus value={ref} onChange={(event) => setRef(event.target.value)} autoComplete="off" spellCheck={false} />
        </Field>
      </form>
    </Modal>
  )
}
