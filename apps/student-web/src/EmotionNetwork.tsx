import { useState } from 'react'
import { BLENDS, NODES, activate, type Source } from './emotionMap'

type Props = { sources: Source[]; bot: string }
type Point = { x: number; y: number }
const W = 400
const H = 360
const pos = ([v, a]: [number, number]): Point => ({ x: W / 2 + v * 165, y: H / 2 - a * 145 })
const AT: Record<string, Point> = Object.fromEntries(
  [...Object.entries(NODES), ...Object.entries(BLENDS).map(([e, { at }]) => [e, at] as const)].map(([e, va]) => [e, pos(va)]),
)
// Label offsets are separate from the approximate valence/arousal coordinates.
const LABELS: Record<string, [number, number, 'start' | 'middle' | 'end']> = {
  neutral: [12, 17, 'start'], happy: [0, 23, 'middle'], surprise: [12, 0, 'start'],
  content: [0, 24, 'middle'], calm: [0, 24, 'middle'], anger: [-12, -8, 'end'],
  fear: [-12, 0, 'end'], nervous: [12, 3, 'start'], distress: [0, -17, 'middle'],
  frustrated: [-12, -9, 'end'], confused: [-12, 22, 'end'], disgust: [0, 24, 'middle'],
  sad: [0, 24, 'middle'], delight: [12, 3, 'start'], alarmed: [0, -14, 'middle'],
  overwhelmed: [12, 3, 'start'], despair: [12, 16, 'start'], discouraged: [12, 20, 'start'],
}
const LINKS = [
  ...Object.keys(NODES).filter((e) => e !== 'neutral').map((e) => ['neutral', e]),
  ...Object.entries(BLENDS).flatMap(([e, { of }]) => of.map((part) => [part, e])),
]
const curve = (a: Point, b: Point) => `M${a.x} ${a.y}Q${(a.x + b.x) / 2 + (b.y - a.y) * 0.15} ${(a.y + b.y) / 2 - (b.x - a.x) * 0.15} ${b.x} ${b.y}`

export default function EmotionNetwork({ sources, bot }: Props) {
  const [blends, setBlends] = useState(false)
  const lit = activate(sources)
  const level = (e: string) => lit[e]?.level ?? 0
  const yours = Object.keys(NODES).filter((e) => level(e) >= 0.3).map((e) => `${e} ${Math.round(level(e) * 100)}%`)
  const visible = (e: string) => blends || !BLENDS[e]

  return (
    <div className="emotion-network">
      <div className="map-toolbar">
        <div className="map-key">
          <span><i className="map-dot" /> Your signals</span>
          <span><i className="map-ring" /> Reply tone</span>
        </div>
        <button className="map-blends" type="button" aria-pressed={blends} onClick={() => setBlends(!blends)}>
          {blends ? 'Hide blends' : 'Show blends'}
        </button>
      </div>
      <svg className="network" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`Emotion map. Your estimates: ${yours.join(', ') || 'none yet'}. Reply tone: ${bot}. ${blends ? 'Blends shown.' : 'Core emotions shown.'}`}>
        <path d="M24 180H376M200 30V322" className="net-axis" />
        <text x="200" y="18" textAnchor="middle" className="net-axis-label">Higher energy</text>
        <text x="200" y="350" textAnchor="middle" className="net-axis-label">Lower energy</text>
        <text x="14" y="339" className="net-axis-label">Unpleasant</text>
        <text x="386" y="339" textAnchor="end" className="net-axis-label">Pleasant</text>
        {LINKS.filter(([, b]) => visible(b)).map(([a, b]) => (
          <g key={`${a}-${b}`}>
            <path d={curve(AT[a], AT[b])} className="net-link" />
            {level(b) >= 0.3 && <path d={curve(AT[a], AT[b])} className="net-signal" strokeOpacity={0.4 + level(b) * 0.6} />}
            {b === bot && <path d={curve(AT[a], AT[b])} className="net-response" />}
          </g>
        ))}
        {Object.entries(AT).filter(([e]) => visible(e)).map(([e, { x, y }]) => {
          const u = level(e)
          const active = u >= 0.3 || e === bot
          const [dx, dy, anchor] = LABELS[e]
          return (
            <g key={e}>
              <title>{`${e}${BLENDS[e] ? `: illustrative blend of ${BLENDS[e].of.join(' + ')}` : ''}${u ? `. Signals: ${lit[e].why}` : '. No signal'}${e === bot ? '. Current reply tone' : ''}`}</title>
              {u >= 0.3 && <circle cx={x} cy={y} r={14} className="net-halo" />}
              <circle cx={x} cy={y} r={BLENDS[e] ? 4 : 5} className={`net-node${BLENDS[e] ? ' blend' : ''}`} />
              {u > 0 && <circle cx={x} cy={y} r={4 + 2 * u} className="net-estimate" opacity={u} />}
              {e === bot && <circle cx={x} cy={y} r={10} className="net-tone" />}
              <text x={x + dx} y={y + dy} textAnchor={anchor} className={`net-label${active ? ' on' : ''}`}>{e}</text>
            </g>
          )
        })}
      </svg>
      <p className="map-caption">{blends ? 'Hollow nodes show illustrative blends, not measured classes.' : 'Position groups similar emotions. Lines connect related nodes.'}</p>
    </div>
  )
}
