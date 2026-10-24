# Knowledge base: cached official school pages

The dialogue service answers ONLY from pages in `pages/`. With no pages it tells the
student it has no official source and offers an advisor.

Add one Markdown file per official page, copied from the school's public website:

```markdown
---
title: Financial Aid Holds
url: https://<school>.edu/<exact page>
---
First paragraph of the official text.

Second paragraph...
```

Rules:
- Public, official school pages only. Copy the text; don't summarize or edit it.
- `url` is required and must be the real page; pages without one are skipped and can't be cited.
- Keep the page's own wording for deadlines and amounts. Never write them from memory.
- Add the date you copied it at the bottom, e.g. `Copied 2026-10-24.`
