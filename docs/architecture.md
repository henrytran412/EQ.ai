# Architecture

Status: as built on 2026-10-24. *Planned* parts are not built yet.

```
Browser (apps/student-web)          Jetson / laptop (services/perception, :8001)
  camera (opt-in) --JPEG 2 fps-->     YuNet face tracking -> square crop -> face CNN (ONNX)
  mic ------------16 kHz PCM---->     3 s window, speech only -> voice model (ONNX)
       <------- readings 1/s ----     EMA smoothing  --labels only--> dialogue /signals
                                                                         |
  text / transcript --POST /chat--> dialogue service (services/dialogue, :8000)
                                     retrieve official pages (BM25) -> Claude (one call:
                                     state + 1-3 sentence reply, structured JSON)
                                     -> behavior policy in code -> citations, 988 if distress
       <--- reply + tone + behavior --
  POST /voice/token  ----------->    mints 10-min Cartesia token (key stays on server)
  Cartesia Ink STT  <-- direct ---   (mic audio to Cartesia cloud)
  Cartesia Sonic TTS <-- direct --   (reply text + speed/emotion from /chat)
  POST /handoffs -------------->    Claude writes the advisor case note (problem, deadline, what was
                                     tried, first step) from the chat only, never the emotion signals,
                                     and the handoff is saved in SQLite (services/dialogue/handoffs.py, 24 h).
  GET /handoffs/{id} every 2 s <-    advisor console (/staff, access code): GET /handoffs every 2 s,
  POST /handoffs/{id}/messages        POST .../status (take, resolve) and .../messages (reply)
```

## Public deployment (https://eqai.study)

Everything runs on one NVIDIA Jetson Orin Nano: dialogue (:8000), perception (:8001, ONNX Runtime on
the GPU) and the static site (:8080), each bound to 127.0.0.1 and restarted 3 s after a crash
(`scripts/serve_jetson.sh`). A Cloudflare named tunnel (outbound only, HTTP/2) publishes just the site,
`/chat`, `/handoffs/*`, `/voice/token`, `/health` and `/ws/*` (`scripts/setup_tunnel.sh`); `/signals` stays
internal. Per-visitor rate limits use Cloudflare's `CF-Connecting-IP`. The only stored data is handoffs: one
SQLite file on the Jetson, rows deleted 24 hours after they were created.

## Models

| Signal | Training | Inference |
|---|---|---|
| Face | AffectNet, 7 emotions, cleaned and deduplicated (`training/prepare_face.py`). Baseline MobileNetV3-Large, main ConvNeXt-Tiny (ImageNet-pretrained, timm) | ONNX on the Jetson |
| Voice | RAVDESS speech, 7 emotions, split by actor (`training/prepare_voice.py`). Baseline WavLM-base-plus, CNN EfficientNet-B0 on log-mel | ONNX on the Jetson |
| Tone + reply | Not trained: Claude (`CLAUDE_MODEL`; project config Sonnet 5.5 at high effort, `DIALOGUE_EFFORT`) | Anthropic API |

Training runs on a free Kaggle GPU (`training/kaggle/launch.py`). Results: `training/compare_runs.py`.
Only numbers that were actually measured are reported, and the model is chosen on validation, never test.

## Behavior policy (`services/dialogue/policy.py`)

| State | Mode | Voice |
|---|---|---|
| neutral | answer normally | neutral, 1.0x |
| nervous | slow down, reassure | calm, 0.85x |
| confused | rephrase simply | calm, 0.8x |
| frustrated | ask "am I reading this right?", then offer an advisor | calm, 0.9x |
| distress | stop the task, 988 + campus counseling, offer a human | calm, 0.8x |

Voice evidence alone never triggers an action; it only makes the assistant ask.

## Run

Full instructions are in the README. In short:

```
python -m venv .venv && .venv/Scripts/pip install -r services/dialogue/requirements.txt \
  -r services/perception/requirements.txt
bash scripts/fetch_models.sh                     # face detector
.venv/Scripts/uvicorn services.dialogue.app:create_app --factory --port 8000 --env-file .env
.venv/Scripts/uvicorn services.perception.server:create_app --factory --port 8001 --env-file .env
.venv/Scripts/python -m unittest discover -s tests
```
