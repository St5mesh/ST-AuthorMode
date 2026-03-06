# ST-AuthorMode
A SillyTavern extension that transforms chat messages into a three-pane novel-writing workspace — extracting story beats with your active LLM and expanding them into continuous literary prose.

---

## How It Works

1. Open Author Mode from the options menu (bottom-left in ST) or the floating ✍️ button
2. Select a chat message from the left pane — this is your chapter outline
3. Click **Extract Beats** — your LLM reads the message and returns a numbered list of story beats
4. Click any beat to expand it — the LLM writes 2–4 paragraphs of prose, aware of what comes before and after
5. Work through the beats in any order, building up prose in the lower-right pane
6. Edit the prose directly, undo any expansion, regenerate beats you aren't happy with, then save or export when done

---

## Features

- **Three-pane layout** — chat history on the left, story beats upper-right, editable prose lower-right
- **Beat extraction** — treats the selected message as a chapter outline and derives concise, ordered story beats
- **Context-aware expansion** — each beat is expanded with knowledge of the preceding and following beat, plus boundary signals at chapter openings and endings
- **Editable prose pane** — directly edit generated content at any point
- **Undo** — step back through expansion history
- **Regenerate** — get a fresh expansion of the last beat without losing the ability to undo back to the original
- **Save** — export prose as a plain `.txt` file
- **Export** — export prose as a formatted `.html` file ready for reading or further editing
- **Live chat sync** — the chat pane updates if new messages arrive or you switch chats while the overlay is open

---

## Installation

In SillyTavern, open the **Extensions** panel (puzzle piece icon), click **Install extension**, and paste:

```
https://github.com/YOUR_USERNAME/SillyTavern-AuthorMode
```

Then reload the page.

Alternatively, clone or download this repository and place the `SillyTavern-AuthorMode` folder directly into:

```
SillyTavern/public/scripts/extensions/third-party/
```

---

## Requirements

- A working SillyTavern installation (recent build recommended)
- An active LLM connection — Author Mode uses whatever model you currently have loaded
- The extension works best with instruction-tuned models; raw base models may return beats or prose in unexpected formats

---

## Usage Notes

**Context limits** — very long messages may push the beat extraction prompt close to your model's context limit. If beats come back truncated or malformed, try selecting a shorter message or summarising it first.

**Prose is session-only** — there is no automatic saving between sessions. Use the Save or Export buttons before closing SillyTavern.

**Menu entry** — the extension tries several strategies to locate ST's options menu and inject the Author Mode entry. If it cannot find a suitable location within 5 seconds of load, it falls back to a small floating ✍️ button in the bottom-left corner of the screen. Both open the same workspace.

**Model output variation** — beat extraction and prose quality depend entirely on the model you have loaded. If you get unexpected output, check the browser console (F12) for the raw LLM response logged under `[author-mode]`.

---

## Known Limitations

- Images attached to chat messages are indicated in the message list but are not rendered in the Author Mode pane
- Prose does not persist between sessions; always export before closing
- Regenerate applies to the most recently expanded beat only; earlier expansions can be revisited by undoing back to them

---

## Troubleshooting

| Symptom | Likely cause | What to try |
|---|---|---|
| Extension doesn't appear at all | Import path mismatch or ST version incompatibility | Open browser console (F12) and look for `[author-mode]` errors on load |
| Menu entry missing, no float button | Menu injection failed silently | Reload the page; check console for injection log lines |
| Extract Beats returns nothing | LLM response was empty or malformed | Check console for raw response; try a shorter message or a different model |
| Prose pane blank after expansion | `innerText` rendering edge case in some Electron builds | Try reloading; if persistent, open an issue with your ST and Electron version |
| Save/Export does nothing | Electron file handler variation | Try accessing ST from a browser tab on the same machine (`http://localhost:8000`) |

---

## License

MIT

