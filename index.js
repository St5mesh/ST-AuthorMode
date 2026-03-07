/**
 * Author Mode — SillyTavern Extension
 *
 * Imports verified against ST extension documentation and community patterns.
 * Path depth: public/scripts/extensions/third-party/{name}/index.js
 *   → ../../../../script.js       = public/script.js
 *   → ../../../extensions.js      = public/scripts/extensions.js
 */

import {
    eventSource,
    event_types,
    generateQuietPrompt,
} from '../../../../script.js';

import {
    getContext,
} from '../../../extensions.js';

// ============================================================
// CONSTANTS
// ============================================================

const EXT_NAME = 'author-mode';
const EXT_LABEL = '✍️ Author Mode';

// Persistent logging using localStorage
const LOG_STORAGE_KEY = 'authorModeLogs';

function loadLogs() {
    try {
        const logs = localStorage.getItem(LOG_STORAGE_KEY);
        return logs ? JSON.parse(logs) : [];
    } catch (e) {
        console.error(`[${EXT_NAME}] Failed to load logs:`, e);
        return [];
    }
}

function saveLogs(logs) {
    try {
        localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(logs));
    } catch (e) {
        console.error(`[${EXT_NAME}] Failed to save logs:`, e);
    }
}

function appendLog(entry) {
    const logs = loadLogs();
    logs.push({ ...entry, timestamp: new Date().toISOString() });
    saveLogs(logs);
}

function clearLogs() {
    localStorage.removeItem(LOG_STORAGE_KEY);
}


// ============================================================
// STATE
// ============================================================

/**
 * All mutable state for the extension lives here.
 * No globals scattered through the file.
 */
const state = {
    visible: false,
    generating: false,

    // Chat pane
    selectedMsgIdx: null,

    // Beats pane
    beats: [],              // string[]
    expandedBeatIdxs: new Set(), // which beats have been expanded this session

    // Prose pane
    selectedBeatIdx: null,
    prose: '',              // current prose content (synced from contenteditable)
    undoStack: [],          // string[] — previous prose states for undo
    lastExpansionPreState: null, // prose state before the most recent expansion (for regen)

    // Logs
    logs: loadLogs(),
};

// ============================================================
// PROMPT TEMPLATES
// ============================================================

/**
 * Beat extraction: ask the LLM to return a strict numbered list.
 * Numbered list is more reliably parseable than JSON from most models.
 */
function promptExtractBeats(chapterText) {
    return `You are a story structure analyst. The text below is a chapter outline or narrative summary.
Extract each distinct story beat as a single concise sentence capturing one key narrative event or moment.

Rules:
- One beat per line
- Return ONLY a numbered list, nothing else — no preamble, no commentary
- Format: 1. Beat text here

Chapter text:
---
${chapterText}
---`;
}

/**
 * Beat expansion: expand one beat into prose given surrounding context.
 * prev/next are either adjacent beats or boundary signals.
 */
function promptExpandBeat(prevContext, currentBeat, nextContext) {
    return `You are a literary novelist. Expand the following story beat into immersive, flowing prose.

Previous context: ${prevContext}
Current beat: ${currentBeat}
Next context: ${nextContext}

Write 2–4 paragraphs of rich, continuous literary prose that:
- Flows naturally from the previous context
- Fully develops the current beat with scene, character, and atmosphere
- Transitions naturally toward the next context

Return ONLY the prose. No labels, no commentary, no preamble.`;
}

// ============================================================
// BEAT PARSING
// ============================================================

/**
 * Parse LLM output into a clean array of beat strings.
 * Handles "1. Beat text" format. Falls back to line-by-line split
 * if the model didn't number correctly, to remain robust.
 */
function parseBeats(rawText) {
    const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
    const numbered = [];

    for (const line of lines) {
        // Match "1. text" or "1) text"
        const match = line.match(/^\d+[.)]\s+(.+)/);
        if (match) {
            numbered.push(match[1].trim());
        }
    }

    // If numbered parsing found beats, use them
    if (numbered.length > 0) return numbered;

    // Fallback: filter out lines that look like headers/blank, treat each as a beat
    return lines.filter(l => l.length > 10 && !l.startsWith('#'));
}

// ============================================================
// CONTEXT HELPERS
// ============================================================

/**
 * Returns the context string for the beat BEFORE the one being expanded.
 * If this is the first beat of the message, uses a boundary signal.
 */
function getPrevContext(beatIdx) {
    if (beatIdx > 0) {
        return `[Previous beat] ${state.beats[beatIdx - 1]}`;
    }
    // First beat of this chapter
    if (state.selectedMsgIdx === 0) {
        return '[Story beginning] This is the opening scene of the narrative.';
    }
    return '[Chapter opening] This is the start of a new chapter. Continue from the end of the previous chapter.';
}

/**
 * Returns the context string for the beat AFTER the one being expanded.
 * If this is the last beat, uses a chapter-end signal.
 */
function getNextContext(beatIdx) {
    if (beatIdx < state.beats.length - 1) {
        return `[Next beat] ${state.beats[beatIdx + 1]}`;
    }
    return '[Chapter end] This is the final beat. Conclude the chapter naturally.';
}

// ============================================================
// PROSE/POV/BEATS HELPERS
// ============================================================

/**
 * Returns a trail of prose for a given beat index.
 * Useful for debugging or showing expansion history.
 */
function getProseTrail(beatIdx) {
    if (!state.proseHistory || !Array.isArray(state.proseHistory)) return [];
    return state.proseHistory.filter(entry => entry.beatIdx === beatIdx).map(entry => entry.prose);
}

/**
 * Detects the point-of-view (POV) in a prose string.
 * Returns 'first', 'second', 'third', or 'unknown'.
 */
function detectPOV(prose) {
    if (/\bI\b|\bme\b|\bmy\b|\bmine\b/.test(prose)) return 'first';
    if (/\byou\b|\byour\b|\byours\b/.test(prose)) return 'second';
    if (/\bhe\b|\bshe\b|\bthey\b|\bhis\b|\bher\b|\btheir\b/.test(prose)) return 'third';
    return 'unknown';
}

/**
 * Calculates the maximum number of beats allowed for expansion.
 * Returns a number based on config or defaults.
 */
function calcMaxBeats() {
    if (state.maxBeats) return state.maxBeats;
    // Default: 10 beats per chapter
    return 10;
}

// ============================================================
// OVERLAY HTML CONSTRUCTION
// ============================================================

function buildOverlayHTML() {
    return `
<div id="am-header">
    <span id="am-header-title">${EXT_LABEL}</span>
    <span id="am-header-status"></span>
    <button id="am-close" class="am-btn" title="Close Author Mode">✕ Close</button>
    <button id="am-debug-toggle" class="am-btn" title="Toggle Debug Panel">🐞 Debug</button>
</div>
<div id="am-body">

    <!-- LEFT: Chat History -->
    <div id="am-chat-pane">
        <div class="am-pane-header">
            Chat History
            <span style="color:#555;font-weight:400;text-transform:none;letter-spacing:0">Select a message to work with</span>
        </div>
        <div id="am-chat-list"></div>
    </div>

    <!-- RIGHT: Beats + Prose -->
    <div id="am-right-pane">

        <!-- UPPER RIGHT: Story Beats -->
        <div id="am-beats-pane">
            <div class="am-pane-header">
                Story Beats
                <div style="display:flex;gap:6px">
                    <button id="am-extract-btn" class="am-btn am-btn-primary" disabled>Extract Beats</button>
                    <button id="am-clear-beats-btn" class="am-btn" disabled title="Clear beats and start over">Clear</button>
                </div>
            </div>
            <div id="am-beats-list"></div>
            <div id="am-beats-footer"></div>
        </div>

        <!-- LOWER RIGHT: Expanded Prose -->
        <div id="am-prose-pane">
            <div class="am-pane-header">
                Expanded Prose
                <div id="am-prose-controls">
                    <button id="am-undo-btn"   class="am-btn" disabled title="Undo last expansion">↩ Undo</button>
                    <button id="am-regen-btn"  class="am-btn" disabled title="Regenerate last expanded beat">↻ Regen</button>
                    <button id="am-clear-prose-btn" class="am-btn am-btn-danger" title="Clear all prose">✕ Clear</button>
                    <button id="am-save-btn"   class="am-btn" title="Save prose as .txt">💾 Save</button>
                    <button id="am-export-btn" class="am-btn" title="Export as formatted HTML">📄 Export</button>
                    <button id="am-download-log-btn" class="am-btn" title="Download session log">📝 Download Log</button>
                </div>
            </div>
            <div
                id="am-prose-content"
                contenteditable="true"
                spellcheck="true"
                data-placeholder="Select a story beat above to expand it into prose…"
            ></div>
            <div id="am-prose-footer"></div>
        </div>

        <!-- DEBUG PANEL -->
        <div id="am-debug-panel" style="display:none;padding:10px;background:#222;color:#fff;border-radius:6px;margin-top:10px">
            <h3 style="margin-top:0">Debug Panel</h3>
            <div id="am-debug-content">Debug info will appear here.</div>
        </div>

    </div>
</div>`;
}

// ============================================================
// OVERLAY LIFECYCLE
// ============================================================

function getOverlay() {
    return document.getElementById('am-overlay');
}

function createOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'am-overlay';
    overlay.innerHTML = buildOverlayHTML();
    document.body.appendChild(overlay);
    bindOverlayEvents(overlay);
    return overlay;
}

function showAuthorMode() {
    let overlay = getOverlay();
    if (!overlay) {
        overlay = createOverlay();
    }
    overlay.classList.add('am-visible');
    state.visible = true;
    renderChatList();
    setHeaderStatus('Select a message from the chat history to begin.');
}

function hideAuthorMode() {
    const overlay = getOverlay();
    if (overlay) overlay.classList.remove('am-visible');
    state.visible = false;
}

// ============================================================
// EVENT BINDING
// ============================================================

function bindOverlayEvents(overlay) {
    // Close button
    overlay.querySelector('#am-close').addEventListener('click', hideAuthorMode);

    // Debug toggle
    overlay.querySelector('#am-debug-toggle').addEventListener('click', () => {
        const panel = overlay.querySelector('#am-debug-panel');
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });

    // Extract beats
    overlay.querySelector('#am-extract-btn').addEventListener('click', handleExtractBeats);

    // Clear beats
    overlay.querySelector('#am-clear-beats-btn').addEventListener('click', () => {
        state.beats = [];
        state.expandedBeatIdxs.clear();
        state.selectedBeatIdx = null;
        renderBeats();
        setBeatsStatus('');
        setBtn('am-clear-beats-btn', true);
        setBtn('am-regen-btn', true);
    });

    // Debug toggle
    const debugToggle = overlay.querySelector('#am-debug-toggle');
    if (debugToggle) {
        debugToggle.addEventListener('click', () => {
            state.debug = !state.debug;
            appendLog(`Debug mode ${state.debug ? 'enabled' : 'disabled'}`);
setHeaderStatus(`Debug mode ${state.debug ? 'enabled' : 'disabled'}.`);
        });
    }

    // Clear debug log
    const debugClear = overlay.querySelector('#am-debug-clear');
    if (debugClear) {
        debugClear.addEventListener('click', () => {
            state.debugLog = [];
            appendLog('Debug log cleared by user action');
setHeaderStatus('Debug log cleared.');
        });
    }

    // Undo
    overlay.querySelector('#am-undo-btn').addEventListener('click', handleUndo);

    // Regenerate
    overlay.querySelector('#am-regen-btn').addEventListener('click', handleRegenerate);

    // Clear prose
    overlay.querySelector('#am-clear-prose-btn').addEventListener('click', () => {
        pushUndo();
        state.prose = '';
        updateProseDisplay();
        appendLog('User cleared prose content');
setProseStatus('Prose cleared.');
        state.expandedBeatIdxs.clear();
        renderBeats(); // re-render to remove am-expanded class
    });

    // Save
    overlay.querySelector('#am-save-btn').addEventListener('click', handleSave);

    // Export
    overlay.querySelector('#am-export-btn').addEventListener('click', handleExport);

    // Download Log
    overlay.querySelector('#am-download-log-btn').addEventListener('click', handleDownloadLog);

    // Sync prose edits back to state
    overlay.querySelector('#am-prose-content').addEventListener('input', () => {
        state.prose = overlay.querySelector('#am-prose-content').innerText;
    });
}

// ============================================================
// CHAT LIST RENDERING
// ============================================================

function renderChatList() {
    const list = document.getElementById('am-chat-list');
    if (!list) return;

    const context = getContext();
    if (!context || !context.chat || context.chat.length === 0) {
        list.innerHTML = '<div style="padding:20px;color:#555;font-size:0.82em">No messages in this chat.</div>';
        return;
    }

    list.innerHTML = '';

    context.chat.forEach((msg, idx) => {
        // Skip system messages — they are not narratable content
        if (msg.is_system) return;

        const item = document.createElement('div');
        item.className = 'am-chat-item' + (idx === state.selectedMsgIdx ? ' am-selected' : '');
        item.dataset.idx = idx;

        const sender = document.createElement('div');
        sender.className = 'am-msg-sender' + (msg.is_user ? ' am-user-sender' : '');
        sender.textContent = msg.name || (msg.is_user ? 'You' : 'AI');

        // Image badge if message has an attached image
        if (msg.extra && msg.extra.image) {
            const badge = document.createElement('span');
            badge.className = 'am-img-badge';
            badge.textContent = '🖼️';
            sender.appendChild(badge);
        }

        const preview = document.createElement('div');
        preview.className = 'am-msg-preview';
        const text = (msg.mes || '').trim();
        preview.textContent = text.length > 160 ? text.slice(0, 160) + '…' : text;

        item.appendChild(sender);
        item.appendChild(preview);

        item.addEventListener('click', () => selectMessage(idx));
        list.appendChild(item);
    });
}

function selectMessage(idx) {
    state.selectedMsgIdx = idx;
    appendLog({ type: 'event', event: 'select-message', messageIdx: idx });

    // Update selection highlight
    document.querySelectorAll('.am-chat-item').forEach(el => {
        el.classList.toggle('am-selected', Number(el.dataset.idx) === idx);
    });

    // Reset beats for this new selection
    state.beats = [];
    state.expandedBeatIdxs.clear();
    state.selectedBeatIdx = null;
    renderBeats();
    appendLog('User selected message for beat extraction');
setBeatsStatus('Message selected. Click "Extract Beats" to analyse.');

    setBtn('am-extract-btn', false);   // enable
    setBtn('am-clear-beats-btn', true); // disable (nothing to clear yet)
    setBtn('am-regen-btn', true);

    setHeaderStatus(`Working on message ${idx + 1}.`);
}

// ============================================================
// BEATS RENDERING
// ============================================================

function renderBeats() {
    const list = document.getElementById('am-beats-list');
    if (!list) return;

    list.innerHTML = '';

    if (state.beats.length === 0) return;

    state.beats.forEach((beat, idx) => {
        const item = document.createElement('div');
        item.className = 'am-beat-item';
        if (idx === state.selectedBeatIdx) item.classList.add('am-selected');
        if (state.expandedBeatIdxs.has(idx)) item.classList.add('am-expanded');
        item.dataset.beatIdx = idx;

        const num = document.createElement('span');
        num.className = 'am-beat-num';
        num.textContent = `${idx + 1}.`;

        item.appendChild(num);
        item.appendChild(document.createTextNode(beat));

        item.addEventListener('click', () => selectBeat(idx));
        list.appendChild(item);
    });

    setBtn('am-clear-beats-btn', false); // enable now that beats exist
}

async function selectBeat(idx) {
    if (state.generating) return;

    state.selectedBeatIdx = idx;

    // Update visual selection
    document.querySelectorAll('.am-beat-item').forEach(el => {
        el.classList.toggle('am-selected', Number(el.dataset.beatIdx) === idx);
    });

    await handleExpandBeat(idx);
}

// ============================================================
// LLM CALLS
// ============================================================

/**
 * Extract story beats from the selected message.
 * Uses generateQuietPrompt — verified export from script.js.
 * Signature: generateQuietPrompt(prompt, quietToLoud, skipWIAN)
 */
async function handleExtractBeats() {
    if (state.selectedMsgIdx === null || state.generating) return;

    const context = getContext();
    const message = context.chat[state.selectedMsgIdx];
    if (!message || !message.mes) {
        setBeatsStatus('Selected message has no text content.');
        return;
    }

    setGenerating(true);
    setBeatsStatus('⏳ Extracting story beats…');

    try {
        const maxBeats = calcMaxBeats();
        const prompt = promptExtractBeats(message.mes);
        appendLog(`Beat extraction prompt: ${JSON.stringify(prompt)}`);
console.log(`[${EXT_NAME}] Beat extraction prompt:`, prompt);
        appendLog({ type: 'prompt', content: prompt, event: 'beat-extraction', messageIdx: state.selectedMsgIdx });
        const raw = await generateQuietPrompt(prompt, false, false);
        appendLog(`Beat extraction response: ${JSON.stringify(raw)}`);
console.log(`[${EXT_NAME}] Beat extraction response:`, raw);
        appendLog({ type: 'response', content: raw, event: 'beat-extraction', messageIdx: state.selectedMsgIdx });

        if (!raw || !raw.trim()) {
            setBeatsStatus('No response from LLM. Check your connection/model.');
            return;
        }

        state.beats = parseBeats(raw.trim());

        if (state.beats.length === 0) {
            setBeatsStatus('Could not parse beats from response. The model may have returned an unexpected format.');
            appendLog(`Beat extraction warning: ${JSON.stringify(raw)}`);
console.warn(`[${EXT_NAME}] Raw beat response:`, raw);
            return;
        }

        // Limit beats to maxBeats
        if (state.beats.length > maxBeats) {
            state.beats = state.beats.slice(0, maxBeats);
            setBeatsStatus(`Extracted ${state.beats.length} beats (limited to max ${maxBeats}). Click any beat to expand it into prose.`);
        } else {
            setBeatsStatus(`${state.beats.length} beats extracted. Click any beat to expand it into prose.`);
        }

        renderBeats();

    } catch (err) {
        console.error(`[${EXT_NAME}] Beat extraction failed:`, err);
        setBeatsStatus('Error during extraction — check browser console.');
    } finally {
        setGenerating(false);
    }
}

/**
 * Core expansion engine — performs the LLM call and appends result to prose.
 * Does NOT manage undo stack; callers are responsible for that.
 */
async function expandBeatCore(beatIdx) {
    const beat = state.beats[beatIdx];
    const prev = getPrevContext(beatIdx);
    const next = getNextContext(beatIdx);

    setProseStatus(`⏳ Expanding beat ${beatIdx + 1}…`);
    setBeatsStatus(`Expanding beat ${beatIdx + 1} of ${state.beats.length}…`);

    // Debug logging
    appendLog(`Beat expansion started for beatIdx: ${beatIdx}`);
console.debug(`[${EXT_NAME}] expandBeatCore called for beatIdx:`, beatIdx);
    console.debug(`[${EXT_NAME}] prev:`, prev);
    console.debug(`[${EXT_NAME}] beat:`, beat);
    console.debug(`[${EXT_NAME}] next:`, next);

    const prompt = promptExpandBeat(prev, beat, next);
    appendLog({ type: 'prompt', content: prompt, event: 'beat-expansion', beatIdx });
    const result = await generateQuietPrompt(prompt, false, false);
    appendLog({ type: 'response', content: result, event: 'beat-expansion', beatIdx });

    if (!result || !result.trim()) {
        setProseStatus('No response from LLM. Try again.');
        console.debug(`[${EXT_NAME}] No result from LLM.`);
        return false;
    }

    // POV detection (simple heuristic: look for "I" or character names)
    let pov = null;
    if (/\bI\b/.test(result)) {
        pov = 'first-person';
    } else if (/\bhe\b|\bshe\b|\bthey\b/i.test(result)) {
        pov = 'third-person';
    } else {
        pov = 'unknown';
    }
    console.debug(`[${EXT_NAME}] POV detected:`, pov);

    // Prose trail: record each expansion
    if (!state.proseTrail) state.proseTrail = [];
    state.proseTrail.push({
        beatIdx,
        beat,
        prose: result.trim(),
        pov,
        timestamp: Date.now()
    });
    appendLog(`Prose trail updated: ${JSON.stringify(state.proseTrail)}`);
console.debug(`[${EXT_NAME}] Prose trail updated.`, state.proseTrail);

    // Record pre-append state for regen to restore to
    state.lastExpansionPreState = state.prose;

    const separator = state.prose.trim().length > 0 ? '\n\n' : '';
    state.prose = state.prose + separator + result.trim();
    state.selectedBeatIdx = beatIdx;

    updateProseDisplay();
    state.expandedBeatIdxs.add(beatIdx);
    renderBeats();

    setBtn('am-undo-btn', false);
    setBtn('am-regen-btn', false);

    setProseStatus(`Beat ${beatIdx + 1} expanded.`);
    setBeatsStatus(`Beat ${beatIdx + 1} expanded. Select next beat to continue.`);
    return true;
}

/**
 * Called when user clicks a beat: push undo state, then expand.
 */
async function handleExpandBeat(beatIdx) {
    if (state.generating) return;
    setGenerating(true);
    try {
        pushUndo();
        await expandBeatCore(beatIdx);
    } catch (err) {
        console.error(`[${EXT_NAME}] Beat expansion failed:`, err);
        setProseStatus('Error during expansion — check browser console.');
    } finally {
        setGenerating(false);
    }
}

/**
 * Undo: pop the undo stack and restore previous prose state.
 */
function handleUndo() {
    if (state.undoStack.length === 0) return;
    state.prose = state.undoStack.pop();
    updateProseDisplay();
    setBtn('am-undo-btn', state.undoStack.length === 0);
    appendLog('User performed undo action');
setProseStatus('Undone.');
}

/**
 * Regenerate: saves current prose to undo (preserving original expansion),
 * restores to pre-expansion state, then generates a fresh expansion.
 * This means undo-after-regen correctly returns the original expansion.
 */
async function handleRegenerate() {
    if (state.selectedBeatIdx === null || state.generating) return;
    setGenerating(true);
    try {
        // Save current prose (with original expansion) — regen is undoable
        pushUndo();
        // Restore prose to what it was before the expansion we're regenerating
        state.prose = state.lastExpansionPreState ?? '';
        state.expandedBeatIdxs.delete(state.selectedBeatIdx);
        renderBeats();
        await expandBeatCore(state.selectedBeatIdx);
    } catch (err) {
        console.error(`[${EXT_NAME}] Regenerate failed:`, err);
        setProseStatus('Error during regeneration — check browser console.');
    } finally {
        setGenerating(false);
    }
}

// ============================================================
// SAVE & EXPORT
// ============================================================

function handleSave() {
    const content = state.prose.trim();
    if (!content) {
        setProseStatus('Nothing to save.');
        return;
    }
    downloadBlob(content, 'text/plain', `author-mode-${timestamp()}.txt`);
    appendLog('User saved prose as .txt');
setProseStatus('Saved as .txt');
}

function handleDownloadLog() {
    // Export session log from browser storage as .txt
    let log = '';
    try {
        // Try localStorage first
        log = localStorage.getItem('author-mode-session-log') || '';
        if (!log) {
            // Try sessionStorage as fallback
            log = sessionStorage.getItem('author-mode-session-log') || '';
        }
    } catch (e) {
        log = '';
    }
    if (!log.trim()) {
        setProseStatus('No session log found.');
        return;
    }
    downloadBlob(log, 'text/plain', `author-mode-session-log-${timestamp()}.txt`);
    setProseStatus('Session log downloaded.');
}

function handleExport() {
    const content = state.prose.trim();
    if (!content) {
        setProseStatus('Nothing to export.');
        return;
    }

    const context = getContext();
    const charName = (context && context.name2) ? context.name2 : 'Chapter';

    // Convert blank-line-separated paragraphs to <p> tags
    const paragraphs = content
        .split(/\n{2,}/)
        .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
        .join('\n');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHTML(charName)} — Author Mode</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; max-width: 720px; margin: 60px auto; padding: 0 24px; line-height: 1.85; color: #222; }
  h1 { font-size: 1.3em; color: #444; border-bottom: 1px solid #ddd; padding-bottom: 8px; }
  p { margin: 0 0 1.2em; text-indent: 2em; }
  p:first-of-type { text-indent: 0; }
</style>
</head>
<body>
<h1>${escapeHTML(charName)}</h1>
${paragraphs}
</body>
</html>`;

    downloadBlob(html, 'text/html', `author-mode-${timestamp()}.html`);
    appendLog('User exported prose as .html');
setProseStatus('Exported as .html');
}

// ============================================================
// PROSE DISPLAY
// ============================================================

function pushUndo() {
    // Only push if there's something to save
    state.undoStack.push(state.prose);
    setBtn('am-undo-btn', false);
}

function updateProseDisplay() {
    const el = document.getElementById('am-prose-content');
    if (!el) return;
    // Use innerText for plain-text contenteditable to avoid HTML injection
    el.innerText = state.prose;
    // Scroll to bottom after new content
    el.scrollTop = el.scrollHeight;
}

// ============================================================
// UTILITY HELPERS
// ============================================================

/**
 * Enable or disable a button by ID.
 * @param {string} id - element id without #
 * @param {boolean} disabled
 */
function setBtn(id, disabled) {
    const el = document.getElementById(id);
    if (el) el.disabled = disabled;
}

function setHeaderStatus(msg) {
    const el = document.getElementById('am-header-status');
    if (el) el.textContent = msg;
}

function setBeatsStatus(msg) {
    const el = document.getElementById('am-beats-footer');
    if (el) el.textContent = msg;
}

function setProseStatus(msg) {
    const el = document.getElementById('am-prose-footer');
    if (el) el.textContent = msg;
}

/**
 * Toggle the generating state: disables primary buttons, shows visual cue.
 */
function setGenerating(active) {
    state.generating = active;
    const overlay = getOverlay();
    if (overlay) {
        overlay.classList.toggle('am-generating', active);
    }
    setBtn('am-extract-btn', active || state.selectedMsgIdx === null);
}

function downloadBlob(content, type, filename) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    // Clean up the object URL after a short delay
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function timestamp() {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function escapeHTML(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ============================================================
// MENU INJECTION
// ============================================================

/**
 * Try to inject an "Author Mode" entry into ST's bottom-left options menu.
 * Uses multiple selector strategies since the exact DOM varies across ST versions.
/**
 * Attempt to inject the Author Mode entry into ST's options menu.
 * Returns true if a suitable container was found and injection succeeded,
 * false if no container was found (caller should retry or fall back).
 */
function injectMenuEntry() {
    // Don't inject twice if retried after a successful early attempt
    if (document.getElementById('am-menu-entry')) return true;

    const entry = document.createElement('div');
    entry.id = 'am-menu-entry';
    entry.innerHTML = `<span>✍️</span><span>Author Mode</span>`;
    entry.addEventListener('click', showAuthorMode);

    // Strategy 1: known options bar
    const optionsBar = document.querySelector('#options_bar');
    if (optionsBar) {
        const wrapper = document.createElement('div');
        wrapper.className = 'list-group-item';
        wrapper.appendChild(entry);
        optionsBar.appendChild(wrapper);
        appendLog(`Injected into #options_bar`);
console.log(`[${EXT_NAME}] Injected into #options_bar`);
        return true;
    }

    // Strategy 2: find by proximity to known sibling text
    const allLinks = Array.from(document.querySelectorAll('a, .list-group-item, [class*="option"]'));
    const sibling = allLinks.find(el =>
        el.textContent && (
            el.textContent.includes('Close chat') ||
            el.textContent.includes('Start new chat') ||
            el.textContent.includes('New chat')
        )
    );
    if (sibling && sibling.parentElement) {
        const wrapper = document.createElement('div');
        wrapper.className = sibling.className;
        wrapper.appendChild(entry);
        sibling.parentElement.appendChild(wrapper);
        appendLog(`Injected alongside sibling: "${sibling.textContent.trim().slice(0, 30)}"`);
console.log(`[${EXT_NAME}] Injected alongside sibling: "${sibling.textContent.trim().slice(0, 30)}"`);
        return true;
    }

    // Strategy 3: left nav panel
    const leftPanel = document.querySelector('#left-nav-panel');
    if (leftPanel) {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'padding:4px 8px';
        wrapper.appendChild(entry);
        leftPanel.appendChild(wrapper);
        appendLog(`Injected into #left-nav-panel`);
console.log(`[${EXT_NAME}] Injected into #left-nav-panel`);
        return true;
    }

    // No container found yet — signal failure so caller can retry
    return false;
}

/**
 * Last-resort floating button. Only called after all injection retries are exhausted.
 */
function injectFloatBtn() {
    if (document.getElementById('am-float-btn')) return;
    const floatBtn = document.createElement('button');
    floatBtn.id = 'am-float-btn';
    floatBtn.title = 'Author Mode';
    floatBtn.textContent = '✍️';
    floatBtn.addEventListener('click', showAuthorMode);
    document.body.appendChild(floatBtn);
}

// ============================================================
// INITIALISATION
// ============================================================

jQuery(async () => {
    appendLog(`Extension initialising`);
console.log(`[${EXT_NAME}] Initialising…`);

    // Guard: verify generateQuietPrompt is available before proceeding
    if (typeof generateQuietPrompt !== 'function') {
        console.error(
            `[${EXT_NAME}] generateQuietPrompt is not available. ` +
            `This extension requires a SillyTavern version that exports this function from script.js.`
        );
        return;
    }

    // Build overlay DOM now (hidden) so it's ready instantly on first open
    createOverlay();

    // Inject menu entry.
    // ST renders its left panel slightly after DOM ready, so we attempt immediately
    // then retry up to 10 times at 500ms intervals before falling back to the
    // floating button. This covers the race without relying on an arbitrary single delay.
    let injected = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 10;

    function tryInject() {
        if (injected) return;
        attempts++;
        injected = injectMenuEntry();
        if (!injected && attempts < MAX_ATTEMPTS) {
            setTimeout(tryInject, 500);
        } else if (!injected) {
            console.warn(`[${EXT_NAME}] Menu injection failed after ${MAX_ATTEMPTS} attempts. Using floating button.`);
            injectFloatBtn();
        }
    }

    tryInject();

    // Keep chat pane current if the user switches chats while overlay is open
    eventSource.on(event_types.CHAT_CHANGED, () => {
        if (state.visible) {
            state.selectedMsgIdx = null;
            state.beats = [];
            state.expandedBeatIdxs.clear();
            state.selectedBeatIdx = null;
            state.prose = '';
            state.undoStack = [];
            state.debugLog = [];
            updateProseDisplay();
            renderBeats();
            renderChatList();
            setHeaderStatus('Chat changed. Select a message to begin.');
        }
    });

    // Also refresh chat list when a new message arrives (non-disruptively)
    eventSource.on(event_types.MESSAGE_RECEIVED, () => {
        if (state.visible) {
            renderChatList();
        }
    });

    appendLog(`Extension ready`);
console.log(`[${EXT_NAME}] Ready.`);
});
