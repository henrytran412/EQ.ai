import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import Bear from './Bear'
import { FACE_EMOTIONS, FACE_MODEL, MODELS, RESULTS_DATE, VOICE_EMOTIONS, VOICE_MODEL, percent, type EmotionResult } from './trainingResults'
import './landing.css'

const PANELS = ['Model comparison', 'Face emotions', 'Voice emotions'] as const

// Content is visible by default; the observer only adds a short, one-time entrance.
function useReveal() {
  const root = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!('IntersectionObserver' in window)) return
    const io = new IntersectionObserver((entries) => {
      entries.forEach(({ target, isIntersecting }) => {
        if (!isIntersecting) return
        target.setAttribute('data-arrived', '')
        io.unobserve(target)
      })
    }, { threshold: 0.08 })
    root.current?.querySelectorAll('[data-reveal]').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])
  return root
}

function Arrow({ back = false }: { back?: boolean }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d={back ? 'M19 12H5m6-6-6 6 6 6' : 'M5 12h14m-6-6 6 6-6 6'} />
  </svg>
}

function ConversationPreview() {
  const [gentle, setGentle] = useState(false)
  return (
    <div className="conversation-preview" data-ui aria-label="Interactive tone preview">
      <div className="preview-top"><span>Meet your study-side bear.</span><span>EQ.ai</span></div>
      <div className="preview-bear"><Bear expression={gentle ? 'concerned' : 'happy'} /></div>
      <div className="preview-dialogue">
        <p className="preview-student">“There’s a hold. I don’t know where to start.”</p>
        <div className="preview-response" aria-live="polite">
          <p className={gentle ? 'is-current' : ''} aria-hidden={!gentle}>We can take this one step at a time. What does the hold say?</p>
          <p className={!gentle ? 'is-current' : ''} aria-hidden={gentle}>Let’s look at it together. What does the hold in your account say?</p>
        </div>
      </div>
      <div className="preview-bottom">
        <span>Example conversation</span>
        <button type="button" className="tone-preview-button" aria-pressed={gentle} onClick={() => setGentle((value) => !value)}>
          {gentle ? 'Back to regular pace' : 'Try a gentler tone'} <Arrow />
        </button>
      </div>
    </div>
  )
}

function EmotionTable({ rows, modality }: { rows: EmotionResult[]; modality: 'Face' | 'Voice' }) {
  return (
    <table className="metrics-table emotion-table">
      <caption className="sr-only">{modality} emotion classification: Kaggle held-out test, F1 and recall</caption>
      <thead><tr><th scope="col">Emotion</th><th scope="col">F1</th><th scope="col">Recall</th><th scope="col">Samples</th></tr></thead>
      <tbody>{rows.map((row) => (
        <tr key={row.emotion}>
          <th scope="row">{row.emotion}</th>
          <td><span className="f1-cell"><span className="f1-track" aria-hidden="true"><span style={{ transform: `scaleX(${row.f1})` }} /></span>{percent(row.f1)}</span></td>
          <td>{percent(row.recall)}</td><td>{row.support.toLocaleString('en-US')}</td>
        </tr>
      ))}</tbody>
    </table>
  )
}

function ResultsCarousel() {
  const viewport = useRef<HTMLDivElement>(null)
  const activeRef = useRef(0)
  const frame = useRef(0)
  const drag = useRef<{ id: number; x: number; scroll: number; moved: boolean } | null>(null)
  const [active, setActive] = useState(0)
  const [basis, setBasis] = useState<'onnx' | 'kaggle'>('onnx')

  function goTo(index: number, instant = false) {
    const el = viewport.current
    if (!el) return
    const target = Math.max(0, Math.min(PANELS.length - 1, index))
    const slide = el.children[target] as HTMLElement
    el.scrollTo({
      left: slide.offsetLeft - (el.children[0] as HTMLElement).offsetLeft,
      behavior: instant || window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    })
  }

  function onScroll() {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const el = viewport.current
      if (!el) return
      const index = Math.max(0, Math.min(PANELS.length - 1, Math.round(el.scrollLeft / el.clientWidth)))
      activeRef.current = index
      setActive(index)
    })
  }

  useEffect(() => {
    const el = viewport.current
    if (!el) return
    const observer = new ResizeObserver(() => goTo(activeRef.current, true))
    observer.observe(el)
    return () => { observer.disconnect(); cancelAnimationFrame(frame.current) }
  }, [])

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return
    const index = event.key === 'ArrowRight' ? active + 1 : event.key === 'ArrowLeft' ? active - 1
      : event.key === 'Home' ? 0 : event.key === 'End' ? PANELS.length - 1 : null
    if (index === null) return
    event.preventDefault()
    goTo(index, true)
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    // Touch and trackpads keep native scrolling, momentum, and vertical page movement.
    if (event.pointerType !== 'mouse' || event.button !== 0 || !event.isPrimary ||
      (event.target as Element).closest('button, a, input, summary')) return
    drag.current = { id: event.pointerId, x: event.clientX, scroll: event.currentTarget.scrollLeft, moved: false }
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current
    if (!current || current.id !== event.pointerId) return
    const distance = event.clientX - current.x
    if (!current.moved && Math.abs(distance) < 6) return
    current.moved = true
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.dataset.dragging = ''
    event.currentTarget.scrollLeft = current.scroll - distance
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current
    if (!current || current.id !== event.pointerId) return
    drag.current = null
    const el = event.currentTarget
    if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId)
    delete el.dataset.dragging
    if (current.moved) goTo(Math.round(el.scrollLeft / el.clientWidth))
  }

  return (
    <div className="results-carousel" role="region" aria-roledescription="carousel" aria-label="Training results">
      <div className="results-toolbar">
        <div className="results-selectors" role="group" aria-label="Choose a results panel">
          {PANELS.map((label, i) => <button key={label} type="button" aria-pressed={active === i}
            aria-controls={`results-panel-${i}`} onClick={(event) => goTo(i, event.detail === 0)}>{label}</button>)}
        </div>
        <div className="results-arrows">
          <button className="round-control" type="button" aria-label="Previous results panel" disabled={active === 0}
            onClick={(event) => goTo(active - 1, event.detail === 0)}><Arrow back /></button>
          <button className="round-control" type="button" aria-label="Next results panel" disabled={active === PANELS.length - 1}
            onClick={(event) => goTo(active + 1, event.detail === 0)}><Arrow /></button>
        </div>
      </div>

      <div ref={viewport} className="results-viewport" tabIndex={0} aria-label="Swipe results, or use left and right arrow keys"
        onScroll={onScroll} onKeyDown={onKeyDown} onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}
        onPointerLeave={(event) => { if (drag.current && !drag.current.moved) drag.current = null; if (event.buttons === 0) endDrag(event) }}>
        <article className="results-slide" id="results-panel-0" role="group" aria-roledescription="slide" aria-label="1 of 3: Model comparison" data-ui>
          <div className="results-slide-intro">
            <h3>Models, side by side.</h3>
            <p>Same test set within each modality. Selected on validation, then evaluated on held-out data.</p>
            <div className="evaluation-switch" role="group" aria-label="Evaluation method">
              <button type="button" aria-pressed={basis === 'onnx'} onClick={() => setBasis('onnx')}>Deployed ONNX</button>
              <button type="button" aria-pressed={basis === 'kaggle'} onClick={() => setBasis('kaggle')}>Kaggle test</button>
            </div>
            <p className="evaluation-caption">{basis === 'onnx'
              ? 'Local re-score of the exported models. Face uses a single image view, as deployed.'
              : 'Training-run evaluation. Face uses original + flipped images; voice uses the recorded test pipeline.'}</p>
          </div>
          <div className="comparison-content">
            <table className="metrics-table comparison-table">
              <caption className="sr-only">{basis === 'onnx' ? 'Deployed ONNX' : 'Kaggle test'} accuracy and macro-F1</caption>
              <thead><tr><th scope="col">Model</th><th scope="col">Accuracy</th><th scope="col">Macro-F1</th></tr></thead>
              <tbody>{MODELS.map((model) => <tr key={model.id} className={model.role === 'Selected model' ? 'selected-model' : ''}>
                <th scope="row"><span>{model.name}</span><small>{model.modality} · {model.role}</small></th>
                <td>{percent(model[basis].accuracy)}</td><td>{percent(model[basis].macroF1)}</td>
              </tr>)}</tbody>
            </table>
            <p className="table-footnote">Face: 2,395 images. Voice: 208 clips. Different datasets; face and voice scores are not a head-to-head comparison.</p>
          </div>
        </article>

        <article className="results-slide" id="results-panel-1" role="group" aria-roledescription="slide" aria-label="2 of 3: Face emotions" data-ui>
          <div className="results-slide-intro">
            <h3>A closer look at face.</h3>
            <p>ConvNeXt-Tiny on AffectNet. Perceptual-hash groups keep duplicate images together across the split.</p>
            <dl className="panel-score"><div><dt>Kaggle macro-F1</dt><dd>{percent(FACE_MODEL.kaggle.macroF1)}</dd></div><div><dt>Test images</dt><dd>2,395</dd></div></dl>
            <p className="evaluation-caption">Happy is strongest; sad remains hardest. Labels have undocumented origins, and the split is not verified by identity.</p>
          </div>
          <div>
            <EmotionTable rows={FACE_EMOTIONS} modality="Face" />
            <p className="table-footnote">Kaggle run 3, with flip augmentation. These class scores are separate from the single-view ONNX re-score.</p>
          </div>
        </article>

        <article className="results-slide" id="results-panel-2" role="group" aria-roledescription="slide" aria-label="3 of 3: Voice emotions" data-ui>
          <div className="results-slide-intro">
            <h3>A closer look at voice.</h3>
            <p>WavLM-base-plus on RAVDESS. Test actors 21–24 are separate from training and validation actors.</p>
            <dl className="panel-score"><div><dt>Kaggle macro-F1</dt><dd>{percent(VOICE_MODEL.kaggle.macroF1)}</dd></div><div><dt>Test clips</dt><dd>208</dd></div></dl>
            <p className="evaluation-caption">Four actors, two fixed sentences, acted emotion. Accuracy on real, accented student speech has not been measured.</p>
          </div>
          <div>
            <EmotionTable rows={VOICE_EMOTIONS} modality="Voice" />
            <p className="table-footnote">Kaggle run 3. Exported WavLM predictions matched locally. Neutral has only 16 test clips.</p>
          </div>
        </article>
      </div>
      <div className="results-pagination">
        <span>Swipe or drag to explore</span>
        <span aria-live="polite" aria-atomic="true">{active + 1} of {PANELS.length} · {PANELS[active]}</span>
      </div>
    </div>
  )
}

const CHALLENGES = [
  ['A fairer face test.', 'The original face split contained duplicate images, and its sad test folder was entirely copies of training or validation images. We rebuilt the split using perceptual-hash groups and tested both face models on the same 2,395 images.'],
  ['New voices at test time.', 'We split RAVDESS by actor and remove duplicate clips. Actors 1–18 train the model, 19–20 select it, and 21–24 test it. A familiar voice cannot quietly inflate the held-out score.'],
  ['Training that finishes.', 'Random audio resampling made the first voice run too slow to finish. Five fixed speed rates replaced that bottleneck, and face and voice training ran side by side on two Tesla T4 GPUs.'],
  ['Room to be wrong.', 'Emotion is an estimate, not a fact about you. Accents, unfamiliar expressions, and real-world noise can change performance. Voice alone never triggers an action; you can correct the estimate.'],
] as const

export default function Landing({ onStart }: { onStart: () => void }) {
  const root = useReveal()
  return (
    <main ref={root} className="landing" id="top">
      <section className="landing-hero landing-frame" aria-labelledby="landing-title">
        <div className="landing-hero-copy">
          <h1 id="landing-title">Explain it<br />once.</h1>
          <p className="landing-lead">A voice assistant for international students at SJSU. A little more patience for the moments university gets complicated.</p>
          <div className="landing-actions"><button className="btn btn-primary" onClick={onStart}>Get started <Arrow /></button><a href="#results">Explore the results</a></div>
          <p className="landing-reassurance">Talk or type. Camera off by default.<br />You set the pace.</p>
        </div>
        <ConversationPreview />
      </section>

      <section className="landing-proof landing-frame" aria-label="Latest deployed model accuracy">
        <p>Built with care.<br />Tested in the open.</p>
        <a href="#results" className="proof-stat"><strong>{percent(FACE_MODEL.onnx.accuracy)}</strong><span>Face accuracy <Arrow /></span></a>
        <a href="#results" className="proof-stat"><strong>{percent(VOICE_MODEL.onnx.accuracy)}</strong><span>Voice accuracy <Arrow /></span></a>
        <p className="proof-context">Held-out benchmark results.<br />Exported models, re-scored locally.<br />{RESULTS_DATE}.</p>
      </section>

      <section id="results" className="landing-results landing-frame" aria-labelledby="results-title">
        <div className="section-heading">
          <h2 id="results-title" data-reveal>Every score,<br />in the open.</h2>
          <p data-reveal>Better models start with honest measurement. Explore accuracy, macro-F1, and the emotions each model still finds difficult.</p>
        </div>
        <ResultsCarousel />
        <div className="metric-definitions">
          <p><strong>Accuracy</strong> is the share of test examples labeled correctly.</p>
          <p><strong>Macro-F1</strong> balances precision and recall, giving each of the seven emotions equal weight.</p>
        </div>
        <details className="evaluation-notes">
          <summary>Sources & evaluation notes <span aria-hidden="true">+</span></summary>
          <div>
            <p>Recorded {RESULTS_DATE} in training/RESULTS.md and the saved metrics from Kaggle runs 3 and 4. The older run used a different split and is excluded here.</p>
            <p>Face training, validation, and test: 19,021 / 2,376 / 2,395 images. Voice test: 208 clips from four held-out actors. Models were selected by validation macro-F1.</p>
            <p>Face Kaggle evaluation uses flip augmentation; exported ONNX uses a single view. The log-mel voice baseline also changes from fp16 evaluation to fp32 ONNX preprocessing. Use one evaluation method when comparing models.</p>
            <p>These are emotion-classification benchmarks, not accuracy scores for advice or the full assistant. Claude’s text estimates and performance with real students have not been evaluated.</p>
          </div>
        </details>
      </section>

      <section id="story" className="landing-story" aria-labelledby="story-title">
        <div className="landing-frame story-layout">
          <div><h2 id="story-title" data-reveal>A hold is hard.<br />Asking shouldn’t be.</h2><p className="story-side-note" data-reveal>One financial aid hold.<br />One deadline on Friday.<br />One less time explaining.</p></div>
          <div className="story-body">
            <p data-reveal>Imagine explaining a registration hold in your second language. The automated line loops. The deadline gets closer. When you finally reach a person, you start over.</p>
            <p data-reveal>EQ.ai is built for that moment. It can slow down, rephrase, and help prepare a handoff summary with your permission. You decide whether an emotion estimate feels right.</p>
            <p data-reveal>Answers need official school sources. If a source is missing, the assistant should say so and offer human help. A calm voice is only useful when the information is honest.</p>
          </div>
        </div>
      </section>

      <section id="process" className="landing-process landing-frame" aria-labelledby="process-title">
        <div className="section-heading"><h2 id="process-title" data-reveal>Care is in the details.</h2><p data-reveal>What we learned while building, and what we changed along the way.</p></div>
        <div className="process-list">{CHALLENGES.map(([title, body], i) => <article key={title} data-reveal style={{ '--order': i % 2 } as CSSProperties}><h3>{title}</h3><p>{body}</p></article>)}</div>
        <p className="related-work">Related work: Hume AI’s emotion-aware voice and Ted.AI’s emotion-adaptive bear. Our focus is a stressful student task and a handoff to someone who can help. The golden bear is a nod to Cal Hacks.</p>
      </section>

      <footer className="landing-footer">
        <div className="landing-frame">
          <div className="footer-invitation"><h2 data-reveal>Start where you are.</h2><button className="btn btn-primary" onClick={onStart}>Get started <Arrow /></button></div>
          <div className="footer-details"><p>Emotion estimates can be wrong.<br />EQ.ai is a service assistant, not a counselor.</p><a href="#results">Read the evaluation</a><a href="#top">Back to top</a></div>
          <div className="footer-wordmark" aria-hidden="true">EQ.ai</div>
        </div>
      </footer>
    </main>
  )
}
