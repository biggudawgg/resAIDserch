import { useCallback } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from './client'

const LIVE = 1500
const IDLE = 15000

export function useWorkspace() {
  return useQuery({ queryKey: ['workspace'], queryFn: api.workspace, staleTime: 30000 })
}

export function useOverview() {
  return useQuery({
    queryKey: ['overview'],
    queryFn: api.overview,
    refetchInterval: (query) => (query.state.data?.running.length ? LIVE : IDLE),
  })
}

export function useQuestions() {
  return useQuery({
    queryKey: ['questions'],
    queryFn: api.questions,
    refetchInterval: (query) => (query.state.data?.some((q) => q.status === 'running') ? LIVE : IDLE),
  })
}

export function useQuestion(id: string | undefined) {
  return useQuery({
    queryKey: ['question', id],
    queryFn: () => api.question(id as string),
    enabled: Boolean(id),
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 1000 : false),
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 1,
  })
}

export function useBeliefs() {
  return useQuery({ queryKey: ['beliefs'], queryFn: api.beliefs })
}

export function useDeadEnds() {
  return useQuery({ queryKey: ['dead-ends'], queryFn: api.deadEnds })
}

export function usePapers(q: string) {
  return useQuery({ queryKey: ['papers', q], queryFn: () => api.papers(q), placeholderData: keepPreviousData })
}

export function usePaper(id: string | null) {
  return useQuery({ queryKey: ['paper', id], queryFn: () => api.paper(id as string), enabled: Boolean(id) })
}

export function useMeetings() {
  return useQuery({ queryKey: ['meetings'], queryFn: api.meetings })
}

export function useMeeting(id: string | undefined) {
  return useQuery({
    queryKey: ['meeting', id],
    queryFn: () => api.meeting(id as string),
    enabled: Boolean(id),
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 1,
  })
}

export function useProviders() {
  return useQuery({ queryKey: ['providers'], queryFn: api.providers })
}

export function useRouting() {
  return useQuery({ queryKey: ['routing'], queryFn: api.routing })
}

export function useUsage(days: number) {
  return useQuery({ queryKey: ['usage', days], queryFn: () => api.usage(days), placeholderData: keepPreviousData })
}

export function useTasks(provider: string) {
  return useQuery({ queryKey: ['tasks', provider], queryFn: () => api.tasks(provider), placeholderData: keepPreviousData })
}

export function useSearch(q: string) {
  return useQuery({
    queryKey: ['search', q],
    queryFn: () => api.search(q),
    enabled: q.trim().length >= 2,
    placeholderData: keepPreviousData,
  })
}

/** A mutation that refreshes every mounted query afterwards, so all views stay consistent. */
export function useApiMutation<TVars = void, TData = unknown>(fn: (vars: TVars) => Promise<TData>) {
  const qc = useQueryClient()
  return useMutation<TData, ApiError, TVars>({ mutationFn: fn, onSuccess: () => qc.invalidateQueries() })
}

export function useMemberName() {
  const ws = useWorkspace()
  return useCallback(
    (id: string | null | undefined) => {
      if (!id) return 'Unknown'
      if (id === 'agent') return 'Research agent'
      return ws.data?.members.find((m) => m.id === id)?.name ?? 'Former member'
    },
    [ws.data],
  )
}
