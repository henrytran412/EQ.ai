"""fetch_page: official page HTML -> verbatim Markdown passages for the knowledge base."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "data" / "knowledge"))

from fetch_page import check_official, html_to_markdown  # noqa: E402

PAGE = """<html><head><title>Registration Holds | Financial Aid | SJSU</title>
<script>var tracking = 1;</script><style>p { color: red }</style></head>
<body>
<header><nav><a href="/">Home</a> <a href="/aid">Aid</a></nav></header>
<main>
  <h1>Registration Holds</h1>
  <p>A hold   prevents you from
     registering for classes.</p>
  <h2>How to clear a hold</h2>
  <p>Submit the <a href="/form">verification form</a> in MySJSU.</p>
  <ul><li>Log in to MySJSU</li><li>Open the To Do List</li></ul>
  <aside>Related links</aside>
</main>
<footer>&copy; San Jos&eacute; State University</footer>
</body></html>"""


class HtmlToMarkdown(unittest.TestCase):
    def setUp(self):
        self.md = html_to_markdown(PAGE, url="https://www.sjsu.edu/faso/holds.php", copied="2026-10-24")

    def test_front_matter_has_title_and_url(self):
        self.assertTrue(self.md.startswith("---\ntitle: Registration Holds\nurl: https://www.sjsu.edu/faso/holds.php\n---\n"))

    def test_main_text_is_kept_verbatim_with_whitespace_collapsed(self):
        self.assertIn("A hold prevents you from registering for classes.", self.md)
        self.assertIn("Submit the verification form in MySJSU.", self.md)

    def test_headings_stay_attached_to_their_paragraph(self):
        self.assertIn("How to clear a hold\nSubmit the verification form in MySJSU.", self.md)

    def test_list_items_become_bullets(self):
        self.assertIn("- Log in to MySJSU\n- Open the To Do List", self.md)

    def test_menus_scripts_footers_and_asides_are_dropped(self):
        for junk in ("tracking", "color: red", "Home", "Related links", "San José State University"):
            self.assertNotIn(junk, self.md.split("---\n", 2)[2])

    def test_copy_date_is_recorded(self):
        self.assertTrue(self.md.rstrip().endswith("Copied 2026-10-24 from the official page."))


class RealWorldHtml(unittest.TestCase):
    def test_void_and_unclosed_tags_do_not_swallow_the_page(self):
        html = """<html><head><title>Holds</title><meta charset="utf-8"><link rel="x"></head><body>
        <nav><img src="logo.png"><a href="/">Home</a><input type="search"></nav>
        <main><h1>Holds</h1><p>First paragraph.<br>Same paragraph after a break.
        <ul><li>One<li>Two</ul>
        <p>After the list.</p></main>
        <footer><img src="seal.png">Footer text</footer></body></html>"""
        md = html_to_markdown(html, url="https://www.sjsu.edu/x", copied="2026-10-24")
        body = md.split("---\n", 2)[2]
        self.assertIn("First paragraph.", body)
        self.assertIn("- One\n- Two", body)
        self.assertIn("After the list.", body)
        self.assertNotIn("Home", body)
        self.assertNotIn("Footer text", body)


class OfficialOnly(unittest.TestCase):
    def test_only_https_pages_on_the_school_domain_are_allowed(self):
        check_official("https://www.sjsu.edu/faso/", "sjsu.edu")
        check_official("https://sjsu.edu/", "sjsu.edu")
        for bad in ("http://www.sjsu.edu/faso/", "https://sjsu.edu.evil.com/", "https://notsjsu.edu/",
                    "https://example.com/?u=sjsu.edu"):
            with self.assertRaises(ValueError):
                check_official(bad, "sjsu.edu")


if __name__ == "__main__":
    unittest.main()
