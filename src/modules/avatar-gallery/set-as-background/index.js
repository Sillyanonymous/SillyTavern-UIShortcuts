/**
 * SillyTavern UI Shortcuts - Set as Background
 *
 * Sub-module of avatar-gallery. Lets the user apply the currently-viewed gallery
 * image as a chat background — either as ST's page background (#bg1) or a custom
 * overlay layer inside the chat panel.
 *
 * This file is the orchestrator: it mounts the toolbar button, manages popover
 * lifecycle, talks to the applier, persists per-character state, and handles
 * "Save to ST gallery" uploads. The applier, popover, storage are all isolated
 * in their own files — this module knows nothing about Gelbooru, videos beyond
 * a single guard, or anything else outside its lane.
 */

import { fetchWithCsrf, isVideoFile, log, getSTContext } from '../../../utils.js';
import { BackgroundApplier } from './applier.js';
import { BackgroundPopover, DEFAULT_STATE } from './popover.js';

const STORAGE_FIELD = 'characterBackgrounds';

export class SetAsBackground {
    /**
     * @param {object} gallery - The parent AvatarGallerySelector instance
     */
    constructor(gallery) {
        this.gallery = gallery;

        this.applier = new BackgroundApplier();
        this.popover = new BackgroundPopover({
            getCurrentSrc: () => this._currentSrc(),
            onPreview: (state) => this._handlePreview(state),
            onApply:   (state) => this._handleApply(state),
            onClear:   ()      => this._handleClear(),
            onSaveToST: (state) => this._handleSaveToST(state),
        });

        this.button = null;
        this._eventHandlerChatChanged = null;

        this._mountButton();
        this._subscribeToChatChanged();

        // Apply any pre-existing per-character bg right away so the page state
        // reflects storage from the moment the extension loads.
        this._reapplyForCurrentCharacter();
    }

    // ============================================================
    // PUBLIC HOOKS (called by parent gallery)
    // ============================================================

    /** Called whenever the gallery navigates to a different image. */
    onImageChanged(src) {
        // Update the disabled state on the button based on video vs image.
        if (!this.button) return;
        const isVideo = !!src && isVideoFile(src);
        this.button.disabled = !src || isVideo;
        this.button.title = isVideo
            ? 'Backgrounds require an image — videos are not supported'
            : 'Set as background';
        this.button.classList.toggle('disabled', this.button.disabled);

        // If the popover is open and the user navigates to a different image,
        // keep the live preview in sync with the new source.
        if (this.popover.isOpen()) {
            if (this.button.disabled) {
                this.popover.cancel();
            } else {
                this.popover._emitPreview();
            }
        }
    }

    /** Called when the gallery's active tab changes. Hide the button outside the local tab. */
    setActive(isActive) {
        if (!this.button) return;
        this.button.style.display = isActive ? '' : 'none';
        if (!isActive && this.popover.isOpen()) {
            this.popover.cancel();
        }
    }

    /** Parent gallery closing — tear down transient UI but keep applier alive. */
    onGalleryClose() {
        if (this.popover.isOpen()) this.popover.close();
    }

    destroy() {
        if (this.popover.isOpen()) this.popover.close();
        this.popover.destroy();
        this.applier.destroy();
        this._unsubscribeFromChatChanged();
        if (this.button && this.button.parentNode) {
            this.button.parentNode.removeChild(this.button);
        }
        this.button = null;
    }

    // ============================================================
    // BUTTON
    // ============================================================

    _mountButton() {
        const controls = this.gallery.panel?.querySelector('.uishortcuts-gallery-controls');
        if (!controls) return;

        const btn = document.createElement('button');
        btn.className = 'uishortcuts-gallery-btn uishortcuts-gallery-set-as-bg';
        btn.title = 'Set as background';
        btn.innerHTML = '<i class="fa-solid fa-image"></i>';
        btn.addEventListener('click', () => this._toggleOpen());

        // Insert before the close button so it sits with the other action buttons.
        const closeBtn = controls.querySelector('.uishortcuts-gallery-close');
        if (closeBtn) controls.insertBefore(btn, closeBtn);
        else controls.appendChild(btn);

        this.button = btn;
    }

    _toggleOpen() {
        if (!this.button || this.button.disabled) return;

        if (this.popover.isOpen()) {
            this.popover.cancel();
            return;
        }

        const src = this._currentSrc();
        if (!src) return;

        // Seed popover with current character's saved state (if any), or defaults.
        const saved = this._readStoredState();
        const initialState = saved
            ? { targets: saved.targets, fit: saved.fit, opacity: saved.opacity, blur: saved.blur, brightness: saved.brightness }
            : { ...DEFAULT_STATE };

        // Snapshot for cancel — what's currently applied (independent of stored).
        const priorApplied = this.applier.getLastState();
        const priorSnapshot = priorApplied ? { ...priorApplied } : null;

        // Show a live preview immediately on open
        this._handlePreview({ ...initialState, src });

        this.popover.open(this.button, initialState, priorSnapshot);
    }

    // ============================================================
    // POPOVER CALLBACKS
    // ============================================================

    _handlePreview(state) {
        // null/undefined means "restore prior" — applier.apply(null) clears
        this.applier.apply(state || null);
    }

    _handleApply(state) {
        this.applier.apply(state);
        this._writeStoredState(state);
    }

    _handleClear() {
        this.applier.clear();
        this._writeStoredState(null);
    }

    async _handleSaveToST(state) {
        if (!state.src) throw new Error('No image selected');

        // Fetch the bytes from whatever URL we currently hold.
        const resp = await fetch(state.src);
        if (!resp.ok) throw new Error(`Fetch failed (${resp.status})`);
        const blob = await resp.blob();
        if (blob.size === 0) throw new Error('Empty response');

        // Build a filename — derived from the URL's last segment, sanitized.
        const filename = this._suggestFilename(state.src, blob.type);
        const file = new File([blob], filename, { type: blob.type || 'image/png' });

        const form = new FormData();
        form.append('avatar', file);

        const uploadResp = await fetchWithCsrf('/api/backgrounds/upload', {
            method: 'POST',
            body: form,
        });
        if (!uploadResp.ok) {
            const txt = await uploadResp.text().catch(() => '');
            throw new Error(`Upload ${uploadResp.status}: ${txt.slice(0, 120)}`);
        }

        log(`Saved background to ST: ${filename}`);
    }

    _suggestFilename(url, mime) {
        try {
            const u = new URL(url, window.location.href);
            const last = decodeURIComponent(u.pathname.split('/').pop() || 'background');
            // Strip query/hash, sanitize
            const base = last.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_').slice(0, 80) || 'background';
            // Ensure it has an extension; derive from MIME if absent
            if (/\.[a-z0-9]{2,5}$/i.test(base)) return base;
            const ext = (mime && mime.split('/')[1]) || 'png';
            return `${base}.${ext}`;
        } catch {
            return 'background.png';
        }
    }

    // ============================================================
    // STORAGE (per-character)
    // ============================================================

    _currentCharacterKey() {
        const char = this.gallery.currentCharacter;
        return char?.avatar || null;
    }

    _readStoredState(forKey) {
        const key = forKey || this._currentCharacterKey();
        if (!key) return null;
        const ctx = getSTContext();
        const store = ctx?.extensionSettings?.UIShortcuts?.[STORAGE_FIELD];
        return store?.[key] || null;
    }

    _writeStoredState(state) {
        const key = this._currentCharacterKey();
        if (!key) return;
        const ctx = getSTContext();
        if (!ctx?.extensionSettings) return;
        if (!ctx.extensionSettings.UIShortcuts) ctx.extensionSettings.UIShortcuts = {};
        const root = ctx.extensionSettings.UIShortcuts;
        if (!root[STORAGE_FIELD]) root[STORAGE_FIELD] = {};

        if (state) {
            root[STORAGE_FIELD][key] = {
                src: state.src,
                targets: state.targets,
                fit: state.fit,
                opacity: state.opacity,
                blur: state.blur,
                brightness: state.brightness,
            };
        } else {
            delete root[STORAGE_FIELD][key];
        }

        if (typeof ctx.saveSettingsDebounced === 'function') {
            ctx.saveSettingsDebounced();
        }
    }

    _currentSrc() {
        const idx = this.gallery.selectedIndex;
        const src = this.gallery.currentImages?.[idx];
        if (!src || isVideoFile(src)) return null;
        return src;
    }

    // ============================================================
    // CHAT_CHANGED — re-apply when character / chat switches
    // ============================================================

    _subscribeToChatChanged() {
        const ctx = getSTContext();
        const eventSource = ctx?.eventSource;
        const events = ctx?.event_types;
        if (!eventSource || !events?.CHAT_CHANGED) return;

        this._eventHandlerChatChanged = () => this._reapplyForCurrentCharacter();
        eventSource.on(events.CHAT_CHANGED, this._eventHandlerChatChanged);
    }

    _unsubscribeFromChatChanged() {
        const ctx = getSTContext();
        const eventSource = ctx?.eventSource;
        const events = ctx?.event_types;
        if (!eventSource || !events?.CHAT_CHANGED || !this._eventHandlerChatChanged) return;
        eventSource.removeListener(events.CHAT_CHANGED, this._eventHandlerChatChanged);
        this._eventHandlerChatChanged = null;
    }

    _reapplyForCurrentCharacter() {
        // Look up the current character via ST context (the gallery's
        // currentCharacter only updates when the panel opens, so we can't rely on it
        // here).
        const ctx = getSTContext();
        const charId = ctx?.characterId;
        const char = (charId !== undefined && charId !== null) ? ctx?.characters?.[charId] : null;
        const key = char?.avatar;
        if (!key) {
            this.applier.clear();
            return;
        }
        const saved = this._readStoredState(key);
        if (saved) {
            this.applier.apply(saved);
        } else {
            this.applier.clear();
        }
    }
}

export function initSetAsBackground(gallery) {
    return new SetAsBackground(gallery);
}
