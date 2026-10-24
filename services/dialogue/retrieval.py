"""Keyword retrieval over cached official school pages (data/knowledge/pages/*.md).

Each page is Markdown with a front-matter header giving its official title and URL:
    ---
    title: Financial Aid Holds
    url: https://<school>.edu/...
    ---
Paragraphs become passages. Scoring is BM25 over lowercase word tokens.
shortcut: keyword match misses paraphrases; switch to embeddings if pages grow past a few hundred.
"""

import hashlib
import math
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

STOPWORDS = set("a an and are as at be but by can can't do for from have how i i'm if in is it my "
                "of on or so that the this to was what when where which why will with you your".split())


def tokens(text: str) -> list[str]:
    return [w for w in re.findall(r"[a-z0-9]+", text.lower()) if w not in STOPWORDS and len(w) > 1]


@dataclass(frozen=True)
class Passage:
    id: str
    title: str
    url: str
    text: str


class KnowledgeBase:
    def __init__(self, passages: list[Passage]):
        self.passages = passages
        self._tokens = [Counter(tokens(f"{p.title} {p.text}")) for p in passages]
        self._avg_len = sum(sum(t.values()) for t in self._tokens) / max(1, len(passages))
        self._df = Counter(w for t in self._tokens for w in t)

    @classmethod
    def load(cls, folder: Path) -> "KnowledgeBase":
        passages, seen = [], set()
        for page in sorted(folder.glob("*.md")) if folder.is_dir() else []:
            meta, body = _front_matter(page.read_text(encoding="utf-8"))
            if not meta.get("url"):
                continue  # only pages with an official source URL can be cited
            for i, para in enumerate(p.strip() for p in re.split(r"\n\s*\n", body) if p.strip()):
                if para in seen:
                    continue  # repeated text (page repeats, shared boilerplate) would crowd out other results
                seen.add(para)
                pid = hashlib.sha1(f"{page.name}:{i}".encode()).hexdigest()[:10]
                passages.append(Passage(pid, meta.get("title", page.stem), meta["url"], para))
        return cls(passages)

    def search(self, query: str, k: int = 3) -> list[Passage]:
        q = set(tokens(query))
        n = len(self.passages)
        scored = []
        for passage, tf in zip(self.passages, self._tokens):
            length = sum(tf.values())
            score = sum(math.log(1 + (n - self._df[w] + 0.5) / (self._df[w] + 0.5)) * tf[w] * 2.2
                        / (tf[w] + 1.2 * (0.25 + 0.75 * length / self._avg_len)) for w in q if w in tf)
            if score > 0:
                scored.append((score, passage))
        return [p for _, p in sorted(scored, key=lambda s: -s[0])[:k]]


def _front_matter(text: str) -> tuple[dict, str]:
    match = re.match(r"---\n(.*?)\n---\n(.*)", text, re.S)
    if not match:
        return {}, text
    meta = dict(line.split(":", 1) for line in match.group(1).splitlines() if ":" in line)
    return {k.strip(): v.strip() for k, v in meta.items()}, match.group(2)
