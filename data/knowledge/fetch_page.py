"""Copy official school pages into the knowledge base, verbatim.

  python data/knowledge/fetch_page.py --sources data/knowledge/sources.txt   # all pages
  python data/knowledge/fetch_page.py https://www.sjsu.edu/<page> --out <file>.md  # one page

Keeps the page's main content (drops menus, scripts, footers, sidebars), collapses whitespace,
and never rewrites wording. Refuses any URL that is not https on the school's domain.
Copied pages are not committed; regenerate them from sources.txt.
"""

import argparse
import datetime
import re
import urllib.request
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
ALWAYS_SKIP = {"script", "style", "noscript", "svg", "nav", "aside", "form", "button", "iframe", "template"}
OUTSIDE_MAIN_SKIP = {"header", "footer"}
HEADINGS = {"h1", "h2", "h3", "h4", "h5", "h6"}
BLOCKS = HEADINGS | {"p", "li", "div", "section", "article", "dd", "dt", "blockquote", "pre", "br"}
CELLS = {"td", "th"}
HEADER_MAX = 60  # a first table row whose cells are all this short is read as column labels


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
        # Tables: one passage per row ("label: value | ..."), so a hold's name stays next to what it means.
        self.tables: list[dict] = []  # per open table: {"header": labels or None, "rows": count}
        self.row: list[str] | None = None
        self.cell: list[str] | None = None

    def _in_main(self) -> bool:
        return not self.use_main or any(m for _, m, _ in self.stack)

    def _skipping(self) -> bool:
        return any(s for _, _, s in self.stack)

    def _flush(self) -> None:
        text = " ".join("".join(self.buffer).split())
        if text and self._in_main() and not self._skipping():
            self.blocks.append((self.kind, text))
        self.buffer, self.kind = [], "p"

    def _end_cell(self) -> None:
        if self.cell is not None and self.row is not None:
            self.row.append(" ".join("".join(self.cell).split()))
        self.cell = None

    def _end_row(self) -> None:
        self._end_cell()
        row, self.row = self.row, None
        if not row or not any(row) or not self.tables:
            return
        table = self.tables[-1]
        table["rows"] += 1
        if table["rows"] == 1 and len(row) > 1 and all(0 < len(c) <= HEADER_MAX for c in row):
            table["header"] = row  # column labels, folded into every following row
            return
        header = table["header"]
        if header and len(header) == len(row):
            text = " | ".join(f"{h}: {c}" for h, c in zip(header, row) if c)
        else:
            text = " | ".join(c for c in row if c)
        if self._in_main():
            self.blocks.append(("p", text))

    def handle_starttag(self, tag, attrs):
        if tag == "title":
            self.in_title = True
        if tag in VOID:
            if tag == "br" and not self._skipping():
                # a line break inside a paragraph or table cell keeps it one passage
                (self.cell if self.cell is not None else self.buffer).append(" ")
            return
        if not self._skipping():
            if tag == "table":
                self._flush()
                self.tables.append({"header": None, "rows": 0})
            elif tag == "tr":
                self._end_row()  # the previous row may have no </tr>
                self._flush()
                self.row = []
            elif tag in CELLS:
                self._end_cell()  # the previous cell may have no </td>
                if self.row is None:
                    self.row = []
                self.cell = []
            elif tag in BLOCKS:
                if self.cell is not None:
                    self.cell.append(" ")  # a <p> inside a table cell stays in that cell
                else:
                    self._flush()
        is_main = tag == "main" or dict(attrs).get("role") == "main"
        skip = tag in ALWAYS_SKIP or (tag in OUTSIDE_MAIN_SKIP and not self._in_main())
        self.stack.append((tag, is_main, skip))
        if tag in BLOCKS and not self._skipping() and self.cell is None:
            self.kind = "h1" if tag == "h1" else "heading" if tag in HEADINGS else "li" if tag == "li" else "p"

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False
        if tag in VOID or all(t != tag for t, _, _ in self.stack):
            return  # stray end tag
        start = max(i for i, (t, _, _) in enumerate(self.stack) if t == tag)
        closing = {t for t, _, _ in self.stack[start:]}
        if not self._skipping():
            if closing & {"table", "tr"}:
                self._end_row()
            elif closing & CELLS:
                self._end_cell()
            elif self.cell is None and closing & BLOCKS:
                self._flush()  # only block ends split passages; </a> or </strong> must not
            if "table" in closing and self.tables:
                self.tables.pop()
        del self.stack[start:]

    def handle_data(self, data):
        if self.in_title:
            self.page_title += data
        elif not self._skipping():
            (self.cell if self.cell is not None else self.buffer).append(data)


def html_to_markdown(html: str, url: str, copied: str) -> str:
    use_main = bool(re.search(r"<main[\s>]|role=[\"']main[\"']", html, re.I))
    parser = _MainText(use_main)
    parser.feed(html)
    parser._end_row()  # a table left open at the end of the page
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


def parse_sources(text: str, domain: str) -> list[tuple[str, str]]:
    """Lines of "<slug> <url>"; blank lines and # comments ignored. Slugs become file names."""
    pairs, seen = [], set()
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) != 2 or not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", parts[0]) or parts[0] in seen:
            raise ValueError(f"bad sources line: {line!r}")
        check_official(parts[1], domain)
        seen.add(parts[0])
        pairs.append((parts[0], parts[1]))
    return pairs


def copy_page(url: str, out: Path) -> int:
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (EQ.ai knowledge base copy)"})
    with urllib.request.urlopen(request, timeout=30) as response:
        html = response.read().decode(response.headers.get_content_charset() or "utf-8", errors="replace")
    md = html_to_markdown(html, url, datetime.date.today().isoformat())
    out.write_text(md, encoding="utf-8")
    return md.count("\n\n")


def main() -> None:
    here = Path(__file__).parent
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("url", nargs="?")
    p.add_argument("--out", type=Path)
    p.add_argument("--sources", type=Path)
    p.add_argument("--out-dir", type=Path, default=here / "pages")
    p.add_argument("--domain", default="sjsu.edu")
    args = p.parse_args()
    if args.sources:
        args.out_dir.mkdir(parents=True, exist_ok=True)
        for slug, url in parse_sources(args.sources.read_text(encoding="utf-8"), args.domain):
            print(f"{slug}: {copy_page(url, args.out_dir / f'{slug}.md')} passages from {url}")
    elif args.url and args.out:
        check_official(args.url, args.domain)
        print(f"{args.out}: {copy_page(args.url, args.out)} passages from {args.url}")
    else:
        p.error("give --sources FILE, or a URL with --out FILE")


if __name__ == "__main__":
    main()
