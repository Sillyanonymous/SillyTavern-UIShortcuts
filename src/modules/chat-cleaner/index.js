/**
 * Chat Cleaner Module
 *
 * Adds a "Clean formatting" button to non-user messages. The button rewrites
 * the message text in place to fix the common malformation pattern where the
 * model emits asterisks touching word characters on both sides (e.g.
 * `word*more*`) and orphan asterisks that drift across responses.
 *
 * Cleaning runs on a depth-tracking walk that pairs `**` (bold) and then `*`
 * (italic). Code blocks, inline code, URLs, HTML tags, and math are protected.
 * Underscores are intentionally left alone (snake_case is too common).
 */

import { log, getSTContext } from '../../utils.js';

const BUTTON_CLASS = 'uishortcuts-chat-cleaner-btn';
const STYLE_ID = 'uishortcuts-chat-cleaner-style';

// Unicode asterisk lookalikes that models occasionally emit
const ASTERISK_LOOKALIKES = /[\u2731\uFF0A\u2217\u2733\u2734\u2722]/g;

// ============================================================
// CLEANING
// ============================================================

/**
 * Replace safe regions with placeholders so cleaning never touches them.
 * @param {string} text
 * @returns {{ masked: string, restore: (s: string) => string }}
 */
function maskSafeRegions(text) {
    const placeholders = [];
    const make = (match) => {
        const token = `\x00${placeholders.length}\x00`;
        placeholders.push(match);
        return token;
    };

    const masked = text
        .replace(/```[\s\S]*?```/g, make)   // fenced code blocks
        .replace(/`[^`\n]+`/g, make)         // inline code
        .replace(/https?:\/\/\S+/g, make)    // URLs
        .replace(/<[^<>]+>/g, make)          // HTML tags
        .replace(/\$\$[\s\S]*?\$\$/g, make)  // block math
        .replace(/\$[^$\n]+\$/g, make);      // inline math

    return {
        masked,
        restore: (out) => out.replace(/\x00(\d+)\x00/g, (_, i) => placeholders[+i]),
    };
}

const isWordChar = (ch) => /\w/.test(ch);

/**
 * Walk `text` and pair up occurrences of `marker` (either `*` or `**`),
 * fixing mid-word markers and dropping orphans.
 *
 * Decision rules at each marker, given depth state:
 *   - word/word on both sides   → mid-word break. If open, CLOSE + space.
 *                                  If not, space + OPEN.
 *   - non-word/word             → OPEN candidate. If already open, drop.
 *                                  Else open.
 *   - word/non-word             → CLOSE candidate. If open, close.
 *                                  Else orphan, drop.
 *   - non-word/non-word         → If open, CLOSE (most likely a closing
 *                                  marker after punctuation/dash/newline).
 *                                  Else leave alone (probably literal `*`).
 *
 * Any remaining unclosed opens are dropped at the end.
 */
function cleanMarker(text, marker) {
    const len = marker.length;
    const out = [];
    const openIndices = []; // indexes into `out` of unmatched opens
    let i = 0;

    while (i < text.length) {
        // Match this marker exactly (no longer/shorter run).
        if (text.substr(i, len) !== marker) {
            out.push(text[i]);
            i++;
            continue;
        }

        // For the italic pass, leave `**` (bold) and `***` (both) untouched.
        if (marker === '*' && text[i + 1] === '*') {
            // Emit the run of asterisks as-is (could be `**` or `***`).
            const start = i;
            while (text[i] === '*') i++;
            out.push(text.slice(start, i));
            continue;
        }
        // For the bold pass, leave `***` as a unit.
        if (marker === '**' && text[i + 2] === '*') {
            out.push('***');
            i += 3;
            continue;
        }

        const leftCh = i > 0 ? text[i - 1] : ' ';
        const rightCh = i + len < text.length ? text[i + len] : ' ';
        const leftWord = isWordChar(leftCh);
        const rightWord = isWordChar(rightCh);

        if (leftWord && rightWord) {
            if (openIndices.length > 0) {
                out.push(marker, ' ');
                openIndices.pop();
            } else {
                out.push(' ', marker);
                openIndices.push(out.length - 1);
            }
        } else if (!leftWord && rightWord) {
            if (openIndices.length > 0) {
                // Already inside emphasis; this orphan would only confuse things.
                // Drop it.
            } else {
                out.push(marker);
                openIndices.push(out.length - 1);
            }
        } else if (leftWord && !rightWord) {
            if (openIndices.length > 0) {
                out.push(marker);
                openIndices.pop();
            } else {
                // Orphan close — drop.
            }
        } else {
            // non-word / non-word: ambiguous. If we're currently inside an
            // emphasis, this is almost certainly the closing marker. If not,
            // leave it alone — probably a literal `*` (e.g. bullet, glob).
            if (openIndices.length > 0) {
                out.push(marker);
                openIndices.pop();
            } else {
                out.push(marker);
            }
        }

        i += len;
    }

    // Drop any unclosed opens (replace placeholder slot with empty string).
    for (const idx of openIndices) {
        out[idx] = '';
    }

    return out.join('');
}

/**
 * Public entry: clean a message body.
 */
export function cleanText(text) {
    if (!text || typeof text !== 'string') return text;

    const { masked, restore } = maskSafeRegions(text);

    // Heuristic gate: skip already-balanced markdown unless we detect suspicious
    // mid-word marker usage (e.g. `people*do*`) that likely needs cleanup.
    const asteriskCount = (masked.match(/\*/g) || []).length;
    const doubleAsteriskCount = (masked.match(/\*\*/g) || []).length;
    const hasSuspiciousMidWordMarker = /\w\*\*?(?=\w)/.test(masked);
    if (
        asteriskCount > 0 &&
        asteriskCount % 2 === 0 &&
        doubleAsteriskCount % 2 === 0 &&
        !hasSuspiciousMidWordMarker
    ) {
        return text; // Already balanced; don't touch
    }

    let out = masked.replace(ASTERISK_LOOKALIKES, '*');

    // Bold first, then italic. Order matters so the italic pass leaves valid
    // bold pairs alone.
    out = cleanMarker(out, '**');
    out = cleanMarker(out, '*');

    // Empty emphasis after cleanup
    out = out.replace(/\*\*\s*\*\*/g, '');
    out = out.replace(/\*\s*\*/g, '');

    // Tidy whitespace introduced by mid-word fixes
    out = out.replace(/[ \t]{2,}/g, ' ');
    out = out.replace(/[ \t]+([.,!?;:])/g, '$1');
    out = out.replace(/[ \t]+\n/g, '\n');

    return restore(out);
}

// ============================================================
// DOM INTEGRATION
// ============================================================

function _injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
        .${BUTTON_CLASS} {
            cursor: pointer;
        }
        .${BUTTON_CLASS}:hover {
            color: var(--SmartThemeQuoteColor, #4a9eff);
        }
        .${BUTTON_CLASS}.uishortcuts-cleaning {
            opacity: 0.5;
            pointer-events: none;
        }

        .uishortcuts-cleaner-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.65);
            z-index: 100000;
            display: flex;
            align-items: center;
            justify-content: center;
            backdrop-filter: blur(4px);
        }
        .uishortcuts-cleaner-modal {
            background: var(--SmartThemeBlurTintColor, #1a1a1a);
            border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.15));
            border-radius: 10px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
            color: var(--SmartThemeBodyColor, #e0e0e0);
            width: min(90vw, 900px);
            max-height: 85vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        .uishortcuts-cleaner-header {
            padding: 10px 14px;
            border-bottom: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.1));
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .uishortcuts-cleaner-header i {
            color: var(--SmartThemeQuoteColor, #4a9eff);
        }
        .uishortcuts-cleaner-body {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
            padding: 12px;
            overflow: hidden;
            min-height: 0;
            flex: 1;
        }
        .uishortcuts-cleaner-pane {
            display: flex;
            flex-direction: column;
            min-height: 0;
            min-width: 0;
        }
        .uishortcuts-cleaner-pane-label {
            font-size: 0.75rem;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--SmartThemeEmColor, #888);
            padding: 0 0 4px 4px;
        }
        .uishortcuts-cleaner-pane pre {
            flex: 1;
            margin: 0;
            padding: 10px;
            background: color-mix(in srgb, var(--SmartThemeBodyColor, #000) 8%, transparent);
            border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.08));
            border-radius: 6px;
            font-family: var(--monoFontFamily, ui-monospace, Consolas, monospace);
            font-size: 0.8rem;
            white-space: pre-wrap;
            word-break: break-word;
            overflow: auto;
            color: var(--SmartThemeBodyColor, #e0e0e0);
            line-height: 1.5;
        }
        .uishortcuts-cleaner-pane pre span {
            border-radius: 2px;
            padding: 0 2px;
        }
        .uishortcuts-cleaner-pane.before pre {
            border-left: 3px solid rgba(220, 80, 80, 0.7);
        }
        .uishortcuts-cleaner-pane.after pre {
            border-left: 3px solid rgba(80, 200, 120, 0.7);
        }
        .uishortcuts-cleaner-stats {
            padding: 0 12px 8px;
            font-size: 0.75rem;
            color: var(--SmartThemeEmColor, #888);
        }
        .uishortcuts-cleaner-footer {
            padding: 10px 14px;
            border-top: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.1));
            display: flex;
            justify-content: flex-end;
            gap: 8px;
        }
        .uishortcuts-cleaner-btn {
            padding: 6px 14px;
            border-radius: 6px;
            border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.15));
            background: var(--black30a, rgba(0, 0, 0, 0.3));
            color: var(--SmartThemeBodyColor, #e0e0e0);
            cursor: pointer;
            font-size: 0.8rem;
            transition: background 0.15s ease;
        }
        .uishortcuts-cleaner-btn:hover {
            background: var(--black50a, rgba(0, 0, 0, 0.5));
        }
        .uishortcuts-cleaner-btn.primary {
            background: var(--SmartThemeQuoteColor, #4a9eff);
            color: white;
            border-color: var(--SmartThemeQuoteColor, #4a9eff);
        }
        .uishortcuts-cleaner-btn.primary:hover {
            filter: brightness(1.1);
        }
        @media (max-width: 700px) {
            .uishortcuts-cleaner-body {
                grid-template-columns: 1fr;
            }
        }
    `;
    document.head.appendChild(style);
}

/**
 * Compute a simple character-level diff and return HTML with highlighting.
 * Added sections in after are highlighted green; removed sections in before are red.
 */
function diffTexts(before, after) {
    // Simple approach: find longest common prefix and suffix, then diff the middle
    let prefixLen = 0;
    while (prefixLen < Math.min(before.length, after.length) && 
           before[prefixLen] === after[prefixLen]) {
        prefixLen++;
    }

    let suffixLen = 0;
    while (suffixLen < Math.min(before.length - prefixLen, after.length - prefixLen) &&
           before[before.length - 1 - suffixLen] === after[after.length - 1 - suffixLen]) {
        suffixLen++;
    }

    const beforePrefix = before.slice(0, prefixLen);
    const beforeMiddle = before.slice(prefixLen, suffixLen ? -suffixLen : undefined);
    const beforeSuffix = before.slice(-suffixLen || undefined);

    const afterPrefix = after.slice(0, prefixLen);
    const afterMiddle = after.slice(prefixLen, suffixLen ? -suffixLen : undefined);
    const afterSuffix = after.slice(-suffixLen || undefined);

    const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    let beforeHtml = escape(beforePrefix);
    if (beforeMiddle) {
        beforeHtml += `<span style="background: rgba(220, 80, 80, 0.3); color: #ff8b8b;">`;
        beforeHtml += escape(beforeMiddle);
        beforeHtml += `</span>`;
    }
    beforeHtml += escape(beforeSuffix);

    let afterHtml = escape(afterPrefix);
    if (afterMiddle) {
        afterHtml += `<span style="background: rgba(80, 200, 120, 0.3); color: #90ee90;">`;
        afterHtml += escape(afterMiddle);
        afterHtml += `</span>`;
    }
    afterHtml += escape(afterSuffix);

    return { beforeHtml, afterHtml };
}

/**
 * Show a confirmation modal with before/after panes and diff highlighting.
 * @returns {Promise<boolean>} true if user confirmed.
 */
function _showDiffModal(before, after) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'uishortcuts-cleaner-overlay';

        const beforeChars = before.length;
        const afterChars = after.length;
        const delta = afterChars - beforeChars;
        const deltaText = delta === 0 ? 'same length' : (delta > 0 ? `+${delta} chars` : `${delta} chars`);

        const { beforeHtml, afterHtml } = diffTexts(before, after);

        overlay.innerHTML = `
            <div class="uishortcuts-cleaner-modal" role="dialog" aria-modal="true">
                <div class="uishortcuts-cleaner-header">
                    <i class="fa-solid fa-broom"></i>
                    <span>Review formatting cleanup</span>
                </div>
                <div class="uishortcuts-cleaner-body">
                    <div class="uishortcuts-cleaner-pane before">
                        <div class="uishortcuts-cleaner-pane-label">Before</div>
                        <pre>${beforeHtml}</pre>
                    </div>
                    <div class="uishortcuts-cleaner-pane after">
                        <div class="uishortcuts-cleaner-pane-label">After</div>
                        <pre>${afterHtml}</pre>
                    </div>
                </div>
                <div class="uishortcuts-cleaner-stats">${deltaText}</div>
                <div class="uishortcuts-cleaner-footer">
                    <button class="uishortcuts-cleaner-btn cancel">Cancel</button>
                    <button class="uishortcuts-cleaner-btn primary apply">Apply</button>
                </div>
            </div>
        `;

        const cleanup = (result) => {
            document.removeEventListener('keydown', onKey);
            overlay.remove();
            resolve(result);
        };
        const onKey = (e) => {
            if (e.key === 'Escape') cleanup(false);
            else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) cleanup(true);
        };

        overlay.querySelector('.cancel').addEventListener('click', () => cleanup(false));
        overlay.querySelector('.apply').addEventListener('click', () => cleanup(true));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });
        document.addEventListener('keydown', onKey);

        document.body.appendChild(overlay);
        overlay.querySelector('.apply').focus();
    });
}

function _shouldShowButton(message) {
    if (!message) return false;
    if (message.is_user) return false; // never on user messages
    return true;
}

class ChatCleaner {
    constructor() {
        this._handlers = {};
        _injectStyles();
        this._bindEvents();
        this._scanAll();
    }

    _bindEvents() {
        const ctx = getSTContext();
        if (!ctx?.eventSource) {
            log('chat-cleaner: eventSource unavailable; module disabled', 'warn');
            return;
        }
        const types = ctx.event_types || {};

        const refresh = (mesId) => this._addButtonForMessage(mesId);
        const refreshAll = () => this._scanAll();

        this._handlers = {
            charRendered: (mesId) => refresh(mesId),
            edited: (mesId) => refresh(mesId),
            swiped: () => refreshAll(),
            chatChanged: () => refreshAll(),
        };

        if (types.CHARACTER_MESSAGE_RENDERED) ctx.eventSource.on(types.CHARACTER_MESSAGE_RENDERED, this._handlers.charRendered);
        if (types.MESSAGE_EDITED) ctx.eventSource.on(types.MESSAGE_EDITED, this._handlers.edited);
        if (types.MESSAGE_SWIPED) ctx.eventSource.on(types.MESSAGE_SWIPED, this._handlers.swiped);
        if (types.CHAT_CHANGED) ctx.eventSource.on(types.CHAT_CHANGED, this._handlers.chatChanged);
    }

    _scanAll() {
        const ctx = getSTContext();
        if (!ctx?.chat) return;
        // Defer slightly — DOM may not be fully built when CHAT_CHANGED fires.
        setTimeout(() => {
            for (let i = 0; i < ctx.chat.length; i++) {
                this._addButtonForMessage(i);
            }
        }, 100);
    }

    _addButtonForMessage(mesId) {
        const ctx = getSTContext();
        if (!ctx?.chat) return;
        const message = ctx.chat[mesId];
        if (!_shouldShowButton(message)) return;

        const messageEl = document.querySelector(`.mes[mesid="${mesId}"]`);
        if (!messageEl) return;

        const container = messageEl.querySelector('.extraMesButtons') || messageEl.querySelector('.mes_buttons');
        if (!container) return;

        // Already added?
        if (container.querySelector(`.${BUTTON_CLASS}`)) return;

        const btn = document.createElement('div');
        btn.className = `mes_button ${BUTTON_CLASS} fa-solid fa-broom interactable`;
        btn.title = 'Clean formatting';
        btn.tabIndex = 0;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._cleanMessage(mesId, btn);
        });

        container.appendChild(btn);
    }

    async _cleanMessage(mesId, btn) {
        const ctx = getSTContext();
        if (!ctx?.chat) return;
        const message = ctx.chat[mesId];
        if (!message) return;

        const original = message.mes;
        const cleaned = cleanText(original);

        if (cleaned === original) {
            this._toast('Already clean');
            return;
        }

        const confirmed = await _showDiffModal(original, cleaned);
        if (!confirmed) return;

        btn.classList.add('uishortcuts-cleaning');
        try {
            message.mes = cleaned;
            // Keep the active swipe in sync if present.
            if (Array.isArray(message.swipes) && typeof message.swipe_id === 'number') {
                message.swipes[message.swipe_id] = cleaned;
            }

            // Re-render the message body.
            if (typeof ctx.updateMessageBlock === 'function') {
                ctx.updateMessageBlock(mesId, message);
            }

            // Persist.
            if (typeof ctx.saveChat === 'function') {
                await ctx.saveChat();
            }

            this._toast('Cleaned formatting');
        } catch (err) {
            log(`chat-cleaner: clean failed: ${err.message}`, 'error');
            this._toast('Clean failed');
        } finally {
            btn.classList.remove('uishortcuts-cleaning');
        }
    }

    _toast(text) {
        const ctx = getSTContext();
        if (ctx?.toastr?.info) {
            ctx.toastr.info(text, 'Chat Cleaner', { timeOut: 1500 });
        } else if (typeof toastr !== 'undefined') {
            // eslint-disable-next-line no-undef
            toastr.info(text, 'Chat Cleaner', { timeOut: 1500 });
        }
    }

    destroy() {
        const ctx = getSTContext();
        const types = ctx?.event_types || {};
        if (ctx?.eventSource) {
            if (types.CHARACTER_MESSAGE_RENDERED && this._handlers.charRendered) {
                ctx.eventSource.removeListener(types.CHARACTER_MESSAGE_RENDERED, this._handlers.charRendered);
            }
            if (types.MESSAGE_EDITED && this._handlers.edited) {
                ctx.eventSource.removeListener(types.MESSAGE_EDITED, this._handlers.edited);
            }
            if (types.MESSAGE_SWIPED && this._handlers.swiped) {
                ctx.eventSource.removeListener(types.MESSAGE_SWIPED, this._handlers.swiped);
            }
            if (types.CHAT_CHANGED && this._handlers.chatChanged) {
                ctx.eventSource.removeListener(types.CHAT_CHANGED, this._handlers.chatChanged);
            }
        }
        document.querySelectorAll(`.${BUTTON_CLASS}`).forEach(el => el.remove());
        document.getElementById(STYLE_ID)?.remove();
        log('Chat cleaner destroyed');
    }
}

let instance = null;

export function initChatCleaner() {
    if (!instance) instance = new ChatCleaner();
    return instance;
}

export const definition = {
    key: 'chatCleaner',
    label: 'Chat Cleaner',
    description: 'Adds a "Clean formatting" button to AI/system messages. Fixes mid-word asterisks and orphan emphasis markers that compound across the conversation.',
    init: initChatCleaner,
};
