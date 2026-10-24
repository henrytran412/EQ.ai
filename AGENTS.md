# [PROJECT_NAME] - Project Context for Codex

Cal Hacks 13.0 (Oct 23-25, 2026). Working name TBD (candidates: Express Queue, WarmHandoff, Once).
Placeholders in [BRACKETS] must be filled in by the team. Never invent their values.

## 1. One-line pitch

A voice assistant for international students at [YOUR SCHOOL] who get stuck in automated
university phone and chat lines (financial aid, billing, housing, visa questions). It notices
confusion or frustration, slows down and rephrases, answers only from official sources, says
plainly when it is unsure, and hands the student to a human advisor WITH context so the
student explains the problem once.

Tagline idea: "Explain it once."

## 2. Community and problem

- Named community: international and non-native-English-speaking students at [YOUR SCHOOL].
- Problem: automated lines miss frustration, trap people in loops, and force them to repeat
  themselves to a human afterward. Deadlines and holds make this costly.
- Evidence (REAL ONLY): [fill in short, consented notes from interviews with students].
  Never fabricate quotes, statistics, or user research.

## 3. Working flow (one demo flow, done well)

Demo scenario: a student has a registration hold from financial aid and the deadline is Friday.

1. Student speaks (mic). Text input is always available. Camera is OFF by default and opt-in.
2. Speech-to-text produces a transcript.
3. Perception estimates emotion from voice and text (face only if the student opts in) and
   returns a label with a confidence value.
4. Fusion smooths estimates over a few seconds so one noisy frame never flips the behavior.
5. Behavior policy (section 4) picks a mode: normal, slow and rephrase, confirm, offer handoff.
6. Dialogue (Codex) answers ONLY from retrieved official school pages, cites the source, and
   states uncertainty. It never guesses eligibility or deadlines.
7. Text-to-speech (Cartesia) speaks the reply with speed and emotion parameters from the mode.
8. Handoff: if the student consents, create a handoff record with a short summary (problem,
   deadline, what was tried, consent). The staff console shows it live. Emotion labels are
   NOT shared with staff unless the student agrees.
9. UI shows a live emotion timeline so judges can see why the tone changed.
10. Comparison mode: the same scenario next to a plain chatbot.

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
  "estimates frustration from voice and text signals".

## 5. Proposed function contracts (confirm before changing)

- `transcribe(audio_chunk) -> Transcript`
- `estimate_emotion(audio, text, frame=None) -> EmotionEstimate{label, confidence, source}`
- `fuse_emotion(history, estimate) -> EmotionState` (windowed smoothing)
- `decide_behavior(state, context) -> Behavior{mode, tts_params, ask_confirmation, offer_handoff}`
- `retrieve_sources(query) -> list[SourcePassage]`
- `generate_reply(transcript, passages, behavior) -> Reply{text, citations, uncertainty}`
- `synthesize_speech(text, tts_params) -> audio stream`
- `create_handoff(session_id, summary, consent) -> Handoff`
- `resolve_handoff(handoff_id, staff_id) -> Handoff`

## 6. Tracks we are competing in

Opt in to each on Devpost. Name every integration in the README and demo video.
Each tool must do real work. No logo-stacking.

Core:
- Anthropic: Codex for Public Benefit (named community, real problem, it works, thoughtful
  use of Codex). Confirm the opt-in step with organizers.
- Cal Hacks: Best People-First Social Impact, Most Creative, Most Technically Advanced, Overall
- Cartesia: Best Use of Cartesia (emotion-controlled voice)
- MLH: Best Use of Gemini API (multimodal emotion estimation)
- Database track: choose ONE of SpacetimeDB or Convex (see section 13)
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
Skipped: Fetch.ai (poor fit for a real-time voice loop).

## 7. Tech stack

Confirmed direction:
- Dialogue, handoff summaries, safety: Codex via the Anthropic API. Model name comes from
  the `CLAUDE_MODEL` env var. Choose by measured latency and quality.
- TTS: Cartesia (supports speed and emotion controls; emotion is beta, test audibility early).
- Perception baseline: Gemini API for voice/text (and optional face) emotion estimation.
- Edge: NVIDIA Jetson Orin Nano for optional local perception (pretrained models first).
- Dev laptop: ASUS Vivobook S14 (assumed no NVIDIA GPU, so no CUDA training there).
- Python for perception, TypeScript for apps and the database client.
- UI design: Figma (design the student app and staff console there before building).

Pending (see section 13): STT choice, database (SpacetimeDB or Convex), frontend framework,
retrieval method, whether VibeVoice is used at all.

Bridge note: no official SpacetimeDB Python SDK was found. Plan: Python perception sends JSON
to a small Node service that uses the TypeScript SDK to call reducers.

## 8. Folder structure (proposed)

```
project-root/
|-- AGENTS.md
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
|   |-- dialogue/           # Codex prompts, retrieval, behavior policy
|   |-- voice/              # STT and TTS adapters (Cartesia)
|   `-- bridge/             # Node: Python to database
|-- data/
|   |-- knowledge/          # source URLs and fetch script for public school pages
|   `-- eval/               # eval scripts (raw audio is gitignored)
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
3. Baselines before experiments. Measure pretrained models first. Fine-tune only if time
   remains and it measurably improves held-out results.
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
- Submission due Oct 25, 9:00 AM PST. Teams of 2-4 college students.
- Disclose Codex as a coding assistant in the Devpost submission and README.

## 12. Positioning and pitch guardrails

- Not "an emotional companion". Pitch it as a frustration-aware service assistant with a
  human handoff for a named community.
- Related work to acknowledge: Hume AI (emotion-aware voice platform), Ted.AI (Cal Hacks 12,
  emotion-adaptive teddy bear for children). We differ in community, outcome (task resolved
  plus handoff), signals, and handling of uncertainty.
- For Microsoft, Meta, and Figma entries, lead with the real student problem, then show how
  the sponsor's tool or theme served it. Do not pitch the tool first.
- No fake neuroscience visuals. No unsourced market statistics. No unmeasured accuracy claims.
- Where it could go wrong, and our answer: emotion misreads (confirm first), wrong aid info
  (cite sources, state uncertainty, hand off), privacy (nothing stored, camera opt-in),
  distress (real resources), accented speech (tested and reported honestly).

## 13. Open decisions (ask the team before assuming)

- Team size and skills: [fill in]
- Jetson Orin Nano memory (4GB or 8GB) and JetPack version: [fill in]
- Database: SpacetimeDB or Convex (pick one; the Spacetime track is newer and riskier,
  Convex is the safer default)
- STT: [TBD by latency test]
- Frontend framework: [TBD]
- Retrieval over school pages: simple search vs Elastic
- VibeVoice: not verified for tone control. Default to Cartesia unless a quick test says otherwise.
- School name and final project name
- Microsoft, Meta, and Figma track requirements: [confirm with mentors or the Devpost page]
- Who on the team owns the Figma design: [fill in]

## 14. Commands

[Fill in once the project exists: setup, run, test, evaluate, and lint commands.]
