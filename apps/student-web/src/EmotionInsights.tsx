import EmotionNetwork from './EmotionNetwork'
import type { Source } from './emotionMap'
import type { EmotionEstimate } from './policy'
import type { Estimate } from './perception'

type Props = {
  sources: Source[]
  estimates: EmotionEstimate[]
  tone: { emotion: string; speed: number }
  cameraOn: boolean
  voiceOn: boolean
  service: 'unconfigured' | 'connected' | 'disconnected'
  demo: boolean
  withPerson: boolean
  face: Estimate | null
  voice: Estimate | null
}
const percent = (n: number) => `${Math.round(Math.max(0, Math.min(1, n)) * 100)}%`

export default function EmotionInsights({ sources, estimates, tone, cameraOn, voiceOn, service, demo, withPerson, face, voice }: Props) {
  const latest = estimates.at(-1)
  const speed = tone.speed < 0.97 ? 'Slower pace' : tone.speed > 1.03 ? 'Faster pace' : 'Normal pace'
  const empty = (label: string) => {
    if (label === 'final') return 'After your first message'
    if (label === 'face' && !cameraOn) return 'Camera is off'
    if (label === 'voice' && !voiceOn) return 'Text input selected'
    if (service !== 'connected') return 'Service unavailable'
    return label === 'voice' ? 'While you speak' : 'Waiting for a face'
  }
  return (
    <>
      <div className="insight-heading">
        <div><h2 id="emotion-title">Emotion map</h2><p>What the signals suggest, not how you must feel.</p></div>
        <span className="estimate-label">Estimates only</span>
      </div>
      <div className="signal-summary">
        <div><span><i className="map-dot" /> Final state prediction</span><strong data-empty={!latest || undefined}>{latest?.label ?? 'No prediction yet'}</strong>
          <small>{latest ? `${percent(latest.confidence)} model confidence${demo ? ' · scripted demo' : ''}` : 'Start chatting to see an estimate'}</small></div>
        <div><span><i className="map-ring" /> {withPerson ? 'Last assistant tone' : 'Assistant reply tone'}</span><strong>{tone.emotion}</strong><small>{speed} · {tone.speed.toFixed(2)}×</small></div>
      </div>
      <section className="signal-section" aria-labelledby="signals-title">
        <div className="insight-section-heading"><h3 id="signals-title">Face &amp; voice confidence</h3><span>Latest reading</span></div>
        <div className="signal-rows">
          {['face', 'voice'].map((label) => {
            const prediction = label === 'face' ? face : voice
            const name = label === 'voice' ? 'Voice' : 'Face'
            return <div className="signal-row" key={label} data-source={label}>
              <span className={`signal-indicator${prediction ? ' available' : ''}`} aria-hidden="true" />
              <span>{name}</span>
              <span className="signal-value">{prediction ? <><span>{prediction.label}</span><strong>{percent(prediction.confidence)}</strong></> : <small>{empty(label)}</small>}</span>
            </div>
          })}
        </div>
      </section>
      <EmotionNetwork sources={sources} bot={tone.emotion} />
      <p className="confidence-note">Confidence is the model’s estimate, not measured accuracy.{demo ? ' Final state uses scripted text rules in demo mode, not face/voice fusion.' : ''}</p>
      {estimates.length > 0 && <section className="estimate-history" aria-labelledby="history-title">
        <div className="insight-section-heading"><h3 id="history-title">Recent conversation</h3><span>Last {Math.min(5, estimates.length)} {estimates.length === 1 ? 'turn' : 'turns'}</span></div>
        <ol>{estimates.slice(-5).map((e, i) => <li key={estimates.length - Math.min(5, estimates.length) + i}>
          <span>Turn {Math.max(0, estimates.length - 5) + i + 1}</span><strong>{e.label}</strong><span>{percent(e.confidence)}</span>
        </li>)}</ol>
      </section>}
      <details className="map-explainer">
        <summary>How to read this map</summary>
        <p>Left to right: unpleasant to pleasant. Bottom to top: lower to higher energy. Positions are approximate, not a brain scan or a diagnosis.</p>
        <p>Pink dots show estimated signals; blue rings show the assistant’s reply tone. Brightness uses the strongest available signal, not a combined probability. Blends are illustrative connections.</p>
        <p>Confidence is not accuracy. Estimates can be wrong, especially across accents and contexts. You can correct the assistant in the chat.</p>
        <p>EQ.ai emotion service: <strong>{service === 'unconfigured' ? 'not configured' : service === 'connected' ? 'connected' : 'not connected'}</strong>. Camera is optional; raw video is not stored.</p>
      </details>
    </>
  )
}
