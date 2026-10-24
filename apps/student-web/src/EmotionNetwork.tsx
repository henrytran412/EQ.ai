import { BLENDS, NODES, activate, type Source } from './emotionMap'

// Valence/arousal map drawn as a neuron-style network. The lines are structure (what a blend is made of, distance
// from neutral); only the glow is data: pink = the student's estimate, blue = the bear's voice tone.
type Props = { sources: Source[]; bot: string }
type P = { x: number; y: number }

const W = 360
const H = 320
const S = 135
const pos = ([v, a]: [number, number]): P => ({ x: W / 2 + v * S, y: H / 2 - a * S })
const AT: Record<string, P> = Object.fromEntries(
  [...Object.entries(NODES), ...Object.entries(BLENDS).map(([b, { at }]) => [b, at] as const)].map(([e, va]) => [e, pos(va)]),
)
// [from, to]: spokes from neutral to each emotion, and from each part to its blend. A link lights with its `to`.
const LINKS = [
  ...Object.keys(NODES).filter((e) => e !== 'neutral').map((e) => ['neutral', e]),
  ...Object.entries(BLENDS).flatMap(([b, { of }]) => of.map((p) => [p, b])),
]
const curve = (a: P, b: P) => `M${a.x} ${a.y}Q${(a.x + b.x) / 2 + (b.y - a.y) * 0.15} ${(a.y + b.y) / 2 - (b.x - a.x) * 0.15} ${b.x} ${b.y}`
const pct = (n: number) => `${Math.round(n * 100)}%`

export default function EmotionNetwork({ sources, bot }: Props) {
  const lit = activate(sources)
  const you = (e: string) => lit[e]?.level ?? 0
  const bear = (e: string) => (e === bot ? 1 : 0)
  const strongest = Object.keys(lit).sort((a, b) => you(b) - you(a))[0]
  const yours = Object.keys(lit).filter((e) => you(e) >= 0.3).map((e) => `${e} ${pct(you(e))}`)
  const summary = `Emotion map. You: ${yours.join(', ') || 'no clear estimate yet'}. Bear's voice: ${bot}.`

  return (
    <svg className="network" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary}>
      <defs>
        <filter id="net-glow" x="-1" y="-1" width="3" height="3">
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>
      <path d={`M20 ${H / 2}H${W - 20}M${W / 2} 20V${H - 20}`} className="net-axis" />
      <text x={W / 2} y={13} textAnchor="middle" className="net-axis-label">high energy</text>
      <text x={W / 2} y={H - 6} textAnchor="middle" className="net-axis-label">low energy</text>
      <text transform={`translate(12 ${H / 2}) rotate(-90)`} textAnchor="middle" className="net-axis-label">unpleasant</text>
      <text transform={`translate(${W - 12} ${H / 2}) rotate(90)`} textAnchor="middle" className="net-axis-label">pleasant</text>

      {LINKS.map(([a, b]) => {
        const d = curve(AT[a], AT[b])
        return (
          <g key={`${a}-${b}`}>
            <path d={d} className="net-link" />
            {you(b) > 0 && (
              <path d={d} className={`net-lit you${you(b) >= 0.3 ? ' flow' : ''}`} strokeOpacity={you(b)} strokeWidth={1 + 2 * you(b)} />
            )}
            {bear(b) > 0 && <path d={d} className="net-lit bear flow" strokeWidth={2} />}
          </g>
        )
      })}

      {Object.entries(AT).map(([e, { x, y }]) => {
        const u = you(e)
        const t = bear(e)
        const blend = BLENDS[e]
        return (
          <g key={e}>
            <title>
              {`${e}${blend ? ` (blend of ${blend.of.join(' + ')})` : ''}${u ? `. You: ${pct(u)} (${lit[e].why})` : ''}${t ? ". The bear's voice" : ''}`}
            </title>
            {u > 0 && <circle cx={x} cy={y} r={8 + 10 * u} className="net-glow you" opacity={u} filter="url(#net-glow)" />}
            {t > 0 && <circle cx={x} cy={y} r={14} className="net-glow bear" filter="url(#net-glow)" />}
            {e === strongest && u >= 0.3 && <circle cx={x} cy={y} r={12} className="net-pulse you" />}
            {t > 0 && <circle cx={x} cy={y} r={12} className="net-pulse bear" />}
            <circle cx={x} cy={y} r={blend ? 3.5 : 4.5} className={`net-node${blend ? ' blend' : ''}`} />
            {u > 0 && <circle cx={x} cy={y} r={3 + 3 * u} className="net-core you" opacity={u} />}
            {t > 0 && <circle cx={x} cy={y} r={5} className="net-core bear" />}
            <text x={x} y={y + 17} textAnchor="middle" className={`net-label${u >= 0.3 || t ? ' on' : ''}`}>
              {e}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
