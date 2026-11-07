import type { LinkType } from '../api/types'

export function linkPath(type: LinkType, id: string): string {
  switch (type) {
    case 'question':
      return `/research/${id}`
    case 'belief':
      return `/beliefs?focus=${id}`
    case 'dead_end':
      return `/dead-ends?focus=${id}`
    case 'meeting':
      return `/meetings/${id}`
    case 'paper':
      return `/library?paper=${id}`
  }
}
