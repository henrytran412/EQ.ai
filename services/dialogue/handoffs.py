"""Handoff store (SQLite): what an advisor needs to pick up a student's case, on any device.

A row exists only after the student clicks "Connect me", and holds what the consent screen lists: first name,
topic, the case note, the chat with EQ.ai, the emotion estimate only if the student shared it, then the messages
between the student and the advisor. Rows are deleted RETENTION_SEC after they were created.
"""

import json
import secrets
import sqlite3
import threading
import time

RETENTION_SEC = 24 * 3600
MAX_MESSAGES = 200  # per handoff, so one chat can't grow without bound


class Closed(Exception):
    """The handoff is resolved, or already has MAX_MESSAGES messages."""


class HandoffStore:
    def __init__(self, path: str, retention_sec: float = RETENTION_SEC, clock=time.time):
        self.path, self.retention, self.clock = path, retention_sec, clock
        self.lock = threading.Lock()
        self.db: sqlite3.Connection | None = None

    def _run(self, fn):
        """fn(db) in one transaction, after deleting expired rows. The file is opened on first use, so a
        service that never hands off creates no file."""
        with self.lock:
            if self.db is None:
                # shortcut: one connection behind a lock (one process on one Jetson); a shared server DB to scale out
                self.db = sqlite3.connect(self.path, check_same_thread=False)
                self.db.execute("CREATE TABLE IF NOT EXISTS handoffs "
                                "(id TEXT PRIMARY KEY, created_at REAL NOT NULL, data TEXT NOT NULL)")
            with self.db:  # commit on success, roll back on error
                self.db.execute("DELETE FROM handoffs WHERE created_at < ?", (self.clock() - self.retention,))
                return fn(self.db)

    def create(self, fields: dict) -> dict:
        now = self.clock()
        # The id is a random 128-bit secret: the student's page uses it to read its own handoff.
        h = {**fields, "id": secrets.token_urlsafe(16), "version": 1, "status": "waiting", "staff_id": None,
             "messages": [], "created_at": int(now * 1000)}
        self._run(lambda db: db.execute("INSERT INTO handoffs VALUES (?, ?, ?)", (h["id"], now, json.dumps(h))))
        return h

    def get(self, hid: str) -> dict | None:
        row = self._run(lambda db: db.execute("SELECT data FROM handoffs WHERE id = ?", (hid,)).fetchone())
        return json.loads(row[0]) if row else None

    def all(self) -> list[dict]:
        rows = self._run(lambda db: db.execute("SELECT data FROM handoffs ORDER BY created_at DESC").fetchall())
        return [json.loads(r[0]) for r in rows]

    def _update(self, hid: str, change) -> dict | None:
        """change(h) edits the handoff in place or raises Closed; None if there is no such handoff."""
        def run(db):
            row = db.execute("SELECT data FROM handoffs WHERE id = ?", (hid,)).fetchone()
            if not row:
                return None
            h = json.loads(row[0])
            change(h)
            h["version"] += 1  # pages keep the newest version they have seen
            db.execute("UPDATE handoffs SET data = ? WHERE id = ?", (json.dumps(h), hid))
            return h
        return self._run(run)

    def add_message(self, hid: str, sender: str, text: str) -> dict | None:
        def change(h):
            if h["status"] == "resolved" or len(h["messages"]) >= MAX_MESSAGES:
                raise Closed
            h["messages"].append({"from": sender, "text": text, "at": int(self.clock() * 1000)})
        return self._update(hid, change)

    def set_status(self, hid: str, status: str, staff_id: str) -> dict | None:
        def change(h):
            if h["status"] == "resolved":
                raise Closed
            h["status"] = status
            if status == "active":
                h["staff_id"] = staff_id
        return self._update(hid, change)
