import type { QueryClient } from '@tanstack/react-query'
import { api } from './client'

// Query keys and fetchers here must match the hooks in ./hooks.ts so a prefetched result is reused as-is.
const ROUTE_QUERIES: Record<string, { queryKey: unknown[]; queryFn: () => Promise<unknown> }[]> = {
  '/': [{ queryKey: ['overview'], queryFn: api.overview }],
  '/research': [{ queryKey: ['questions'], queryFn: api.questions }],
  '/beliefs': [{ queryKey: ['beliefs'], queryFn: api.beliefs }],
  '/dead-ends': [{ queryKey: ['dead-ends'], queryFn: api.deadEnds }],
  '/library': [{ queryKey: ['papers', ''], queryFn: () => api.papers('') }],
  '/meetings': [{ queryKey: ['meetings'], queryFn: api.meetings }],
  '/providers': [
    { queryKey: ['providers'], queryFn: api.providers },
    { queryKey: ['routing'], queryFn: api.routing },
    { queryKey: ['usage', 14], queryFn: () => api.usage(14) },
    { queryKey: ['tasks', ''], queryFn: () => api.tasks('') },
  ],
}

/** Fetch a page's data before the user lands on it (on hover/focus of its link). Fresh cache entries are skipped. */
export function prefetchRoute(client: QueryClient, path: string) {
  const queries = ROUTE_QUERIES[path]
  if (!queries) return
  for (const query of queries) void client.prefetchQuery({ ...query, staleTime: 30_000 })
}

/** Warm every main page once the app has rendered, so first navigation is instant. */
export function warmAllRoutes(client: QueryClient) {
  const run = () => Object.keys(ROUTE_QUERIES).forEach((path) => prefetchRoute(client, path))
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback
  if (idle) idle(run)
  else window.setTimeout(run, 300)
}
