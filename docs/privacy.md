# Privacy: where student data goes

Status: describes the code and the public site (https://eqai.study) as of 2026-10-24.

| Data | Leaves the student's device? | Where it goes | Stored? |
|---|---|---|---|
| Camera frames (opt-in) | Yes, only to EQ.ai's own Jetson, through Cloudflare's network (encrypted) | `services/perception` | No. Decoded in memory, never written |
| Microphone audio (emotion) | Yes, only to EQ.ai's own Jetson, through Cloudflare | `services/perception` | No. Last 3 s kept in memory only |
| Microphone audio (speech-to-text) | **Yes: Cartesia's cloud (Ink 2)** | Cartesia STT, browser connects directly | Per Cartesia's terms; we store none |
| Face/voice emotion labels | Yes, as labels only | dialogue service, then Claude | In memory, expires after 30 s |
| Messages (typed or transcribed) | Yes | Claude (Anthropic API) | Not stored by our services |
| Reply text | Yes | Cartesia TTS | Not stored by our services |
| Advisor case note | Yes: the chat text goes to Claude to write it | the student's screen and the advisor console (`/staff`) | Only after "Connect me": SQLite on the Jetson, deleted after 24 hours |
| Handoff (first name, topic, chat with EQ.ai, messages with the advisor) | Only after the student clicks "Connect me" | the advisor console (`/staff`, access code required) | SQLite on the Jetson, deleted after 24 hours |
| Emotion estimate in a handoff | Only if the student ticks "share my emotion estimate" | the advisor console | With the handoff, 24 hours |
| Visitor IP address | Yes, as with any website | rate limiter in the dialogue service | In memory for 10 minutes, never logged |

Nothing about a conversation is kept unless the student asks for a person. Then the handoff (what the consent
screen lists) is kept in one SQLite file on the Jetson (`data/handoffs.db`, never committed) and deleted 24 hours
after it was created. The advisor console needs the `STAFF_CODE` access code; with no code set, it stays closed.
A student's page reads only its own handoff, by a random 128-bit id.

Rules enforced in code:
- The camera is opt-in. The browser sends frames only while the camera toggle is on.
- `/signals` accepts labels and confidences only, and rejects any extra field such as image data
  (`services/dialogue/app.py`, test `test_signals_never_accept_raw_media`).
- Perception posts labels only to the dialogue service, never media (`test_dialogue_gets_labels_only_never_media`).
- Emotion labels go to an advisor only if the student ticks consent (web app).
- API keys stay on the server. The browser gets a 10-minute Cartesia token (`/voice/token`).
- WebSocket and HTTP endpoints accept only the student app's origin.

Known limits:
- Speech-to-text sends raw voice audio to Cartesia's cloud. The setup screen says so, and so does a
  notice when the student switches to voice or turns the camera on inside the chat. The setup
  screen also says messages and emotion labels go to Claude (Anthropic).
- Public traffic passes through Cloudflare, which ends TLS at its edge before the tunnel to the Jetson.
- Emotion classifiers can be wrong, especially for accented or non-native speech. The assistant asks
  before acting on a voice-only estimate and never acts on voice alone.
- This is not a therapist or medical tool. Distress replies always include the 988 Suicide and Crisis
  Lifeline and offer a human.
