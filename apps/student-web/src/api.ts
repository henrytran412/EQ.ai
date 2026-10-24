import { demoRespond, normalizeResponse, type ChatRequest, type ChatResponse } from './policy'

const API_URL: string = import.meta.env.VITE_API_URL ?? ''
export const isDemo = !API_URL

export async function askAssistant(req: ChatRequest): Promise<ChatResponse> {
  if (isDemo) {
    await new Promise((r) => setTimeout(r, 700)) // lets the "thinking" face show, like a real round trip
    return demoRespond(req)
  }
  const res = await fetch(`${API_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!res.ok) throw new Error(`chat API ${res.status}`)
  return normalizeResponse(await res.json())
}
