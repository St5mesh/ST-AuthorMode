# Copilot Instructions for ST-AuthorMode

## Build, Test, and Lint Commands

- **Build:** No build step required; this is a pure JS/CSS SillyTavern extension.
- **Test:** Run all tests by executing `node test_helpers.js` in the project root. To run a single test, comment/uncomment the relevant function call in `test_helpers.js`.
- **Lint:** No linting scripts provided.

## High-Level Architecture

- **Extension Type:** SillyTavern third-party extension, loaded via `manifest.json`.
- **Entry Point:** `index.js` (referenced in `manifest.json`).
- **UI:** Injects a fixed overlay with a three-pane layout (chat history, story beats, prose output) using `style.css`.
- **Core Flow:**
  1. User selects a chat message (chapter outline) from the left pane.
  2. LLM extracts numbered story beats (upper-right pane).
  3. User expands beats into prose (lower-right pane), with undo/regenerate/save/export controls.
  4. Overlay can be opened via menu injection or fallback floating button.
- **LLM Integration:** Uses SillyTavern's `generateQuietPrompt` for beat extraction and expansion. Model output is parsed and displayed in the UI.
- **State:** All mutable state is managed in a single `state` object in `index.js`.

## Key Conventions

- **Beat Extraction:** Prompts always request a strict numbered list; fallback parsing handles non-numbered output.
- **Prose Expansion:** Each beat is expanded with context from adjacent beats or chapter boundaries.
- **Undo/Regenerate:** Undo stack is managed for prose edits; regenerate restores to pre-expansion state before generating new prose.
- **Menu Injection:** Multiple strategies are used to inject the menu entry; if all fail, a floating button is shown.
- **Session Logs:** Logs are persisted in browser storage and can be downloaded from the overlay.
- **Export:** Prose can be exported as `.txt` or formatted `.html`.

## Integration Notes

- No other AI assistant config files detected (Claude, Cursor, Codex, Windsurf, Aider, Cline).
- README.md is the primary source for user-facing instructions.

---

This file summarizes build/test commands, architecture, and conventions for Copilot and other AI assistants. Adjust or request coverage for additional areas as needed.
