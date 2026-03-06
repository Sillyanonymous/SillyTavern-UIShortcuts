/**
 * Prompt Groups Module — Non-destructive approach
 *
 * Keeps ALL <li> as direct children of #completion_prompt_manager_list.
 * Injects clickable <div> headers between groups. Uses CSS classes for
 * visual styling (thick accent borders + background tints).
 *
 * Recovery mechanisms:
 *   - MutationObserver (subtree: true) catches ALL DOM changes
 *   - Safety interval re-applies if fingerprint drifts
 *   - _clean + _apply is fully idempotent / self-healing
 */

import { log, getSTContext } from '../../utils.js';

// ========================================
// SELECTORS & CONSTANTS
// ========================================

const SEL = {
    container: '#completion_prompt_manager_list',
    item:      'li.completion_prompt_manager_prompt',
    nameLink:  'span.completion_prompt_manager_prompt_name a.prompt-manager-inspect-action',
    nameSpan:  'span.completion_prompt_manager_prompt_name',
    toggleOn:  '.fa-toggle-on',
};

/** Full item selector with container for high-specificity CSS */
const LI_FULL = `${SEL.container} > ${SEL.item}`;

const PROMPT_GROUPS_STATE_FIELD = 'promptGroupStates';
const DEFAULT_GROUP_MARKER = '===';
const DEFAULT_SUB_MARKER = '<';

// CSS class names
const C = {
    hdr:      'uipg-hdr',
    subHdr:   'uipg-sub-hdr',
    closed:   'uipg-closed',
    hidden:   'uipg-hidden',
    member:   'uipg-member',
    subMem:   'uipg-sub-member',
    collapsed:'uipg-collapsed',
    last:     'uipg-last',
    chevron:  'uipg-chevron',
    name:     'uipg-name',
    badge:    'uipg-badge',
};

const LI_CLASSES = [C.hidden, C.member, C.subMem, C.collapsed, C.last];

// ========================================
// STATE PERSISTENCE
// ========================================

function _getSTStore() {
    const ctx = getSTContext();
    return ctx?.extensionSettings?.UIShortcuts || null;
}

function _persistToST() {
    const ctx = getSTContext();
    if (typeof ctx?.saveSettingsDebounced === 'function') {
        ctx.saveSettingsDebounced();
    }
}

function loadStates() {
    try {
        const store = _getSTStore();
        if (store?.promptGroups?.rememberState === false) return {};
        return store?.[PROMPT_GROUPS_STATE_FIELD] || {};
    } catch { return {}; }
}

function saveStates(s) {
    try {
        const store = _getSTStore();
        if (store) {
            store[PROMPT_GROUPS_STATE_FIELD] = s;
            _persistToST();
        }
    } catch { /* silent */ }
}

// ========================================
// HELPERS
// ========================================

function getName(li) {
    const a = li.querySelector(SEL.nameLink);
    if (a) return a.textContent.trim();
    const s = li.querySelector(SEL.nameSpan);
    return s ? s.textContent.trim() : '';
}

function isOn(li) {
    return !!li.querySelector(SEL.toggleOn);
}

function _escRegex(ch) {
    return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getMarkers() {
    const pg = _getSTStore()?.promptGroups;
    return {
        group: pg?.groupMarker || DEFAULT_GROUP_MARKER,
        sub:   pg?.subGroupMarker || DEFAULT_SUB_MARKER,
    };
}

function parseDivider(name, prefix) {
    if (!prefix || !name.startsWith(prefix)) return null;
    const ch = _escRegex(prefix[prefix.length - 1]);
    let clean = name.slice(prefix.length);
    clean = clean.replace(new RegExp('^' + ch + '+'), '');
    clean = clean.replace(new RegExp(ch + '+\\s*$'), '');
    clean = clean.trim() || 'Group';
    return { clean, key: name };
}

function parseSubDiv(name, prefix) {
    if (!prefix || !name.startsWith(prefix)) return null;
    const ch = _escRegex(prefix[prefix.length - 1]);
    let clean = name.slice(prefix.length);
    clean = clean.replace(new RegExp('^' + ch + '+'), '');
    clean = clean.replace(new RegExp(ch + '+\\s*$'), '');
    clean = clean.trim() || 'Sub-group';
    return { clean, key: name };
}

// ========================================
// INJECTED STYLES
// ========================================

const STYLE_ID = 'uipg-injected-styles';

const CSS = `
/* ====== Prompt Groups — injected by module ====== */

/* Ensure list container doesn't clip children horizontally */
${SEL.container} {
    overflow-x: visible !important;
}

.${C.hidden},
.${C.collapsed} {
    display: none !important;
}

/* ── Group header (green) ─────────────────────── */

.${C.hdr} {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 12px;
    margin: 8px 0 0 0;
    cursor: pointer;
    user-select: none;
    font-size: 0.88rem;
    background: rgba(76, 175, 80, 0.18) !important;
    border-left: 4px solid rgba(76, 175, 80, 0.7);
    border-top: 1px solid rgba(76, 175, 80, 0.3);
    border-right: 1px solid rgba(76, 175, 80, 0.3);
    border-bottom: none;
    border-radius: 6px 6px 0 0;
    transition: background 0.15s;
    box-sizing: border-box;
    max-width: 100%;
}
.${C.hdr}:hover {
    background: rgba(76, 175, 80, 0.26) !important;
}
.${C.hdr}.${C.closed} {
    border-bottom: 1px solid rgba(76, 175, 80, 0.3);
    border-radius: 6px;
    margin-bottom: 2px;
}

/* ── Sub-group header (orange) ────────────────── */

.${C.subHdr} {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 5px 10px 5px 24px;
    cursor: pointer;
    user-select: none;
    font-size: 0.82rem;
    background: rgba(255, 152, 0, 0.14) !important;
    border-left: 4px solid rgba(255, 152, 0, 0.6);
    border-right: 1px solid rgba(76, 175, 80, 0.3);
    border-top: 1px solid rgba(255, 152, 0, 0.2);
    border-bottom: none;
    transition: background 0.15s;
    box-sizing: border-box;
    max-width: 100%;
}
.${C.subHdr}:hover {
    background: rgba(255, 152, 0, 0.22) !important;
}
.${C.subHdr}.${C.closed} {
    border-bottom: 1px solid rgba(255, 152, 0, 0.2);
}

/* ── Shared header children ───────────────────── */

.${C.chevron} {
    font-size: 0.6rem;
    flex-shrink: 0;
    width: 14px;
    text-align: center;
}
.${C.hdr}    .${C.chevron} { color: rgba(76, 175, 80, 0.85); }
.${C.subHdr} .${C.chevron} { color: rgba(255, 152, 0, 0.75); }

.${C.name} {
    flex: 1;
    font-weight: 600;
    color: var(--SmartThemeBodyColor, #e0e0e0);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.${C.badge} {
    font-size: 0.7rem;
    font-weight: 600;
    border-radius: 8px;
    padding: 2px 8px;
    flex-shrink: 0;
    letter-spacing: 0.02em;
}
.${C.hdr}    .${C.badge} { color: rgba(76,175,80,0.95); background: rgba(76,175,80,0.15); }
.${C.subHdr} .${C.badge} { color: rgba(255,152,0,0.95); background: rgba(255,152,0,0.15); }

/* ── Group member <li> (green accent) ─────────── */

${LI_FULL}.${C.member} {
    background: rgba(76, 175, 80, 0.08) !important;
    border-left: 4px solid rgba(76, 175, 80, 0.55) !important;
    border-right: 1px solid rgba(76, 175, 80, 0.2) !important;
    border-top: none !important;
    border-bottom: none !important;
    margin-top: 0 !important;
    margin-bottom: 0 !important;
    border-radius: 0 !important;
    box-sizing: border-box !important;
    min-width: 0 !important;
    overflow: visible !important;
}

${LI_FULL}.${C.member}.${C.last} {
    border-bottom: 1px solid rgba(76, 175, 80, 0.3) !important;
    border-radius: 0 0 6px 4px !important;
    margin-bottom: 4px !important;
}

/* ── Sub-group member <li> (orange accent) ────── */

${LI_FULL}.${C.subMem} {
    background: rgba(255, 152, 0, 0.07) !important;
    border-left: 4px solid rgba(255, 152, 0, 0.5) !important;
    border-right: 1px solid rgba(76, 175, 80, 0.2) !important;
    border-top: none !important;
    border-bottom: none !important;
    padding-left: 20px !important;
    margin-top: 0 !important;
    margin-bottom: 0 !important;
    border-radius: 0 !important;
    box-sizing: border-box !important;
    min-width: 0 !important;
    overflow: visible !important;
}

${LI_FULL}.${C.subMem}.${C.last} {
    border-bottom: 1px solid rgba(76, 175, 80, 0.3) !important;
    border-radius: 0 0 6px 4px !important;
    margin-bottom: 4px !important;
}
`;

function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = CSS;
    document.head.appendChild(el);
}

function removeStyles() {
    document.getElementById(STYLE_ID)?.remove();
}

// ========================================
// PROMPT GROUPS CLASS
// ========================================

class PromptGroups {
    constructor() {
        this.states = loadStates();
        this._obs = null;
        this._debounce = null;
        this._retryTimer = null;
        this._bodyObs = null;
        this._safetyInterval = null;
        this._applying = false;
        this._lastFP = '';

        injectStyles();
        this._boot();
    }

    // ----------------------------------------------------------------
    // BOOT — find or wait for the container
    // ----------------------------------------------------------------

    _boot() {
        const c = this._getContainer();
        if (c) { this._attach(c); return; }

        let n = 0;
        this._retryTimer = setInterval(() => {
            if (++n > 120) {
                clearInterval(this._retryTimer);
                this._retryTimer = null;
                this._watchBody();
                return;
            }
            const c2 = this._getContainer();
            if (c2) {
                clearInterval(this._retryTimer);
                this._retryTimer = null;
                this._attach(c2);
            }
        }, 500);
    }

    _watchBody() {
        this._bodyObs = new MutationObserver(() => {
            const c = this._getContainer();
            if (c) {
                this._bodyObs.disconnect();
                this._bodyObs = null;
                this._attach(c);
            }
        });
        this._bodyObs.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => {
            if (this._bodyObs) { this._bodyObs.disconnect(); this._bodyObs = null; }
        }, 120_000);
    }

    _getContainer() {
        const c = document.querySelector(SEL.container);
        return c && c.querySelector(`:scope > ${SEL.item}`) ? c : null;
    }

    _attach(container) {
        this._apply(container);
        this._observe(container);
        this._startSafety();
        log('Prompt groups attached');
    }

    // ----------------------------------------------------------------
    // OBSERVER — subtree: true catches enable/disable toggles
    // ----------------------------------------------------------------

    _observe(container) {
        if (this._obs) this._obs.disconnect();

        this._obs = new MutationObserver(() => {
            if (this._applying) return;
            clearTimeout(this._debounce);
            this._debounce = setTimeout(() => {
                const c = document.querySelector(SEL.container);
                if (c) this._apply(c);
            }, 200);
        });

        this._obs.observe(container, { childList: true, subtree: true });
    }

    // ----------------------------------------------------------------
    // SAFETY INTERVAL — catches anything the observer misses
    // ----------------------------------------------------------------

    _startSafety() {
        if (this._safetyInterval) return;
        this._safetyInterval = setInterval(() => {
            if (this._applying) return;
            const c = document.querySelector(SEL.container);
            if (!c) return;

            // Check if our headers are still present. If ST rebuilt the list
            // (page refresh, user change, preset switch), the container has
            // fresh <li> elements and our injected <div> headers are gone —
            // even though the fingerprint (names + enabled) may be identical.
            const headersPresent = c.querySelector(`.${C.hdr}`) !== null;
            const fp = this._fp(c);

            if (fp !== this._lastFP || !headersPresent) {
                this._apply(c);
                this._observe(c); // re-observe in case container was replaced
            }
        }, 500);
    }

    /** Cheap fingerprint: count + names + enabled state */
    _fp(container) {
        const items = container.querySelectorAll(`:scope > ${SEL.item}`);
        let s = items.length + '|';
        for (const li of items) {
            s += (li.dataset.pmIdentifier || getName(li).slice(0, 16));
            s += isOn(li) ? '1' : '0';
            s += ',';
        }
        return s;
    }

    // ----------------------------------------------------------------
    // CORE: APPLY GROUPING (non-destructive, idempotent)
    // ----------------------------------------------------------------

    _apply(container) {
        this._applying = true;
        if (this._obs) this._obs.disconnect();

        let ok = false;
        try {
            // 1. Strip all our artifacts
            this._clean(container);

            // 2. Enumerate <li> items
            const items = Array.from(
                container.querySelectorAll(`:scope > ${SEL.item}`)
            );
            if (!items.length) {
                this._lastFP = this._fp(container);
                this._resume(container);
                return;
            }

            // 3. Parse groups
            const groups = [];
            let curG = null;
            let curS = null;

            const markers = getMarkers();

            for (const li of items) {
                const name = getName(li);
                const dv = parseDivider(name, markers.group);
                const sd = parseSubDiv(name, markers.sub);

                if (dv) {
                    curS = null;
                    curG = { key: dv.key, clean: dv.clean, divLi: li, members: [], subs: [] };
                    groups.push(curG);
                } else if (sd && curG) {
                    curS = { key: sd.key, clean: sd.clean, divLi: li, members: [] };
                    curG.subs.push(curS);
                } else if (curS) {
                    curS.members.push(li);
                } else if (curG) {
                    curG.members.push(li);
                }
                // Items before the first divider are left untouched
            }

            // 4. Render each group
            for (const g of groups) {
                const open = this.states[g.key] === true; // default collapsed

                g.divLi.classList.add(C.hidden);
                const hdr = this._makeHdr(g.key, g.clean, 'group', open, g);
                container.insertBefore(hdr, g.divLi);

                // Direct members
                for (const li of g.members) {
                    li.classList.add(C.member);
                    if (!open) li.classList.add(C.collapsed);
                }

                // Sub-groups
                for (const s of g.subs) {
                    const subOpen = this.states[s.key] === true;

                    s.divLi.classList.add(C.hidden);
                    const subHdr = this._makeHdr(s.key, s.clean, 'sub', subOpen, s);
                    container.insertBefore(subHdr, s.divLi);

                    if (!open) {
                        subHdr.classList.add(C.collapsed);
                        s.divLi.classList.add(C.collapsed);
                    }

                    for (const li of s.members) {
                        li.classList.add(C.subMem);
                        if (!open || !subOpen) li.classList.add(C.collapsed);
                    }
                }

                // Mark last visible item for bottom border
                this._markLast(g, open);
            }

            ok = true;
        } catch (e) {
            log('Prompt groups _apply error: ' + e.message, 'error');
        }

        if (ok) this._lastFP = this._fp(container);
        this._resume(container);
    }

    // ----------------------------------------------------------------
    // HEADER ELEMENT
    // ----------------------------------------------------------------

    _makeHdr(key, label, type, isOpen, data) {
        const div = document.createElement('div');
        div.className = type === 'group' ? C.hdr : C.subHdr;
        if (!isOpen) div.classList.add(C.closed);
        div.dataset.uipgKey = key;

        const chev = document.createElement('span');
        chev.className = C.chevron;
        chev.textContent = isOpen ? '▼' : '▶';

        const nm = document.createElement('span');
        nm.className = C.name;
        nm.textContent = label;

        const badge = document.createElement('span');
        badge.className = C.badge;
        this._setBadge(badge, data);

        div.append(chev, nm, badge);

        div.addEventListener('click', () => {
            this.states[key] = !this.states[key];
            if (_getSTStore()?.promptGroups?.rememberState !== false) {
                saveStates(this.states);
            }
            const c = document.querySelector(SEL.container);
            if (c) this._apply(c);
        });

        return div;
    }

    _setBadge(el, data) {
        const all = [...(data.members || [])];
        if (data.subs) for (const s of data.subs) all.push(...s.members);
        const on = all.filter(isOn).length;
        el.textContent = `${on}/${all.length}`;
    }

    // ----------------------------------------------------------------
    // MARK LAST VISIBLE — for bottom-border rounding
    // ----------------------------------------------------------------

    _markLast(group, open) {
        if (!open) return;
        const all = [...group.members];
        for (const s of group.subs) all.push(...s.members);
        const vis = all.filter(li => !li.classList.contains(C.collapsed));
        if (vis.length) vis[vis.length - 1].classList.add(C.last);
    }

    // ----------------------------------------------------------------
    // CLEAN — remove all our artifacts
    // ----------------------------------------------------------------

    _clean(container) {
        // Remove injected header divs
        container.querySelectorAll(`.${C.hdr}, .${C.subHdr}`).forEach(el => el.remove());

        // Strip classes from <li> items
        container.querySelectorAll(`:scope > ${SEL.item}`).forEach(li => {
            li.classList.remove(...LI_CLASSES);
        });
    }

    // ----------------------------------------------------------------
    // RESUME OBSERVER
    // ----------------------------------------------------------------

    _resume(container) {
        this._applying = false;
        if (this._obs && container) {
            this._obs.observe(container, { childList: true, subtree: true });
        }
    }

    // ----------------------------------------------------------------
    // DESTROY
    // ----------------------------------------------------------------

    destroy() {
        clearTimeout(this._debounce);
        clearInterval(this._retryTimer);
        clearInterval(this._safetyInterval);
        this._safetyInterval = null;
        this._bodyObs?.disconnect(); this._bodyObs = null;
        this._obs?.disconnect(); this._obs = null;

        const c = document.querySelector(SEL.container);
        if (c) this._clean(c);

        removeStyles();
        instance = null;
        log('Prompt groups destroyed');
    }
}

// ========================================
// EXPORT
// ========================================

let instance = null;

export function initPromptGroups() {
    if (!instance) instance = new PromptGroups();
    return instance;
}

export const definition = {
    key: 'promptGroups',
    label: 'Prompt Groups',
    description: 'Groups prompts in the Prompt Manager by detecting === dividers as collapsible sections.',
    init: initPromptGroups,
    settings: {
        defaults: {
            groupMarker: '===',
            subGroupMarker: '<',
            rememberState: true,
        },
        render: (values) => `
            <small style="display:block; margin-bottom:6px; opacity:0.7;">
                <i class="fa-solid fa-layer-group"></i> Marker prefixes — characters at the start of a prompt name that mark it as a group/sub-group divider
            </small>
            <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
                <label class="uishortcuts-setting-label" style="margin:0;">
                    Group
                    <input type="text" data-key="groupMarker" placeholder="===" style="width:70px; margin-left:4px;" />
                </label>
                <label class="uishortcuts-setting-label" style="margin:0;">
                    Sub-group
                    <input type="text" data-key="subGroupMarker" placeholder="<" style="width:70px; margin-left:4px;" />
                </label>
            </div>
            <label class="checkbox_label" style="margin-top:6px;">
                <input type="checkbox" data-key="rememberState" ${values.rememberState !== false ? 'checked' : ''} />
                <span>Remember open/closed state</span>
            </label>
        `,
        hydrate: (container, values) => {
            container.querySelector('[data-key="groupMarker"]').value = values.groupMarker || '===';
            container.querySelector('[data-key="subGroupMarker"]').value = values.subGroupMarker || '<';
        },
    },
};

export { PromptGroups };
