**Try it live: [eqai.study](https://eqai.study)** (Chrome or Edge on a laptop, allow the microphone) · **Code:** [github.com/henrytran412/EQ.ai](https://github.com/henrytran412/EQ.ai)

## Inspiration

My inspiration comes from my own life. Whenever I had a problem, like a login issue, opening a bank account or depositing money, I first had to get through an automated chatbot before I could reach a real person. Every time, the same things frustrated me: it spoke too fast, and it didn't feel human or supportive. I wanted a real conversation, with someone who understood my problem and showed empathy and support. That gave me the idea for an adaptive conversational AI that changes its tone and the way it speaks based on the user's real situation and emotions.

There was a second problem. When I was finally moved to a real person, some of my information wasn't passed along, and I had to repeat everything again. The same thing happened at my school.

International students at San José State University (SJSU) deal with the same high-stakes paperwork as every student, like financial aid holds, registration deadlines, scholarship rules and visa questions, but often in their second language. The answers do exist, but they are spread across official pages from Financial Aid, the Bursar, the Registrar and International Student and Scholar Services (ISSS), written in dense English.

So I built EQ.ai to help international students handle stressful problems like holds and visa questions in the easiest way possible. It notices when you seem confused and changes **how** it talks, with simpler words and a slower, calmer voice. When it can't help, it hands you to a person with your case already written, so you **explain it once**. The goal is not to replace advisors. It is to get students to the right person faster.

## What it does

EQ.ai is a voice assistant, shown as a friendly cartoon bear, for **international and non-native-English-speaking students at SJSU** who are stuck on a stressful school problem. The demo covers one flow and does it well: **a financial aid hold that blocks registration, with a deadline coming.**

1. The student enters a first name, picks a topic and chooses voice or text. The camera is optional and off by default.
2. They talk or type. **Cartesia Ink 2** turns speech into text. My own face and voice models, running on an **NVIDIA Jetson**, estimate how the student seems to feel.
3. **Claude** estimates the student's state and writes a 1–3 sentence answer **only from official SJSU pages**, with citations. If the pages don't cover the question, the bear says so and offers an advisor instead of guessing.
4. The bear changes **how it says the answer**, and **Cartesia Sonic** speaks it with the matching emotion and speed:

| Estimated state | What the bear does | Voice |
|---|---|---|
| neutral | answers normally and cites the page | neutral, 1.0× |
| nervous | slows down and reassures | calm, 0.85× |
| confused | rephrases in simpler words | calm, 0.8× |
| frustrated | checks first ("Am I reading that right?"), then offers an advisor | calm, 0.9× |
| distress | stops the task, shares the 988 Suicide & Crisis Lifeline, offers a person | calm, 0.8× |

5. Clicking **Talk to a person** at any time turns the conversation into an **advisor case note**: the problem, any deadline, what the student already tried, and a first step. The student decides whether to share their emotion estimate, which is off by default.
6. The handoff goes to an **advisor console** on any device. The advisor sees the case note and the student's whole chat with EQ.ai, takes the chat, and replies. The reply appears in the student's chat, so the student **explains it once**. In this demo, the advisor is whoever has the console's access code, not SJSU staff.

An **emotion map** shows what the system estimated, from which signal (face, voice or words), and how confident it is, so you can see why the tone changed. The bear never claims to feel or understand emotions. It shows an estimate and asks before acting on it.

Emotion-aware voice already exists: Hume AI builds emotion-aware voice, and Ted.AI (Cal Hacks 12) was an emotion-adaptive teddy bear for children. EQ.ai is different in three ways:
- **Who it serves:** international students at one named university.
- **What it is for:** solving a real school problem and handing it to a human.
- **How it handles uncertainty:** it asks before it acts.

## How we built it

I built it solo. Everything runs on one **NVIDIA Jetson Orin Nano**, published at **eqai.study** through a Cloudflare Tunnel.

```
Browser (eqai.study)                       Jetson Orin Nano
  camera (optional) -- 2 frames/s ------>   face model (ConvNeXt-Tiny, GPU) --+
  microphone -------- 16 kHz audio ----->   voice model (WavLM, GPU) ---------+--> labels only ("confused 0.7")
  student's words ---------------------->   official SJSU pages (BM25 search) -> Claude -> safety policy in code
  <------------- reply + emotion + speed --
  microphone ---> Cartesia Ink 2 (speech to text, turn detection)
  reply --------> Cartesia Sonic 3.5 (speaks with the chosen emotion and speed)
```

**Claude (Anthropic API, Sonnet 5.5 at high effort).** Each student message gets one Claude call with **structured outputs** (a JSON schema). Claude reads the student's words plus short labels from the face and voice models, never images or audio. It returns the estimated state, its confidence, and the reply. The reply may only use the official passages it was given. Those come from a BM25 search over **26 official SJSU pages (523 passages)**, copied word for word. A second Claude call writes the advisor case note from the conversation only.

**Where Claude could go wrong, and what I did about it:**
- **Wrong aid information.** Claude answers only from the retrieved official pages, cites them, says when the pages don't cover the question, and never guesses eligibility or deadlines.
- **Misreading emotion.** Accents and non-native speech can fool emotion models. A behavior policy in code (`policy.py`) sits between Claude and the student:
  - Voice alone never triggers an action. If only the voice model thinks a student is upset, the bear asks instead of assuming.
  - Frustration is confirmed with the student before an advisor is suggested.
- **A student in crisis.** Distress always shows 988 and offers a person, whatever the model writes. That rule is in code, with tests, not only in the prompt.
- **A wrong case note.** The note is written from the conversation only and never describes emotions. If Claude fails, the advisor sees the student's own words, labeled "In their words", instead of an invented summary.
- **Privacy.** Only text and labels go to Claude. Nothing is stored unless the student asks for a person; then the handoff is kept for 24 hours and deleted.

**Cartesia: the voice is the product.** In EQ.ai, the adaptation is something you hear.
- **Ink 2** (speech to text) streams the microphone straight from the browser. Its turn detection decides when the student has finished, which gives room to someone pausing to find the right English word. I also send SJSU keyterms (MySJSU, FASO, Bursar, ISSS, FAFSA, F-1…) so campus words are recognized.
- **Sonic 3.5** (text to speech) speaks every reply with the `emotion` and `speed` the policy picks. Audio is streamed over a WebSocket and plays as it arrives, with about **0.5 s to first sound**.
- I measured speed control before choosing a model. "Calm, 0.8×" came out **15% slower** than "neutral, 1×" on Sonic 3.5, against 9% on Sonic 3.6, so I chose Sonic 3.5.
- API keys stay on the server. The browser only gets a 10-minute Cartesia access token, rate-limited per visitor.

**My own emotion models, on an edge GPU.**
- **Face:** ConvNeXt-Tiny (an architecture from Meta AI research), fine-tuned on AffectNet with 7 emotions. YuNet finds the face first.
- **Voice:** WavLM-base-plus (Microsoft), fine-tuned on RAVDESS with 7 emotions, split by actor. It reads 3-second windows of audio.
- I trained both with PyTorch and timm on Kaggle's free T4 GPUs and exported them to ONNX.
- They run on the Jetson's GPU with ONNX Runtime and CUDA: **19.6 ms** per face prediction and **83 ms** per voice prediction, about 6× faster than its CPU. Only labels leave the Jetson.

**The live site.** The Jetson runs the React + TypeScript web app, a FastAPI dialogue service and a WebSocket perception service. Each is bound to localhost and restarts itself after a crash. The tunnel exposes only the public routes, and paid API calls are rate-limited per visitor. The project has **113 Python tests and 32 web tests**.

**The handoff database.** Handoffs live in **SQLite** on the Jetson: free, built into Python, nothing to set up. A row is created only when the student clicks "Connect me", holds only what the consent screen lists, and is deleted after 24 hours. The advisor console needs an access code, and the student's page and the console check for new messages every 2 seconds.

## Challenges we ran into

- **A benchmark that flattered me.** In the AffectNet copy I trained on, the test "sad" folder was made entirely of copies of training and validation images. Duplicates like that inflate accuracy. I re-split all 23,792 images by perceptual hash, so no test image is a copy of a training image, and retrained. The honest number is lower, and it is the one I report.
- **CUDA 13 on a Jetson, without sudo.** The Jetson runs L4T 39.2 with CUDA 13.
  - The standard `onnxruntime-gpu` package has no kernels for the Orin GPU.
  - Asking for TensorRT, which wasn't installed, silently fell back to the CPU.
  - I found NVIDIA's Jetson build of ONNX Runtime and installed the CUDA 13 libraries into one folder.
  - I checked that GPU and CPU outputs match, with a maximum logit difference under 0.0014.
- **Hackathon Wi-Fi vs. QUIC.** The Cloudflare tunnel kept dropping every connection at once on the venue Wi-Fi, so the site returned 502 errors. Running the tunnel over HTTP/2 (TCP) instead of QUIC fixed it.
- **Tables broke the answers.** SJSU explains holds in a table, and my page copier split tables into single cells. The bear said it couldn't explain the hold. Now each table row becomes one passage labeled with its column headers ("Hold: … | What does it do?: …").
- **Care vs. speed.** Claude at high effort gives careful, grounded answers but takes 2.5–4.8 s, and Cartesia adds about 0.5 s. I kept high effort, because a wrong answer about a hold costs a student more than a short pause. The reply time is shown on screen, not hidden.

## Accomplishments that we're proud of

- **It works today, for anyone.** Open **eqai.study** in a browser and talk. There is nothing to install. The whole site is served from one Jetson Orin Nano. The name says what it is: EQ for emotional intelligence, and `.study` because it's for students.
- **You can hear the difference.** When a student is confused, the same kind of answer comes back simpler, slower and calmer. The change is in the voice, not just a label on a screen.
- **Models I trained myself, with honest numbers:**
  - **Face:** **78.4%** accuracy (macro-F1 0.773) on 2,395 test images. That beats my MobileNetV3 baseline at 73.2%.
  - **Voice:** **87.5%** (macro-F1 0.884) on 4 actors the model never heard in training.
  - **Full face pipeline on the Jetson:** 78.1% on 210 test faces, which matches the offline test.
  - Every number was measured, and the README says plainly what wasn't.
- **Safety that doesn't depend on the model behaving.** The rules are code with tests.
- **Privacy by default.** Nothing is kept unless the student asks for a person, and handoffs are deleted after 24 hours. The camera is opt-in. Images and audio are never stored. An advisor sees the emotion estimate only if the student agrees.
- **A solo build.** Data cleaning, two trained models, edge GPU deployment, the voice pipeline, the Claude integration, the web app and the public domain were all built by one person in one weekend.

## What we learned

- **Check the data before trusting the number.** Duplicates between training and test can make a model look better than it is.
- **Emotion estimates are guesses, so design for being wrong.** The most important feature isn't detection. It is asking "Am I reading that right?" and letting the student correct it.
- **Pace and tone are part of the answer.** The same facts land differently when they are spoken slower and calmer.
- **Put the rules that must hold in code.** The prompt guides Claude. The code guarantees that 988 shows up.
- **One well-designed Claude call can replace a pipeline.** I first planned to fine-tune a separate small model just for tone. A single structured Claude call that estimates the state and writes the reply keeps the words and the tone in agreement, and it freed time for the parts that needed it.
- **Real hardware fights back.** CUDA versions, missing permissions and venue Wi-Fi took as much care as the models did.

## What's next for EQ.ai

- **Test it with international students at SJSU**, with their consent, and measure accuracy on real, accented speech. RAVDESS is acted English speech, so I expect lower accuracy in real use, and I won't claim otherwise until it's measured.
- **Connect the advisor console to real SJSU advisors**, with the student's consent, together with offices like Financial Aid and ISSS.
- **Reply in the student's first language**, while keeping the official sources linked.
- **Faster replies**, by streaming Claude's answer into Sonic sentence by sentence.
- **More flows**, starting with scholarships and visa-status questions. These will give official information only, always point to ISSS, and never give immigration advice.
- **Other campuses.** The knowledge base is a list of official URLs, so another school can start with its own list.

---

*Built solo at Cal Hacks 13.0. AI coding assistants (Claude Code by Anthropic, and Codex by OpenAI) helped write the code. All results above were measured. EQ.ai is a student project, not an official SJSU service.*
