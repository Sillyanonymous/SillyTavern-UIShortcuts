/**
 * Drag & Drop Blocker Module
 * Prevents the default SillyTavern behavior of creating characters when dragging images
 */

import { log } from '../../utils.js';

// ========================================
// DRAG & DROP BLOCKER
// ========================================

class DragDropBlocker {
    constructor() {
        this.boundHandler = this.handleDragDrop.bind(this);
        this.boundEvents = ['dragenter', 'dragover', 'dragleave', 'drop'];
        this.isActive = false;
        this.init();
    }

    init() {
        this.blockDragDrop();
        log('Drag & Drop character creation disabled');
    }

    handleDragDrop(e) {
        // Allow drops on our gallery panel (for image uploads)
        if (e.target.closest('#uishortcuts-avatar-gallery')) {
            return; // Let the gallery handle it
        }
        
        // Check if files are being dragged
        if (e.dataTransfer && e.dataTransfer.types) {
            const hasFiles = e.dataTransfer.types.includes('Files') || 
                             e.dataTransfer.types.includes('application/x-moz-file');
            
            if (hasFiles) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                
                // Clear the drag data to prevent any fallback handling
                if (e.type === 'drop') {
                    e.dataTransfer.dropEffect = 'none';
                    log('Blocked image drop');
                }
                
                return false;
            }
        }
    }

    blockDragDrop() {
        if (this.isActive) return;
        // Intercept all drag/drop events at capture phase
        this.boundEvents.forEach(eventType => {
            document.addEventListener(eventType, this.boundHandler, true);
        });

        // Also block on window level for extra safety
        window.addEventListener('drop', this.boundHandler, true);
        window.addEventListener('dragover', this.boundHandler, true);
        this.isActive = true;
    }

    destroy() {
        if (!this.isActive) return;
        this.boundEvents.forEach(eventType => {
            document.removeEventListener(eventType, this.boundHandler, true);
        });
        window.removeEventListener('drop', this.boundHandler, true);
        window.removeEventListener('dragover', this.boundHandler, true);
        this.isActive = false;
        instance = null;
    }
}

// ========================================
// EXPORTS
// ========================================

let instance = null;

export function initDragDropBlocker() {
    if (!instance) {
        instance = new DragDropBlocker();
    }
    return instance;
}

export const definition = {
    key: 'dragDropBlocker',
    label: 'Drag & Drop Blocker',
    description: 'Prevents dragging images into chat from creating new characters.',
    init: initDragDropBlocker,
};

export { DragDropBlocker };
