# EQ.ai - Project Context for Codex and other AI coding agents

This file mirrors CLAUDE.md (the source of truth). If they ever differ, follow CLAUDE.md.
"Claude" below means the Claude model used inside the product, not the coding agent.

Cal Hacks 13.0 (Oct 23-25, 2026). Project name: EQ.ai (EQ = emotional intelligence, and
Express Query). Solo builder.
Placeholders in [BRACKETS] must be filled in by the team. Never invent their values.

## 1. One-line pitch

A voice assistant for international students at [YOUR SCHOOL] who get stuck in automated
university phone and chat lines for stressful, high-stakes questions (financial aid,
scholarships, visa status, school problems). It notices
confusion or frustration, slows down and rephrases, answers only from official sources, says
plainly when it is unsure, and hands the student to a human advisor WITH context so the
student explains the problem once.

Tagline candidates (not final): "Hears how you feel. Adapts to you." / "Explain it once."

Interface: a voice chat with an expressive animated face. The face expression and the voice
tone adapt to the estimated emotion. Text chat is always available.

## 2. Community and problem

- Named community: international and non-native-English-speaking students at [YOUR SCHOOL].
- Scope: the primary community stays international students. "Any student" is a later
  extension, not the demo target (the Anthropic track requires a named community).
- Demo focus: ONE flow (financial aid hold). Scholarships, visa status, and school problems
  are supported only as far as time allows.
- Problem: automated lines miss frustration, trap people in loops, and force them to repeat
  themselves to a human afterward. Deadlines and holds make this costly.
- Evidence (REAL ONLY): [fill in short, consented notes from interviews with students].
  Never fabricate quotes, statistics, or user research.

## 3. Working flow (one demo flow, done well)

Demo scenario: a student has a registration hold from financial aid and the deadline is Friday.

1. The browser (on localhost) captures the mic. Camera frames (about 1-2 per second) are OFF
   by default and opt-in. Text input is always available.
2. A local perception service runs a face classifier on frames, a voice classifier on 2-3
   second audio windows, and speech-to-text for the transcript. Raw video stays on the laptop.
3. An aggregator keeps a rolling window (about 10 seconds), smooths it, and emits a compact
   JSON: face and voice probabilities, trend, latest transcript. Never send every frame to an
   LLM. Send the summary when the student finishes speaking or the state changes noticeably.
4. The tone LLM (our LoRA fine-tuned model) reads that JSON and returns short JSON: fused state,
   confidence, ask_confirmation flag, Cartesia tone params (speed, emotion), and avatar
   expression. It does NOT write reply content.
5. Behavior policy (section 4) picks a mode: normal, slow and rephrase, confirm, offer handoff.
6. Claude writes the reply content: answers ONLY from cached official school pages, cites the
   source, states uncertainty, never guesses eligibility or deadlines. Replies are 1-3
   sentences. Claude and the tone LLM run in parallel. Tone params are applied to the voice
   when they arrive.
7. Cartesia speaks the reply, streamed sentence by sentence, with speed and emotion from the
   tone params. A pre-generated short acknowledgment clip (per tone) plays immediately to cover
   the wait. The animated face changes expression and its mouth follows the audio level.
8. Handoff: if the student consents, create a handoff record with a short summary (problem,
   deadline, what was tried, consent). The staff console shows it live. Emotion labels are
   NOT shared with staff unless the student agrees.
9. UI shows a live emotion timeline so judges can see why the tone changed.
10. Comparison mode: the same scenario next to a plain chatbot.

Latency: log the time from end of speech to first audio, split by stage (speech-to-text,
tone LLM, Claude first token, Cartesia first audio). Rough goal is about 1-2 seconds.
Measure it, do not assume it.

## 4. Behavior policy (emotion state to action)

| State | Assistant behavior |
|---|---|
| neutral | Answer normally, cite source |
| confused | Slow down, rephrase simply, offer an example |
| frustrated | Acknowledge, ask "am I reading this right?", offer handoff |
| distress | Stop task flow, surface campus counseling and 988 (US) resources, offer human contact |

Rules:
- Voice signal alone NEVER triggers an action. Ask the student first ("You sound frustrated.
  Is that right?") and let them correct it.
- Accents and non-native speech may lower detector accuracy. Treat this as a known risk.
- Not a therapist or medical tool. Never claim to "understand" or "feel" emotions. Say it
  "estimates frustration from voice, text, and (opt-in) camera signals".

## 5. Proposed function contracts (confirm before changing)

- `transcribe(audio_chunk) -> Transcript`
- `classify_face(frame) -> EmotionProbs` (opt-in only)
- `classify_voice(audio_window) -> EmotionProbs`
- `aggregate_signals(history, face, voice, transcript) -> SignalSummary` (rolling window,
  smoothing, trend)
- `infer_tone(summary) -> ToneDecision{state, confidence, ask_confirmation, tts_params,
  avatar_expression}` (fine-tuned tone LLM, no reply text)
- `decide_behavior(tone_decision, context) -> Behavior{mode, offer_handoff}`
- `retrieve_sources(query) -> list[SourcePassage]` (cached local copies of school pages)
- `generate_reply(transcript, passages, behavior) -> Reply{text, citations, uncertainty}`
  (Claude, streamed, short)
- `synthesize_speech(text, tts_params) -> audio stream` (Cartesia, streamed per sentence)
- `create_handoff(session_id, summary, consent) -> Handoff`
- `resolve_handoff(handoff_id, staff_id) -> Handoff`

## 6. Tracks we are competing in

Opt in to each on Devpost. Name every integration in the README and demo video.
Each tool must do real work. No logo-stacking.

Core:
- Anthropic: Claude for Public Benefit (named community, real problem, it works, thoughtful
  use of Claude). Confirm the opt-in step with organizers.
- Cal Hacks: Best People-First Social Impact, Most Creative, Most Technically Advanced, Overall
- Cartesia: Best Use of Cartesia (emotion-controlled voice)
- SpacetimeDB: Best Use of Spacetime (sessions, emotion events, and the live handoff queue
  depend on its reducers and subscriptions)
- Microsoft: Built for the Real World, and Customer Impact Award (real users, real problem).
  Requirements not confirmed. Ask Microsoft mentors whether specific tools (Azure, VibeVoice)
  are required or count. Do not assume.
- Meta: Bringing People Closer Together with AI (framing: helping international students
  reach people and services at their institution). Requirements not confirmed. Ask Meta
  mentors. Do not assume specific tools (e.g., Llama) are required.
- Figma: five categories (Best Use Case of Figma, Best Use Case of Figma Agent, Most Creative
  Use Case of Figma Agent, Best Design, Most Creative). Design the student app and staff
  console in Figma. Confirm each category's requirements first, and only enter a category if
  we actually used the tool that way. Keep the Figma file link in design/.
- Vultr (GPU hosting), GoDaddy Registry (domain), Commit Fellowship (opt in at submission)

Optional, only if natural: Elastic Agent Builder (retrieval over school pages), Bitdeer.
Skipped: Fetch.ai (poor fit for a real-time voice loop). Dropped: MLH Gemini (Gemini is not
used) and Convex (SpacetimeDB chosen).

## 7. Tech stack

Confirmed direction:
- Dialogue, handoff summaries, safety: Claude via the Anthropic API. Model name comes from
  the `CLAUDE_MODEL` env var. Choose by measured latency and quality.
- TTS: Cartesia (supports speed and emotion controls; emotion is beta, test audibility early).
- Perception: our own models. Voice and face use separate classifiers (pretrained encoder plus
  classification head). A text-only LLM cannot read raw audio or images. The tone LLM (small
  open instruct model, see section 13, LoRA fine-tuned on a Vultr GPU) reads the aggregated
  signal JSON plus the transcript and outputs state and tone settings. It does NOT write reply
  content (Claude does). Serve it on Vultr behind a token-protected API, with a quantized
  local copy as fallback. Gemini is NOT used.
- Database: SpacetimeDB (sessions, emotion_events, handoffs; live sync to the staff console).
- Avatar: 2D animated face in the web app (expression states, mouth driven by audio level).
  No photoreal avatar.
- Edge: NVIDIA Jetson Orin Nano for optional local perception (pretrained models first).
- Dev laptop: ASUS Vivobook S14 (assumed no NVIDIA GPU, so no CUDA training there).
- Python for perception, TypeScript for apps and the database client.
- UI design: Figma (design the student app and staff console there before building).

Pending (see section 13): STT choice (Gemini is no longer an option), model choices, frontend
framework, retrieval method, whether VibeVoice is used at all.

Bridge note: no official SpacetimeDB Python SDK was found. Plan: Python perception sends JSON
to a small Node service that uses the TypeScript SDK to call reducers.

## 8. Folder structure (proposed)

```
project-root/
|-- CLAUDE.md             # agent context (source of truth)
|-- AGENTS.md             # same context for Codex and other agents
|-- README.md
|-- .gitignore
|-- .env.example            # placeholders only
|-- docs/                   # architecture.md, privacy.md, evaluation.md
|-- design/                 # Figma file link, exported assets, UI notes
|-- apps/
|   |-- student-web/        # voice UI, consent toggles, emotion timeline
|   `-- staff-console/      # live handoff queue
|-- backend/                # database module: tables and reducers
|-- services/
|   |-- perception/         # Python: emotion estimation and fusion
|   |-- dialogue/           # Claude prompts, retrieval, behavior policy
|   |-- voice/              # STT and TTS adapters (Cartesia)
|   `-- bridge/             # Node: Python to database
|-- data/
|   |-- knowledge/          # source URLs and fetch script for public school pages
|   `-- eval/               # eval scripts (raw audio is gitignored)
|-- training/               # training scripts and configs (data, weights gitignored)
|-- configs/                # default config, no secrets
|-- scripts/                # setup and utility scripts
|-- tests/
`-- demo/                   # demo script, video notes
```

Data model sketch: `sessions`, `emotion_events` (timestamp, label, confidence, source),
`handoffs` (status, summary, consent, staff_id).

## 9. Rules for working in this repo

1. Understand before implementing. Inspect the repo and requirements first. If something
   important is unclear, ask a specific question. Do not guess requirements.
2. Start with a short plan. Build the simplest end-to-end loop first (one session, one live
   emotion update on the staff screen), then add features.
3. Baselines before experiments. Measure zero-shot and pretrained baselines first (Claude
   zero-shot on text, off-the-shelf voice and face models, and a simple rule-based fusion). Compare every fine-tuned model to
   them on held-out data and report honestly, even if the fine-tune does not win.
4. Keep modules separate (data, models, evaluation, config). Use type hints, clear names,
   logging, and error handling. No hard-coded paths, keys, or hyperparameters.
5. Reproducibility: fixed random seeds, record configs, dependencies, and metrics.
6. Evaluation: split by SPEAKER, never by clip. Check for leakage. Report only numbers that
   were actually measured. A small preliminary check is "preliminary", not an accuracy figure.
7. Never fabricate datasets, citations, metrics, or test results. Report clearly what
   passed, failed, or could not be tested.
8. Do not delete or modify important files, data, or results without asking.
9. Do not push, publish, or rewrite git history without explicit permission.
10. Explain what changed, why, and how to run or verify it. Mention limits and risks.

## 10. Security and privacy (check before every "done")

- Keys live in environment variables. `.env.example` has placeholders only.
- Never print or commit secrets. Scan tracked files for keys, tokens, and private URLs.
- Do NOT store raw audio or video. Store only derived state (emotion label, summary).
- Raw video never leaves the laptop. Raw audio stays local unless a cloud STT is chosen (then
  disclose it and get consent). Only probabilities, labels, and transcript text go to Vultr
  or Claude.
- Camera is opt-in. Show the student what the system thinks and let them correct it.
- Validate untrusted input. Avoid unsafe command execution and insecure deserialization.
- Review dependencies for obvious risks. Do not publish licensed or personal datasets.
- Before calling the repo ready: complete `.gitignore`, `.env.example`, dependency file,
  README (setup, config, run, evaluation, structure), and a minimal verification command.
  Check `git status` and the diff.

## 11. Hackathon constraints

- All work must be done during the event. Start a FRESH repo at kickoff. Do not copy files
  from any earlier project. Ideas and lessons learned are fine, old code is not.
- Public GitHub repo and a recorded demo video are required. Record the video early.
- Submission due Oct 25, 9:00 AM PST. Solo participation is allowed.
- Disclose every AI coding assistant used (Claude Code, Codex) in the Devpost submission and README.

## 12. Positioning and pitch guardrails

- Not "an emotional companion". Pitch it as a frustration-aware service assistant with a
  human handoff for a named community.
- Related work to acknowledge: Hume AI (emotion-aware voice platform), Ted.AI (Cal Hacks 12,
  emotion-adaptive teddy bear for children). We differ in community, outcome (task resolved
  plus handoff), signals, and handling of uncertainty.
- "Emotional support" means a calm supportive tone, honest uncertainty, crisis resources, and
  human handoff. It is NOT therapy or mental-health care.
- Visa status: never give legal or immigration advice. Share official information and point
  to the school's international student office.
- The animated face shows the system's estimate. Do not describe it as the AI feeling emotions.
- For Microsoft, Meta, and Figma entries, lead with the real student problem, then show how
  the sponsor's tool or theme served it. Do not pitch the tool first.
- No fake neuroscience visuals. No unsourced market statistics. No unmeasured accuracy claims.
- Where it could go wrong, and our answer: emotion misreads (confirm first), wrong aid info
  (cite sources, state uncertainty, hand off), privacy (nothing stored, camera opt-in),
  distress (real resources), accented speech (tested and reported honestly).

## 13. Open decisions (ask the team before assuming)

- Team: solo. Skills and time budget: [fill in]
- Jetson Orin Nano memory (4GB or 8GB) and JetPack version: [fill in]
- Base LLM for text-emotion LoRA (model and size): [fill in]
- Face and voice training data: modality, labels, size, speakers, licenses: [fill in].
  Confirm none of it was collected or labeled before the event.
- STT: [TBD by latency test] (Gemini dropped)
- Frontend framework: [TBD]
- Retrieval over school pages: simple search vs Elastic
- VibeVoice: not verified for tone control. Default to Cartesia unless a quick test says otherwise.
- School name
- Microsoft, Meta, and Figma track requirements: [confirm with mentors or the Devpost page]
- Who on the team owns the Figma design: [fill in]

## 14. Commands

[Fill in once the project exists: setup, run, test, evaluate, and lint commands.]
