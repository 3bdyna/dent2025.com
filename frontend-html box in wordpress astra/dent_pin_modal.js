/**
 * Dent2025 - Admin 4-Digit PIN Modal Component
 * Styled to 100% match the Dent2025 dark zinc / charcoal minimalist aesthetic.
 */
(function() {
    'use strict';

    if (window.DentPinModal) return;

    const PIN_LENGTH = 4;
    const API_BASE = (window.location.pathname === '/dev' || window.location.pathname.startsWith('/dev/')) ? '/dev' : '';

    const STYLES = `
        .dent-pin-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            width: 100%;
            height: 100%;
            background: rgba(10, 12, 16, 0.85);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            z-index: 9999999;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 16px;
            opacity: 0;
            visibility: hidden;
            transition: opacity 0.2s ease, visibility 0.2s ease;
            box-sizing: border-box;
            direction: rtl;
            font-family: 'Outfit', 'Noto Kufi Arabic', -apple-system, BlinkMacSystemFont, sans-serif;
        }
        .dent-pin-overlay.active {
            opacity: 1;
            visibility: visible;
        }
        .dent-pin-card {
            position: relative;
            width: 100%;
            max-width: 340px;
            background: #181b21;
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 18px;
            padding: 20px 22px 18px;
            box-shadow: 0 25px 60px rgba(0, 0, 0, 0.75);
            color: #f8fafc;
            text-align: right;
            transform: scale(0.96) translateY(8px);
            transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
            user-select: none;
            box-sizing: border-box;
        }
        .dent-pin-overlay.active .dent-pin-card {
            transform: scale(1) translateY(0);
        }

        /* Header matching standard Dent2025 modals */
        .dent-pin-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            padding-bottom: 12px;
            gap: 10px;
        }
        .dent-pin-header-content {
            flex: 1;
            min-width: 0;
        }
        .dent-pin-title-row {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 4px;
        }
        .dent-pin-lock-icon {
            color: #cbd5e1;
            flex-shrink: 0;
        }
        .dent-pin-title {
            margin: 0;
            font-size: 1.05rem;
            font-weight: 700;
            color: #f8fafc;
            line-height: 1.3;
        }
        .dent-pin-context-pill {
            font-size: 0.74rem;
            color: #a1a1aa;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 6px;
            padding: 2px 8px;
            display: inline-block;
            font-weight: 500;
        }
        .dent-pin-close-btn {
            background: rgba(255, 255, 255, 0.06);
            border: 1px solid rgba(255, 255, 255, 0.1);
            color: #9ca3af;
            width: 32px;
            height: 32px;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.25rem;
            cursor: pointer;
            flex-shrink: 0;
            transition: all 0.2s ease;
            line-height: 1;
            padding: 0;
        }
        .dent-pin-close-btn:hover {
            background: rgba(239, 68, 68, 0.15);
            color: #ef4444;
            border-color: rgba(239, 68, 68, 0.3);
        }

        /* Instruction label */
        .dent-pin-label {
            font-size: 0.82rem;
            color: #a1a1aa;
            font-weight: 600;
            margin-bottom: 12px;
            display: block;
        }

        /* 4 PIN Display Cells */
        .dent-pin-cells-wrapper {
            position: relative;
            display: flex;
            justify-content: center;
            gap: 12px;
            margin: 0 auto 14px;
            direction: ltr; /* digits type LTR */
        }
        .dent-pin-cell {
            width: 52px;
            height: 56px;
            border-radius: 12px;
            background: #111317;
            border: 1px solid rgba(255, 255, 255, 0.12);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.5rem;
            color: transparent;
            transition: all 0.18s ease;
            box-sizing: border-box;
            cursor: pointer;
        }
        .dent-pin-cell.active-focus {
            border-color: rgba(255, 255, 255, 0.45);
            background: rgba(255, 255, 255, 0.04);
            box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.08);
        }
        .dent-pin-cell.filled {
            background: #1f232b;
            border-color: rgba(255, 255, 255, 0.28);
            color: #f8fafc;
        }
        .dent-pin-cell.filled::after {
            content: '●';
            font-size: 1.15rem;
            line-height: 1;
            color: #f8fafc;
        }

        /* Hidden native input for keyboard/paste capture */
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
            font-size: 16px;
        }

        /* Status & Feedback message */
        .dent-pin-status {
            min-height: 20px;
            font-size: 0.8rem;
            margin-bottom: 12px;
            font-weight: 500;
            text-align: center;
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

        /* Compact, Subdued Numpad matching Dent2025 button language */
        .dent-pin-keypad {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 7px;
            direction: ltr;
            max-width: 270px;
            margin: 0 auto 14px;
        }
        .dent-pin-key {
            height: 42px;
            border-radius: 8px;
            background: #27272a;
            border: 1px solid rgba(255, 255, 255, 0.1);
            font-size: 1.2rem;
            font-weight: 600;
            font-family: 'Outfit', sans-serif;
            color: #f8fafc;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all 0.15s ease;
            user-select: none;
            -webkit-tap-highlight-color: transparent;
            padding: 0;
        }
        .dent-pin-key:hover {
            background: #3f3f46;
            border-color: rgba(255, 255, 255, 0.2);
            transform: translateY(-1px);
        }
        .dent-pin-key:active {
            transform: translateY(0);
            background: #52525b;
        }
        .dent-pin-key.action-key {
            font-size: 0.8rem;
            color: #a1a1aa;
            font-weight: 500;
            background: rgba(255, 255, 255, 0.04);
            border-color: rgba(255, 255, 255, 0.06);
            font-family: inherit;
        }
        .dent-pin-key.action-key:hover {
            color: #f8fafc;
            background: rgba(255, 255, 255, 0.08);
        }

        /* Primary Submit Button matching Dent2025 primary action buttons */
        .dent-pin-submit-btn {
            width: 100%;
            height: 44px;
            background: #27272a;
            color: #f8fafc;
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 10px;
            font-size: 0.92rem;
            font-weight: 600;
            font-family: inherit;
            cursor: pointer;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            box-sizing: border-box;
        }
        .dent-pin-submit-btn:hover {
            background: #3f3f46;
            border-color: rgba(255, 255, 255, 0.25);
            transform: translateY(-1px);
        }
        .dent-pin-submit-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
        }

        /* Error Shake Animation */
        @keyframes dentPinShake {
            0%, 100% { transform: translateX(0); }
            20%, 60% { transform: translateX(-6px); }
            40%, 80% { transform: translateX(6px); }
        }
        .dent-pin-shake {
            animation: dentPinShake 0.4s cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
        }
        .dent-pin-shake .dent-pin-cell {
            border-color: rgba(239, 68, 68, 0.8) !important;
            background: rgba(239, 68, 68, 0.1) !important;
        }

        /* Success State */
        .dent-pin-success .dent-pin-cell {
            border-color: rgba(16, 185, 129, 0.8) !important;
            background: rgba(16, 185, 129, 0.12) !important;
            color: #34d399 !important;
        }

        /* Subtle Spinner */
        .dent-pin-spinner {
            width: 13px;
            height: 13px;
            border: 2px solid rgba(255, 255, 255, 0.2);
            border-top-color: #f8fafc;
            border-radius: 50%;
            animation: dentPinSpin 0.6s linear infinite;
        }
        @keyframes dentPinSpin {
            to { transform: rotate(360deg); }
        }
    `;

    function injectStyles() {
        if (document.getElementById('dent-pin-modal-css')) return;
        const style = document.createElement('style');
        style.id = 'dent-pin-modal-css';
        style.textContent = STYLES;
        document.head.appendChild(style);
    }

    let activeModal = null;
    let currentDigits = [];
    let isVerifying = false;

    function showPinModal(opts) {
        opts = opts || {};
        injectStyles();
        closePinModal(false);

        const overlay = document.createElement('div');
        overlay.className = 'dent-pin-overlay';
        overlay.id = 'dent-pin-overlay';

        let contextLabel = 'لوحة التحكم';
        if (opts.context && opts.context.specialty) {
            const specMap = { dentistry: 'طب الأسنان', medicine: 'الطب البشري', 'pre-med': 'السنة التحضيرية' };
            const specName = specMap[opts.context.specialty] || opts.context.specialty;
            contextLabel = `${specName} — سنة ${opts.context.year} ترم ${opts.context.semester}`;
        }

        overlay.innerHTML = `
            <div class="dent-pin-card" role="dialog" aria-modal="true" aria-labelledby="dent-pin-title">
                <div class="dent-pin-header">
                    <div class="dent-pin-header-content">
                        <div class="dent-pin-title-row">
                            <svg class="dent-pin-lock-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                            </svg>
                            <h3 class="dent-pin-title" id="dent-pin-title">${opts.title || 'تسجيل دخول المشرف'}</h3>
                        </div>
                        <span class="dent-pin-context-pill">${contextLabel}</span>
                    </div>
                    <button class="dent-pin-close-btn" type="button" aria-label="إغلاق" id="dent-pin-close-btn">×</button>
                </div>

                <label class="dent-pin-label">أدخل رمز PIN المكون من 4 أرقام للتحقق:</label>

                <div class="dent-pin-cells-wrapper" id="dent-pin-cells-wrap">
                    <div class="dent-pin-cell" data-idx="0"></div>
                    <div class="dent-pin-cell" data-idx="1"></div>
                    <div class="dent-pin-cell" data-idx="2"></div>
                    <div class="dent-pin-cell" data-idx="3"></div>
                    <input type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" class="dent-pin-hidden-input" id="dent-pin-hidden" autocomplete="one-time-code" />
                </div>

                <div class="dent-pin-status" id="dent-pin-status"></div>

                <!-- Compact Subdued Keypad -->
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
                    <button type="button" class="dent-pin-key action-key" data-action="backspace" aria-label="حذف">⌫</button>
                </div>

                <!-- Submit Button -->
                <button type="button" class="dent-pin-submit-btn" id="dent-pin-submit-btn">تسجيل الدخول</button>
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

        updateCells();

        const hiddenInput = overlay.querySelector('#dent-pin-hidden');
        if (hiddenInput) {
            setTimeout(() => {
                try { hiddenInput.focus(); } catch(e) {}
            }, 60);
        }

        requestAnimationFrame(() => {
            overlay.classList.add('active');
        });

        // Close events
        overlay.querySelector('#dent-pin-close-btn').onclick = () => closePinModal(true);
        overlay.onclick = (e) => {
            if (e.target === overlay) closePinModal(true);
        };

        // Submit button
        overlay.querySelector('#dent-pin-submit-btn').onclick = () => {
            if (currentDigits.length === PIN_LENGTH) {
                submitPin();
            } else {
                setStatus('يرجى إدخال جميع الأرقام الـ 4.', 'error');
                triggerShake();
            }
        };

        // Keypad buttons
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

        // Cells click focuses hidden input
        const cellsWrap = overlay.querySelector('#dent-pin-cells-wrap');
        if (cellsWrap && hiddenInput) {
            cellsWrap.onclick = () => {
                try { hiddenInput.focus(); } catch(e) {}
            };
        }

        // Hidden input typing
        if (hiddenInput) {
            hiddenInput.addEventListener('input', () => {
                if (isVerifying) return;
                const val = hiddenInput.value.replace(/\D/g, '');
                currentDigits = val.slice(0, PIN_LENGTH).split('');
                updateCells();
                if (currentDigits.length === PIN_LENGTH) {
                    submitPin();
                }
            });
        }

        // Physical Keyboard listener
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
                if (currentDigits.length === PIN_LENGTH) {
                    submitPin();
                } else {
                    setStatus('يرجى إدخال جميع الأرقام الـ 4.', 'error');
                    triggerShake();
                }
            }
        };
        window.addEventListener('keydown', activeModal.keyHandler);

        // Clipboard paste
        activeModal.pasteHandler = (e) => {
            if (!activeModal || isVerifying) return;
            const pasteData = (e.clipboardData || window.clipboardData)?.getData('text');
            if (!pasteData) return;
            const cleanDigits = pasteData.replace(/\D/g, '').slice(0, PIN_LENGTH);
            if (cleanDigits.length > 0) {
                e.preventDefault();
                currentDigits = cleanDigits.split('');
                updateCells();
                if (currentDigits.length === PIN_LENGTH) {
                    submitPin();
                }
            }
        };
        window.addEventListener('paste', activeModal.pasteHandler);
    }

    function appendDigit(digit) {
        if (currentDigits.length >= PIN_LENGTH || isVerifying) return;
        currentDigits.push(digit);
        updateCells();
        if (currentDigits.length === PIN_LENGTH) {
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
        void card.offsetWidth;
        card.classList.add('dent-pin-shake');
        setTimeout(() => {
            card.classList.remove('dent-pin-shake');
        }, 450);
    }

    function submitPin() {
        const pin = currentDigits.join('');
        if (pin.length !== PIN_LENGTH || isVerifying || !activeModal) return;

        isVerifying = true;
        setStatus('جاري التحقق من الصلاحيات...', 'loading');

        const submitBtn = activeModal.overlay.querySelector('#dent-pin-submit-btn');
        if (submitBtn) submitBtn.disabled = true;

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
                const allowedContexts = res.data.allowed_contexts || [];
                const isUniversal = allowedContexts.includes('*');
                const currentContextKey = `${payload.specialty}_${payload.year}_${payload.semester}`;

                if (!isUniversal && !allowedContexts.includes(currentContextKey)) {
                    isVerifying = false;
                    if (submitBtn) submitBtn.disabled = false;
                    triggerShake();
                    setStatus('رمز PIN غير مصرح له بهذه الدفعة/القسم.', 'error');
                    currentDigits = [];
                    updateCells();
                    const hiddenInput = activeModal?.overlay?.querySelector('#dent-pin-hidden');
                    if (hiddenInput) {
                        hiddenInput.value = '';
                        try { hiddenInput.focus(); } catch(e) {}
                    }
                    return;
                }

                sessionStorage.setItem('dent2025_admin_pass', pin);
                sessionStorage.setItem('dent2025_schedule_admin_pass', pin);
                const perms = res.data.permissions || {};
                sessionStorage.setItem('dent2025_permissions', JSON.stringify(perms));
                sessionStorage.setItem('dent2025_passkey_info', JSON.stringify(res.data));

                setStatus('تم التحقق بنجاح!', 'success');
                const card = activeModal.overlay.querySelector('.dent-pin-card');
                if (card) card.classList.add('dent-pin-success');

                setTimeout(() => {
                    const cb = activeModal?.opts?.onSuccess;
                    closePinModal(false);
                    if (typeof cb === 'function') {
                        cb({ pin, permissions: perms, data: res.data });
                    }
                }, 350);
            } else {
                isVerifying = false;
                if (submitBtn) submitBtn.disabled = false;
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
            if (submitBtn) submitBtn.disabled = false;
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
        }, 200);

        activeModal = null;
        currentDigits = [];
        isVerifying = false;

        if (triggerCancel && typeof opts?.onCancel === 'function') {
            opts.onCancel();
        }
    }

    window.DentPinModal = {
        open: showPinModal,
        close: closePinModal
    };

    window.dentPromptPin = function(opts) {
        showPinModal(opts);
    };

})();
