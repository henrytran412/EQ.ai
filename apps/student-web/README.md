# EQ.ai student web + staff console

React + Vite + TypeScript. Styling follows `DESIGN-oura.md` (Fraunces/Inter stand in for Oura's fonts).

```bash
npm install
npm run dev        # http://localhost:5173 (student), http://localhost:5173/staff (staff console)
npm test           # policy self-checks (node:test, no extra deps)
npm run build      # type-check + production build
```

Open the student page and `/staff` in two tabs of the **same browser** to demo the live handoff.

## Pages

- `/` landing, demo login (first name only, nothing saved), topic + voice/text setup, chat with the bear.
- `/staff` handoff queue: summary, consent-gated emotion estimate, live chat, resolve.

## Chat API contract (for `services/dialogue`)

Set `VITE_API_URL` (see `.env.example`). Empty = demo mode with scripted replies that never state aid rules or deadlines.

`POST {VITE_API_URL}/chat`, types in `src/policy.ts`:

```jsonc
// request
{ "session_id": "uuid", "topic": "financial_aid_hold", "text": "student turn",
  "history": [{ "role": "student" | "assistant", "text": "..." }],
  "awaiting_confirmation": false }
// response
{ "reply": { "text": "1-3 sentences", "citations": [{ "title": "...", "url": "https://..." }], "uncertainty": "optional" },
  "tone": { "state": "neutral|confused|frustrated|distress", "confidence": 0.0, "ask_confirmation": false,
            "tts_params": { "speed": 1.0, "emotion": "calm" },
            "avatar_expression": "neutral|listening|thinking|happy|concerned|sad" },
  "behavior": { "mode": "normal|slow_rephrase|confirm|offer_handoff|distress", "offer_handoff": false } }
```

The service must allow CORS from the web origin. Only `http(s)` citation links are rendered.

## Temporary stand-ins (marked `shortcut:` in code)

- Voice: browser SpeechRecognition / speechSynthesis until Cartesia is wired in. Chrome sends recognition audio to Google; the setup screen says so.
- Handoffs: `BroadcastChannel` (same browser only) until the SpacetimeDB `handoffs` table + subscription exists.
- Handoff summary: the student's last messages until Claude writes one.
- Camera: opt-in preview only; frames are not sent anywhere yet.
