/**
 * SillyTavern UI Shortcuts - Settings UI
 * Adds an entry on the Extensions screen with module toggles.
 * Fully generic — all module metadata and settings schemas come from definitions.
 */

import { EXTENSION_NAME, getSTContext, log } from './utils.js';

const ST_SETTINGS_KEY = 'UIShortcuts';

/**
 * Get the ST extensionSettings store for UIShortcuts.
 * Returns null if ST context is unavailable.
 */
function getSTSettingsStore() {
    const ctx = getSTContext();
    if (!ctx?.extensionSettings) return null;
    if (!ctx.extensionSettings[ST_SETTINGS_KEY]) {
        ctx.extensionSettings[ST_SETTINGS_KEY] = {};
    }
    return ctx.extensionSettings[ST_SETTINGS_KEY];
}

function _persistToST() {
    const ctx = getSTContext();
    if (typeof ctx?.saveSettingsDebounced === 'function') {
        ctx.saveSettingsDebounced();
    }
}

/**
 * Merge stored settings with defaults derived from module definitions.
 */
function _mergeDefaults(stored, definitions) {
    const result = { ...stored, modules: { ...(stored?.modules || {}) } };

    for (const def of definitions) {
        // Ensure module toggle defaults to disabled (opt-in)
        if (typeof result.modules[def.key] !== 'boolean') {
            result.modules[def.key] = false;
        }
        // Merge module-specific settings with declared defaults
        if (def.settings?.defaults) {
            result[def.key] = {
                ...def.settings.defaults,
                ...(stored?.[def.key] || {}),
            };
        }
    }

    return result;
}

export function loadSettings(definitions = []) {
    try {
        const store = getSTSettingsStore();
        const stored = (store && Object.keys(store).length > 0) ? store : {};
        return _mergeDefaults(stored, definitions);
    } catch (e) {
        log('Failed to load settings: ' + e.message, 'warn');
        return _mergeDefaults({}, definitions);
    }
}

export function saveSettings(settings) {
    try {
        const store = getSTSettingsStore();
        if (store) {
            Object.assign(store, settings);
            _persistToST();
        }
    } catch (e) {
        log('Failed to save settings: ' + e.message, 'warn');
    }
}

// ========================================
// SETTINGS PANEL
// ========================================

function findExtensionsContainer() {
    const selectors = [
        '#extensions_settings',
        '#extensions-settings',
        '#extensions .extensions-settings',
        '.extensions-settings',
        '#extensions',
        '#extensions-tab',
        '#extensions_tab'
    ];

    for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el) return el;
    }
    return null;
}

function buildSettingsPanel(definitions, settings) {
    const panel = document.createElement('div');
    panel.dataset.uishortcuts = 'settings';

    const itemsHtml = definitions.map((def) => {
        const checked = settings.modules[def.key] ? 'checked' : '';
        const hasSettings = def.settings?.render || def.settingsSlot;
        let settingsInner = '';

        // Render module-declared settings UI
        if (def.settings?.render) {
            const values = settings[def.key] || def.settings.defaults || {};
            settingsInner += def.settings.render(values);
        }

        // Slot for modules that provide a custom settings panel via instance
        if (def.settingsSlot) {
            settingsInner += '<div data-uishortcuts-slot></div>';
        }

        // Wrap settings in a collapsible section (collapsed by default)
        const settingsHtml = hasSettings ? `
            <div class="uishortcuts-module-settings-wrap">
                <div class="uishortcuts-module-settings-toggle">
                    <i class="fa-solid fa-chevron-right uishortcuts-module-settings-arrow"></i>
                    <small>Settings</small>
                </div>
                <div class="uishortcuts-module-settings" hidden>
                    ${settingsInner}
                </div>
            </div>
        ` : '';

        return `
            <div class="uishortcuts-module-entry" data-uishortcuts-module="${def.key}">
                <label class="checkbox_label" for="uishortcuts_${def.key}">
                    <input type="checkbox" id="uishortcuts_${def.key}" data-module="${def.key}" ${checked} />
                    <span>${def.label}</span>
                </label>
                <small class="uishortcuts-setting-desc">${def.description}</small>
                ${settingsHtml}
            </div>
        `;
    }).join('');

    panel.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>${EXTENSION_NAME}</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                ${itemsHtml}
            </div>
        </div>
    `;

    // Hydrate settings inputs with JS values (for chars that can't go in HTML attributes)
    for (const def of definitions) {
        if (def.settings?.hydrate) {
            const container = panel.querySelector(`[data-uishortcuts-module="${def.key}"] .uishortcuts-module-settings`);
            if (container) {
                const values = settings[def.key] || def.settings.defaults || {};
                def.settings.hydrate(container, values);
            }
        }
    }

    // Wire up collapsible settings toggles
    panel.querySelectorAll('.uishortcuts-module-settings-toggle').forEach(toggle => {
        toggle.addEventListener('click', () => {
            const content = toggle.nextElementSibling;
            const arrow = toggle.querySelector('.uishortcuts-module-settings-arrow');
            const open = content.hidden;
            content.hidden = !open;
            arrow?.classList.toggle('uishortcuts-open', open);
        });
    });

    return panel;
}

export function initSettingsUI({ definitions, settings, onToggle }) {
    if (!definitions?.length) return;

    const attach = () => {
        const container = findExtensionsContainer();
        if (!container) return false;
        if (container.querySelector('[data-uishortcuts="settings"]')) return true;

        const panel = buildSettingsPanel(definitions, settings);

        // Generic change handler — works for all modules via data-key attributes
        panel.addEventListener('change', (e) => {
            // Module toggle
            const moduleToggle = e.target.closest('input[data-module]');
            if (moduleToggle) {
                onToggle(moduleToggle.dataset.module, moduleToggle.checked);
                return;
            }

            // Module settings field (input, select, checkbox with data-key)
            const field = e.target.closest('[data-key]');
            if (field) {
                const moduleEntry = field.closest('[data-uishortcuts-module]');
                const moduleKey = moduleEntry?.dataset.uishortcutsModule;
                if (moduleKey) {
                    settings[moduleKey] = settings[moduleKey] || {};
                    settings[moduleKey][field.dataset.key] =
                        field.type === 'checkbox' ? field.checked :
                        field.tagName === 'SELECT' ? field.value :
                        field.value.trim();
                    saveSettings(settings);
                }
            }
        });

        // Save text inputs on keystroke too (live-update as user types)
        panel.addEventListener('input', (e) => {
            const field = e.target.closest('input[data-key]');
            if (field && field.type !== 'checkbox') {
                const moduleEntry = field.closest('[data-uishortcuts-module]');
                const moduleKey = moduleEntry?.dataset.uishortcutsModule;
                if (moduleKey) {
                    settings[moduleKey] = settings[moduleKey] || {};
                    settings[moduleKey][field.dataset.key] = field.value.trim();
                    saveSettings(settings);
                }
            }
        });

        container.appendChild(panel);
        return true;
    };

    if (attach()) return;

    const observer = new MutationObserver(() => {
        if (attach()) {
            observer.disconnect();
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 10000);
}
