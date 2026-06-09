/**
 * Alternate Greeting Inserter
 *
 * Browse the active character's greetings (main first_mes + alternate_greetings),
 * pick one, and append it to the chat as a message on behalf of {{char}}.
 *
 * Entry points: a wand-menu item and a /altgreet slash command.
 * Mobile follows the avatar-gallery model (fixed panel, JS class, !important overrides).
 */

import { log, getSTContext } from '../../utils.js';

const STYLE_ID = 'uishortcuts-altgreet-styles';
const WAND_BUTTON_ID = 'uishortcuts-altgreet-wand';
const PANEL_CLASS = 'uishortcuts-altgreet-panel';
const BACKDROP_CLASS = 'uishortcuts-altgreet-backdrop';
const MOBILE_CLASS = 'uishortcuts-altgreet-mobile';
const BODY_OPEN_CLASS = 'uishortcuts-altgreet-open';
const MOBILE_MEDIA_QUERY = '(pointer: coarse), (max-width: 900px)';

// Slash command lives for the whole session; register once even across re-inits.
let slashRegistered = false;

/**
 * Collects the active character's greetings.
 * @returns {{ error: string|null, list: string[], charName: string|null }}
 */
function _getGreetings() {
    const ctx = getSTContext();
    if (ctx?.groupId) return { error: 'group', list: [], charName: null };

    const char = ctx?.characters?.[ctx?.characterId];
    if (!char) return { error: 'nochar', list: [], charName: null };

    const main = (typeof char.first_mes === 'string' && char.first_mes.trim()) ? [char.first_mes] : [];
    const alts = Array.isArray(char.data?.alternate_greetings)
        ? char.data.alternate_greetings.filter(g => typeof g === 'string' && g.trim())
        : [];

    return { error: null, list: [...main, ...alts], charName: char.name };
}

/**
 * Appends a greeting to the chat as a {{char}} message and persists it.
 * @param {string} rawText Greeting text (macros unresolved)
 * @returns {Promise<boolean>}
 */
async function _sendGreeting(rawText) {
    const ctx = getSTContext();
    if (!ctx?.chat || typeof ctx.addOneMessage !== 'function') return false;

    const char = ctx.characters?.[ctx.characterId];
    const name = char?.name || ctx.name2;
    const types = ctx.eventTypes || ctx.event_types || {};

    const message = {
        name,
        is_user: false,
        is_system: false,
        send_date: new Date().toISOString(),
        mes: ctx.substituteParams ? ctx.substituteParams(String(rawText ?? '')) : String(rawText ?? ''),
        extra: {},
    };

    ctx.chat.push(message);
    const idx = ctx.chat.length - 1;

    if (types.MESSAGE_RECEIVED) await ctx.eventSource.emit(types.MESSAGE_RECEIVED, idx, 'extension');
    ctx.addOneMessage(message);
    if (types.CHARACTER_MESSAGE_RENDERED) await ctx.eventSource.emit(types.CHARACTER_MESSAGE_RENDERED, idx, 'extension');
    if (typeof ctx.saveChat === 'function') await ctx.saveChat();

    return true;
}

function _toast(type, msg) {
    if (typeof toastr !== 'undefined' && toastr?.[type]) toastr[type](msg);
}

function _reportError(error) {
    if (error === 'group') _toast('info', 'Group chats have no single active character.');
    else if (error === 'nochar') _toast('info', 'Select a character first.');
    else _toast('warning', 'No greetings available for this character.');
}

function _injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
        .${BACKDROP_CLASS} {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.65);
            backdrop-filter: blur(4px);
            z-index: 9998;
        }
        .${PANEL_CLASS} {
            position: fixed;
            z-index: 9999;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: min(92vw, 760px);
            max-height: 85vh;
            /* Theme tint over an opaque backstop: stays solid without backdrop blur,
               which themes like Moonlit Echoes rely on for their low-alpha tint. */
            background: linear-gradient(var(--SmartThemeBlurTintColor, #1a1a1a), var(--SmartThemeBlurTintColor, #1a1a1a)), #1a1a1a;
            border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.15));
            border-radius: 10px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
            color: var(--SmartThemeBodyColor, #e0e0e0);
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        .uishortcuts-altgreet-header {
            padding: 10px 14px;
            border-bottom: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.1));
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .uishortcuts-altgreet-header i { color: var(--SmartThemeQuoteColor, #4a9eff); }
        .uishortcuts-altgreet-header .uishortcuts-altgreet-count {
            margin-left: auto;
            font-weight: 400;
            font-size: 0.8rem;
            color: var(--SmartThemeEmColor, #888);
        }
        .uishortcuts-altgreet-body {
            padding: 12px;
            overflow: hidden;
            display: flex;
            min-height: 0;
            flex: 1;
        }
        .uishortcuts-altgreet-preview {
            flex: 1;
            margin: 0;
            padding: 12px;
            background: color-mix(in srgb, var(--SmartThemeBodyColor, #000) 8%, transparent);
            border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.08));
            border-left: 3px solid var(--SmartThemeQuoteColor, #4a9eff);
            border-radius: 6px;
            word-break: break-word;
            overflow: auto;
            line-height: 1.55;
            font-size: 0.9rem;
            color: var(--SmartThemeBodyColor, #e0e0e0);
        }
        .uishortcuts-altgreet-preview img {
            max-width: 100%;
            height: auto;
            border-radius: 4px;
        }
        .uishortcuts-altgreet-footer {
            padding: 10px 14px;
            border-top: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.1));
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .uishortcuts-altgreet-footer .spacer { flex: 1; }
        .uishortcuts-altgreet-btn {
            padding: 6px 14px;
            border-radius: 6px;
            border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.15));
            background: var(--black30a, rgba(0, 0, 0, 0.3));
            color: var(--SmartThemeBodyColor, #e0e0e0);
            cursor: pointer;
            font-size: 0.85rem;
            transition: background var(--uishortcuts-transition, 0.15s ease);
        }
        .uishortcuts-altgreet-btn:hover { background: var(--white20a, rgba(255, 255, 255, 0.12)); }
        .uishortcuts-altgreet-btn:disabled { opacity: 0.4; cursor: default; }
        .uishortcuts-altgreet-btn.send {
            border-color: var(--SmartThemeQuoteColor, #4a9eff);
            color: var(--SmartThemeQuoteColor, #4a9eff);
        }

        /* Fullscreen opaque on mobile. !important so a custom mobile theme can't
           override size/position; double-gated by media query and JS class. */
        @media (pointer: coarse), (max-width: 900px) {
            .${PANEL_CLASS},
            .${PANEL_CLASS}.${MOBILE_CLASS} {
                inset: 0 !important;
                top: 0 !important;
                left: 0 !important;
                width: 100vw !important;
                height: 100vh !important;
                height: 100dvh !important; /* respects mobile browser chrome */
                max-width: none !important;
                max-height: none !important;
                transform: none !important;
                border: none !important;
                border-radius: 0 !important;
                box-shadow: none !important;
                background: linear-gradient(var(--SmartThemeBlurTintColor, #14141a), var(--SmartThemeBlurTintColor, #14141a)), #14141a !important;
                backdrop-filter: none !important;
            }
            .${BACKDROP_CLASS} { display: none !important; }
            .uishortcuts-altgreet-header {
                padding-top: calc(10px + env(safe-area-inset-top));
            }
            .uishortcuts-altgreet-footer {
                flex-wrap: wrap;
                gap: 8px;
                padding-bottom: calc(10px + env(safe-area-inset-bottom));
            }
            .uishortcuts-altgreet-footer .spacer { display: none; }
            .uishortcuts-altgreet-btn {
                flex: 1 1 0;
                min-height: 44px;
                text-align: center;
                white-space: nowrap;
            }
            .uishortcuts-altgreet-btn.send {
                flex-basis: 100%;
                white-space: normal;
            }
            body.${BODY_OPEN_CLASS} {
                overflow: hidden;
                touch-action: none;
            }
        }
    `;
    document.head.appendChild(style);
}

let instance = null;

export class AltGreetingInserter {
    constructor() {
        this._observer = null;
        this._panel = null;
        this._backdrop = null;
        this._state = null;
        this._mql = window.matchMedia ? window.matchMedia(MOBILE_MEDIA_QUERY) : null;
        this._onKeyDown = this._onKeyDown.bind(this);
        this._applyMobileState = this._applyMobileState.bind(this);

        _injectStyles();
        _registerSlashCommand();
        this._ensureWandButton();
    }

    /** Adds the wand-menu launcher, waiting for the menu container if needed. */
    _ensureWandButton() {
        if (this._addWandButton()) return;
        this._observer = new MutationObserver(() => {
            if (this._addWandButton() && this._observer) {
                this._observer.disconnect();
                this._observer = null;
            }
        });
        this._observer.observe(document.body, { childList: true, subtree: true });
    }

    _addWandButton() {
        const menu = document.getElementById('extensionsMenu');
        if (!menu) return false;
        if (document.getElementById(WAND_BUTTON_ID)) return true;

        const item = document.createElement('div');
        item.id = WAND_BUTTON_ID;
        item.className = 'list-group-item flex-container flexGap5';
        item.title = 'Send a character greeting to the chat';

        const icon = document.createElement('div');
        icon.className = 'fa-solid fa-comment-dots extensionsMenuExtensionButton';
        const label = document.createElement('span');
        label.textContent = 'Insert Greeting';

        item.appendChild(icon);
        item.appendChild(label);
        item.addEventListener('click', () => this.open());
        menu.appendChild(item);
        return true;
    }

    open() {
        try {
            const { error, list, charName } = _getGreetings();
            if (error || list.length === 0) {
                _reportError(error || 'empty');
                return;
            }

            // Close the wand menu if it's open so it doesn't sit over the panel.
            const wandMenu = document.getElementById('extensionsMenu');
            if (wandMenu) wandMenu.style.display = 'none';

            this._buildPanel(list, charName);
        } catch (e) {
            log(`failed to open greeting browser: ${e.message}`, 'error');
            _toast('error', 'Could not open the greeting browser. Check the console.');
        }
    }

    _buildPanel(list, charName) {
        this._dismiss();
        this._state = { list, index: 0, charName };

        const backdrop = document.createElement('div');
        backdrop.className = BACKDROP_CLASS;
        backdrop.addEventListener('click', () => this._dismiss());

        const panel = document.createElement('div');
        panel.className = PANEL_CLASS;
        panel.innerHTML = `
            <div class="uishortcuts-altgreet-header">
                <i class="fa-solid fa-comment-dots"></i>
                <span class="uishortcuts-altgreet-title"></span>
                <span class="uishortcuts-altgreet-count"></span>
            </div>
            <div class="uishortcuts-altgreet-body">
                <div class="uishortcuts-altgreet-preview mes_text"></div>
            </div>
            <div class="uishortcuts-altgreet-footer">
                <button class="uishortcuts-altgreet-btn prev"><i class="fa-solid fa-chevron-left"></i> Prev</button>
                <button class="uishortcuts-altgreet-btn next">Next <i class="fa-solid fa-chevron-right"></i></button>
                <span class="spacer"></span>
                <button class="uishortcuts-altgreet-btn close">Close</button>
                <button class="uishortcuts-altgreet-btn send"><i class="fa-solid fa-paper-plane"></i> Send as ${charName}</button>
            </div>
        `;

        panel.querySelector('.prev').addEventListener('click', () => this._step(-1));
        panel.querySelector('.next').addEventListener('click', () => this._step(1));
        panel.querySelector('.close').addEventListener('click', () => this._dismiss());
        panel.querySelector('.send').addEventListener('click', () => this._sendCurrent());

        document.body.appendChild(backdrop);
        document.body.appendChild(panel);
        document.body.classList.add(BODY_OPEN_CLASS);
        this._backdrop = backdrop;
        this._panel = panel;

        this._applyMobileState();
        this._mql?.addEventListener('change', this._applyMobileState);
        document.addEventListener('keydown', this._onKeyDown, true);
        this._renderCurrent();
    }

    /** Toggles the mobile class on the panel (parity with avatar-gallery). */
    _applyMobileState() {
        if (!this._panel) return;
        const isMobile = this._mql?.matches ?? false;
        this._panel.classList.toggle(MOBILE_CLASS, isMobile);
    }

    _renderCurrent() {
        if (!this._panel || !this._state) return;
        const ctx = getSTContext();
        const { list, index, charName } = this._state;
        const raw = list[index];
        const text = ctx?.substituteParams ? ctx.substituteParams(raw) : raw;

        this._panel.querySelector('.uishortcuts-altgreet-title').textContent = charName || 'Greetings';
        this._panel.querySelector('.uishortcuts-altgreet-count').textContent = `${index + 1} / ${list.length}`;

        const previewEl = this._panel.querySelector('.uishortcuts-altgreet-preview');
        // Render via ST's own formatter for markdown, media, and sanitized CSS.
        // messageId -1 avoids the chat[0] special case; fall back to plain text if it throws.
        try {
            if (typeof ctx?.messageFormatting !== 'function') throw new Error('messageFormatting unavailable');
            previewEl.innerHTML = ctx.messageFormatting(text, charName, false, false, -1);
        } catch (e) {
            log(`greeting preview formatting failed, showing plain text: ${e.message}`, 'warn');
            previewEl.textContent = text;
        }
        this._panel.querySelector('.prev').disabled = index <= 0;
        this._panel.querySelector('.next').disabled = index >= list.length - 1;
    }

    _step(delta) {
        if (!this._state) return;
        const next = this._state.index + delta;
        if (next < 0 || next >= this._state.list.length) return;
        this._state.index = next;
        this._renderCurrent();
    }

    async _sendCurrent() {
        if (!this._state) return;
        const raw = this._state.list[this._state.index];
        this._dismiss();
        const ok = await _sendGreeting(raw);
        if (ok) _toast('success', 'Greeting added to chat.');
        else _toast('error', 'Could not add greeting.');
    }

    _onKeyDown(e) {
        if (!this._panel) return;
        const handled = ['Escape', 'ArrowLeft', 'ArrowRight', 'Enter'];
        if (!handled.includes(e.key)) return;

        // Stop here so arrow keys don't trigger ST swipe and Enter doesn't hit the send box.
        e.preventDefault();
        e.stopPropagation();

        switch (e.key) {
            case 'Escape': this._dismiss(); break;
            case 'ArrowLeft': this._step(-1); break;
            case 'ArrowRight': this._step(1); break;
            case 'Enter': this._sendCurrent(); break;
        }
    }

    _dismiss() {
        document.removeEventListener('keydown', this._onKeyDown, true);
        this._mql?.removeEventListener('change', this._applyMobileState);
        document.body.classList.remove(BODY_OPEN_CLASS);
        if (this._panel) { this._panel.remove(); this._panel = null; }
        if (this._backdrop) { this._backdrop.remove(); this._backdrop = null; }
        this._state = null;
    }

    destroy() {
        this._dismiss();
        if (this._observer) {
            this._observer.disconnect();
            this._observer = null;
        }
        document.getElementById(WAND_BUTTON_ID)?.remove();
        document.getElementById(STYLE_ID)?.remove();
        instance = null;
        log('Alternate greeting inserter destroyed');
    }
}

function _registerSlashCommand() {
    if (slashRegistered) return;
    const ctx = getSTContext();
    if (!ctx?.SlashCommandParser || !ctx.SlashCommand) return;

    try {
        ctx.SlashCommandParser.addCommandObject(ctx.SlashCommand.fromProps({
            name: 'altgreet',
            aliases: ['altgreeting'],
            helpString: 'Open the greeting browser, or pass a 1-based number to send that greeting as {{char}}.',
            unnamedArgumentList: ctx.SlashCommandArgument ? [
                ctx.SlashCommandArgument.fromProps({
                    description: 'greeting number (1-based)',
                    typeList: ctx.ARGUMENT_TYPE ? [ctx.ARGUMENT_TYPE.NUMBER] : [],
                    isRequired: false,
                }),
            ] : [],
            callback: async (_args, value) => {
                if (!instance) { _toast('info', 'Alternate Greeting Inserter is disabled.'); return ''; }

                const raw = String(value ?? '').trim();
                if (raw === '') { instance.open(); return ''; }

                const { error, list } = _getGreetings();
                if (error || list.length === 0) { _reportError(error || 'empty'); return ''; }

                const n = Number(raw);
                if (!Number.isInteger(n) || n < 1 || n > list.length) {
                    _toast('warning', `Pick a number between 1 and ${list.length}.`);
                    return '';
                }

                await _sendGreeting(list[n - 1]);
                return '';
            },
        }));
        slashRegistered = true;
    } catch (e) {
        log(`altgreet slash command registration failed: ${e.message}`, 'warn');
    }
}

export function initAltGreetingInserter() {
    if (!instance) instance = new AltGreetingInserter();
    return instance;
}

export const definition = {
    key: 'altGreetingInserter',
    label: 'Alternate Greeting Inserter',
    description: "Browse the active character's greetings and send one to the chat as {{char}}. Adds a wand-menu item and a /altgreet command.",
    init: initAltGreetingInserter,
};
