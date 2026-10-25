# EQ.ai: 3-minute pitch script and judge Q&A

Goes with the one-slide board. Plan: slide for 30 s, live demo for 90 s, slide again for the last minute.
Spoken words are in quotes. Short sentences on purpose: say them slowly.

## Before you start
- Open two tabs: **eqai.study** (setup done: your name, Financial aid hold, Text + Voice replies, camera on)
  and the **slide**. Keep the demo video ready as a backup if the Wi-Fi drops.
- Type your demo lines (faster and safer than speaking in a loud room), or hold the mic for each line.
- Volume up, so judges hear the voice change.

## The script

**0:00–0:20 · Hook (slide)**
"Every time I needed help, with a login, a bank account or a deposit, a chatbot answered first.
It talked too fast, and it never noticed I was frustrated. When I finally reached a person,
I had to explain everything again. Then it happened again at my school."

**0:20–0:35 · What it is (slide)**
"This is EQ.ai, a voice assistant for international students at San José State.
It notices when you're lost, slows down, answers only from official school pages,
and hands you to a person with your case already written. So you explain it once."

**0:35–2:05 · Live demo (switch to eqai.study)**
1. Type: *"Hello. There is a hold on my MySJSU account. How do I get it removed so I can register for spring classes?"*
   While it thinks: "Every answer comes only from official SJSU pages, with the source."
   When it answers: "Normal voice, normal speed."
2. Type: *"Sorry... my English is not so good. It says something about a To Do List from financial aid? I don't understand. What do I need to do?"*
   While it thinks: "Now I sound confused."
   When it answers: "Listen: simpler words, a calmer and slower voice. Same facts."
   Point at the emotion map: "On the right you can see what it estimated, and the tone it chose."
3. Type: *"I already uploaded my tax documents three days ago, and the hold is still there! Registration opens on Friday, and nobody answers the phone!"*
   When it answers: "It doesn't assume. It asks: am I reading that right? Emotion estimates can be wrong,
   so it checks first."
4. Click **Talk to a person**. Tick **share how my mood changed**. "I choose what is shared." Click **OK**.
   On the advisor view: "This is what the advisor gets: the problem, the Friday deadline, what I tried,
   how my mood changed message by message, and where it got hard, and why.
   The advisor starts with the full story."

**2:05–2:35 · How it works (back to the slide, point at the green band)**
"Cartesia Ink 2 turns my speech into text. My own face and voice models run on this NVIDIA Jetson,
and only labels leave it. Claude estimates my state and answers only from 26 official pages.
The safety rules are code, not a prompt: voice alone never triggers an action, and distress always
shows the 988 crisis line. Cartesia Sonic speaks calmer and slower. The handoff is deleted after 24 hours."

**2:35–2:55 · Results (point at the numbers)**
"I trained both models myself. Face: 78.4% on 2,395 held-out images, up from a 73.2% baseline.
Voice: 87.5% on actors it never heard. The honest limit: the voice data is acted English,
so accuracy on real accented speech is not measured yet. That's my next step."

**2:55–3:00 · Close**
"EQ.ai notices, it adapts, and you explain it once. Try it at eqai.study. Thank you."

**If something breaks:** "The venue Wi-Fi is busy. Here's the recording of the same flow." Play the video.

## Questions judges may ask

**How accurate is the emotion detection?**
Face 78.4% on 2,395 held-out images, voice 87.5% on 4 actors the model never heard. I removed duplicate
images first, because the dataset's test set had copies of training images. Real accented speech is not
measured yet, which is why the system asks before it acts.

**What if it reads my emotion wrong, especially with an accent?**
Voice alone never changes what it does; it can only make the bear ask. For frustration it asks
"Am I reading that right?" and the student can say no. The words count most.

**How do you stop it from giving wrong financial aid information?**
Claude only gets passages from 26 official SJSU pages and must cite them. If the pages don't cover it,
it says so and offers a person. It never guesses deadlines or eligibility.

**Why Claude? Why not a fine-tuned model?**
I planned a separate fine-tuned tone model. One structured Claude call that estimates the state and writes
the grounded answer together was simpler and keeps the words and the tone consistent. The safety rules
sit in code around it, so they hold even if the model is wrong.

**How do you use Cartesia?**
Ink 2 for speech to text: its turn detection gives students time to finish, and I add campus words like
MySJSU and FASO. Sonic 3.5 speaks every reply with an emotion and speed. I measured the speed control:
calm at 0.8× came out 15% slower on Sonic 3.5, against 9% on 3.6, so I chose 3.5. First audio in about 0.5 s.

**What about privacy?**
The camera is opt-in. Frames go only to my own Jetson, are analyzed live and never stored; only labels go
to Claude. Nothing is saved unless the student asks for a person; then the handoff is kept 24 hours and
deleted. Mood estimates are shared only if the student ticks the box. Visitor IPs are not logged.

**Why run models on a Jetson instead of the cloud?**
So face and voice stay on hardware I control. On its GPU a face takes 19.6 ms and a voice clip 83 ms,
about 6× faster than its CPU. The limit: one Jetson serves only a few visitors at a time.

**How fast is it?**
About 3 to 6 seconds from your words to the bear's voice: Claude takes 2.5 to 4.8 s at high effort, the
voice about 0.5 s. I chose careful answers over speed; next I'd stream the answer into the voice.

**What happens if a student is in crisis?**
It stops the task, shares the 988 Suicide and Crisis Lifeline and campus counseling, and offers a person.
That rule is in code with tests, not left to the model.

**Did you test it with real students?**
Not formally yet. It comes from my own experience [add: friends you talked to, only if true]. A study with
international students, with consent, is the next step.

**How is this different from Hume AI or other emotion-aware bots?**
It's built for one community and one job: solving a school problem and handing it to a person. It asks
before acting, answers only from official sources, and the handoff carries the context.

**What's the plain mode?**
The same assistant, same pages and voice, with the emotion features off. It shows the difference fairly.

**How would a school use it?**
Swap in that school's official pages, and send the advisor view to their real advisor queue, with consent.

**Did you build it alone? Did you use AI tools?**
Solo, during Cal Hacks. Claude Code helped write the code, and I say so in the README. The models, the
measurements and the design decisions are mine.
