/**
 * SillyTavern UI Shortcuts Extension
 * Main entry point — discovers, loads, and manages modules dynamically.
 */

import { EXTENSION_NAME, log } from './src/utils.js';
import { loadSettings, saveSettings, initSettingsUI } from './src/settings.js';
import moduleRegistry from './src/modules/registry.js';

// ========================================
// MODULE LIFECYCLE
// ========================================

const modules = {};
const definitions = [];

/**
 * Import every module listed in the registry and collect their definitions.
 * Missing folders are silently skipped (logged as warnings).
 */
async function discoverModules() {
    for (const folderName of moduleRegistry) {
        try {
            const mod = await import(`./src/modules/${folderName}/index.js`);
            if (mod.definition) {
                definitions.push(mod.definition);
            } else {
                log(`Module ${folderName} has no definition export, skipping`, 'warn');
            }
        } catch (e) {
            log(`Module folder "${folderName}" not found or failed to load: ${e.message}`, 'warn');
        }
    }
}

async function enableModule(def) {
    if (modules[def.key]) return;
    try {
        modules[def.key] = def.init();
        log(`${def.key} module loaded`);
    } catch (e) {
        log(`Failed to load ${def.key} module: ${e.message}`, 'error');
        return;
    }

    // Inject custom settings panel if the module provides one
    if (def.settingsSlot) {
        setTimeout(() => _injectSlotPanel(def.key), 200);
    }
}

function disableModule(def) {
    const instance = modules[def.key];
    if (!instance) return;
    try {
        if (typeof instance.destroy === 'function') {
            instance.destroy();
        } else {
            log(`Module ${def.key} does not support destroy()`, 'warn');
        }
    } catch (e) {
        log(`Failed to unload ${def.key} module: ${e.message}`, 'error');
    } finally {
        modules[def.key] = null;
    }

    // Remove custom settings panel if present
    if (def.settingsSlot) {
        const slot = document.querySelector(`[data-uishortcuts-module="${def.key}"] [data-uishortcuts-slot]`);
        if (slot) slot.innerHTML = '';
    }
}

function _injectSlotPanel(moduleKey) {
    const instance = modules[moduleKey];
    if (typeof instance?.getSettingsPanel !== 'function') return;
    const slot = document.querySelector(`[data-uishortcuts-module="${moduleKey}"] [data-uishortcuts-slot]`);
    if (!slot || slot.children.length) return;
    const panel = instance.getSettingsPanel();
    if (panel) slot.appendChild(panel);
}

// ========================================
// INITIALIZATION
// ========================================

async function initializeExtension() {
    log('Initializing...');

    // Small delay to ensure SillyTavern UI is loaded
    await new Promise(resolve => setTimeout(resolve, 1000));

    await discoverModules();

    const settings = loadSettings(definitions);

    initSettingsUI({
        definitions,
        settings,
        onToggle: async (moduleKey, enabled) => {
            const def = definitions.find(d => d.key === moduleKey);
            if (!def) return;
            settings.modules[moduleKey] = enabled;
            saveSettings(settings);
            if (enabled) {
                await enableModule(def);
            } else {
                disableModule(def);
            }
        },
    });

    // Enable modules that are toggled on
    for (const def of definitions) {
        if (settings.modules[def.key]) {
            await enableModule(def);
        }
    }

    window.UIShortcuts.settings = settings;
    log('Initialized successfully');
}

// ========================================
// EXPORTS (for potential external access)
// ========================================

// Expose modules globally for debugging/extension interop
window.UIShortcuts = {
    modules,
    version: '1.1.0'
};

// ========================================
// ENTRY POINT
// ========================================

jQuery(initializeExtension);
