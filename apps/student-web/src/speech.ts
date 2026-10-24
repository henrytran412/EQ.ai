// shortcut: browser speech stands in for Cartesia (Ink STT + Sonic TTS); swap when services/voice is ready.
// Chrome's SpeechRecognition sends audio to Google, which the setup screen discloses.

type Recognizer = {
  lang: string
  interimResults: boolean
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void
  onend: () => void
  onerror: () => void
  start: () => void
  stop: () => void
}
const w = window as unknown as { SpeechRecognition?: new () => Recognizer; webkitSpeechRecognition?: new () => Recognizer }
const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition

export const canListen = !!SR

export function listen(onText: (text: string) => void, onEnd: () => void): () => void {
  if (!SR) {
    onEnd()
    return () => {}
  }
  const r = new SR()
  r.lang = 'en-US'
  r.interimResults = false
  r.onresult = (e) => onText(e.results[0][0].transcript)
  r.onend = onEnd
  r.onerror = onEnd
  r.start()
  return () => r.stop()
}

export function speak(text: string, rate: number, onStart: () => void, onEnd: () => void) {
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.rate = rate
  u.onstart = onStart
  u.onend = onEnd
  u.onerror = onEnd
  speechSynthesis.speak(u)
}

export const stopSpeaking = () => speechSynthesis.cancel()
