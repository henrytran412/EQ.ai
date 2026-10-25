// Shared types for the chat API (names follow CLAUDE.md section 5) plus the demo-mode fallback.

// State set not final (backend may add e.g. "nervous"); the UI shows any string and styles unknown ones as neutral.
export type EmotionLabel = 'neutral' | 'confused' | 'frustrated' | 'distress' | (string & {})
export type Expression = 'neutral' | 'listening' | 'thinking' | 'happy' | 'concerned' | 'sad'
export type Mode = 'normal' | 'slow_rephrase' | 'confirm' | 'offer_handoff' | 'distress'

export type EmotionEstimate = { label: EmotionLabel; confidence: number }

export type ChatRequest = {
  session_id: string
  topic: string
  text: string
  history: { role: 'student' | 'assistant'; text: string }[] // previous turns, not including `text`
  awaiting_confirmation: boolean // last assistant turn asked "am I reading this right?"
}

export type ChatResponse = {
  reply: { text: string; citations: { title: string; url: string }[]; uncertainty?: string }
  tone: {
    state: EmotionLabel
    confidence: number
    ask_confirmation: boolean
    tts_params: { speed: number; emotion: string } // speed 1 = normal
    avatar_expression: Expression
  }
  behavior: { mode: Mode; offer_handoff: boolean }
}

const EXPRESSIONS: Expression[] = ['neutral', 'listening', 'thinking', 'happy', 'concerned', 'sad']

// Untrusted API data: the state set isn't final (e.g. "nervous"), so unknown values fall back instead of crashing.
export function normalizeResponse(data: any): ChatResponse {
  if (typeof data?.reply?.text !== 'string') throw new Error('chat API returned no reply text')
  const tone = data.tone ?? {}
  const speed = Number(tone.tts_params?.speed)
  return {
    reply: {
      text: data.reply.text,
      citations: Array.isArray(data.reply.citations) ? data.reply.citations.filter((c: any) => typeof c?.url === 'string' && /^https?:\/\//.test(c.url)) : [],
      uncertainty: typeof data.reply.uncertainty === 'string' ? data.reply.uncertainty : undefined,
    },
    tone: {
      state: typeof tone.state === 'string' ? tone.state : 'neutral',
      confidence: Number.isFinite(tone.confidence) ? Math.min(1, Math.max(0, tone.confidence)) : 0, // the model's number is unbounded
      ask_confirmation: tone.ask_confirmation === true,
      tts_params: { speed: speed >= 0.6 && speed <= 1.5 ? speed : 1, emotion: String(tone.tts_params?.emotion ?? 'neutral') },
      avatar_expression: EXPRESSIONS.includes(tone.avatar_expression) ? tone.avatar_expression : 'neutral',
    },
    behavior: { mode: data.behavior?.mode ?? 'normal', offer_handoff: data.behavior?.offer_handoff === true },
  }
}

export const TOPICS = [
  {
    id: 'financial_aid_hold',
    label: 'Financial aid hold',
    blurb: 'A hold is blocking my registration',
    followUp: 'Thanks for explaining. What does the hold message in your student portal say, and when is your deadline?',
    simple: 'Let me say that more simply. A hold is a block on your student account, and it can stop you from registering. What does the hold message say?',
  },
  {
    id: 'scholarships',
    label: 'Scholarships',
    blurb: 'Applying, eligibility, or a missing payment',
    followUp: 'Thanks. Which scholarship is this about, and what part is unclear?',
    simple: 'Let me slow down. Which scholarship is it, and what do you need to know?',
  },
  {
    id: 'visa_status',
    label: 'Visa status',
    blurb: 'I-20, enrollment, or status questions',
    followUp:
      "Thanks. I can share official information, but I can't give legal or immigration advice. For your own case, SJSU's international student office is the right place. What is your question about?",
    simple: 'Let me slow down. In a few words, what is your visa question about?',
  },
  {
    id: 'other',
    label: 'Something else',
    blurb: 'Another school problem',
    followUp: "Thanks. Can you tell me a bit more about what's going on?",
    simple: 'Let me slow down. In a few words, what do you need help with?',
  },
] as const

const DISTRESS = /\b(kill myself|suicid\w*|want to die|end my life|hurt myself|self[- ]harm|hopeless|can'?t go on)\b/i
const FRUSTRATED = /(frustrat|annoy|ridiculous|useless|waste|again|already|nobody|not working|doesn'?t work|ugh|seriously|angry|upset|stuck|!!)/gi
const CONFUSED = /(confus|don'?t understand|what does|what do you mean|huh|i'?m lost|not sure|explain|\?\?)/gi
const THANKS = /\b(thank|thanks|great|that helps|awesome|perfect|got it)\b/i
const YES = /\b(yes|yeah|yep|right|correct|i am)\b/i

const DEMO_LIMIT =
  "Thanks. I'm in demo mode, so I'm not connected to SJSU's official pages yet, and I won't guess the answer. A person can check this for you. Would you like me to connect you?"

// Rule-based text baseline (CLAUDE.md rule 3). The real estimate comes from the dialogue service.
export function estimateFromText(text: string): EmotionEstimate {
  if (DISTRESS.test(text)) return { label: 'distress', confidence: 0.9 }
  const frustrated = text.match(FRUSTRATED)?.length ?? 0
  const confused = text.match(CONFUSED)?.length ?? 0
  if (frustrated === 0 && confused === 0) return { label: 'neutral', confidence: 0.6 }
  const label = frustrated >= confused ? 'frustrated' : 'confused'
  return { label, confidence: Math.min(0.5 + 0.15 * Math.max(frustrated, confused), 0.9) }
}

function respond(
  text: string,
  est: EmotionEstimate,
  o: { mode?: Mode; offer?: boolean; ask?: boolean; expr?: Expression; speed?: number; uncertainty?: string } = {},
): ChatResponse {
  return {
    reply: { text, citations: [], uncertainty: o.uncertainty ?? 'Demo mode: no official sources connected.' },
    tone: {
      state: est.label,
      confidence: est.confidence,
      ask_confirmation: o.ask ?? false,
      tts_params: { speed: o.speed ?? 1, emotion: o.expr === 'happy' ? 'content' : 'calm' },
      avatar_expression: o.expr ?? 'neutral',
    },
    behavior: { mode: o.mode ?? 'normal', offer_handoff: o.offer ?? false },
  }
}

// Scripted stand-in for the dialogue service. Never states aid rules, eligibility, or deadlines.
export function demoRespond(req: ChatRequest): ChatResponse {
  const est = estimateFromText(req.text)
  const topic = TOPICS.find((t) => t.id === req.topic) ?? TOPICS[0]
  const earlierTurns = req.history.filter((t) => t.role === 'student').length

  if (est.label === 'distress')
    return respond(
      "I'm really sorry you're feeling this way. Let's pause the school questions. You can call or text 988 any time to reach the Suicide & Crisis Lifeline, and SJSU Counseling and Psychological Services can help too. Would you like me to connect you with a person now?",
      est,
      { mode: 'distress', offer: true, expr: 'concerned', speed: 0.9 },
    )
  if (req.awaiting_confirmation) {
    if (YES.test(req.text))
      return respond(
        "Thank you for telling me. I'm sorry this has been so stressful. Would you like me to connect you with a person? I'll pass along what you've told me, so you won't have to repeat it.",
        { label: 'frustrated', confidence: 0.95 },
        { mode: 'offer_handoff', offer: true, expr: 'concerned', speed: 0.95 },
      )
    return respond("Thanks for correcting me. Let's keep going. What would help most right now?", { label: 'neutral', confidence: 0.8 })
  }
  // Never act on the estimate alone: ask first (CLAUDE.md section 4).
  if (est.label === 'frustrated')
    return respond('It sounds like this has been frustrating. Am I reading that right?', est, {
      mode: 'confirm',
      ask: true,
      expr: 'concerned',
      speed: 0.95,
    })
  if (est.label === 'confused') return respond(topic.simple, est, { mode: 'slow_rephrase', speed: 0.85 })
  if (THANKS.test(req.text))
    return respond(`Glad that helps! Is there anything else about your ${topic.label.toLowerCase()}?`, est, { expr: 'happy' })
  if (earlierTurns === 0) return respond(topic.followUp, est)
  return respond(DEMO_LIMIT, est, { mode: 'offer_handoff', offer: true })
}
