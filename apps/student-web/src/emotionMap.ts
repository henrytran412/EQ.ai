// Emotion map layout: valence (x, unpleasant → pleasant) and arousal (y, low → high energy), both -1..1.
// Placed approximately after Russell's circumplex of affect (1980), nudged apart so labels stay readable.
// Labels match the face/voice models, the dialogue states, and the bear's voice tones.
export const NODES: Record<string, [number, number]> = {
  neutral: [0, 0],
  happy: [0.88, 0.22],
  surprise: [0.25, 0.88],
  content: [0.8, -0.4],
  calm: [0.36, -0.8],
  anger: [-0.22, 0.9],
  fear: [-0.56, 0.74],
  nervous: [-0.06, 0.3],
  distress: [-0.88, 0.48],
  frustrated: [-0.68, 0.24],
  confused: [-0.36, 0.1],
  disgust: [-0.9, -0.08],
  sad: [-0.62, -0.68],
}

// Blends of two emotions, placed where the blend itself sits. They light up only when both parts are present.
export const BLENDS: Record<string, { at: [number, number]; of: [string, string] }> = {
  delight: { at: [0.6, 0.6], of: ['happy', 'surprise'] },
  alarmed: { at: [0, 0.6], of: ['fear', 'surprise'] },
  overwhelmed: { at: [-0.42, 0.46], of: ['confused', 'fear'] },
  despair: { at: [-0.7, -0.32], of: ['fear', 'sad'] },
  discouraged: { at: [-0.26, -0.44], of: ['frustrated', 'sad'] },
}

export type Source = { label: string; probs: Record<string, number> | null }
export type Lit = Record<string, { level: number; why: string }>

// An emotion's level is its strongest report across sources; a blend's is the geometric mean of its two parts.
export function activate(sources: Source[]): Lit {
  const lit: Lit = {}
  for (const s of sources)
    for (const [e, p] of Object.entries(s.probs ?? {})) {
      if (!(e in NODES) || !(p > 0)) continue
      const level = Math.min(1, p)
      const prev = lit[e]
      const why = `${s.label} ${Math.round(level * 100)}%`
      lit[e] = { level: Math.max(prev?.level ?? 0, level), why: prev ? `${prev.why}, ${why}` : why }
    }
  for (const [b, { of: [x, y] }] of Object.entries(BLENDS)) {
    const level = Math.sqrt((lit[x]?.level ?? 0) * (lit[y]?.level ?? 0))
    if (level > 0) lit[b] = { level, why: `${x} + ${y}` }
  }
  return lit
}
