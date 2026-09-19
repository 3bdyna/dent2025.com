/**
 * Dent2025 - Universal 6-Digit Admin PIN Lockpad Modal
 * Self-contained, responsive (phone, tablet & desktop) PIN entry component.
 * Supports touch numpad, physical keyboard, paste, soft-keyboard, and auto-submit.
 */
(function() {
    'use strict';

    if (window.DentPinModal) return; // Prevent multiple declarations

    const API_BASE = (window.location.pathname === '/dev' || window.location.pathname.startsWith('/dev/')) ? '/dev' : '';

    const STYLES = `
        .dent-pin-overlay {
            position: fixed;
            inset: 0;
            background: rgba(4, 7, 15, 0.78);
            backdrop-filter: blur(14px);
            -webkit-backdrop-filter: blur(14px);
            z-index: 9999999;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 16px;
            opacity: 0;
            visibility: hidden;
            transition: opacity 0.22s ease, visibility 0.22s ease;
        }
        .dent-pin-overlay.active {
            opacity: 1;
            visibility: visible;
        }
        .dent-pin-card {
            position: relative;
            width: 100%;
            max-width: 350px;
            background: linear-gradient(165deg, rgba(15, 23, 42, 0.96) 0%, rgba(10, 15, 29, 0.98) 100%);
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 24px;
            padding: 24px 20px 20px;
            box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.75), 0 0 35px -5px rgba(56, 189, 248, 0.12);
            font-family: 'Outfit', 'Noto Kufi Arabic', -apple-system, BlinkMacSystemFont, sans-serif;
            text-align: center;
            direction: rtl;
            transform: scale(0.93) translateY(10px);
            transition: transform 0.24s cubic-bezier(0.16, 1, 0.3, 1);
            user-select: none;
            box-sizing: border-box;
        }
        .dent-pin-overlay.active .dent-pin-card {
            transform: scale(1) translateY(0);
        }
        .dent-pin-close-btn {
            position: absolute;
            top: 14px;
            left: 14px;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.06);
            border: 1px solid rgba(255, 255, 255, 0.1);
            color: #94a3b8;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all 0.18s ease;
            padding: 0;
        }
        .dent-pin-close-btn:hover {
            background: rgba(239, 68, 68, 0.2);
            color: #f87171;
            border-color: rgba(239, 68, 68, 0.4);
        }
        .dent-pin-badge {
            width: 48px;
            height: 48px;
            margin: 0 auto 12px;
            border-radius: 16px;
            background: linear-gradient(135deg, rgba(56, 189, 248, 0.2) 0%, rgba(59, 130, 246, 0.2) 100%);
            border: 1px solid rgba(56, 189, 248, 0.35);
            display: flex;
            align-items: center;
            justify-content: center;
            color: #38bdf8;
            box-shadow: 0 0 20px rgba(56, 189, 248, 0.2);
        }
        .dent-pin-title {
            margin: 0 0 4px;
            font-size: 1.18rem;
            font-weight: 700;
            color: #f8fafc;
            letter-spacing: -0.01em;
        }
        .dent-pin-subtitle {
            margin: 0 0 16px;
            font-size: 0.84rem;
            color: #94a3b8;
            line-height: 1.4;
        }
        .dent-pin-context-pill {
            display: inline-block;
            margin-bottom: 14px;
            padding: 3px 10px;
            background: rgba(56, 189, 248, 0.1);
            border: 1px solid rgba(56, 189, 248, 0.25);
            border-radius: 20px;
            font-size: 0.76rem;
            color: #7dd3fc;
            font-weight: 500;
        }
        /* 6-Digit Display Cells */
        .dent-pin-cells-wrapper {
            position: relative;
            display: flex;
            justify-content: center;
            gap: 8px;
            margin: 0 auto 12px;
            direction: ltr; /* digits type LTR */
        }
        .dent-pin-cell {
            width: 42px;
            height: 48px;
            border-radius: 12px;
            background: rgba(255, 255, 255, 0.04);
            border: 1.5px solid rgba(255, 255, 255, 0.12);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.35rem;
            color: transparent;
            transition: all 0.18s ease;
            box-sizing: border-box;
        }
        .dent-pin-cell.active-focus {
            border-color: #38bdf8;
            background: rgba(56, 189, 248, 0.06);
            box-shadow: 0 0 12px rgba(56, 189, 248, 0.35);
        }
        .dent-pin-cell.filled {
            background: rgba(56, 189, 248, 0.12);
            border-color: rgba(56, 189, 248, 0.5);
            color: #38bdf8;
        }
        .dent-pin-cell.filled::after {
            content: '●';
            font-size: 1.1rem;
            line-height: 1;
            filter: drop-shadow(0 0 4px #38bdf8);
        }
        /* Hidden input for software/physical keyboard capture */
        .dent-pin-hidden-input {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            opacity: 0.001;
            border: none;
            outline: none;
            background: transparent;
            cursor: pointer;
            font-size: 16px; /* Prevents auto-zoom on iOS */
        }
        /* Status Message */
        .dent-pin-status {
            min-height: 22px;
            font-size: 0.8rem;
            margin-bottom: 12px;
            font-weight: 500;
            transition: color 0.2s ease;
            color: #94a3b8;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
        }
        .dent-pin-status.error {
            color: #f87171;
        }
        .dent-pin-status.success {
            color: #34d399;
        }
        /* Tactile Keypad */
        .dent-pin-keypad {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 9px;
            direction: ltr;
        }
        .dent-pin-key {
            height: 48px;
            border-radius: 12px;
            background: rgba(255, 255, 255, 0.045);
            border: 1px solid rgba(255, 255, 255, 0.08);
            font-size: 1.28rem;
            font-weight: 600;
            color: #f8fafc;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all 0.12s ease;
            user-select: none;
            -webkit-tap-highlight-color: transparent;
        }
        .dent-pin-key:hover {
            background: rgba(255, 255, 255, 0.1);
            border-color: rgba(255, 255, 255, 0.18);
            transform: translateY(-1px);
        }
        .dent-pin-key:active {
            transform: scale(0.94);
            background: rgba(56, 189, 248, 0.2);
            border-color: rgba(56, 189, 248, 0.4);
        }
        .dent-pin-key.action-key {
            font-size: 0.85rem;
            color: #cbd5e1;
            font-weight: 500;
        }
        .dent-pin-key.action-key:hover {
            color: #f8fafc;
        }
        /* Error Shake Animation */
        @keyframes dentPinShake {
            0%, 100% { transform: translateX(0); }
            20%, 60% { transform: translateX(-8px); }
            40%, 80% { transform: translateX(8px); }
        }
        .dent-pin-shake {
            animation: dentPinShake 0.42s cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
        }
        .dent-pin-shake .dent-pin-cell {
            border-color: rgba(239, 68, 68, 0.8) !important;
            background: rgba(239, 68, 68, 0.12) !important;
            color: #f87171 !important;
        }
        /* Success Glow */
        .dent-pin-success .dent-pin-cell {
            border-color: rgba(16, 185, 129, 0.8) !important;
            background: rgba(16, 185, 129, 0.15) !important;
            color: #34d399 !important;
        }
        /* Loading Spinner */
        .dent-pin-spinner {
            width: 14px;
            height: 14px;
            border: 2px solid rgba(56, 189, 248, 0.25);
            border-top-color: #38bdf8;
            border-radius: 50%;
            animation: dentPinSpin 0.7s linear infinite;
        }
        @keyframes dentPinSpin {
            to { transform: rotate(360deg); }
        }
    `;

    // Inject styles once
    function injectStyles() {
        if (document.getElementById('dent-pin-modal-css')) return;
        const style = document.createElement('style');
        style.id = 'dent-pin-modal-css';
        style.textContent = STYLES;
        document.head.appendChild(style);
    }

    // Modal Singleton State
    let activeModal = null;
    let currentDigits = [];
    let isVerifying = false;

    /**
     * Display the 6-digit PIN pad modal
     * @param {Object} opts
     *   opts.title: string
     *   opts.subtitle: string
     *   opts.context: { specialty, year, semester }
     *   opts.onSuccess: function({ pin, permissions, data })
     *   opts.onCancel: function()
     */
    function showPinModal(opts) {
        opts = opts || {};
        injectStyles();

        // Close any existing modal
        closePinModal(false);

        const overlay = document.createElement('div');
        overlay.className = 'dent-pin-overlay';
        overlay.id = 'dent-pin-overlay';

        // Context label
        let contextLabel = '';
        if (opts.context && opts.context.specialty) {
            const specMap = { dentistry: 'طب الأسنان', medicine: 'الطب البشري', 'pre-med': 'السنة التحضيرية' };
            const specName = specMap[opts.context.specialty] || opts.context.specialty;
            contextLabel = `${specName} — سنة ${opts.context.year} ترم ${opts.context.semester}`;
        }

        overlay.innerHTML = `
            <div class="dent-pin-card" role="dialog" aria-modal="true" aria-labelledby="dent-pin-title">
                <button class="dent-pin-close-btn" type="button" aria-label="إغلاق" id="dent-pin-close-btn">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>

                <div class="dent-pin-badge">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                    </svg>
                </div>

                <h3 class="dent-pin-title" id="dent-pin-title">${opts.title || 'تسجيل دخول المشرف'}</h3>
                ${contextLabel ? `<div class="dent-pin-context-pill">${contextLabel}</div>` : ''}
                <p class="dent-pin-subtitle">${opts.subtitle || 'أدخل رمز PIN المكون من 6 أرقام'}</p>

                <div class="dent-pin-cells-wrapper" id="dent-pin-cells-wrap">
                    <div class="dent-pin-cell" data-idx="0"></div>
                    <div class="dent-pin-cell" data-idx="1"></div>
                    <div class="dent-pin-cell" data-idx="2"></div>
                    <div class="dent-pin-cell" data-idx="3"></div>
                    <div class="dent-pin-cell" data-idx="4"></div>
                    <div class="dent-pin-cell" data-idx="5"></div>
                    <!-- Hidden input to capture native mobile/desktop keyboard & paste -->
                    <input type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" class="dent-pin-hidden-input" id="dent-pin-hidden" autocomplete="one-time-code" />
                </div>

                <div class="dent-pin-status" id="dent-pin-status"></div>

                <!-- Tactile Touch/Click Keypad -->
                <div class="dent-pin-keypad" id="dent-pin-keypad">
                    <button type="button" class="dent-pin-key" data-digit="1">1</button>
                    <button type="button" class="dent-pin-key" data-digit="2">2</button>
                    <button type="button" class="dent-pin-key" data-digit="3">3</button>
                    <button type="button" class="dent-pin-key" data-digit="4">4</button>
                    <button type="button" class="dent-pin-key" data-digit="5">5</button>
                    <button type="button" class="dent-pin-key" data-digit="6">6</button>
                    <button type="button" class="dent-pin-key" data-digit="7">7</button>
                    <button type="button" class="dent-pin-key" data-digit="8">8</button>
                    <button type="button" class="dent-pin-key" data-digit="9">9</button>
                    <button type="button" class="dent-pin-key action-key" data-action="cancel">إلغاء</button>
                    <button type="button" class="dent-pin-key" data-digit="0">0</button>
                    <button type="button" class="dent-pin-key action-key" data-action="backspace" aria-label="حذف">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"></path>
                            <line x1="18" y1="9" x2="12" y2="15"></line>
                            <line x1="12" y1="9" x2="18" y2="15"></line>
                        </svg>
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        currentDigits = [];
        isVerifying = false;

        activeModal = {
            overlay,
            opts,
            keyHandler: null,
            pasteHandler: null
        };

        // Render initial UI state
        updateCells();

        // Focus hidden input
        const hiddenInput = overlay.querySelector('#dent-pin-hidden');
        if (hiddenInput) {
            setTimeout(() => {
                try { hiddenInput.focus(); } catch(e) {}
            }, 50);
        }

        // Show overlay with transition
        requestAnimationFrame(() => {
            overlay.classList.add('active');
        });

        // Event: Close Button & Backdrop Click
        overlay.querySelector('#dent-pin-close-btn').onclick = () => closePinModal(true);
        overlay.onclick = (e) => {
            if (e.target === overlay) closePinModal(true);
        };

        // Event: Keypad buttons
        overlay.querySelector('#dent-pin-keypad').onclick = (e) => {
            if (isVerifying) return;
            const btn = e.target.closest('.dent-pin-key');
            if (!btn) return;
            const digit = btn.getAttribute('data-digit');
            const action = btn.getAttribute('data-action');

            if (digit !== null) {
                appendDigit(digit);
            } else if (action === 'backspace') {
                removeDigit();
            } else if (action === 'cancel') {
                closePinModal(true);
            }
        };

        // Event: Hidden Input typing (for mobile soft keyboards)
        if (hiddenInput) {
            hiddenInput.addEventListener('input', (e) => {
                if (isVerifying) return;
                const val = hiddenInput.value.replace(/\D/g, '');
                currentDigits = val.slice(0, 6).split('');
                updateCells();
                if (currentDigits.length === 6) {
                    submitPin();
                }
            });
        }

        // Event: Physical Keyboard (Desktop)
        activeModal.keyHandler = (e) => {
            if (!activeModal) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                closePinModal(true);
                return;
            }
            if (isVerifying) return;

            if (e.key >= '0' && e.key <= '9') {
                e.preventDefault();
                appendDigit(e.key);
            } else if (e.key === 'Backspace' || e.key === 'Delete') {
                e.preventDefault();
                removeDigit();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (currentDigits.length === 6) {
                    submitPin();
                }
            }
        };
        window.addEventListener('keydown', activeModal.keyHandler);

        // Event: Clipboard Paste
        activeModal.pasteHandler = (e) => {
            if (!activeModal || isVerifying) return;
            const pasteData = (e.clipboardData || window.clipboardData)?.getData('text');
            if (!pasteData) return;
            const cleanDigits = pasteData.replace(/\D/g, '').slice(0, 6);
            if (cleanDigits.length > 0) {
                e.preventDefault();
                currentDigits = cleanDigits.split('');
                updateCells();
                if (currentDigits.length === 6) {
                    submitPin();
                }
            }
        };
        window.addEventListener('paste', activeModal.pasteHandler);
    }

    function appendDigit(digit) {
        if (currentDigits.length >= 6 || isVerifying) return;
        currentDigits.push(digit);
        updateCells();
        if (currentDigits.length === 6) {
            submitPin();
        }
    }

    function removeDigit() {
        if (currentDigits.length === 0 || isVerifying) return;
        currentDigits.pop();
        updateCells();
    }

    function updateCells() {
        if (!activeModal) return;
        const cells = activeModal.overlay.querySelectorAll('.dent-pin-cell');
        const hiddenInput = activeModal.overlay.querySelector('#dent-pin-hidden');

        cells.forEach((cell, idx) => {
            cell.classList.remove('filled', 'active-focus');
            if (idx < currentDigits.length) {
                cell.classList.add('filled');
            } else if (idx === currentDigits.length && !isVerifying) {
                cell.classList.add('active-focus');
            }
        });

        if (hiddenInput) {
            hiddenInput.value = currentDigits.join('');
        }
    }

    function setStatus(msg, type) {
        if (!activeModal) return;
        const statusEl = activeModal.overlay.querySelector('#dent-pin-status');
        if (!statusEl) return;
        statusEl.className = 'dent-pin-status ' + (type || '');
        if (type === 'loading') {
            statusEl.innerHTML = `<div class="dent-pin-spinner"></div> <span>${msg || 'جاري التحقق...'}</span>`;
        } else {
            statusEl.textContent = msg || '';
        }
    }

    function triggerShake() {
        if (!activeModal) return;
        const card = activeModal.overlay.querySelector('.dent-pin-card');
        if (!card) return;
        card.classList.remove('dent-pin-shake');
        void card.offsetWidth; // Force reflow
        card.classList.add('dent-pin-shake');
        setTimeout(() => {
            card.classList.remove('dent-pin-shake');
        }, 500);
    }

    function submitPin() {
        const pin = currentDigits.join('');
        if (pin.length !== 6 || isVerifying || !activeModal) return;

        isVerifying = true;
        setStatus('جاري التحقق من الصلاحيات...', 'loading');

        const context = activeModal.opts.context || {};
        const sel = (context.specialty) ? context : JSON.parse(localStorage.getItem('dent2025_selection') || '{}');

        const payload = {
            password: pin,
            specialty: sel.specialty || 'dentistry',
            year: (sel.year !== undefined && sel.year !== null) ? sel.year : 3,
            semester: sel.semester || 1
        };

        fetch(API_BASE + '/dent2025_api.php?action=check_auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
        .then(r => r.json())
        .then(res => {
            if (res.success && res.data) {
                // Success state: save unified session passkeys
                sessionStorage.setItem('dent2025_admin_pass', pin);
                sessionStorage.setItem('dent2025_schedule_admin_pass', pin);
                const perms = res.data.permissions || {};
                sessionStorage.setItem('dent2025_permissions', JSON.stringify(perms));
                sessionStorage.setItem('dent2025_passkey_info', JSON.stringify(res.data));

                setStatus('تم تسجيل الدخول بنجاح!', 'success');
                const card = activeModal.overlay.querySelector('.dent-pin-card');
                if (card) card.classList.add('dent-pin-success');

                setTimeout(() => {
                    const cb = activeModal?.opts?.onSuccess;
                    closePinModal(false);
                    if (typeof cb === 'function') {
                        cb({ pin, permissions: perms, data: res.data });
                    }
                }, 400);
            } else {
                isVerifying = false;
                triggerShake();
                setStatus(res.message || 'رمز PIN غير صحيح.', 'error');
                currentDigits = [];
                updateCells();
                const hiddenInput = activeModal?.overlay?.querySelector('#dent-pin-hidden');
                if (hiddenInput) {
                    hiddenInput.value = '';
                    try { hiddenInput.focus(); } catch(e) {}
                }
            }
        })
        .catch(err => {
            console.error('PIN Auth error:', err);
            isVerifying = false;
            triggerShake();
            setStatus('حدث خطأ في الاتصال بالخادم.', 'error');
            currentDigits = [];
            updateCells();
        });
    }

    function closePinModal(triggerCancel) {
        if (!activeModal) return;
        const { overlay, opts, keyHandler, pasteHandler } = activeModal;

        if (keyHandler) window.removeEventListener('keydown', keyHandler);
        if (pasteHandler) window.removeEventListener('paste', pasteHandler);

        overlay.classList.remove('active');
        setTimeout(() => {
            overlay.remove();
        }, 220);

        activeModal = null;
        currentDigits = [];
        isVerifying = false;

        if (triggerCancel && typeof opts?.onCancel === 'function') {
            opts.onCancel();
        }
    }

    // Public API
    window.DentPinModal = {
        open: showPinModal,
        close: closePinModal
    };

    // Global shortcut helper
    window.dentPromptPin = function(opts) {
        showPinModal(opts);
    };

})();
