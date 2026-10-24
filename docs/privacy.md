# Privacy: where student data goes

Status: describes the code as of 2026-10-24. Items marked *planned* are not built yet.

| Data | Leaves the student's devices? | Where it goes | Stored? |
|---|---|---|---|
| Camera frames | No. Only to our own Jetson (local network) | `services/perception` | No. Decoded in memory, never written |
| Microphone audio (emotion) | No. Only to our own Jetson | `services/perception` | No. Last 3 s kept in memory only |
| Microphone audio (speech-to-text) | **Yes: Cartesia's cloud (Ink)** | Cartesia STT, browser connects directly | Per Cartesia's terms; we store none |
| Face/voice emotion labels | Yes, as labels only | dialogue service, then Claude | In memory, expires after 30 s |
| Transcript text | Yes | Claude (Anthropic API) | Not stored by our services |
| Reply text | Yes | Cartesia TTS | Not stored by our services |
| Handoff summary | Yes, only with student consent | advisor console (*planned: SpacetimeDB*) | *Planned: until resolved* |

Rules enforced in code:
- The camera is opt-in. The browser sends frames only while the camera toggle is on.
- `/signals` accepts labels and confidences only, and rejects any extra field such as image data
  (`services/dialogue/app.py`, test `test_signals_never_accept_raw_media`).
- Perception posts labels only to the dialogue service, never media (`test_dialogue_gets_labels_only_never_media`).
- Emotion labels go to an advisor only if the student ticks consent (web app).
- API keys stay on the server. The browser gets a 10-minute Cartesia token (`/voice/token`).
- WebSocket and HTTP endpoints accept only the student app's origin.

Known limits:
- Speech-to-text sends raw voice audio to Cartesia's cloud. The student must be told in the UI.
- Emotion classifiers can be wrong, especially for accented or non-native speech. The assistant asks
  before acting on a voice-only estimate and never acts on voice alone.
- This is not a therapist or medical tool. Distress replies always include the 988 Suicide and Crisis
  Lifeline and offer a human.
