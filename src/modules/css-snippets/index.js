/**
 * CSS Snippets Module
 * User-creatable CSS snippets that can be saved, exported, toggled, and shared.
 * Replaces hardcoded CSS-only modules (assistant-hider, hide-favorites-hotswap, etc.)
 */

import { log, getSTContext } from '../../utils.js';

const ST_SETTINGS_KEY = 'UIShortcuts';
const SNIPPETS_FIELD = 'cssSnippets';
const STYLE_PREFIX = 'uishortcuts-snippet-';

// ========================================
// BUILT-IN SNIPPETS (ship as defaults)
// ========================================

const BUILTIN_SNIPPETS = [
    {
        id: 'builtin-hide-assistant',
        name: 'Hide Assistant Messages',
        description: 'Hides the Assistant message area on the start page.',
        css: `.mes.fade[ch_name="Assistant"] { display: none !important; }`,
        enabled: false,
        builtin: true,
    },
    {
        id: 'builtin-hide-favorites-hotswap',
        name: 'Hide Favorites Hotswap',
        description: 'Hides the favorites hotswap bar from the character list.',
        css: `#CharListButtonAndHotSwaps, .CharListButtonAndHotSwaps { display: none !important; }`,
        enabled: false,
        builtin: true,
    },
];

// ========================================
// CSS SNIPPETS MANAGER
// ========================================

class CSSSnippetsManager {
    constructor() {
        /** @type {Map<string, HTMLStyleElement>} */
        this.activeStyles = new Map();
        this.snippets = [];
        this._init();
    }

    // ---- persistence ----

    _getSTStore() {
        const ctx = getSTContext();
        if (!ctx?.extensionSettings) return null;
        if (!ctx.extensionSettings[ST_SETTINGS_KEY]) {
            ctx.extensionSettings[ST_SETTINGS_KEY] = {};
        }
        return ctx.extensionSettings[ST_SETTINGS_KEY];
    }

    _persistToST() {
        const ctx = getSTContext();
        if (typeof ctx?.saveSettingsDebounced === 'function') {
            ctx.saveSettingsDebounced();
        }
    }

    _loadSnippets() {
        try {
            const store = this._getSTStore();
            if (store?.[SNIPPETS_FIELD]?.length) {
                return store[SNIPPETS_FIELD];
            }
            return null;
        } catch {
            return null;
        }
    }

    _saveSnippets() {
        const store = this._getSTStore();
        if (store) {
            store[SNIPPETS_FIELD] = this.snippets;
            this._persistToST();
        }
    }

    // ---- lifecycle ----

    _init() {
        const stored = this._loadSnippets();
        if (stored && Array.isArray(stored)) {
            // Merge with builtins — ensure builtins are always present
            const storedMap = new Map(stored.map(s => [s.id, s]));
            const merged = [];

            for (const builtin of BUILTIN_SNIPPETS) {
                if (storedMap.has(builtin.id)) {
                    // Keep user's enabled state but update the css/description in case we ship fixes
                    const existing = storedMap.get(builtin.id);
                    merged.push({
                        ...builtin,
                        enabled: existing.enabled,
                    });
                    storedMap.delete(builtin.id);
                } else {
                    merged.push({ ...builtin });
                }
            }

            // Add remaining user snippets
            for (const snippet of storedMap.values()) {
                merged.push(snippet);
            }

            this.snippets = merged;
        } else {
            this.snippets = BUILTIN_SNIPPETS.map(s => ({ ...s }));
        }

        // Apply enabled snippets
        for (const snippet of this.snippets) {
            if (snippet.enabled) this._injectStyle(snippet);
        }

        this._saveSnippets();
        log('CSS Snippets loaded');
    }

    // ---- style injection ----

    _injectStyle(snippet) {
        if (this.activeStyles.has(snippet.id)) return;
        const style = document.createElement('style');
        style.id = STYLE_PREFIX + snippet.id;
        style.dataset.uishortcutsSnippet = snippet.id;
        style.textContent = snippet.css;
        document.head.appendChild(style);
        this.activeStyles.set(snippet.id, style);
    }

    _removeStyle(snippetId) {
        const style = this.activeStyles.get(snippetId);
        if (style) {
            style.remove();
            this.activeStyles.delete(snippetId);
        }
    }

    // ---- public API ----

    getAll() {
        return [...this.snippets];
    }

    getById(id) {
        return this.snippets.find(s => s.id === id) || null;
    }

    toggle(id, enabled) {
        const snippet = this.getById(id);
        if (!snippet) return;
        snippet.enabled = enabled;
        if (enabled) {
            this._injectStyle(snippet);
        } else {
            this._removeStyle(id);
        }
        this._saveSnippets();
    }

    add({ name, css, description = '' }) {
        const id = 'user-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        const snippet = {
            id,
            name: name || 'Untitled Snippet',
            description,
            css: css || '',
            enabled: true,
            builtin: false,
        };
        this.snippets.push(snippet);
        this._injectStyle(snippet);
        this._saveSnippets();
        return snippet;
    }

    update(id, { name, css, description }) {
        const snippet = this.getById(id);
        if (!snippet) return null;
        if (name !== undefined) snippet.name = name;
        if (description !== undefined) snippet.description = description;
        if (css !== undefined) {
            snippet.css = css;
            // Re-inject if active
            if (snippet.enabled) {
                this._removeStyle(id);
                this._injectStyle(snippet);
            }
        }
        this._saveSnippets();
        return snippet;
    }

    remove(id) {
        const idx = this.snippets.findIndex(s => s.id === id);
        if (idx === -1) return false;
        const snippet = this.snippets[idx];
        if (snippet.builtin) return false; // can't delete builtins
        this._removeStyle(id);
        this.snippets.splice(idx, 1);
        this._saveSnippets();
        return true;
    }

    exportAll() {
        return JSON.stringify(this.snippets.filter(s => !s.builtin), null, 2);
    }

    exportById(id) {
        const snippet = this.getById(id);
        if (!snippet) return null;
        return JSON.stringify(snippet, null, 2);
    }

    importSnippets(jsonString) {
        try {
            const data = JSON.parse(jsonString);
            const toImport = Array.isArray(data) ? data : [data];
            let count = 0;
            for (const item of toImport) {
                if (!item.name && !item.css) continue;
                const existing = item.id ? this.getById(item.id) : null;
                if (existing) {
                    this.update(existing.id, {
                        name: item.name,
                        css: item.css,
                        description: item.description,
                    });
                } else {
                    this.add({
                        name: item.name || 'Imported Snippet',
                        css: item.css || '',
                        description: item.description || '',
                    });
                }
                count++;
            }
            this._saveSnippets();
            return count;
        } catch (e) {
            log('Failed to import snippets: ' + e.message, 'error');
            return 0;
        }
    }

    destroy() {
        for (const [id] of this.activeStyles) {
            this._removeStyle(id);
        }
        this.activeStyles.clear();
    }
}

// ========================================
// SETTINGS UI INTEGRATION
// ========================================

class CSSSnippetsUI {
    constructor(manager) {
        this.manager = manager;
        this.container = null;
        this.editingId = null;
    }

    /**
     * Build the snippets panel to be injected into the extension settings
     * @returns {HTMLElement}
     */
    buildPanel() {
        const panel = document.createElement('div');
        panel.className = 'uishortcuts-snippets-panel';
        panel.dataset.uishortcutsSnippets = 'panel';
        this.container = panel;

        this._render();
        return panel;
    }

    _render() {
        if (!this.container) return;
        const snippets = this.manager.getAll();

        this.container.innerHTML = `
            <div class="uishortcuts-snippets-header">
                <span class="uishortcuts-snippets-title">CSS Snippets</span>
                <span class="uishortcuts-snippets-count">${snippets.length}</span>
            </div>
            <div class="uishortcuts-snippets-toolbar">
                <button class="uishortcuts-snippets-btn" data-action="add" title="New snippet">
                    <i class="fa-solid fa-plus"></i> New
                </button>
                <button class="uishortcuts-snippets-btn" data-action="import" title="Import snippets from JSON">
                    <i class="fa-solid fa-file-import"></i> Import
                </button>
                <button class="uishortcuts-snippets-btn" data-action="export" title="Export all user snippets">
                    <i class="fa-solid fa-file-export"></i> Export
                </button>
            </div>
            <div class="uishortcuts-snippets-list">
                ${snippets.map(s => this._renderSnippetItem(s)).join('')}
            </div>
        `;

        this._attachListeners();
    }

    _renderSnippetItem(snippet) {
        const checked = snippet.enabled ? 'checked' : '';
        const builtinBadge = snippet.builtin
            ? '<span class="uishortcuts-snippets-badge">built-in</span>'
            : '';
        const deleteBtn = snippet.builtin
            ? ''
            : `<button class="uishortcuts-snippets-action" data-action="delete" data-id="${snippet.id}" title="Delete"><i class="fa-solid fa-trash"></i></button>`;

        return `
            <div class="uishortcuts-snippet-item" data-snippet-id="${snippet.id}">
                <div class="uishortcuts-snippet-row">
                    <label class="uishortcuts-snippet-toggle">
                        <input type="checkbox" data-action="toggle" data-id="${snippet.id}" ${checked} />
                    </label>
                    <div class="uishortcuts-snippet-info">
                        <span class="uishortcuts-snippet-name">${snippet.name}</span>
                        ${builtinBadge}
                        ${snippet.description ? `<div class="uishortcuts-snippet-desc">${snippet.description}</div>` : ''}
                    </div>
                    <div class="uishortcuts-snippet-actions">
                        <button class="uishortcuts-snippets-action" data-action="edit" data-id="${snippet.id}" title="Edit"><i class="fa-solid fa-pen"></i></button>
                        <button class="uishortcuts-snippets-action" data-action="export-one" data-id="${snippet.id}" title="Export this snippet"><i class="fa-solid fa-download"></i></button>
                        ${deleteBtn}
                    </div>
                </div>
            </div>
        `;
    }

    _attachListeners() {
        if (!this.container) return;

        this.container.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            const action = btn.dataset.action;
            const id = btn.dataset.id;

            switch (action) {
                case 'add':
                    this._showEditor(null);
                    break;
                case 'edit':
                    this._showEditor(id);
                    break;
                case 'delete':
                    if (confirm('Delete this snippet?')) {
                        this.manager.remove(id);
                        this._render();
                    }
                    break;
                case 'import':
                    this._showImportDialog();
                    break;
                case 'export':
                    this._downloadJson('css-snippets-export.json', this.manager.exportAll());
                    break;
                case 'export-one': {
                    const snippet = this.manager.getById(id);
                    if (snippet) {
                        this._downloadJson(`snippet-${snippet.name.replace(/\s+/g, '-')}.json`, this.manager.exportById(id));
                    }
                    break;
                }
            }
        });

        this.container.addEventListener('change', (e) => {
            const input = e.target.closest('input[data-action="toggle"]');
            if (!input) return;
            this.manager.toggle(input.dataset.id, input.checked);
        });
    }

    _showEditor(snippetId) {
        const existing = snippetId ? this.manager.getById(snippetId) : null;
        const isNew = !existing;

        // Remove any existing editor
        const prev = document.querySelector('.uishortcuts-snippet-editor-overlay');
        if (prev) { prev.close?.(); prev.remove(); }

        const overlay = document.createElement('dialog');
        overlay.className = 'uishortcuts-snippet-editor-overlay';
        overlay.innerHTML = `
            <div class="uishortcuts-snippet-editor">
                <div class="uishortcuts-snippet-editor-header">
                    <span>${isNew ? 'New CSS Snippet' : 'Edit CSS Snippet'}</span>
                    <button class="uishortcuts-snippet-editor-close" title="Close"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="uishortcuts-snippet-editor-body">
                    <label class="uishortcuts-snippet-editor-label">Name</label>
                    <input type="text" class="uishortcuts-snippet-editor-input" id="uishortcuts-snippet-name" value="${existing ? existing.name : ''}" placeholder="My CSS Tweak" autocomplete="off" />
                    <label class="uishortcuts-snippet-editor-label">Description <small>(optional)</small></label>
                    <input type="text" class="uishortcuts-snippet-editor-input" id="uishortcuts-snippet-desc" value="${existing ? (existing.description || '') : ''}" placeholder="What this snippet does..." autocomplete="off" />
                    <label class="uishortcuts-snippet-editor-label">CSS</label>
                    <textarea class="uishortcuts-snippet-editor-textarea" id="uishortcuts-snippet-css" placeholder="/* Your CSS here */\n.some-class {\n    display: none !important;\n}" spellcheck="false" autocapitalize="off" autocomplete="off">${existing ? existing.css : ''}</textarea>
                </div>
                <div class="uishortcuts-snippet-editor-footer">
                    <button class="uishortcuts-snippets-btn" data-editor-action="cancel">Cancel</button>
                    <button class="uishortcuts-snippets-btn primary" data-editor-action="save">${isNew ? 'Create' : 'Save'}</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        overlay.showModal();

        // On mobile, scroll focused inputs into view when keyboard opens
        const scrollIntoViewOnFocus = (e) => {
            setTimeout(() => e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
        };
        overlay.querySelectorAll('input, textarea').forEach(el => {
            el.addEventListener('focus', scrollIntoViewOnFocus);
        });

        const close = () => overlay.remove();

        // Handle native Escape key close
        overlay.addEventListener('cancel', (e) => {
            e.preventDefault();
            close();
        });

        overlay.querySelector('.uishortcuts-snippet-editor-close').addEventListener('click', close);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        });

        overlay.querySelector('[data-editor-action="cancel"]').addEventListener('click', close);
        overlay.querySelector('[data-editor-action="save"]').addEventListener('click', () => {
            const name = overlay.querySelector('#uishortcuts-snippet-name').value.trim();
            const desc = overlay.querySelector('#uishortcuts-snippet-desc').value.trim();
            const css = overlay.querySelector('#uishortcuts-snippet-css').value;

            if (!name) {
                overlay.querySelector('#uishortcuts-snippet-name').focus();
                return;
            }

            if (isNew) {
                this.manager.add({ name, css, description: desc });
            } else {
                this.manager.update(snippetId, { name, css, description: desc });
            }

            close();
            this._render();
        });

        overlay.querySelector('#uishortcuts-snippet-name').focus();
    }

    _showImportDialog() {
        const prev = document.querySelector('.uishortcuts-snippet-editor-overlay');
        if (prev) { prev.close?.(); prev.remove(); }

        const overlay = document.createElement('dialog');
        overlay.className = 'uishortcuts-snippet-editor-overlay';
        overlay.innerHTML = `
            <div class="uishortcuts-snippet-editor">
                <div class="uishortcuts-snippet-editor-header">
                    <span>Import CSS Snippets</span>
                    <button class="uishortcuts-snippet-editor-close" title="Close"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="uishortcuts-snippet-editor-body">
                    <label class="uishortcuts-snippet-editor-label">Paste JSON or select a file</label>
                    <textarea class="uishortcuts-snippet-editor-textarea" id="uishortcuts-snippet-import-json" placeholder='[{"name": "My Snippet", "css": "..."}]'></textarea>
                    <input type="file" accept=".json" id="uishortcuts-snippet-import-file" style="margin-top: 8px;" />
                </div>
                <div class="uishortcuts-snippet-editor-footer">
                    <button class="uishortcuts-snippets-btn" data-editor-action="cancel">Cancel</button>
                    <button class="uishortcuts-snippets-btn primary" data-editor-action="import">Import</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        overlay.showModal();

        const close = () => overlay.remove();

        // Handle native Escape key close
        overlay.addEventListener('cancel', (e) => {
            e.preventDefault();
            close();
        });

        overlay.querySelector('.uishortcuts-snippet-editor-close').addEventListener('click', close);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        });
        overlay.querySelector('[data-editor-action="cancel"]').addEventListener('click', close);

        const fileInput = overlay.querySelector('#uishortcuts-snippet-import-file');
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                overlay.querySelector('#uishortcuts-snippet-import-json').value = ev.target.result;
            };
            reader.readAsText(file);
        });

        overlay.querySelector('[data-editor-action="import"]').addEventListener('click', () => {
            const json = overlay.querySelector('#uishortcuts-snippet-import-json').value.trim();
            if (!json) return;
            const count = this.manager.importSnippets(json);
            if (count > 0) {
                log(`Imported ${count} snippet(s)`);
                close();
                this._render();
            } else {
                alert('No valid snippets found in the provided data.');
            }
        });
    }

    _downloadJson(filename, data) {
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    destroy() {
        const overlay = document.querySelector('.uishortcuts-snippet-editor-overlay');
        if (overlay) { overlay.close?.(); overlay.remove(); }
        if (this.container) {
            this.container.innerHTML = '';
            this.container = null;
        }
    }
}

// ========================================
// MODULE EXPORT
// ========================================

let managerInstance = null;
let uiInstance = null;

export function initCSSSnippets() {
    if (!managerInstance) {
        managerInstance = new CSSSnippetsManager();
        uiInstance = new CSSSnippetsUI(managerInstance);
    }
    return {
        manager: managerInstance,
        ui: uiInstance,
        getSettingsPanel() {
            return uiInstance?.buildPanel() ?? null;
        },
        destroy() {
            uiInstance?.destroy();
            managerInstance?.destroy();
            managerInstance = null;
            uiInstance = null;
        },
    };
}

export const definition = {
    key: 'cssSnippets',
    label: 'CSS Snippets',
    description: 'Create, save, export, and toggle custom CSS tweaks. Includes built-in snippets for common UI hides.',
    init: initCSSSnippets,
    settingsSlot: true,
};

export { CSSSnippetsManager, CSSSnippetsUI };
