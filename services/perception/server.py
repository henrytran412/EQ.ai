"""Perception WebSocket server (runs on the Jetson).

The browser streams camera JPEGs (opt-in) and 16 kHz mic audio; this server tracks the
student's face, runs the face and voice classifiers, smooths the results, sends a reading
back about once a second, and posts labels (never media) to the dialogue service.

Run from the repo root:
  .venv/Scripts/uvicorn services.perception.server:create_app --factory --host 0.0.0.0 --port 8001 --env-file .env
Env: DIALOGUE_URL (default http://localhost:8000), ALLOWED_ORIGINS, PERCEPTION_MODELS.
"""

import io
import logging
import os
import time
from typing import Callable

import cv2
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from PIL import Image
from starlette.concurrency import run_in_threadpool

from .core import AudioWindow, EmaSmoother, expand_box, is_speech, parse_message, pick_face

log = logging.getLogger("perception")
SAMPLE_RATE = 16000
VOICE_EVERY_SEC = 1.0  # classify the latest window at most once per second
MAX_FRAME_PIXELS = 1280 * 960  # webcam frames are 640 px wide; a tiny JPEG can claim gigapixels and exhaust memory
MAX_SOCKETS = 50  # each open socket holds a 3 s audio window; a flood of sockets would exhaust memory


def http_poster(url: str) -> Callable[[dict], None]:
    import httpx
    client = httpx.Client(timeout=2.0)

    def post(body: dict) -> None:
        try:
            client.post(url, json=body)
        except httpx.HTTPError as e:
            log.warning("could not reach dialogue service: %s", e)
    return post


def create_app(detector=None, face=None, voice=None, post_signals: Callable[[dict], None] | None = None,
               allowed_origins: list[str] | None = None, min_interval_sec: float = 1.0,
               min_frame_sec: float = 0.25, max_sockets: int = MAX_SOCKETS) -> FastAPI:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s:     %(name)s: %(message)s")  # uvicorn hides app logs
    logging.getLogger("httpx").setLevel(logging.WARNING)  # otherwise one line per /signals post
    if detector is None and face is None and voice is None:
        from .models import load_defaults
        detector, face, voice = load_defaults()
    if post_signals is None:
        post_signals = http_poster(os.environ.get("DIALOGUE_URL", "http://localhost:8000").rstrip("/") + "/signals")
    origins = set(allowed_origins or os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173").split(","))
    app = FastAPI(title="EQ.ai perception")

    def classify_frame(jpeg: bytes, previous):
        try:
            width, height = Image.open(io.BytesIO(jpeg)).size  # reads only the header, no decoding
        except Exception:  # noqa: BLE001 - not an image
            return None
        if width * height > MAX_FRAME_PIXELS:
            return None
        bgr = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
        if bgr is None:
            return None
        height, width = bgr.shape[:2]
        box = pick_face(detector.detect(bgr), previous) if detector else None
        if box is None:
            return box, None, (width, height)
        x, y, w, h = expand_box(box, width, height)
        rgb = cv2.cvtColor(bgr[y:y + h, x:x + w], cv2.COLOR_BGR2RGB)
        return box, face.predict(rgb), (width, height)

    @app.get("/health")
    def health():
        return {"face": face is not None and detector is not None, "voice": voice is not None}

    live = {"sockets": 0}

    @app.websocket("/ws/{session_id}")
    async def stream(ws: WebSocket, session_id: str):
        if ws.headers.get("origin") not in origins or not 0 < len(session_id) <= 100:
            await ws.close(code=1008)
            return
        if live["sockets"] >= max_sockets:
            await ws.close(code=1013)  # try again later; the web app reconnects every 3 s
            return
        await ws.accept()
        live["sockets"] += 1
        face_s = EmaSmoother(face.labels if face else [], alpha=0.3, timeout_sec=3.0)
        voice_s = EmaSmoother(voice.labels if voice else [], alpha=0.5, timeout_sec=4.0)
        window = AudioWindow(SAMPLE_RATE, voice.window_sec) if voice else None
        previous, box_norm, last_voice, last_emit = None, None, float("-inf"), float("-inf")
        last_frame = float("-inf")
        try:
            while True:
                try:
                    kind, payload = parse_message(await ws.receive_bytes())
                except ValueError as e:
                    await ws.close(code=1003, reason=str(e))
                    return
                now = time.monotonic()
                if kind == "video" and face and detector:
                    if now - last_frame < min_frame_sec:
                        continue  # faster than the web app ever sends (2/s): drop so one socket can't hog the GPU
                    last_frame = now
                    result = await run_in_threadpool(classify_frame, payload, previous)
                    if result is None:
                        continue  # undecodable frame: skip it, keep the connection
                    previous, probs, (width, height) = result
                    if previous is not None:
                        face_s.update(probs, now)
                        x, y, w, h = previous
                        box_norm = [round(x / width, 4), round(y / height, 4), round(w / width, 4),
                                    round(h / height, 4)]
                elif kind == "audio" and window is not None:
                    window.push(payload)
                    clip = window.window()
                    if clip is not None and now - last_voice >= VOICE_EVERY_SEC and is_speech(clip):
                        voice_s.update(await run_in_threadpool(voice.predict, clip), now)
                        last_voice = now

                if now - last_emit >= min_interval_sec:
                    last_emit = now
                    face_r, voice_r = face_s.current(now), voice_s.current(now)
                    if face_r is not None:
                        face_r["box"] = box_norm
                    await ws.send_json({"type": "reading", "ts": int(time.time() * 1000),
                                        "face": face_r, "voice": voice_r})
                    brief = lambda r: None if r is None else {"label": r["label"], "confidence": r["confidence"]}  # noqa: E731
                    await run_in_threadpool(post_signals, {"session_id": session_id, "face": brief(face_r),
                                                           "voice": brief(voice_r)})
        except WebSocketDisconnect:
            pass
        finally:
            live["sockets"] -= 1

    return app
