"""Copy one official school page into the knowledge base, verbatim.

  python data/knowledge/fetch_page.py https://www.sjsu.edu/<page> --out data/knowledge/pages/<name>.md

Keeps the page's main content (drops menus, scripts, footers, sidebars), collapses whitespace,
and never rewrites wording. Refuses any URL that is not https on the school's domain.
After fetching you may DELETE irrelevant paragraphs, but never edit the text that remains.
"""

import argparse
import datetime
import re
import urllib.request
from html.parser import HTMLParser
from urllib.parse import urlsplit

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
ALWAYS_SKIP = {"script", "style", "noscript", "svg", "nav", "aside", "form", "button", "iframe", "template"}
OUTSIDE_MAIN_SKIP = {"header", "footer"}
HEADINGS = {"h1", "h2", "h3", "h4", "h5", "h6"}
BLOCKS = HEADINGS | {"p", "li", "div", "section", "article", "td", "th", "dd", "dt", "blockquote", "pre", "tr", "br"}


def check_official(url: str, domain: str) -> None:
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    if parts.scheme != "https" or not (host == domain or host.endswith("." + domain)):
        raise ValueError(f"not an official https page on {domain}: {url}")


class _MainText(HTMLParser):
    """Tracks the open-element stack like a browser: void tags never open, and an end tag also
    closes any unclosed elements inside it (pages often omit </li> or </p>)."""

    def __init__(self, use_main: bool):
        super().__init__(convert_charrefs=True)
        self.use_main = use_main
        self.stack: list[tuple[str, bool, bool]] = []  # (tag, opens main, skipped)
        self.blocks: list[tuple[str, str]] = []  # (kind, text) with kind in heading/h1/li/p
        self.buffer, self.kind, self.page_title, self.in_title = [], "p", "", False

    def _in_main(self) -> bool:
        return not self.use_main or any(m for _, m, _ in self.stack)

    def _skipping(self) -> bool:
        return any(s for _, _, s in self.stack)

    def _flush(self) -> None:
        text = " ".join("".join(self.buffer).split())
        if text and self._in_main() and not self._skipping():
            self.blocks.append((self.kind, text))
        self.buffer, self.kind = [], "p"

    def handle_starttag(self, tag, attrs):
        if tag == "title":
            self.in_title = True
        if tag in VOID:
            if tag == "br" and not self._skipping():
                self.buffer.append(" ")  # a line break inside a paragraph keeps it one passage
            return
        if tag in BLOCKS and not self._skipping():
            self._flush()
        is_main = tag == "main" or dict(attrs).get("role") == "main"
        skip = tag in ALWAYS_SKIP or (tag in OUTSIDE_MAIN_SKIP and not self._in_main())
        self.stack.append((tag, is_main, skip))
        if tag in BLOCKS and not self._skipping():
            self.kind = "h1" if tag == "h1" else "heading" if tag in HEADINGS else "li" if tag == "li" else "p"

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False
        if tag in VOID or all(t != tag for t, _, _ in self.stack):
            return  # stray end tag
        start = max(i for i, (t, _, _) in enumerate(self.stack) if t == tag)
        if any(t in BLOCKS for t, _, _ in self.stack[start:]) and not self._skipping():
            self._flush()  # only block ends split passages; </a> or </strong> must not
        del self.stack[start:]

    def handle_data(self, data):
        if self.in_title:
            self.page_title += data
        elif not self._skipping():
            self.buffer.append(data)


def html_to_markdown(html: str, url: str, copied: str) -> str:
    use_main = bool(re.search(r"<main[\s>]|role=[\"']main[\"']", html, re.I))
    parser = _MainText(use_main)
    parser.feed(html)
    parser._flush()
    h1 = next((t for k, t in parser.blocks if k == "h1"), "")
    title = h1 or " ".join(parser.page_title.split()).split(" | ")[0]

    out, heading, bullets = [], [], []
    for kind, text in parser.blocks:
        if kind != "li" and bullets:
            out.append("\n".join(heading + bullets))
            heading, bullets = [], []
        if kind == "h1":
            continue
        if kind == "heading":
            heading.append(text)
        elif kind == "li":
            bullets.append(f"- {text}")
        else:
            out.append("\n".join(heading + [text]))
            heading = []
    if bullets or heading:
        out.append("\n".join(heading + bullets))
    body = "\n\n".join(out)
    return f"---\ntitle: {title}\nurl: {url}\n---\n{body}\n\nCopied {copied} from the official page.\n"


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("url")
    p.add_argument("--out", required=True)
    p.add_argument("--domain", default="sjsu.edu")
    args = p.parse_args()
    check_official(args.url, args.domain)
    request = urllib.request.Request(args.url, headers={"User-Agent": "Mozilla/5.0 (EQ.ai knowledge base copy)"})
    with urllib.request.urlopen(request, timeout=30) as response:
        html = response.read().decode(response.headers.get_content_charset() or "utf-8", errors="replace")
    md = html_to_markdown(html, args.url, datetime.date.today().isoformat())
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(md)
    print(f"{args.out}: {md.count(chr(10) + chr(10))} passages from {args.url}")


if __name__ == "__main__":
    main()
