/**
 * SillyTavern UI Shortcuts - Avatar Gallery Mobile Enhancements
 * Touch interactions and mobile-only behavior for the avatar gallery.
 */

const MOBILE_MEDIA_QUERY = '(pointer: coarse), (max-width: 900px)';

function isMobileMatch(mediaQuery) {
    return mediaQuery?.matches ?? false;
}

export function initAvatarGalleryMobileEnhancements(gallery) {
    if (!gallery || !window?.matchMedia) return () => {};

    const mediaQuery = window.matchMedia(MOBILE_MEDIA_QUERY);

    const updateBodyOpenClass = () => {
        const isOpen = gallery.panel?.classList.contains('active');
        const shouldLock = Boolean(gallery.isMobile && isOpen);
        document.body.classList.toggle('uishortcuts-gallery-mobile-open', shouldLock);
    };

    const updateMobileState = () => {
        const isMobile = isMobileMatch(mediaQuery);
        gallery.isMobile = isMobile;
        if (gallery.panel) {
            gallery.panel.classList.toggle('uishortcuts-gallery-mobile', isMobile);
        }
        if (isMobile) {
            ensureSwipeHint();
        } else {
            removeSwipeHint();
        }
        updateBodyOpenClass();
    };

    const originalOpen = gallery.open.bind(gallery);
    const originalClose = gallery.close.bind(gallery);

    gallery.open = () => {
        originalOpen();
        updateBodyOpenClass();
    };

    gallery.close = () => {
        originalClose();
        updateBodyOpenClass();
    };

    const wrapper = gallery.panel?.querySelector('.uishortcuts-gallery-image-wrapper');
    const content = gallery.panel?.querySelector('.uishortcuts-gallery-content');

    const DOUBLE_TAP_DELAY = 300;
    const DOUBLE_TAP_DISTANCE = 24;
    const TAP_MOVE_THRESHOLD = 10;
    const DOUBLE_TAP_ZOOM = 2;

    let touchStartX = 0;
    let touchStartY = 0;
    let lastX = 0;
    let lastY = 0;
    let isTracking = false;
    let isPanning = false;
    let panMoved = false;
    let isPinching = false;
    let pinchStartDistance = 0;
    let pinchStartZoom = 1;
    let tapStartTime = 0;
    let tapStartX = 0;
    let tapStartY = 0;
    let lastTapTime = 0;
    let lastTapX = 0;
    let lastTapY = 0;
    let tapMoved = false;
    let hintDismissed = false;

    const ensureSwipeHint = () => {
        if (!content || !gallery.isMobile) return;
        if (content.querySelector('.uishortcuts-gallery-swipe-hint')) return;
        const hint = document.createElement('div');
        hint.className = 'uishortcuts-gallery-swipe-hint';
        hint.innerHTML = '<i class="fa-solid fa-hand-pointer"></i> Swipe to browse';
        content.appendChild(hint);
    };

    const removeSwipeHint = () => {
        if (!content) return;
        const hint = content.querySelector('.uishortcuts-gallery-swipe-hint');
        if (hint) {
            hint.remove();
        }
        hintDismissed = false;
    };

    const dismissSwipeHint = () => {
        if (!content || hintDismissed) return;
        const hint = content.querySelector('.uishortcuts-gallery-swipe-hint');
        if (hint) {
            hint.classList.add('hidden');
            hintDismissed = true;
        }
    };

    const onTouchStart = (e) => {
        if (!gallery.isMobile || !gallery.panel?.classList.contains('active')) return;
        if (e.touches.length === 2) {
            const [first, second] = e.touches;
            isPinching = true;
            isTracking = false;
            isPanning = false;
            pinchStartDistance = Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
            pinchStartZoom = gallery.zoomLevel;
            return;
        }

        if (e.touches.length !== 1) return;

        const touch = e.touches[0];
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        lastX = touchStartX;
        lastY = touchStartY;
        tapStartX = touchStartX;
        tapStartY = touchStartY;
        tapStartTime = Date.now();
        tapMoved = false;
        isTracking = true;
        isPanning = gallery.zoomLevel > 1;
        panMoved = false;

        if (isPanning) {
            gallery.panStart.x = touch.clientX - gallery.panOffset.x;
            gallery.panStart.y = touch.clientY - gallery.panOffset.y;
        }
    };

    const onTouchMove = (e) => {
        if (isPinching && e.touches.length === 2) {
            e.preventDefault();
            const [first, second] = e.touches;
            const distance = Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
            if (pinchStartDistance > 0) {
                const zoom = pinchStartZoom * (distance / pinchStartDistance);
                gallery.zoomLevel = Math.max(gallery.zoomMin, Math.min(gallery.zoomMax, zoom));
                gallery.applyZoom();
            }
            return;
        }

        if (!isTracking) return;
        const touch = e.touches[0];

        const dx = touch.clientX - touchStartX;
        const dy = touch.clientY - touchStartY;
        lastX = touch.clientX;
        lastY = touch.clientY;

        if (Math.abs(dx) > TAP_MOVE_THRESHOLD || Math.abs(dy) > TAP_MOVE_THRESHOLD) {
            tapMoved = true;
        }

        if (isPanning) {
            if (Math.abs(dx) > TAP_MOVE_THRESHOLD || Math.abs(dy) > TAP_MOVE_THRESHOLD) {
                panMoved = true;
            }
            e.preventDefault();
            gallery.panOffset.x = touch.clientX - gallery.panStart.x;
            gallery.panOffset.y = touch.clientY - gallery.panStart.y;
            const mainImg = gallery.panel?.querySelector('.uishortcuts-gallery-main-image');
            if (mainImg) {
                mainImg.style.transform = `translate(${gallery.panOffset.x}px, ${gallery.panOffset.y}px) scale(${gallery.zoomLevel})`;
            }
            return;
        }

        if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
            e.preventDefault();
        }
    };

    const onTouchEnd = (e) => {
        if (isPinching) {
            if (e.touches.length < 2) {
                isPinching = false;
            }
            return;
        }

        if (!isTracking) return;
        isTracking = false;

        if (isPanning && panMoved) {
            gallery.wasPanning = true;
            return;
        }

        const dx = lastX - touchStartX;
        const dy = lastY - touchStartY;

        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
            const direction = dx < 0 ? 1 : -1;
            gallery.navigateWrap(direction);
            dismissSwipeHint();
            return;
        }

        const now = Date.now();
        const tapDistance = Math.hypot(tapStartX - lastTapX, tapStartY - lastTapY);
        const isTap = !tapMoved && Math.abs(dx) < TAP_MOVE_THRESHOLD && Math.abs(dy) < TAP_MOVE_THRESHOLD;
        const withinDelay = now - lastTapTime <= DOUBLE_TAP_DELAY;
        const withinDistance = tapDistance <= DOUBLE_TAP_DISTANCE;

        if (isTap && withinDelay && withinDistance) {
            if (gallery.zoomLevel !== 1) {
                gallery.resetZoom();
            } else {
                gallery.zoomLevel = Math.min(gallery.zoomMax, DOUBLE_TAP_ZOOM);
                gallery.panOffset = { x: 0, y: 0 };
                gallery.applyZoom();
            }
            lastTapTime = 0;
            dismissSwipeHint();
            return;
        }

        if (isTap) {
            lastTapTime = now;
            lastTapX = tapStartX;
            lastTapY = tapStartY;
        }
    };

    const onMediaChange = () => updateMobileState();

    if (wrapper) {
        wrapper.addEventListener('touchstart', onTouchStart, { passive: true });
        wrapper.addEventListener('touchmove', onTouchMove, { passive: false });
        wrapper.addEventListener('touchend', onTouchEnd);
        wrapper.addEventListener('touchcancel', onTouchEnd);
    }

    mediaQuery.addEventListener('change', onMediaChange);

    updateMobileState();

    return () => {
        if (wrapper) {
            wrapper.removeEventListener('touchstart', onTouchStart);
            wrapper.removeEventListener('touchmove', onTouchMove);
            wrapper.removeEventListener('touchend', onTouchEnd);
            wrapper.removeEventListener('touchcancel', onTouchEnd);
        }
        mediaQuery.removeEventListener('change', onMediaChange);
        gallery.open = originalOpen;
        gallery.close = originalClose;
        document.body.classList.remove('uishortcuts-gallery-mobile-open');
    };
}
