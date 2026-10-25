# EQ.ai: explain it once

**A voice assistant for international students at San José State University (SJSU) who are stuck on a
stressful school problem, starting with a financial aid hold that blocks registration.**

EQ.ai notices when a student seems confused or frustrated and changes how it talks: simpler words and a slower,
calmer voice. It answers only from official SJSU pages, says plainly when it doesn't know, and writes a short
case note for an advisor, so the student only has to explain the problem once.

**Try it: [https://eqai.study](https://eqai.study)** (Chrome or Edge on a laptop works best; allow the microphone to talk)

Built solo at Cal Hacks 13.0 (October 23–25, 2026). EQ.ai is a student project, not an official SJSU
service. Always confirm important details with the office.

## How to use it

1. Open [eqai.study](https://eqai.study) and click **Get started**.
2. Enter your first name and pick a topic, for example **Financial aid hold**.
3. Choose how you want to talk (**Voice** or **Text**) and how the bear replies (**Voice** or **Text**).
   The camera is optional and off by default. Click **Start chat**.
4. Talk to the bear:
   - **Tap** the mic and speak. It sends when you finish your sentence.
   - Or **hold** the mic while you speak, and let go to send.
   - Or type in the box.
5. Watch the bear adapt. If you seem confused, it uses simpler words and speaks slower and calmer. If you
   seem frustrated, it checks first: "It sounds frustrating. Am I reading that right?" On a laptop, the
   panel on the right shows the emotion map, what it is reading from, and how long the last reply took.
6. Click **Talk to a person** at any time. The bear asks you to confirm and lists what it will share. Tick
   **Also share how my mood seemed to change** if you want, then click **OK**.
7. A new tab opens with the **advisor view**: what an SJSU advisor would get for your chat. It shows Claude's
   summary (the problem, any deadline, what you already tried, a first step), how your estimated mood changed
   message by message, where it seemed hard and why, and the whole chat. In this demo it isn't sent to SJSU.

If a student sounds like they are in crisis, the bear stops the task and shares the 988 Suicide and Crisis
Lifeline. EQ.ai is not a therapist or a medical tool.

## How it works

```
Browser (eqai.study)                      Jetson Orin Nano (behind a Cloudflare Tunnel)
  camera (optional) --- frames 2/s ---->   face model (ConvNeXt-Tiny, GPU) --+
  microphone ---------- 16 kHz audio --->  voice model (WavLM, GPU) ---------+--> labels only, e.g. "confused 0.7"
                                                                             |
  your words -------------------------->   dialogue service:  official SJSU pages (search)
                                             -> Claude: estimate the state + write a 1-3 sentence reply
                                             -> policy in code: tone, safety rules, citations
  <------------------ reply + tone ------
  microphone -----> Cartesia Ink 2 (speech to text, turn detection)
  reply ----------> Cartesia Sonic 3.5 (speaks with the chosen emotion and speed)
  OK (handoff) ---------------------->   Claude writes the case note -> SQLite (24 h) -> advisor view (new tab)
```

| Part | What it does |
|---|---|
| **Claude** (Anthropic API, Sonnet 5.5 at high effort) | One call per student message. It estimates the student's state (neutral, nervous, confused, frustrated, distress) from their words plus the face and voice labels, and writes a short reply using only the official pages it was given, with citations. A second call writes the advisor case note from the chat and, if the student shares their mood estimates, how the mood changed and what seemed hard. |
| **Behavior policy** (`services/dialogue/policy.py`) | Turns the state into actions in code, so the safety rules hold even if a model is wrong: voice alone never triggers an action, frustration is confirmed before an advisor is pushed, and distress always shows 988 and offers a person. It also picks Cartesia's emotion and speed and the bear's face. |
| **Cartesia Ink 2** | Turns the student's speech into text. Its turn detection decides when the student has finished, which helps people who pause mid-sentence. |
| **Cartesia Sonic 3.5** | Speaks each reply with the emotion and speed the policy picked. We chose Sonic 3.5 because its speed control was strongest in our test: "calm, 0.8×" came out 15% slower than "neutral, 1×". |
| **Our face and voice models** | Trained by us (see `training/`), running on the Jetson's GPU. Only short labels leave the Jetson, never images or audio. |
| **Handoff database** (`services/dialogue/handoffs.py`) | SQLite on the Jetson: free, built into Python, no setup. A handoff is saved only after the student clicks **OK** on the handoff confirmation, and deleted after 24 hours. The advisor view (a new tab) loads it by a random, unguessable id. |
| **Official pages** (`data/knowledge/`) | 26 public SJSU pages (financial aid, registration, Bursar, scholarships, international students, counseling), copied word for word on 2026-10-24 and searched with BM25. |

More detail: [docs/architecture.md](docs/architecture.md).

## Measured results

Only numbers we actually measured. The model was picked on validation data and tested once.

| What | Result |
|---|---|
| Face emotion: 7 emotions, AffectNet, re-split so no test image is a copy of a training image | **78.4% accuracy**, macro-F1 0.773 on 2,395 test images. MobileNetV3 baseline: 73.2%, 0.718 |
| Full face chain on the Jetson (find face, crop, classify) | **78.1%** on 210 test faces |
| Voice emotion: 7 emotions, RAVDESS acted speech, split by actor | **87.5% accuracy**, macro-F1 0.884 on 208 clips from 4 unseen actors |
| Speed on the Jetson Orin Nano GPU | face 19.6 ms, voice 83 ms per prediction (about 6× faster than its CPU) |
| Reply time on eqai.study | about 3–6 s from the student's words to the bear's first sound: Claude 2.5–4.8 s at high effort, voice about 0.5 s |

Full tables: [training/RESULTS.md](training/RESULTS.md). **Not measured yet:** accuracy on real, accented
student speech and faces. RAVDESS is acted English speech, so expect lower accuracy in real use.

## Privacy

- **Camera** (optional): frames go only to EQ.ai's own Jetson, are analyzed live, and are never stored.
- **Voice**: goes to Cartesia's cloud to become text, and to the Jetson for the emotion estimate. EQ.ai stores none of it.
- **Messages** and short emotion labels go to Claude (Anthropic) to write the replies.
- The advisor view never includes your mood estimates unless you tick the box to share them.
- **Nothing is kept unless you ask for a person.** After you click **OK**, your first name, the topic, the case
  note, your chat with EQ.ai and your mood estimates (only if you share them) are kept in a SQLite file on the
  Jetson for 24 hours, then deleted. The advisor view opens only with the handoff's random id.
- API keys stay on the server. The browser only gets a 10-minute Cartesia token.

The setup screen tells students all of this. Full details: [docs/privacy.md](docs/privacy.md).

## Run it yourself

You need Python 3.12 or newer and Node.js 22 or newer. For the full experience you also need an
[Anthropic API key](https://console.anthropic.com) and a [Cartesia API key](https://play.cartesia.ai).

### 1. The chat (laptop)

```bash
git clone https://github.com/henrytran412/EQ.ai.git
cd EQ.ai
python -m venv .venv
source .venv/bin/activate                    # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r services/dialogue/requirements.txt
cp .env.example .env                         # then fill in ANTHROPIC_API_KEY and CARTESIA_API_KEY
python data/knowledge/fetch_page.py --sources data/knowledge/sources.txt    # copy the official pages
python -m uvicorn services.dialogue.app:create_app --factory --port 8000 --env-file .env
```

In a second terminal:

```bash
cd apps/student-web
npm install
VITE_API_URL=http://localhost:8000 npm run dev
# Windows PowerShell: $env:VITE_API_URL="http://localhost:8000"; npm run dev
```

Open http://localhost:5173. **No keys?** Start the web app without `VITE_API_URL`. It runs in demo mode
with sample replies and the browser's own voice.

### 2. Face and voice emotion (optional)

The trained model files are not in this repository, because of their size and the dataset licenses. Train
them with `training/` (the Kaggle runner is `training/kaggle/launch.py`), then:

1. Put each model's `model.onnx` and `preprocess.json` in `models/face/` and `models/voice/`.
2. Download the face detector: `bash scripts/fetch_models.sh`.
3. Install and start the service:

```bash
pip install -r services/perception/requirements.txt
python -m uvicorn services.perception.server:create_app --factory --port 8001 --env-file .env
```

4. Start the web app with `VITE_PERCEPTION_URL=ws://localhost:8001` as well.

### 3. Public site on a Jetson

This is how [eqai.study](https://eqai.study) runs. It needs no sudo, and everything stays in the repo folder.

1. **Install.** On a Jetson Orin (Ubuntu 24.04, L4T 39), clone the repo to `~/eq-ai` and run
   `scripts/setup_jetson.sh`. It installs the packages, the CUDA 13 libraries and NVIDIA's Jetson build of
   ONNX Runtime into `.venv`.
2. **Add files.** Add `.env` with `ALLOWED_ORIGINS=https://your.domain`, the models in `models/`, and the
   copied pages.
3. **Start.** Run `scripts/serve_jetson.sh start`. This starts dialogue, perception and the site on
   127.0.0.1, and restarts any of them after a crash. `stop` and `status` also work.
4. **Tunnel.** Put your domain on Cloudflare (Free plan), then on the Jetson:
   1. Download `cloudflared` to `bin/`.
   2. Run `HOME="$PWD" bin/cloudflared tunnel login` and approve the link.
   3. Run `scripts/setup_tunnel.sh your.domain`, then `scripts/serve_jetson.sh start` again.
5. **Publish the site.** From your laptop, run `scripts/deploy_site.sh https://your.domain`. It uses an
   `ssh jetson` alias, builds the site, refuses to deploy if an API key is inside, and swaps the site into place.

### Tests

```bash
python -m unittest discover -s tests          # 113 Python tests
cd apps/student-web && npm test               # 32 web app tests
```

## Configuration (`.env`)

| Setting | What it does |
|---|---|
| `ANTHROPIC_API_KEY`, `CARTESIA_API_KEY` | API keys. These stay on the server. |
| `CLAUDE_MODEL`, `DIALOGUE_EFFORT` | Claude model and effort (`low`, `medium`, `high`). Lower effort replies faster. |
| `ALLOWED_ORIGINS` | Websites allowed to call the services, e.g. `https://eqai.study,http://localhost:5173`. |
| `CHAT_LIMIT`, `TOKEN_LIMIT` | Per-IP limits on paid calls, as `hits/seconds` (default 60 chats and 30 voice tokens per 10 minutes). |
| `CAMPUS_COUNSELING` | One line added to distress replies, e.g. the counseling center's phone number. |
| `CARTESIA_VOICE_ID`, `CARTESIA_TTS_MODEL`, `CARTESIA_STT_MODEL` | Optional voice and model overrides (defaults: the "Maya" voice, `sonic-3.5`, `ink-2`). |
| `HANDOFF_DB`, `HANDOFF_LIMIT` | Optional: the SQLite file for handoffs (default `data/handoffs.db`), and the per-IP limit on advisor-view loads (default 300 per 10 minutes). |

The web app reads `VITE_API_URL` and `VITE_PERCEPTION_URL` when it is built (see `apps/student-web/.env.example`).

## Project structure

```
apps/student-web/    React + Vite web app: landing, setup, chat, advisor view (/advisor), plain mode (/plain)
services/dialogue/   FastAPI: /chat, /handoffs, /voice/token, /signals; Claude, page search, behavior policy, handoff database
services/perception/ FastAPI WebSocket: face and voice emotion models (ONNX on the Jetson GPU)
data/knowledge/      the list of official SJSU pages and the script that copies them
training/            dataset preparation, training, Kaggle runner, measured results
scripts/             Jetson setup, serve and tunnel scripts, site deploy, model download, Cartesia test
docs/                architecture and privacy notes
tests/               Python tests (web app tests live next to the code in apps/student-web/src)
demo/                demo script and video notes
```

## Limitations

- **Emotion estimates can be wrong**, especially for accented or non-native speech. That is why voice
  alone never triggers an action, and the bear asks before acting on frustration.
- **The voice model learned from acted English speech** (RAVDESS). Real-world accuracy is not measured yet.
- **Answers only cover the 26 copied SJSU pages.** If they don't cover a question, the bear says so and
  offers an advisor instead of guessing.
- **The advisor view is a demo.** It shows what an advisor would get; nothing is sent to SJSU staff.
- **One Jetson serves the public site**, so it handles a few visitors at a time. If the network drops,
  the site is down briefly; the tunnel reconnects within seconds.

## Credits

- Built by Tran Thuc Bao (solo) at Cal Hacks 13.0.
- **AI coding assistants:** Claude Code (Anthropic) and Codex (OpenAI) helped write the code. All results above were measured.
- **Services:** Claude (Anthropic API) for replies and case notes; Cartesia (Ink 2, Sonic 3.5) for the voice.
- **Datasets:**
  - AffectNet (academic license; not redistributed here).
  - RAVDESS (Livingstone and Russo, 2018; CC BY-NC-SA 4.0).
- **Pretrained models:** ConvNeXt-Tiny (timm), WavLM-base-plus (Microsoft), and the YuNet face detector (OpenCV Zoo).
- **Infrastructure:** training on Kaggle GPUs; hosting on an NVIDIA Jetson Orin Nano behind Cloudflare Tunnel.

License: [MIT](LICENSE).
