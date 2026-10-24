import type { CSSProperties } from 'react'
import type { Expression } from './policy'

// Every mouth is "M Q Q" so the browser can morph between them (CSS `d` transition).
const MOUTH: Record<Expression, string> = {
  neutral: 'M90 145 Q95 151 100 146 Q105 151 110 145',
  listening: 'M93 145 Q96.5 149 100 146 Q103.5 149 107 145',
  thinking: 'M93 148 Q97 147 100 147 Q104 147 108 145',
  happy: 'M86 143 Q93 158 100 148 Q107 158 114 143',
  concerned: 'M90 149 Q95 144 100 149 Q105 154 110 149',
  sad: 'M89 153 Q94.5 144 100 146 Q105.5 144 111 153',
}
// [left brow, right brow]; brows sit still on a neutral face so emotion reads from their tilt.
const BROWS: Record<Expression, [string, string]> = {
  neutral: ['none', 'none'],
  listening: ['translateY(-2px)', 'translateY(-2px)'],
  thinking: ['none', 'translateY(-4px) rotate(-8deg)'],
  happy: ['translateY(-3px)', 'translateY(-3px)'],
  concerned: ['rotate(-14deg)', 'rotate(14deg)'],
  sad: ['translateY(-1px) rotate(-22deg)', 'translateY(-1px) rotate(22deg)'],
}
const EYES: Partial<Record<Expression, string>> = {
  thinking: 'translate(3px, -4px)',
  sad: 'translateY(3px)',
  listening: 'scale(1.08)',
}
const LABEL: Record<Expression, string> = {
  neutral: 'calm',
  listening: 'listening',
  thinking: 'thinking',
  happy: 'smiling',
  concerned: 'concerned',
  sad: 'sorry',
}

type Props = { expression: Expression; speaking?: boolean; listening?: boolean }

export default function Bear({ expression, speaking = false, listening = false }: Props) {
  const happy = expression === 'happy'
  const [browL, browR] = BROWS[expression]
  return (
    <svg className="bear" viewBox="0 0 200 200" role="img" aria-label={`Assistant bear, ${LABEL[expression]}`}>
      {listening && <circle className="bear-ring" cx="100" cy="112" r="92" />}
      <g className="bear-body">
        <circle cx="48" cy="58" r="24" fill="var(--bear-fur)" />
        <circle cx="152" cy="58" r="24" fill="var(--bear-fur)" />
        <circle cx="48" cy="58" r="12" fill="var(--bear-inner)" />
        <circle cx="152" cy="58" r="12" fill="var(--bear-inner)" />
        <ellipse cx="100" cy="114" rx="76" ry="70" fill="var(--bear-fur)" />

        <g className="bear-blush" style={{ opacity: happy ? 0.85 : 0.45 }}>
          <ellipse cx="56" cy="130" rx="11" ry="7" fill="var(--bear-blush)" />
          <ellipse cx="144" cy="130" rx="11" ry="7" fill="var(--bear-blush)" />
        </g>
        <ellipse cx="100" cy="138" rx="30" ry="22" fill="var(--bear-muzzle)" />

        {happy ? (
          <g fill="none" stroke="var(--espresso)" strokeWidth="4.5" strokeLinecap="round">
            <path d="M63 106 Q72 96 81 106" />
            <path d="M119 106 Q128 96 137 106" />
          </g>
        ) : (
          <g className="bear-eyes" style={{ transform: EYES[expression] ?? 'none' }}>
            {[72, 128].map((x) => (
              <g key={x}>
                <circle cx={x} cy="104" r="9" fill="var(--espresso)" />
                <circle cx={x - 3} cy="100.5" r="3.2" fill="#fff" />
                <circle cx={x + 3} cy="107" r="1.4" fill="#fff" opacity="0.8" />
              </g>
            ))}
          </g>
        )}

        <g stroke="var(--espresso)" strokeWidth="3.5" strokeLinecap="round" opacity="0.55">
          <line className="bear-brow" x1="66" y1="86" x2="78" y2="86" style={{ transform: browL }} />
          <line className="bear-brow" x1="122" y1="86" x2="134" y2="86" style={{ transform: browR }} />
        </g>

        <ellipse cx="100" cy="130" rx="9" ry="6.5" fill="var(--espresso)" />
        <ellipse cx="97" cy="128" rx="3" ry="1.8" fill="#fff" opacity="0.55" />

        {speaking ? (
          <ellipse className="bear-talk" cx="100" cy="148" rx="7" ry="6" fill="var(--espresso)" />
        ) : (
          <path
            className="bear-mouth"
            d={MOUTH[expression]}
            style={{ d: `path('${MOUTH[expression]}')` } as CSSProperties}
            fill="none"
            stroke="var(--espresso)"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {expression === 'sad' && <path className="bear-tear" d="M64 114 Q59 122 64 126 Q69 122 64 114Z" fill="var(--bear-tear)" />}
      </g>
    </svg>
  )
}
