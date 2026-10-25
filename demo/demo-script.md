# EQ.ai demo video script

**Goal:** show the same problem told to a plain chatbot and to EQ.ai side by side, then the advisor handoff.
Aim for about 2–3 minutes, and check the video length limit on the Cal Hacks Devpost page.

**Scenario:** you are an international student. A hold on MySJSU blocks spring registration, and
registration opens Friday.

## 1. Before you record

- [ ] The Jetson is on, and https://eqai.study loads. If it doesn't, ask Claude Code to check the services.
- [ ] If you want the newest UI in the video, deploy it first (`scripts/deploy_site.sh https://eqai.study`).
- [ ] Use Chrome on the laptop. When Chrome asks, allow the microphone and camera.
- [ ] Put a light in front of you (not behind), with the camera at eye level and your whole face in view.
- [ ] Bluetooth headset:
  - Pick it as the microphone in Chrome.
  - Make a 20-second test recording and listen to the bear's voice.
  - If the bear sounds muffled, the headset has switched to "hands-free" mode. Set the sound output to the laptop speakers, or use wired earbuds.
- [ ] Turn on Windows Focus (Do not disturb) and close other tabs.
- [ ] Reload the page before each take, so every take starts with a fresh chat.
- [ ] Recording: record each side as its own clip, then put them side by side in **Clipchamp** (built into Windows 11).
- [ ] Record the narration afterward as a voice-over. If you narrate live, the bear transcribes it.

## 2. The plain chatbot (left side)

- Choose a **scripted support chatbot**, like the bank or login bots that frustrated you. Don't use ChatGPT
  or Claude: they already sound kind in text, so the comparison would be unfair and weaker.
- **Type the same four lines** below, word for word.
- Record what it really says. Don't edit or stage its replies.
- Hide its name and logo (blur or crop) and call it "a typical automated chatbot". The point is the
  pattern, not one company.

## 3. The lines (same words on both sides)

Setup on EQ.ai:
1. Click **Get started** and enter your first name.
2. Pick the topic **Financial aid hold**.
3. Set talk to **Voice** and the reply to **Voice**, and turn the **camera on**.
4. Click **Start chat**.

| # | Say this | Your face | Your voice | EQ.ai should… |
|---|---|---|---|---|
| 1 | "Hello. There is a hold on my MySJSU account. How do I get it removed so I can register for spring classes?" | Relaxed, normal | Normal speed and volume | Estimate **neutral**. Answer from the official holds page and cite it. Voice: neutral, 1.0×. (Don't say "What does that mean?": in testing, that phrase made Claude read line 1 as confused.) |
| 2 | "Sorry… my English is not so good. It says something about a To Do List from financial aid? I don't understand. What do I need to do?" | Eyebrows pulled together, head tilted, a small squint | Slow, with pauses and "um" | Estimate **confused**. Use simpler words and give one concrete step (upload the documents on the MySJSU To Do List). Voice: calm, **0.8×**, audibly slower. Thinking face. |
| 3 | "I already uploaded my tax documents three days ago, and the hold is still there! Registration opens on Friday, and nobody answers the phone!" | Eyebrows down, tight lips, a small head shake | Louder, faster, sharper | Estimate **frustrated**. Check before acting: "It sounds like this has been frustrating. Am I reading that right?" Voice: calm, 0.9×. May mention that documents take 1–3 business days to clear. |
| 4 | "Yes… I'm really stressed about it." | Sigh, eyes down | Quieter, tired | Thank you for confirming, then offer to connect you with an advisor. |

**Rehearsal result (2026-10-24, typed text, no face or voice signals, live site):** the states were neutral 0.6, then confused 0.7, then frustrated 0.75 (it asked "Am I reading that right?" and offered an advisor), then frustrated 0.7 (it offered an advisor). Claude took 2–3 s for lines 1–2 and 5–7 s for lines 3–4, so trim those pauses when you edit.

Then click **Talk to a person**:
- Show the choice to share your emotion estimate, which is **off** by default.
- Click **Connect me**.
- Hold the **case note** on screen for about 5 seconds. It should list the problem (a hold blocking
  registration), the deadline (Friday), what you tried (uploaded tax documents three days ago, called with
  no answer), and a first step for the advisor.

The plain chatbot gets the same four lines. For the handoff, film whatever it really does: a "contact us"
link, a phone number, or nothing.

**What to point at on the emotion map** (right panel on a laptop): the face reading, the voice reading,
and the final state with its confidence. If the face says something different from the final state, leave
it in the video. It shows the system is an estimate that checks with you, which is honest.

**Tips for the readings:**
- **Words carry the most weight.** Claude reads your words first, and the face and voice add evidence.
  Voice alone never changes what the bear does; it can only make the bear ask.
- **The face model has no "confused" emotion.** It knows anger, disgust, fear, happy, neutral, sad and
  surprise. For line 2 it may read surprise, fear or sad. That's fine, because your words say "I don't
  understand".
- **The voice model learned from actors.** A clear, slightly acted tone works better than a subtle one.

## 4. Shot list and narration (voice-over)

| Time | On screen | Narration |
|---|---|---|
| 0:00–0:15 | You, or a black screen with text | "Every time I needed help, with a login, a bank account or a deposit, I had to get past a chatbot first. It talked too fast, and it didn't feel human. When I finally reached a person, I had to explain everything again. Then it happened at my school." |
| 0:15–0:22 | Landing page, eqai.study | "This is EQ.ai, a voice assistant for international students at San José State, built for one problem: a hold that blocks registration." |
| 0:22–0:32 | Setup screen | "I pick my problem and choose voice. The camera is optional, and nothing is stored." |
| 0:32–0:50 | Split screen, line 1 | "On the left, a typical automated chatbot. On the right, EQ.ai. Same words." |
| 0:50–1:15 | Split screen, line 2 | "When I'm confused, the plain bot answers the same way. EQ.ai uses simpler words, and Cartesia Sonic speaks calmer and slower." |
| 1:15–1:40 | Split screen, line 3 | "When I'm frustrated, EQ.ai doesn't assume. It asks: am I reading that right? Emotion estimates can be wrong, especially with accents, so it checks first." |
| 1:40–2:10 | Line 4, then the handoff and case note | "I ask for a person. I decide whether my emotion estimate is shared. The advisor gets a case note that Claude wrote from our chat: the problem, the deadline, what I tried, and a first step. I explain it once." |
| 2:10–2:40 | Emotion map, then a quick shot of the Jetson | "Cartesia Ink 2 turns my speech into text. My own face and voice models run on this NVIDIA Jetson, and only labels leave it. Claude reads my words and those labels, estimates my state, and answers only from official SJSU pages, with citations. Safety rules live in code: voice alone never triggers an action, and distress always shows the 988 lifeline." |
| 2:40–2:50 | Landing page | "EQ.ai notices, it adapts, and you only explain it once. Try it at eqai.study." |

If you cut waiting time between your words and the bear's reply, add a small caption: "pauses shortened".
Never speed up the bear's voice, because its speed is the feature you are showing.

## 5. Optional bonus clip: the safety rule

Record this only if you are comfortable, and as a separate short clip. It ends the task flow, so keep it
out of the main take.

- Say: "I can't do this anymore. I feel hopeless."
- EQ.ai should stop the task, reply with care, show the **988 Suicide & Crisis Lifeline** and campus
  counseling, and offer a person.
- Narration: "If a student sounds like they're in crisis, the bear stops and shares real help. That rule is
  in code, not left to the model."

## 6. If something goes wrong while recording

| Problem | What to do |
|---|---|
| The bear picks the wrong state | Say the words more clearly; words matter most. Make the face and voice bigger. Reload and try again. |
| The face reading stays "neutral" | Face the camera directly, add front light, and make a bigger expression. |
| "Voice is busy", or no reply | Rate limit: 60 messages and 30 voice tokens per 10 minutes per visitor. Wait a few minutes. If it keeps failing, check that the Jetson is on. |
| The bear's voice is muffled in the recording | See the Bluetooth tip in section 1. |
| The bear transcribes your narration | Mute the mic, or record the narration afterward. |
