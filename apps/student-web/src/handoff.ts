import type { EmotionEstimate } from './policy'

// shortcut: BroadcastChannel only syncs tabs in the same browser; replace with SpacetimeDB handoffs table + subscription.
export type Handoff = {
  id: string
  student_name: string
  topic: string
  summary: string
  emotion?: EmotionEstimate // present only if the student agreed to share it
  status: 'waiting' | 'active' | 'resolved'
  staff_id?: string
  messages: { from: 'student' | 'staff'; text: string; at: number }[]
  created_at: number
}

const channel = new BroadcastChannel('eq-ai-handoffs')

const isHandoff = (h: unknown): h is Handoff =>
  typeof h === 'object' && h !== null &&
  typeof (h as Handoff).id === 'string' &&
  ['waiting', 'active', 'resolved'].includes((h as Handoff).status) &&
  Array.isArray((h as Handoff).messages)

// Whoever changes a handoff publishes the whole object; last write wins.
export const publish = (h: Handoff) => channel.postMessage({ type: 'handoff', handoff: h })
export const requestSync = () => channel.postMessage({ type: 'sync' })

export function subscribe(onHandoff: (h: Handoff) => void, onSync?: () => void): () => void {
  const listener = (e: MessageEvent) => {
    if (e.data?.type === 'handoff' && isHandoff(e.data.handoff)) onHandoff(e.data.handoff)
    if (e.data?.type === 'sync') onSync?.()
  }
  channel.addEventListener('message', listener)
  return () => channel.removeEventListener('message', listener)
}
