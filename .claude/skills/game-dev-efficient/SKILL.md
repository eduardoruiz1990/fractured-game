---
name: game-dev-efficient
description: Use when working on the HTML/JS/CSS game in this repo — editing game logic, styles, or markup, fixing bugs, adding features, or running local tests/builds. Also trigger on phrases like "update the game", "fix the game code", "add a feature to the game", or references to files like index.html, game.js, style.css, or the project's game folder. Encodes token-efficient ("harness engineering") practices so routine edits don't burn excessive context/tokens.
---

# Efficient Game Dev Workflow (HTML/JS/CSS)

## Purpose
This repo is a browser game built with plain HTML, JS, and CSS (no engine/framework
build step). This skill keeps Claude Code's token usage lean by favoring targeted
reads/edits over full-file dumps, and by using the right tool for each step instead
of the most expensive one.

## Core principles (apply on every task)

1. **Locate before you read.** Use `grep`/`rg` (ripgrep) or `glob` to find the
   function, class, or selector by name first. Never open an entire file "just to
   look around" if a targeted search will find the exact lines.
2. **Read ranges, not whole files.** For files over ~150 lines, view only the
   relevant line range. Re-read the whole file only if you don't yet know where
   the relevant code lives.
3. **Edit with str_replace, not rewrites.** Change only the specific block that
   needs to change. Never regenerate a full file to make a small fix — this is the
   single biggest token sink in game-loop or CSS files.
4. **Don't re-read what you just edited.** If you made the edit yourself via
   str_replace in this session, trust that it applied — don't view the file again
   to "confirm" unless a command reported an error or you edited it another way
   (e.g. via `sed` in bash).
5. **Batch bash commands.** Combine related shell steps (e.g. lint + test) into one
   call with `&&` rather than several round trips.
6. **Summarize, don't paste, large output.** Test logs, build output, or search
   results longer than ~20 lines: summarize the relevant part in your own words
   instead of echoing it all back into the conversation.
7. **Plan before multi-step work.** For anything touching 3+ files, write a short
   numbered plan first, then execute it in order. This avoids backtracking and
   repeated exploration, which is what actually costs tokens on bigger tasks.
8. **One feature/fix per pass.** Keep edits scoped to the task asked. Don't
   proactively refactor unrelated code in the same turn — that inflates both the
   diff and the token cost for review.

## MCP usage guidance

- **Filesystem access is already local** — Claude Code reads/writes this repo
  directly. Don't reach for a filesystem MCP server for anything inside this repo.
- **GitHub MCP (if connected):** use it only for PR/issue/branch operations
  (opening a PR, checking CI status, commenting). Never use it to pull file
  contents you can already read locally — that's a slower, more expensive path.
- **Browser/Playwright MCP (if connected):** use it to actually load the game in a
  browser and check behavior visually instead of guessing from source alone. Take
  one targeted screenshot of the relevant area, not a full-page capture on every
  check.
- **Any other connected MCP tool:** before calling it, ask whether local `grep`,
  `view`, or `bash` already answers the question more cheaply. Prefer local tools
  when the data already lives in the repo.

## HTML/JS/CSS specifics

- **JS logic:** `grep` for the function/variable name before opening the file.
  Edit the function body only.
- **CSS:** target the specific selector block with str_replace. Don't rewrite the
  whole stylesheet to change one rule.
- **HTML:** target the specific element/section by a unique attribute or nearby
  unique text, not by re-viewing the whole markup tree each time.
- **Debug logging:** remove any `console.log` added during debugging before
  wrapping up the task — don't leave iterative debug cruft in the diff.

## Workflow

1. **Plan** — restate the task in one or two lines; identify which file(s) are
   likely involved.
2. **Locate** — grep/glob for the exact code, don't open full files blind.
3. **Edit** — str_replace the minimal necessary block(s).
4. **Verify** — run only the relevant check (a specific test, a lint on the
   changed file, or a browser check via MCP if connected). Avoid full test-suite
   runs unless the task is broad or the user asks for it.
5. **Summarize** — report what changed in 2-4 sentences, not a full re-paste of
   the diff.

## Limitations
- This skill governs *how* Claude works, not *what* it builds — it won't catch
  logic errors on its own; still ask for verification on anything gameplay-critical.
- Large, genuinely repo-wide refactors will still cost real tokens — that's not
  waste, that's the actual size of the job. This skill is aimed at cutting the
  *unnecessary* overhead (redundant reads, full-file rewrites, verbose logs), not
  the necessary cost of big changes.