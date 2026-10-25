"""Handoff store (SQLite): what an advisor would get when a student asks for a person.

A row exists only after the student clicks OK on the handoff confirmation, and holds what that screen lists:
first name, topic, Claude's case note, the chat with EQ.ai, and the estimated mood per message only if the
student agreed to share it. Rows are deleted RETENTION_SEC after they were created.
"""

import json
import secrets
import sqlite3
import threading
import time

RETENTION_SEC = 24 * 3600
MAX_ROWS = 1000  # a cap on disk use: about 250 MB at the largest allowed handoff


class Full(Exception):
    """MAX_ROWS handoffs are already stored."""


class HandoffStore:
    def __init__(self, path: str, retention_sec: float = RETENTION_SEC, clock=time.time, max_rows: int = MAX_ROWS):
        self.path, self.retention, self.clock, self.max_rows = path, retention_sec, clock, max_rows
        self.lock = threading.Lock()
        self.db: sqlite3.Connection | None = None

    def _run(self, fn):
        """fn(db) in one transaction, after deleting expired rows. The file is opened on first use, so a
        service that never hands off creates no file."""
        with self.lock:
            if self.db is None:
                # shortcut: one connection behind a lock (one process on one Jetson); a shared server DB to scale out
                self.db = sqlite3.connect(self.path, check_same_thread=False)
                self.db.execute("PRAGMA secure_delete = ON")  # deleted chats are overwritten in the file, not just unlinked
                self.db.execute("CREATE TABLE IF NOT EXISTS handoffs "
                                "(id TEXT PRIMARY KEY, created_at REAL NOT NULL, data TEXT NOT NULL)")
            with self.db:  # commit on success, roll back on error
                self.db.execute("DELETE FROM handoffs WHERE created_at < ?", (self.clock() - self.retention,))
                return fn(self.db)

    def create(self, fields: dict) -> dict:
        now = self.clock()
        # The id is a random 128-bit secret: only the student's page and its advisor-view tab know it.
        h = {**fields, "id": secrets.token_urlsafe(16), "created_at": int(now * 1000)}
        def insert(db):
            if db.execute("SELECT COUNT(*) FROM handoffs").fetchone()[0] >= self.max_rows:
                raise Full
            db.execute("INSERT INTO handoffs VALUES (?, ?, ?)", (h["id"], now, json.dumps(h, ensure_ascii=False)))
        self._run(insert)
        return h

    def purge(self) -> None:
        """Delete expired rows (every call does this too; this is for when nobody calls)."""
        self._run(lambda db: None)

    def get(self, hid: str) -> dict | None:
        row = self._run(lambda db: db.execute("SELECT data FROM handoffs WHERE id = ?", (hid,)).fetchone())
        return json.loads(row[0]) if row else None
