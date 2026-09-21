const API_BASE = (function() {
    let p = window.location.pathname;
    if (p.endsWith('.html') || p.endsWith('.php')) {
        p = p.substring(0, p.lastIndexOf('/'));
    }
    if (p.endsWith('/')) {
        p = p.substring(0, p.length - 1);
    }
    return p;
})();

const AI_API_BASE = `${API_BASE || ''}/backend/api_ai_exam.php`;
window.AdminApp = {
    pass: null,
    permissions: {},
    passkeyInfo: null,
    currentTab: 'subjects',
    
    // Cached data for modals & lists
    passwordsData: [],
    eventsData: [],
    subjectsData: [],
    classesData: [],
    announcementsData: [],
    historyData: [],
    quizzesData: [],
    geminiData: null,
    cacheStatsData: null,
    _classesCohort: null,
    _quillLoadingPromise: null,
    _prefetchScheduled: false,
    visibleKeys: {}, // To track visible passkeys in passwords tab
    portalMultiSpecialtyMode: null,

    selectedClassDay: 'الأحد',

    // Universal Focus Mode (Active Academic Track)
    focusMode: {
        enabled: true,
        specialty: 'dentistry',
        year: '3',
        semester: '1'
    },

    init() {
        this.pass = sessionStorage.getItem('dent2025_admin_pass');
        const storedPerms = sessionStorage.getItem('dent2025_permissions');
        if (storedPerms) {
            try { this.permissions = JSON.parse(storedPerms); } catch(e) { this.permissions = {}; }
        }

        const loginBtn = document.getElementById('login-btn');
        if (loginBtn) {
            loginBtn.onclick = () => this.login();
        }

        const passInput = document.getElementById('admin-password');
        if (passInput) {
            passInput.onkeydown = (e) => {
                if (e.key === 'Enter') this.login();
            };
        }

        // Close focus popover on outside click
        document.addEventListener('click', (e) => {
            const wrapper = document.getElementById('focus-popover-wrapper');
            const popover = document.getElementById('focus-track-popover');
            if (popover && !popover.classList.contains('hidden')) {
                if (wrapper && !wrapper.contains(e.target)) {
                    this.closeFocusPopover();
                }
            }
        });

        this.initFocusMode();

        if (this.pass) {
            this.verifyAuth(this.pass);
        } else {
            const overlay = document.getElementById('login-overlay');
            if (overlay) overlay.classList.remove('hidden');
        }
    },

    verifyAuth(pass) {
        const url = (API_BASE ? API_BASE : '.') + '/dent2025_api.php?action=check_auth';
        fetch(url, {
            method: 'POST',
            body: JSON.stringify({ password: pass })
        })
        .then(r => r.json())
        .then(res => {
            if (res.success && res.data) {
                this.pass = pass;
                this.passkeyInfo = res.data;
                this.permissions = res.data.permissions || {};
                sessionStorage.setItem('dent2025_admin_pass', pass);
                sessionStorage.setItem('dent2025_permissions', JSON.stringify(this.permissions));
                sessionStorage.setItem('dent2025_passkey_info', JSON.stringify(res.data));
                const overlay = document.getElementById('login-overlay');
                if (overlay) overlay.classList.add('hidden');
                const err = document.getElementById('login-error');
                if (err) err.classList.add('hidden');
                this.applyPermissionsUI();
                this.showMain();
            } else {
                this.logout();
            }
        })
        .catch(e => {
            console.error('Auth check error:', e);
            if (this.pass) {
                const overlay = document.getElementById('login-overlay');
                if (overlay) overlay.classList.add('hidden');
                this.applyPermissionsUI();
                this.showMain();
            }
        });
    },

    login() {
        const passInput = document.getElementById('admin-password');
        const pass = passInput ? passInput.value.trim() : '';
        if (!pass) {
            const err = document.getElementById('login-error');
            if (err) { err.innerText = 'يرجى إدخال كلمة المرور أولاً'; err.classList.remove('hidden'); }
            if (passInput) passInput.focus();
            return;
        }

        const btn = document.querySelector('#login-overlay button') || document.getElementById('login-btn');
        const oldText = btn ? btn.innerText : 'دخول';
        if (btn) {
            btn.innerText = 'جاري التحقق...';
            btn.disabled = true;
        }

        const primaryUrl = (API_BASE ? API_BASE : '.') + '/dent2025_api.php?action=check_auth';
        
        const doAuthRequest = (endpoint) => {
            return fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: pass })
            }).then(r => {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            });
        };

        doAuthRequest(primaryUrl)
        .catch(() => doAuthRequest('./dent2025_api.php?action=check_auth'))
        .then(res => {
            if (btn) {
                btn.innerText = oldText;
                btn.disabled = false;
            }
            if (res.success && res.data) {
                this.pass = pass;
                this.passkeyInfo = res.data;
                this.permissions = res.data.permissions || {};
                sessionStorage.setItem('dent2025_admin_pass', pass);
                sessionStorage.setItem('dent2025_permissions', JSON.stringify(this.permissions));
                sessionStorage.setItem('dent2025_passkey_info', JSON.stringify(res.data));
                const overlay = document.getElementById('login-overlay');
                if (overlay) overlay.classList.add('hidden');
                const err = document.getElementById('login-error');
                if (err) err.classList.add('hidden');
                this.applyPermissionsUI();
                this.showMain();
            } else {
                const err = document.getElementById('login-error');
                if (err) {
                    err.innerText = res.message || 'كلمة المرور غير صحيحة';
                    err.classList.remove('hidden');
                }
            }
        })
        .catch(e => {
            if (btn) {
                btn.innerText = oldText;
                btn.disabled = false;
            }
            const err = document.getElementById('login-error');
            if (err) {
                err.innerText = 'خطأ في الاتصال بالخادم (Network Error: ' + (e.message || '') + ')';
                err.classList.remove('hidden');
            }
            console.error('Login error:', e);
        });
    },

    logout() {
        this.pass = null;
        this.permissions = {};
        this.passkeyInfo = null;
        sessionStorage.removeItem('dent2025_admin_pass');
        sessionStorage.removeItem('dent2025_permissions');
        sessionStorage.removeItem('dent2025_passkey_info');
        const overlay = document.getElementById('login-overlay');
        if (overlay) overlay.classList.remove('hidden');
        if (document.getElementById('admin-password')) {
            document.getElementById('admin-password').value = '';
        }
    },

    toggleMobileDrawer() {
        const drawer = document.getElementById('mobile-drawer');
        const overlay = document.getElementById('mobile-drawer-overlay');
        if (!drawer || !overlay) return;
        const isOpen = !drawer.classList.contains('translate-x-full');
        if (isOpen) {
            this.closeMobileDrawer();
        } else {
            overlay.classList.remove('hidden');
            setTimeout(() => {
                overlay.classList.remove('opacity-0');
                overlay.classList.add('opacity-100');
            }, 10);
            drawer.classList.remove('translate-x-full');
            document.body.classList.add('overflow-hidden');
        }
    },

    closeMobileDrawer() {
        const drawer = document.getElementById('mobile-drawer');
        const overlay = document.getElementById('mobile-drawer-overlay');
        if (drawer) {
            drawer.classList.add('translate-x-full');
        }
        if (overlay) {
            overlay.classList.remove('opacity-100');
            overlay.classList.add('opacity-0');
            setTimeout(() => {
                overlay.classList.add('hidden');
            }, 300);
        }
        const hasOpenModal = document.querySelector('[id$="-modal"]:not(.hidden)');
        if (!hasOpenModal) {
            document.body.classList.remove('overflow-hidden');
        }
    },

    applyPermissionsUI() {
        const canManageMaster = !!(this.permissions && this.permissions.manage_passwords);
        const masterOnlyTabs = ['passwords', 'gemini', 'cache', 'history'];
        masterOnlyTabs.forEach(tabName => {
            document.querySelectorAll(`[data-tab="${tabName}"]`).forEach(el => {
                if (canManageMaster) {
                    el.classList.remove('hidden');
                } else {
                    el.classList.add('hidden');
                }
            });
        });
        const topPortalControl = document.getElementById('portal-mode-top-control');
        if (topPortalControl) {
            topPortalControl.classList.toggle('hidden', !canManageMaster);
            topPortalControl.classList.toggle('flex', canManageMaster);
        }
        const mobileToggle = document.getElementById('portal-mode-mobile-toggle');
        if (mobileToggle) {
            mobileToggle.classList.toggle('hidden', !canManageMaster);
        }
    },

    loadQuill() {
        if (typeof window.Quill !== 'undefined') return Promise.resolve(window.Quill);
        if (this._quillLoadingPromise) return this._quillLoadingPromise;
        this._quillLoadingPromise = new Promise((resolve, reject) => {
            if (!document.getElementById('quill-css')) {
                const link = document.createElement('link');
                link.id = 'quill-css';
                link.rel = 'stylesheet';
                link.href = 'https://cdn.quilljs.com/1.3.7/quill.snow.css';
                document.head.appendChild(link);
            }
            const s = document.createElement('script');
            s.src = 'https://cdn.quilljs.com/1.3.7/quill.min.js';
            s.async = true;
            s.onload = () => resolve(window.Quill);
            s.onerror = (err) => reject(err);
            document.body.appendChild(s);
        });
        return this._quillLoadingPromise;
    },

    scheduleBackgroundPrefetch() {
        if (this._prefetchScheduled) return;
        this._prefetchScheduled = true;

        const runTask = (fn, delayMs) => {
            if (typeof window.requestIdleCallback === 'function') {
                setTimeout(() => window.requestIdleCallback(fn, { timeout: 3000 }), delayMs);
            } else {
                setTimeout(fn, delayMs);
            }
        };

        // Step 1: Preload Quill assets quietly in background (600ms)
        runTask(() => this.loadQuill().catch(() => {}), 600);

        // Step 2: Prefetch Timetable Classes for active track (1000ms)
        runTask(() => this.prefetchClasses(), 1000);

        // Step 3: Prefetch Calendar Events (1600ms)
        runTask(() => this.prefetchEvents(), 1600);

        // Step 4: Prefetch Announcements (2200ms)
        runTask(() => this.prefetchAnnouncements(), 2200);

        // Step 5: Prefetch Quizzes list (2800ms)
        runTask(() => this.prefetchQuizzes(), 2800);

        // Step 6: Master-only datasets (if authorized)
        const canManageMaster = !!(this.permissions && this.permissions.manage_passwords);
        if (canManageMaster) {
            runTask(() => this.prefetchPasswords(), 3400);
            runTask(() => this.prefetchGemini(), 4000);
            runTask(() => this.prefetchHistory(), 4600);
            runTask(() => this.prefetchCacheStats(), 5200);
        }
    },

    prefetchClasses() {
        if (this.classesData && this.classesData.length) return;
        let spec = (this.focusMode && this.focusMode.specialty) || 'dentistry';
        let year = (this.focusMode && String(this.focusMode.year)) || '3';
        let sem = (this.focusMode && String(this.focusMode.semester)) || '1';
        fetch(`${API_BASE}/dent2025_api.php?action=get_classes&specialty=${spec}&year=${year}&semester=${sem}`)
        .then(r => r.json())
        .then(res => {
            if (res.success && Array.isArray(res.data)) {
                this.classesData = res.data;
                this._classesCohort = `${spec}_${year}_${sem}`;
            }
        }).catch(() => {});
    },

    prefetchEvents() {
        if (this.eventsData && this.eventsData.length) return;
        fetch(`${API_BASE}/schedule_backend.php?schedule_id=all&_t=${Date.now()}`)
        .then(r => r.json())
        .then(res => {
            if (res.success && Array.isArray(res.data)) {
                this.eventsData = res.data;
            }
        }).catch(() => {});
    },

    prefetchAnnouncements() {
        if (this.announcementsData && this.announcementsData.length) return;
        fetch(API_BASE + '/announcements_api.php?action=get_all')
        .then(r => r.json())
        .then(res => {
            if (res.success && res.data) {
                this.announcementsData = res.data;
            }
        }).catch(() => {});
    },

    prefetchQuizzes() {
        if (this.quizzesData && this.quizzesData.length) return;
        fetch(API_BASE + '/backend/api_ai_exam.php?action=list_quizzes')
        .then(r => r.json())
        .then(res => {
            if (res.success && Array.isArray(res.data)) {
                this.quizzesData = res.data;
            }
        }).catch(() => {});
    },

    prefetchPasswords() {
        if (this.passwordsData && this.passwordsData.length) return;
        fetch(API_BASE + '/dent2025_api.php?action=get_passwords', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: this.pass })
        })
        .then(r => r.json())
        .then(res => {
            if (res.success && Array.isArray(res.data)) {
                this.passwordsData = res.data;
            }
        }).catch(() => {});
    },

    prefetchGemini() {
        if (this.geminiData) return;
        this.fetchGeminiApi('action=gemini_status')
        .then(res => {
            if (res && res.success && res.data) {
                this.geminiData = res.data;
            }
        }).catch(() => {});
    },

    prefetchHistory() {
        if (this.historyData && this.historyData.length) return;
        fetch(API_BASE + '/history_api.php?action=get_history', { headers: { 'X-Admin-Pass': this.pass || '' } })
        .then(r => r.json())
        .then(res => {
            if (res.success && Array.isArray(res.data)) {
                this.historyData = res.data.filter(h => h.action_type !== 'manual_save');
            }
        }).catch(() => {});
    },

    prefetchCacheStats() {
        if (this.cacheStatsData) return;
        fetch(this.aiExamUrl('get_cache_stats'), { headers: { 'X-Admin-Pass': this.pass || '' } })
        .then(r => r.json())
        .then(res => {
            if (res.success && res.data) {
                this.cacheStatsData = res.data;
            }
        }).catch(() => {});
    },

    showMain() {
        this.initFocusMode();
        this.loadPortalSettings();
        let initialTab = 'subjects';
        this.switchTab(this.currentTab && this.currentTab !== 'dashboard' ? this.currentTab : initialTab);
        this.scheduleBackgroundPrefetch();
    },

    switchTab(tabId) {
        const masterOnlyTabs = ['passwords', 'gemini', 'cache', 'history'];
        if (masterOnlyTabs.includes(tabId)) {
            const canManageMaster = !!(this.permissions && this.permissions.manage_passwords);
            if (!canManageMaster) {
                this.showToast('غير مصرح لك بالوصول لهذا القسم (صلاحية Master مطلوبة)', true);
                return;
            }
        }

        this.currentTab = tabId;

        const tabNames = {
            'subjects': 'المواد والروابط',
            'classes': 'الجداول الدراسية',
            'events': 'التقويم والأحداث',
            'announcements': 'الإعلانات',
            'quizzes': 'بنك الاختبارات الذكية',
            'cache': 'ذاكرة الكاش والتجهيز',
            'gemini': 'مراقبة مفاتيح المعالجة الذكية',
            'passwords': 'الصلاحيات والمفاتيح',
            'history': 'سجل التغييرات والاستعادة'
        };

        const badge = document.getElementById('mobile-active-tab-badge');
        if (badge && tabNames[tabId]) {
            badge.innerText = tabNames[tabId];
        }
        
        // Desktop sidebar tabs
        document.querySelectorAll('.tab-btn').forEach(btn => {
            if (btn.dataset.tab === tabId) {
                btn.classList.add('bg-white/10', 'text-white', 'font-semibold');
                btn.classList.remove('text-gray-400');
            } else {
                btn.classList.remove('bg-white/10', 'text-white', 'font-semibold');
                btn.classList.add('text-gray-400');
            }
        });

        // Mobile drawer tabs
        document.querySelectorAll('.mobile-tab-btn').forEach(btn => {
            if (btn.dataset.tab === tabId) {
                btn.classList.add('bg-white/10', 'text-white', 'font-semibold');
                btn.classList.remove('text-gray-400');
            } else {
                btn.classList.remove('bg-white/10', 'text-white', 'font-semibold');
                btn.classList.add('text-gray-400');
            }
        });

        // Mobile pills tabs
        document.querySelectorAll('.pill-tab-btn').forEach(btn => {
            if (btn.dataset.tab === tabId) {
                btn.classList.add('bg-white/10', 'text-white', 'font-medium', 'border-white/10');
                btn.classList.remove('bg-white/5', 'text-gray-400', 'border-white/5');
                if (typeof btn.scrollIntoView === 'function') {
                    btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
                }
            } else {
                btn.classList.remove('bg-white/10', 'text-white', 'font-medium', 'border-white/10');
                btn.classList.add('bg-white/5', 'text-gray-400', 'border-white/5');
            }
        });

        // Mobile bottom navigation bar items
        document.querySelectorAll('#mobile-bottom-nav .mobile-nav-item').forEach(btn => {
            if (btn.dataset.tab === tabId) {
                btn.className = 'mobile-nav-item flex flex-col items-center justify-center gap-0.5 py-1 text-white font-medium';
            } else if (btn.dataset.tab) {
                btn.className = 'mobile-nav-item flex flex-col items-center justify-center gap-0.5 py-1 text-gray-400 hover:text-white';
            }
        });



        this.closeMobileDrawer();

        const contentDiv = document.getElementById('tab-content');
        const tpl = document.getElementById(`tpl-${tabId}`);
        
        if (tpl) {
            contentDiv.innerHTML = tpl.innerHTML;
            if (tabId === 'passwords') {
                this.loadPasswords();
            } else if (tabId === 'events') {
                this.loadEvents();
            } else if (tabId === 'subjects') {
                this.loadSubjects();
            } else if (tabId === 'classes') {
                this.loadClasses();
            } else if (tabId === 'announcements') {
                const initEditor = () => {
                    if (typeof window.Quill !== 'undefined' && document.getElementById('ann-editor-container')) {
                        if (!this.quill) {
                            this.quill = new window.Quill('#ann-editor-container', {
                                theme: 'snow',
                                placeholder: 'اكتب الإعلان هنا...',
                                modules: {
                                    toolbar: [
                                        ['bold', 'italic', 'underline', 'strike'],
                                        [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                                        [{ 'color': [] }, { 'background': [] }],
                                        ['link', 'clean']
                                    ]
                                }
                            });
                        }
                    }
                };
                if (typeof window.Quill !== 'undefined') {
                    initEditor();
                } else {
                    this.loadQuill().then(() => initEditor()).catch(console.error);
                }
                this.loadAnnouncements();
            } else if (tabId === 'history') {
                this.loadHistory();
                this.loadManualSnapshots();
            } else if (tabId === 'gemini') {
                this.loadGeminiStatus();
            } else if (tabId === 'quizzes') {
                this.loadQuizzes();
            } else if (tabId === 'cache') {
                this.loadCacheStats();
            }
        } else {
            contentDiv.innerHTML = `<div class="p-8 text-center text-gray-400 glass rounded-2xl">
                <h2 class="text-2xl mb-2">قريباً</h2>
                <p>هذا القسم قيد التطوير...</p>
            </div>`;
        }
    },

    async loadPortalSettings() {
        const topToggle = document.getElementById('portal-mode-top-toggle');
        const topLabel = document.getElementById('portal-mode-top-label');
        const mobileToggle = document.getElementById('portal-mode-mobile-toggle');
        const mobileLabel = document.getElementById('portal-mode-mobile-label');
        if (!topToggle && !mobileToggle) return;

        if (topToggle) topToggle.disabled = true;
        if (topLabel) topLabel.innerText = 'جاري التحميل';
        if (mobileToggle) mobileToggle.disabled = true;
        if (mobileLabel) mobileLabel.innerText = 'جاري التحميل';

        try {
            const response = await fetch(`${API_BASE}/dent2025_api.php?action=portal_settings&_t=${Date.now()}`, {
                cache: 'no-store',
                credentials: 'same-origin'
            });
            const result = await response.json();
            if (!result.success || !result.data || typeof result.data.multi_specialty_mode !== 'boolean') {
                throw new Error(result.message || 'Invalid portal settings response');
            }

            this.portalMultiSpecialtyMode = result.data.multi_specialty_mode;
            this.updatePortalModeSaveState();
            if (topToggle) topToggle.disabled = false;
            if (mobileToggle) mobileToggle.disabled = false;
        } catch (e) {
            if (topLabel) topLabel.innerText = 'تعذر التحميل';
            if (mobileLabel) mobileLabel.innerText = 'تعذر التحميل';
            this.showToast('تعذر تحميل إعداد الموقع', true);
        }
    },

    updatePortalModeSaveState() {
        const topToggle = document.getElementById('portal-mode-top-toggle');
        const topLabel = document.getElementById('portal-mode-top-label');
        const mobileToggle = document.getElementById('portal-mode-mobile-toggle');
        const mobileLabel = document.getElementById('portal-mode-mobile-label');
        const mobileDot = document.getElementById('portal-mode-mobile-dot');
        if (this.portalMultiSpecialtyMode === null) return;

        const enabled = !!this.portalMultiSpecialtyMode;
        if (topLabel) topLabel.innerText = enabled ? 'مفعّل' : 'معطّل';
        if (topToggle) {
            topToggle.classList.toggle('bg-emerald-500/20', enabled);
            topToggle.classList.toggle('text-emerald-300', enabled);
            topToggle.classList.toggle('bg-white/10', !enabled);
            topToggle.classList.toggle('text-gray-200', !enabled);
        }

        if (mobileLabel) mobileLabel.innerText = enabled ? 'تعدد: مفعّل' : 'تعدد: معطّل';
        if (mobileDot) {
            mobileDot.className = enabled ? 'w-2 h-2 rounded-full bg-emerald-400 shrink-0' : 'w-2 h-2 rounded-full bg-amber-400 shrink-0';
        }
        if (mobileToggle) {
            mobileToggle.classList.toggle('bg-emerald-500/15', enabled);
            mobileToggle.classList.toggle('border-emerald-500/30', enabled);
            mobileToggle.classList.toggle('text-emerald-300', enabled);
            mobileToggle.classList.toggle('bg-white/10', !enabled);
            mobileToggle.classList.toggle('border-white/20', !enabled);
            mobileToggle.classList.toggle('text-gray-200', !enabled);
        }
    },

    async togglePortalModeFromTop() {
        if (!this.permissions.manage_passwords) {
            this.showToast('غير مصرح لك بتغيير هذا الإعداد (صلاحية Master مطلوبة)', true);
            return;
        }
        if (this.portalMultiSpecialtyMode === null) {
            await this.loadPortalSettings();
        }
        if (this.portalMultiSpecialtyMode === null) {
            this.showToast('لم يتم تحميل إعداد الموقع بعد', true);
            return;
        }
        this.savePortalMode(!this.portalMultiSpecialtyMode);
    },

    async savePortalMode(desiredValue) {
        const topToggle = document.getElementById('portal-mode-top-toggle');
        const topLabel = document.getElementById('portal-mode-top-label');
        const mobileToggle = document.getElementById('portal-mode-mobile-toggle');
        const mobileLabel = document.getElementById('portal-mode-mobile-label');
        if (!this.permissions.manage_passwords) return;

        const nextValue = !!desiredValue;
        const confirmation = nextValue
            ? 'سيتم السماح للطلاب باختيار جميع التخصصات. هل تريد المتابعة؟'
            : 'سيتم تثبيت الموقع على طب الأسنان، السنة الثالثة، الترم الأول. هل تريد المتابعة؟';
        if (!window.confirm(confirmation)) {
            this.updatePortalModeSaveState();
            return;
        }

        if (topToggle) topToggle.disabled = true;
        if (topLabel) topLabel.innerText = 'جاري الحفظ...';
        if (mobileToggle) mobileToggle.disabled = true;
        if (mobileLabel) mobileLabel.innerText = 'جاري الحفظ...';
        try {
            const response = await fetch(`${API_BASE}/dent2025_api.php?action=save_portal_settings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    password: this.pass,
                    multi_specialty_mode: nextValue
                })
            });
            const result = await response.json();
            if (!result.success) throw new Error(result.message || 'Save failed');

            this.portalMultiSpecialtyMode = nextValue;
            this.updatePortalModeSaveState();
            this.showToast(nextValue ? 'تم تفعيل وضع تعدد التخصصات للموقع بنجاح' : 'تم تفعيل وضع المسار الثابت بنجاح');
        } catch (e) {
            this.updatePortalModeSaveState();
            this.showToast('فشل حفظ إعداد الموقع: ' + (e.message || ''), true);
        } finally {
            if (topToggle) topToggle.disabled = false;
            if (mobileToggle) mobileToggle.disabled = false;
            this.updatePortalModeSaveState();
        }
    },

    showLoading(show) {
        const loader = document.getElementById('loading');
        if (loader) {
            if (show) loader.classList.remove('hidden');
            else loader.classList.add('hidden');
        }
    },

    showToast(msg, isError = false) {
        const toast = document.getElementById('toast');
        if (!toast) return;
        document.getElementById('toast-msg').innerText = msg;
        document.getElementById('toast-icon').innerText = isError ? '' : '';
        
        if (isError) {
            toast.classList.remove('glass');
            toast.classList.add('bg-red-500');
        } else {
            toast.classList.add('glass');
            toast.classList.remove('bg-red-500');
        }
        
        toast.classList.remove('opacity-0', 'pointer-events-none');
        toast.style.transform = 'translate(-50%, 20px)';
        
        setTimeout(() => {
            toast.classList.add('opacity-0', 'pointer-events-none');
            toast.style.transform = 'translate(-50%, 0)';
        }, 3000);
    },

    openModal(modalId) {
        const el = document.getElementById(modalId);
        if (el) {
            el.classList.remove('hidden');
            document.body.classList.add('overflow-hidden');
        }
    },

    closeModal(modalId) {
        const el = document.getElementById(modalId);
        if (el) {
            el.classList.add('hidden');
            const hasOtherOpenModal = document.querySelector('[id$="-modal"]:not(.hidden)');
            if (!hasOtherOpenModal) {
                document.body.classList.remove('overflow-hidden');
            }
        }
    },

    escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str).replace(/[&<>"']/g, function(m) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
        });
    },

    sanitizeUrl(url) {
        if (!url) return '#';
        const trimmed = String(url).trim();
        if (/^(https?:\/\/|mailto:|\/)/i.test(trimmed)) {
            return this.escapeHtml(trimmed);
        }
        return '#blocked';
    },

    normalizeArabic(str) {
        if (!str) return '';
        return String(str)
            .replace(/[أإآ]/g, 'ا')
            .replace(/ة/g, 'ه')
            .replace(/ى/g, 'ي')
            .toLowerCase()
            .trim();
    },

    updateYearOptions(specId, yearId) {
        const specEl = document.getElementById(specId);
        const yearEl = document.getElementById(yearId);
        if (!specEl || !yearEl) return;

        const spec = specEl.value;
        const prevYear = yearEl.value;

        let options = [];

        const hasAllOption = specId.startsWith('ann-');
        
        if (spec === 'pre-med') {
            if (hasAllOption) {
                options = [
                    { val: 'all', label: 'الكل' },
                    { val: 0, label: 'سنة 1 (تحضيري)' }
                ];
            } else {
                options = [
                    { val: 0, label: 'سنة 1 (تحضيري)' }
                ];
            }
        } else if (spec === 'all') {
            options = [
                { val: 'all', label: 'الكل' },
                { val: 1, label: 'سنة 1' },
                { val: 2, label: 'سنة 2' },
                { val: 3, label: 'سنة 3' },
                { val: 4, label: 'سنة 4' },
                { val: 5, label: 'سنة 5' },
                { val: 6, label: 'سنة 6' }
            ];
        } else {
            // dentistry or medicine (Years 2 to 6)
            if (hasAllOption) {
                options = [{ val: 'all', label: 'الكل' }];
            } else {
                options = [];
            }
            for (let y = 2; y <= 6; y++) {
                options.push({ val: y, label: `سنة ${y}` });
            }
        }

        yearEl.innerHTML = options.map(o => `<option value="${o.val}">${o.label}</option>`).join('');

        if (options.some(o => String(o.val) === String(prevYear))) {
            yearEl.value = prevYear;
        } else {
            yearEl.value = options[0].val;
        }
    },

    onEventSpecChange() {
        this.updateYearOptions('evt-spec', 'evt-year');
        this.loadEvents();
    },

    onSubjectSpecChange() {
        this.updateYearOptions('sub-spec', 'sub-year');
        if (this.focusMode && this.focusMode.enabled) {
            this.focusMode.specialty = document.getElementById('sub-spec').value;
            this.focusMode.year = document.getElementById('sub-year').value;
            this.saveFocusMode();
            this.renderFocusBar();
        }
        this.loadSubjects();
    },

    onSubjectFilterChange() {
        if (this.focusMode && this.focusMode.enabled) {
            const yEl = document.getElementById('sub-year');
            const sEl = document.getElementById('sub-sem');
            if (yEl) this.focusMode.year = yEl.value;
            if (sEl) this.focusMode.semester = sEl.value;
            this.saveFocusMode();
            this.renderFocusBar();
        }
        this.loadSubjects();
    },

    onClassSpecChange() {
        this.updateYearOptions('cls-spec', 'cls-year');
        if (this.focusMode && this.focusMode.enabled) {
            this.focusMode.specialty = document.getElementById('cls-spec').value;
            this.focusMode.year = document.getElementById('cls-year').value;
            this.saveFocusMode();
            this.renderFocusBar();
        }
        this.loadClasses();
    },

    onClassFilterChange() {
        if (this.focusMode && this.focusMode.enabled) {
            const yEl = document.getElementById('cls-year');
            const sEl = document.getElementById('cls-sem');
            if (yEl) this.focusMode.year = yEl.value;
            if (sEl) this.focusMode.semester = sEl.value;
            this.saveFocusMode();
            this.renderFocusBar();
        }
        this.loadClasses();
    },

    onAnnouncementSpecChange() {
        this.updateYearOptions('ann-spec', 'ann-year');
    },

    // --- UNIVERSAL FOCUS MODE (ACTIVE TRACK) METHODS ---

    initFocusMode() {
        const STORAGE_KEY = 'dent2025_admin_focus_v2';
        let saved = null;
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) saved = JSON.parse(raw);
        } catch(e) {
            console.warn('Error reading saved focusMode:', e);
        }

        // Check URL search parameters (e.g. ?track=dentistry_3_1 or ?specialty=dentistry&year=3&semester=1 or ?focus=0)
        const urlParams = new URLSearchParams(window.location.search);
        const urlTrack = urlParams.get('track');
        const urlSpec = urlParams.get('specialty');
        const urlYear = urlParams.get('year');
        const urlSem = urlParams.get('semester');
        const urlFocus = urlParams.get('focus');

        if (urlTrack) {
            const parts = urlTrack.split('_');
            if (parts.length >= 3) {
                this.focusMode = {
                    enabled: true,
                    specialty: parts[0],
                    year: String(parts[1]),
                    semester: String(parts[2])
                };
            }
        } else if (urlSpec && urlYear && urlSem) {
            this.focusMode = {
                enabled: true,
                specialty: urlSpec,
                year: String(urlYear),
                semester: String(urlSem)
            };
        } else if (urlFocus === '0' || urlFocus === 'false') {
            this.focusMode = {
                enabled: false,
                specialty: (saved && saved.specialty) ? saved.specialty : 'dentistry',
                year: (saved && saved.year) ? String(saved.year) : '3',
                semester: (saved && saved.semester) ? String(saved.semester) : '1'
            };
        } else if (saved && saved.specialty && saved.year && saved.semester) {
            this.focusMode = {
                enabled: saved.enabled !== undefined ? !!saved.enabled : true,
                specialty: saved.specialty,
                year: String(saved.year),
                semester: String(saved.semester)
            };
        } else {
            // Default on entry: Dentistry Year 3 Semester 1, enabled = true
            this.focusMode = {
                enabled: true,
                specialty: 'dentistry',
                year: '3',
                semester: '1'
            };
        }

        this.enforceLeaderContext();
        this.renderFocusBar();
    },

    enforceLeaderContext() {
        if (!this.passkeyInfo) return;
        const perms = this.permissions || {};
        const isMaster = !!perms.manage_passwords || (this.passkeyInfo.allowed_contexts && this.passkeyInfo.allowed_contexts.includes('*'));
        if (!isMaster && Array.isArray(this.passkeyInfo.allowed_contexts) && this.passkeyInfo.allowed_contexts.length > 0) {
            const firstCtx = this.passkeyInfo.allowed_contexts[0];
            const parts = firstCtx.split('_');
            if (parts.length >= 3) {
                this.focusMode = {
                    enabled: true,
                    specialty: parts[0],
                    year: String(parts[1]),
                    semester: String(parts[2])
                };
                const popBtn = document.getElementById('focus-track-btn');
                if (popBtn) popBtn.disabled = true;
                const toggleBtn = document.getElementById('focus-toggle-btn');
                if (toggleBtn) toggleBtn.classList.add('hidden');
            }
        }
    },

    saveFocusMode() {
        try {
            localStorage.setItem('dent2025_admin_focus_v2', JSON.stringify(this.focusMode));
        } catch(e) {
            console.warn('Failed to save focusMode to localStorage:', e);
        }
    },

    toggleFocusMode() {
        this.focusMode.enabled = !this.focusMode.enabled;
        this.saveFocusMode();
        this.renderFocusBar();
        this.showToast(this.focusMode.enabled ? 'تم تفعيل وضع التركيز الأكاديمي' : 'تم تفعيل عرض الكل');
        this.refreshCurrentTab();
    },

    setFocusTrack(specialty, year, semester) {
        const allowedSpecialties = ['dentistry', 'medicine', 'pre-med'];
        const normalizedSpecialty = allowedSpecialties.includes(String(specialty)) ? String(specialty) : 'dentistry';
        this.focusMode.specialty = normalizedSpecialty;
        this.focusMode.year = normalizedSpecialty === 'pre-med' ? '1' : String(year);
        this.focusMode.semester = ['1', '2'].includes(String(semester)) ? String(semester) : '1';
        this.focusMode.enabled = true;
        this.saveFocusMode();
        this.renderFocusBar();
        this.showToast(`تم تغيير وضع التركيز إلى: ${this.getTrackLabel(specialty, year, semester)}`);
        this.refreshCurrentTab();
    },

    getTrackLabel(spec, year, sem) {
        const specNames = {
            'dentistry': 'طب الأسنان',
            'medicine': 'الطب البشري',
            'pre-med': 'السنة التحضيرية'
        };
        const sName = specNames[spec] || spec;
        const yName = (spec === 'pre-med') ? 'سنة 1 (تحضيري)' : `سنة ${year}`;
        const semName = `الترم ${sem}`;
        return `${sName} - ${yName} - ${semName}`;
    },

    renderFocusBar() {
        const trackBtn = document.getElementById('focus-track-btn');
        const trackText = document.getElementById('focus-track-text');
        const toggleBtn = document.getElementById('focus-toggle-btn');
        const toggleText = document.getElementById('focus-toggle-text');
        const barLabel = document.getElementById('focus-bar-label');

        // Mobile header elements
        const mobileTrackText = document.getElementById('mobile-header-track-text');
        const mobileSheetToggleText = document.getElementById('mobile-sheet-toggle-text');

        const isEnabled = this.focusMode && this.focusMode.enabled;
        const label = this.getTrackLabel(this.focusMode.specialty, this.focusMode.year, this.focusMode.semester);

        if (mobileTrackText) {
            if (isEnabled) {
                const spec = this.focusMode.specialty;
                const shortSpec = spec === 'dentistry' ? 'طب الأسنان' : (spec === 'medicine' ? 'الطب البشري' : 'تحضيري');
                if (spec === 'pre-med') {
                    mobileTrackText.innerText = `تحضيري - ت${this.focusMode.semester}`;
                } else {
                    mobileTrackText.innerText = `${shortSpec} - س${this.focusMode.year} - ت${this.focusMode.semester}`;
                }
            } else {
                mobileTrackText.innerText = 'عرض شامل (الكل)';
            }
        }
        if (mobileSheetToggleText) {
            mobileSheetToggleText.innerText = isEnabled ? 'عرض شامل (الكل)' : `تفعيل (${label})`;
        }
        if (!trackText || !toggleBtn) return;

        if (isEnabled) {
            if (barLabel) barLabel.innerText = 'التركيز:';
            trackText.innerText = label;
            if (trackBtn) {
                trackBtn.className = 'px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 border border-white/20 text-white font-medium flex items-center gap-1.5 transition text-xs';
            }
            if (toggleText) toggleText.innerText = 'عرض الكل';
            toggleBtn.className = 'px-2.5 py-1 rounded-lg bg-transparent hover:bg-white/5 border border-white/10 text-gray-400 hover:text-white text-xs transition';
        } else {
            if (barLabel) barLabel.innerText = 'التركيز:';
            trackText.innerText = 'عرض شامل (الكل)';
            if (trackBtn) {
                trackBtn.className = 'px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-gray-400 font-medium flex items-center gap-1.5 transition text-xs';
            }
            if (toggleText) toggleText.innerText = `تفعيل التركيز (${label})`;
            toggleBtn.className = 'px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 border border-white/20 text-gray-200 hover:text-white text-xs transition';
        }
    },

    refreshCurrentTab() {
        if (!this.currentTab) return;
        if (this.currentTab === 'subjects') {
            this.loadSubjects();
        } else if (this.currentTab === 'classes') {
            this.loadClasses();
        } else if (this.currentTab === 'events') {
            if (this.eventsData && Array.isArray(this.eventsData)) {
                if (this.focusMode && this.focusMode.enabled) {
                    const scopeEl = document.getElementById('evt-filter-scope');
                    const yearEl = document.getElementById('evt-filter-year');
                    if (scopeEl) scopeEl.value = this.focusMode.specialty;
                    if (yearEl) yearEl.value = this.focusMode.year;
                } else {
                    const scopeEl = document.getElementById('evt-filter-scope');
                    const yearEl = document.getElementById('evt-filter-year');
                    if (scopeEl) scopeEl.value = 'all';
                    if (yearEl) yearEl.value = 'all';
                }
                this.renderEvents();
            } else {
                this.loadEvents();
            }
        } else if (this.currentTab === 'announcements') {
            if (this.announcementsData && Array.isArray(this.announcementsData)) {
                if (this.focusMode && this.focusMode.enabled) {
                    const filterSpec = document.getElementById('ann-filter-spec');
                    const filterYear = document.getElementById('ann-filter-year');
                    const filterSem = document.getElementById('ann-filter-sem');
                    if (filterSpec) {
                        filterSpec.value = this.focusMode.specialty;
                        this.updateYearOptions('ann-filter-spec', 'ann-filter-year');
                    }
                    if (filterYear) filterYear.value = this.focusMode.year;
                    if (filterSem) filterSem.value = this.focusMode.semester;
                } else {
                    const filterSpec = document.getElementById('ann-filter-spec');
                    const filterYear = document.getElementById('ann-filter-year');
                    const filterSem = document.getElementById('ann-filter-sem');
                    if (filterSpec) {
                        filterSpec.value = 'all';
                        this.updateYearOptions('ann-filter-spec', 'ann-filter-year');
                    }
                    if (filterYear) filterYear.value = 'all';
                    if (filterSem) filterSem.value = 'all';
                }
                this.renderAnnouncements();
            } else {
                this.loadAnnouncements();
            }
        } else if (this.currentTab === 'quizzes') {
            if (this.quizzesData && Array.isArray(this.quizzesData)) {
                this.renderQuizzesTable(this.quizzesData);
            } else {
                this.loadQuizzes();
            }
        } else if (this.currentTab === 'cache') {
            // Reload from the server so a focus change also picks up repaired
            // subject metadata and freshly scanned pending files.
            this.loadCacheStats();
        }
    },

    toggleFocusPopover() {
        const pop = document.getElementById('focus-track-popover');
        if (!pop) return;
        const isHidden = pop.classList.contains('hidden');
        if (isHidden) {
            this.openFocusPopover();
        } else {
            this.closeFocusPopover();
        }
    },

    openFocusPopover() {
        const pop = document.getElementById('focus-track-popover');
        const caret = document.getElementById('focus-caret-icon');
        if (!pop) return;

        const specEl = document.getElementById('pop-focus-spec');
        const semEl = document.getElementById('pop-focus-sem');
        if (specEl) specEl.value = this.focusMode.specialty;
        this.updateYearOptions('pop-focus-spec', 'pop-focus-year');
        const yearEl = document.getElementById('pop-focus-year');
        if (yearEl) yearEl.value = this.focusMode.year;
        if (semEl) semEl.value = this.focusMode.semester;

        pop.classList.remove('hidden');
        if (caret) caret.classList.add('rotate-180');
    },

    closeFocusPopover() {
        const pop = document.getElementById('focus-track-popover');
        const caret = document.getElementById('focus-caret-icon');
        if (pop) pop.classList.add('hidden');
        if (caret) caret.classList.remove('rotate-180');
    },

    onFocusPopoverSpecChange() {
        this.updateYearOptions('pop-focus-spec', 'pop-focus-year');
    },

    quickSetFocusPreset(spec, year, sem) {
        this.setFocusTrack(spec, year, sem);
        this.closeFocusPopover();
    },

    applyFocusFromPopover() {
        const specEl = document.getElementById('pop-focus-spec');
        const yearEl = document.getElementById('pop-focus-year');
        const semEl = document.getElementById('pop-focus-sem');
        if (!specEl || !yearEl || !semEl) return;
        const spec = specEl.value;
        const year = yearEl.value;
        const sem = semEl.value;
        this.setFocusTrack(spec, year, sem);
        this.closeFocusPopover();
    },

    openMobileTrackSheet() {
        const sheet = document.getElementById('mobile-track-sheet');
        if (!sheet) return;
        const specEl = document.getElementById('mobile-sheet-spec');
        const semEl = document.getElementById('mobile-sheet-sem');
        if (specEl) specEl.value = this.focusMode.specialty;
        this.updateYearOptions('mobile-sheet-spec', 'mobile-sheet-year');
        const yearEl = document.getElementById('mobile-sheet-year');
        if (yearEl) yearEl.value = this.focusMode.year;
        if (semEl) semEl.value = this.focusMode.semester;

        const toggleText = document.getElementById('mobile-sheet-toggle-text');
        if (toggleText) {
            const isEnabled = this.focusMode && this.focusMode.enabled;
            const label = this.getTrackLabel(this.focusMode.specialty, this.focusMode.year, this.focusMode.semester);
            toggleText.innerText = isEnabled ? 'عرض شامل (الكل)' : `تفعيل (${label})`;
        }

        sheet.classList.remove('hidden');
        document.body.classList.add('overflow-hidden');
    },

    closeMobileTrackSheet() {
        const sheet = document.getElementById('mobile-track-sheet');
        if (sheet) sheet.classList.add('hidden');
        const hasOpenModal = document.querySelector('[id$="-modal"]:not(.hidden)');
        if (!hasOpenModal && !document.getElementById('mobile-drawer')?.classList.contains('translate-x-0')) {
            document.body.classList.remove('overflow-hidden');
        }
    },

    onMobileTrackSheetSpecChange() {
        this.updateYearOptions('mobile-sheet-spec', 'mobile-sheet-year');
    },

    applyMobileTrackSheet() {
        const specEl = document.getElementById('mobile-sheet-spec');
        const yearEl = document.getElementById('mobile-sheet-year');
        const semEl = document.getElementById('mobile-sheet-sem');
        if (!specEl || !yearEl || !semEl) return;
        this.setFocusTrack(specEl.value, yearEl.value, semEl.value);
        this.closeMobileTrackSheet();
    },

    // --- TAB 1: PASSWORDS & ACCESS ---

    loadPasswords() {
        const hasCached = Array.isArray(this.passwordsData) && this.passwordsData.length > 0;
        if (hasCached) {
            this.renderPasswords();
        } else {
            this.showLoading(true);
        }

        fetch(API_BASE + '/dent2025_api.php?action=get_passwords', {
            method: 'POST',
            body: JSON.stringify({ password: this.pass })
        })
        .then(r => r.json())
        .then(res => {
            if (!hasCached) this.showLoading(false);
            if (res.success && Array.isArray(res.data)) {
                this.passwordsData = res.data;
                this.renderPasswords();
            } else if (!hasCached) {
                this.showToast(res.message || 'فشل تحميل كلمات المرور', true);
            }
        })
        .catch(e => {
            if (!hasCached) {
                this.showLoading(false);
                console.error('loadPasswords error:', e);
                this.showToast('خطأ في الاتصال بالخادم', true);
            }
        });
    },

    toggleKeyVisibility(id) {
        this.visibleKeys[id] = !this.visibleKeys[id];
        this.renderPasswords();
    },

    renderPasswords() {
        const container = document.getElementById('passwords-list');
        if (!container) return;
        if (!this.passwordsData || this.passwordsData.length === 0) {
            container.innerHTML = '<p class="text-gray-400">لا توجد كلمات مرور مسجلة حالياً.</p>';
            return;
        }

        const permLabels = {
            add_subject: 'إضافة مواد',
            delete_subject: 'حذف مواد',
            edit_core_subject: 'تعديل الأساسيات',
            edit_basic_subject: 'تعديل المحاضر/الروابط',
            global_events: 'أحداث عامة',
            semester_events: 'أحداث الترم',
            global_announcements: 'إعلانات عامة',
            semester_announcements: 'إعلانات الترم',
            timetable: 'الجداول الدراسية',
            manage_passwords: 'إدارة الصلاحيات'
        };

        let html = '';
        this.passwordsData.forEach(p => {
            const isVisible = !!this.visibleKeys[p.id];
            const passDisplay = isVisible ? p.passkey : '••••••••••••';
            const allowedCtx = Array.isArray(p.allowed_contexts) ? p.allowed_contexts.join(', ') : '*';
            
            const safeId = this.escapeHtml(p.id);
            const safeLabel = this.escapeHtml(p.label || 'بدون عنوان');
            const safePassDisplay = this.escapeHtml(passDisplay);
            const safeAllowedCtx = this.escapeHtml(allowedCtx);
            
            let permBadges = '';
            const perms = p.permissions || {};
            for (let [k, label] of Object.entries(permLabels)) {
                const active = !!perms[k];
                const safePermLabel = this.escapeHtml(label);
                if (active) {
                    permBadges += `<span class="bg-gray-500/20 text-gray-300 border border-gray-500/30 px-2 py-0.5 rounded text-xs">${safePermLabel}</span> `;
                } else {
                    permBadges += `<span class="bg-gray-800/50 text-gray-500 border border-gray-700 px-2 py-0.5 rounded text-xs opacity-50">${safePermLabel}</span> `;
                }
            }

            html += `
                <div class="bg-black/30 p-5 rounded-xl border border-white/10 relative hover:border-white/20 transition">
                    <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-3 border-b border-white/5 pb-3">
                        <div>
                            <div class="flex items-center gap-3">
                                <h3 class="text-lg font-bold text-white">${safeLabel}</h3>
                                <span class="bg-primary/20 text-accent font-mono text-xs px-2 py-0.5 rounded border border-primary/30">${safeId}</span>
                            </div>
                            <div class="flex items-center gap-2 mt-2">
                                <span class="text-xs text-gray-400">كلمة المرور:</span>
                                <code class="bg-black/50 text-gray-300 px-3 py-1 rounded text-sm font-mono tracking-widest border border-white/10">${safePassDisplay}</code>
                                <button onclick="AdminApp.toggleKeyVisibility('${safeId}')" class="text-xs text-gray-300 hover:text-white px-2 py-1 bg-white/5 rounded border border-white/10">
                                    ${isVisible ? 'إخفاء' : 'إظهار'}
                                </button>
                            </div>
                        </div>
                        <div class="flex items-center gap-2">
                            <button onclick="AdminApp.editPassword('${safeId}')" class="btn btn-secondary text-xs py-1 px-3">تعديل</button>
                            <button onclick="AdminApp.deletePassword('${safeId}')" class="btn btn-danger text-xs py-1 px-3">حذف</button>
                        </div>
                    </div>
                    
                    <div class="space-y-2 text-xs">
                        <div class="flex items-center gap-2">
                            <span class="text-gray-400">السياقات المسموحة:</span>
                            <span class="bg-white/10 text-gray-200 px-2 py-0.5 rounded font-mono border border-white/20">${safeAllowedCtx}</span>
                        </div>
                        <div>
                            <span class="text-gray-400 block mb-1">الصلاحيات الممنوحة:</span>
                            <div class="flex flex-wrap gap-1.5">${permBadges}</div>
                        </div>
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;
    },

    openPasswordModal() {
        document.getElementById('pass-id').value = '';
        document.getElementById('pass-label').value = '';
        document.getElementById('pass-key').value = '';
        document.getElementById('pass-contexts').value = '*';
        document.getElementById('pass-modal-title').innerText = 'إضافة كلمة مرور جديدة';

        const permKeys = ['add_subject', 'delete_subject', 'edit_core_subject', 'edit_basic_subject', 'global_events', 'semester_events', 'global_announcements', 'semester_announcements', 'timetable', 'manage_passwords'];
        permKeys.forEach(k => {
            const chk = document.getElementById(`perm-${k}`);
            if (chk) chk.checked = false;
        });

        this.openModal('password-modal');
    },

    editPassword(id) {
        const p = (this.passwordsData || []).find(item => item.id === id);
        if (!p) return;

        document.getElementById('pass-id').value = p.id;
        document.getElementById('pass-label').value = p.label || '';
        document.getElementById('pass-key').value = p.passkey || '';
        document.getElementById('pass-contexts').value = Array.isArray(p.allowed_contexts) ? p.allowed_contexts.join(', ') : (p.allowed_contexts || '*');
        document.getElementById('pass-modal-title').innerText = `تعديل كلمة المرور: ${p.label || p.id}`;

        const perms = p.permissions || {};
        const permKeys = ['add_subject', 'delete_subject', 'edit_core_subject', 'edit_basic_subject', 'global_events', 'semester_events', 'global_announcements', 'semester_announcements', 'timetable', 'manage_passwords'];
        permKeys.forEach(k => {
            const chk = document.getElementById(`perm-${k}`);
            if (chk) chk.checked = !!perms[k];
        });

        this.openModal('password-modal');
    },

    savePassword() {
        const id = document.getElementById('pass-id').value.trim();
        const label = document.getElementById('pass-label').value.trim();
        const passkey = document.getElementById('pass-key').value.trim();
        const contextsRaw = document.getElementById('pass-contexts').value.trim();

        if (!passkey) {
            this.showToast('يرجى إدخال رمز كلمة المرور (Passkey)', true);
            return;
        }

        let allowed_contexts = ['*'];
        if (contextsRaw && contextsRaw !== '*') {
            allowed_contexts = contextsRaw.split(',').map(s => s.trim()).filter(Boolean);
        }

        const permissions = {};
        const permKeys = ['add_subject', 'delete_subject', 'edit_core_subject', 'edit_basic_subject', 'global_events', 'semester_events', 'global_announcements', 'semester_announcements', 'timetable', 'manage_passwords'];
        permKeys.forEach(k => {
            const chk = document.getElementById(`perm-${k}`);
            permissions[k] = chk ? chk.checked : false;
        });

        const entry = {
            id: id || ('pass_' + Math.random().toString(36).substring(2, 9)),
            label: label || 'كلمة مرور جديدة',
            passkey: passkey,
            allowed_contexts: allowed_contexts,
            permissions: permissions
        };

        this.showLoading(true);
        fetch(API_BASE + '/dent2025_api.php?action=save_password', {
            method: 'POST',
            body: JSON.stringify({
                password: this.pass,
                entry: entry
            })
        })
        .then(r => r.json())
        .then(res => {
            this.showLoading(false);
            if (res.success) {
                this.showToast('تم حفظ كلمة المرور والصلاحيات بنجاح');
                this.closeModal('password-modal');
                this.loadPasswords();
            } else {
                this.showToast(res.message || 'فشل حفظ كلمة المرور', true);
            }
        })
        .catch(e => {
            this.showLoading(false);
            console.error('savePassword error:', e);
            this.showToast('خطأ في الاتصال بالخادم', true);
        });
    },

    deletePassword(id) {
        if (!confirm('هل أنت متأكد من حذف كلمة المرور هذه؟ سيؤدي ذلك لقطع صلاحيات صاحب المفتاح.')) return;

        this.showLoading(true);
        fetch(API_BASE + '/dent2025_api.php?action=delete_password', {
            method: 'POST',
            body: JSON.stringify({
                password: this.pass,
                id: id
            })
        })
        .then(r => r.json())
        .then(res => {
            this.showLoading(false);
            if (res.success) {
                this.showToast('تم حذف كلمة المرور');
                this.loadPasswords();
            } else {
                this.showToast(res.message || 'فشل حذف كلمة المرور', true);
            }
        })
        .catch(e => {
            this.showLoading(false);
            console.error('deletePassword error:', e);
            this.showToast('خطأ في الاتصال بالخادم', true);
        });
    },

    // --- TAB 2: EVENTS ---

    // --- TAB 2: EVENTS ---

    onEventFilterChange() {
        this.renderEvents();
    },

    toggleEventTargetFields() {
        const isGlobal = document.getElementById('evt-is-global') ? document.getElementById('evt-is-global').checked : false;
        const targetFields = document.getElementById('evt-target-fields');
        if (targetFields) {
            if (isGlobal) {
                targetFields.classList.add('hidden');
            } else {
                targetFields.classList.remove('hidden');
            }
        }
        this.updateEventAudiencePreview();
    },

    updateEventAudiencePreview() {
        const audienceText = document.getElementById('evt-audience-text');
        const audiencePill = document.getElementById('evt-audience-pill');
        if (!audienceText) return;

        const isGlobal = document.getElementById('evt-is-global') ? document.getElementById('evt-is-global').checked : false;

        if (isGlobal) {
            audienceText.innerText = 'الفئة المستهدفة: جميع الدفعات والتخصصات (حدث عام)';
            if (audiencePill) {
                audiencePill.className = 'text-xs bg-gray-500/10 border border-gray-500/30 text-gray-200 px-3 py-1.5 rounded-lg flex items-center gap-2';
            }
        } else {
            const specEl = document.getElementById('evt-entry-spec');
            const yearEl = document.getElementById('evt-entry-year');
            const semEl = document.getElementById('evt-entry-sem');

            const specNames = { 'dentistry': 'طب الأسنان', 'medicine': 'الطب البشري', 'pre-med': 'السنة التحضيرية' };
            const spec = specEl ? specEl.value : 'dentistry';
            const year = yearEl ? yearEl.value : '2';
            const sem = semEl ? semEl.value : '1';

            const name = specNames[spec] || spec;
            const yearLabel = (spec === 'pre-med') ? 'سنة 1 (تحضيري)' : `سنة ${year}`;
            
            audienceText.innerText = `الفئة المستهدفة: ${name} | ${yearLabel} | الترم ${sem}`;
            if (audiencePill) {
                audiencePill.className = 'text-xs bg-gray-500/10 border border-gray-500/30 text-gray-200 px-3 py-1.5 rounded-lg flex items-center gap-2';
            }
        }
    },

    loadEvents() {
        if (this.focusMode && this.focusMode.enabled) {
            const scopeEl = document.getElementById('evt-filter-scope');
            const yearEl = document.getElementById('evt-filter-year');
            if (scopeEl) scopeEl.value = this.focusMode.specialty;
            if (yearEl) yearEl.value = this.focusMode.year;
        } else {
            const scopeEl = document.getElementById('evt-filter-scope');
            const yearEl = document.getElementById('evt-filter-year');
            if (scopeEl) scopeEl.value = 'all';
            if (yearEl) yearEl.value = 'all';
        }

        const hasCached = Array.isArray(this.eventsData) && this.eventsData.length > 0;
        if (hasCached) {
            this.renderEvents();
        } else {
            this.showLoading(true);
        }

        fetch(`${API_BASE}/schedule_backend.php?schedule_id=all&_t=${Date.now()}`)
        .then(r => r.json())
        .then(res => {
            if (!hasCached) this.showLoading(false);
            if (res.success && Array.isArray(res.data)) {
                this.eventsData = res.data;
                this.renderEvents();
            } else if (!hasCached) {
                this.showToast(res.message || 'فشل تحميل الأحداث', true);
            }
        })
        .catch(e => {
            if (!hasCached) {
                this.showLoading(false);
                console.error('loadEvents error:', e);
                this.showToast('خطأ في الاتصال بالخادم', true);
            }
        });
    },

    renderEvents() {
        const container = document.getElementById('events-list');
        if (!container) return;

        const rawEvents = this.eventsData || [];
        const todayStr = new Date().toISOString().split('T')[0];

        // 1. Calculate Stats
        let totalCount = rawEvents.length;
        let globalCount = 0;
        let examCount = 0;
        let holidayCount = 0;
        let upcomingCount = 0;

        rawEvents.forEach(ev => {
            if (ev.is_global) globalCount++;
            if (ev.type === 'exam') examCount++;
            if (ev.type === 'holiday') holidayCount++;

            const end = ev.end_date || ev.date;
            if (end >= todayStr) upcomingCount++;
        });

        if (document.getElementById('evt-stat-total')) document.getElementById('evt-stat-total').innerText = totalCount;
        if (document.getElementById('evt-stat-global')) document.getElementById('evt-stat-global').innerText = globalCount;
        if (document.getElementById('evt-stat-exams')) document.getElementById('evt-stat-exams').innerText = examCount;
        if (document.getElementById('evt-stat-holidays')) document.getElementById('evt-stat-holidays').innerText = holidayCount;
        if (document.getElementById('evt-stat-upcoming')) document.getElementById('evt-stat-upcoming').innerText = upcomingCount;

        // 2. Read Filter Values
        const scopeFilter = document.getElementById('evt-filter-scope') ? document.getElementById('evt-filter-scope').value : 'all';
        const yearFilter = document.getElementById('evt-filter-year') ? document.getElementById('evt-filter-year').value : 'all';
        const typeFilter = document.getElementById('evt-filter-type') ? document.getElementById('evt-filter-type').value : 'all';
        const searchQuery = document.getElementById('evt-search-input') ? document.getElementById('evt-search-input').value.trim().toLowerCase() : '';

        // 3. Filter Events
        const filteredEvents = rawEvents.filter(ev => {
            if (this.focusMode && this.focusMode.enabled) {
                // Keep all global events
                if (ev.is_global) {
                    if (typeFilter !== 'all' && ev.type !== typeFilter) return false;
                    if (searchQuery) {
                        const titleStr = (ev.title || '').toLowerCase();
                        const dateStr = (ev.date || '').toLowerCase();
                        const hijriStr = (ev.hijri || '').toLowerCase();
                        if (!titleStr.includes(searchQuery) && !dateStr.includes(searchQuery) && !hijriStr.includes(searchQuery)) {
                            return false;
                        }
                    }
                    return true;
                }

                // Non-global events: specialty must match
                if (ev.specialty && ev.specialty !== this.focusMode.specialty) return false;

                // Year must match
                const fYear = String(this.focusMode.year);
                const isPreMed = (this.focusMode.specialty === 'pre-med');
                const matchesYear = String(ev.year) === fYear || 
                    (isPreMed && (ev.specialty === 'pre-med' || ev.year === 0 || ev.year === 1));
                if (!matchesYear) return false;

                // Semester match if specified
                if (ev.semester && String(ev.semester) !== String(this.focusMode.semester)) return false;

                // Type Filter
                if (typeFilter !== 'all' && ev.type !== typeFilter) return false;

                // Search Query
                if (searchQuery) {
                    const titleStr = (ev.title || '').toLowerCase();
                    const dateStr = (ev.date || '').toLowerCase();
                    const hijriStr = (ev.hijri || '').toLowerCase();
                    if (!titleStr.includes(searchQuery) && !dateStr.includes(searchQuery) && !hijriStr.includes(searchQuery)) {
                        return false;
                    }
                }
                return true;
            }

            // Normal Filtering (when Focus Mode is OFF)
            // Scope Filter
            if (scopeFilter === 'global' && !ev.is_global) return false;
            if (scopeFilter === 'dentistry' && ev.specialty !== 'dentistry' && !ev.is_global) return false;
            if (scopeFilter === 'medicine' && ev.specialty !== 'medicine' && !ev.is_global) return false;
            if (scopeFilter === 'pre-med' && ev.specialty !== 'pre-med' && !ev.is_global) return false;

            // Year Filter
            if (yearFilter !== 'all' && !ev.is_global) {
                const matchesYear = String(ev.year) === String(yearFilter) || 
                    ((yearFilter === '0' || yearFilter === '1') && (ev.specialty === 'pre-med' || ev.year === 0 || ev.year === 1));
                if (!matchesYear) return false;
            }

            // Type Filter
            if (typeFilter !== 'all' && ev.type !== typeFilter) return false;

            // Search Query
            if (searchQuery) {
                const titleStr = (ev.title || '').toLowerCase();
                const dateStr = (ev.date || '').toLowerCase();
                const hijriStr = (ev.hijri || '').toLowerCase();
                if (!titleStr.includes(searchQuery) && !dateStr.includes(searchQuery) && !hijriStr.includes(searchQuery)) {
                    return false;
                }
            }

            return true;
        });

        if (filteredEvents.length === 0) {
            container.innerHTML = `
                <div class="p-12 text-center text-gray-400 glass rounded-2xl">
                    <span class="text-4xl block mb-3"></span>
                    <h3 class="text-xl font-bold mb-1 text-white">لا توجد أحداث مطابقة</h3>
                    <p class="text-xs">جرب تغيير خيارات التصفية أو كلمة البحث للأحداث.</p>
                </div>
            `;
            return;
        }

        // 4. Categorize Events
        const categories = {
            global: { title: 'الأحداث العامة (Global Events)', events: [], icon: '' },
            'pre-med': { title: 'السنة التحضيرية (Pre-Med)', events: [], icon: '' },
            dentistry: { title: 'طب الأسنان (Dentistry)', events: [], icon: '' },
            medicine: { title: 'الطب البشري (Medicine)', events: [], icon: '' },
            other_batches: { title: 'أحداث الدفعات الأخرى', events: [], icon: '' }
        };

        filteredEvents.forEach(ev => {
            if (ev.is_global || ev.schedule_id === 'global') {
                categories.global.events.push(ev);
            } else if (ev.specialty === 'pre-med') {
                categories['pre-med'].events.push(ev);
            } else if (ev.specialty === 'dentistry') {
                categories.dentistry.events.push(ev);
            } else if (ev.specialty === 'medicine') {
                categories.medicine.events.push(ev);
            } else {
                categories.other_batches.events.push(ev);
            }
        });

        const typeBadges = {
            start: '<span class="text-sky-300 border border-sky-500/20 px-2 py-0.5 rounded text-xs">بداية ترم</span>',
            exam: '<span class="text-rose-300 border border-rose-500/20 px-2 py-0.5 rounded text-xs font-semibold">اختبارات</span>',
            holiday: '<span class="text-emerald-300 border border-emerald-500/20 px-2 py-0.5 rounded text-xs">إجازة رسمية</span>',
            payment: '<span class="text-amber-300 border border-amber-500/20 px-2 py-0.5 rounded text-xs">مكافآت / رسوم</span>',
            other: '<span class="text-gray-300 border border-gray-500/20 px-2 py-0.5 rounded text-xs">حدث آخر</span>'
        };

        let html = '';

        for (let [catKey, catObj] of Object.entries(categories)) {
            if (catObj.events.length === 0) continue;

            html += `
                <div class="space-y-3">
                    <div class="flex items-center gap-3 border-b border-white/10 pb-2">
                        <h3 class="text-lg font-bold text-white flex items-center gap-2">
                            <span>${catObj.title}</span>
                            <span class="bg-white/10 text-gray-300 text-xs px-2.5 py-0.5 rounded-full font-mono">${catObj.events.length}</span>
                        </h3>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            `;

            catObj.events.forEach(ev => {
                const dateStr = ev.date || '';
                const endDateStr = ev.end_date || '';

                let statusBadge = '<span class="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded text-xs">قادم</span>';

                if (endDateStr) {
                    if (todayStr < dateStr) {
                        statusBadge = '<span class="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded text-xs">قادم</span>';
                    } else if (todayStr >= dateStr && todayStr <= endDateStr) {
                        statusBadge = '<span class="bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded text-xs font-bold animate-pulse">اليوم / جاري</span>';
                    } else {
                        statusBadge = '<span class="bg-gray-500/20 text-gray-400 border border-gray-500/30 px-2 py-0.5 rounded text-xs">منتهي</span>';
                    }
                } else {
                    if (todayStr < dateStr) {
                        statusBadge = '<span class="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded text-xs">قادم</span>';
                    } else if (todayStr === dateStr) {
                        statusBadge = '<span class="bg-gray-500/20 text-gray-300 border border-gray-500/30 px-2 py-0.5 rounded text-xs font-bold animate-pulse">اليوم</span>';
                    } else {
                        statusBadge = '<span class="bg-gray-500/20 text-gray-400 border border-gray-500/30 px-2 py-0.5 rounded text-xs">منتهي</span>';
                    }
                }

                const isGlobal = !!ev.is_global || ev.schedule_id === 'global';

                let targetBadge = '';
                if (isGlobal) {
                    targetBadge = '<span class="bg-gray-500/20 text-gray-300 border border-gray-500/30 px-2 py-0.5 rounded text-xs">عام (Global)</span>';
                } else {
                    const specNames = { 'dentistry': 'أسنان', 'medicine': 'بشري', 'pre-med': 'تحضيري' };
                    const specTxt = this.escapeHtml(specNames[ev.specialty] || ev.specialty || '');
                    const yearTxt = this.escapeHtml(ev.specialty === 'pre-med' ? 'سنة 1' : (ev.year ? `سنة ${ev.year}` : ''));
                    const semTxt = this.escapeHtml(ev.semester ? `ترم ${ev.semester}` : '');
                    targetBadge = `<span class="bg-white/10 text-gray-200 border border-white/20 px-2 py-0.5 rounded text-xs font-semibold">${specTxt} | ${yearTxt} | ${semTxt}</span>`;
                }

                const schedIdAttr = ev.schedule_id || (isGlobal ? 'global' : '');
                const safeEvId = this.escapeHtml(ev.id);
                const safeSchedId = this.escapeHtml(schedIdAttr);
                const safeTitle = this.escapeHtml(ev.title || 'بدون عنوان');
                const safeDateStr = this.escapeHtml(dateStr);
                const safeEndDateStr = endDateStr ? this.escapeHtml(endDateStr) : '';
                const safeHijri = ev.hijri ? this.escapeHtml(ev.hijri) : '';

                html += `
                    <div class="bg-black/30 p-4 rounded-xl border border-white/10 flex flex-col justify-between hover:border-white/20 transition">
                        <div>
                            <div class="flex justify-between items-start mb-2 gap-2 flex-wrap">
                                ${typeBadges[ev.type] || typeBadges['other']}
                                <div class="flex items-center gap-1 flex-wrap">
                                    ${targetBadge}
                                    ${statusBadge}
                                </div>
                            </div>
                            <h4 class="text-base font-bold text-white mb-2 break-words">${safeTitle}</h4>
                            <div class="text-xs text-gray-400 space-y-1 mb-4">
                                <div>التاريخ: <span class="text-gray-200 font-mono">${safeDateStr}${safeEndDateStr ? ' إلى ' + safeEndDateStr : ''}</span></div>
                                ${safeHijri ? `<div> الهجري: <span class="text-gray-300 font-mono">${safeHijri}</span></div>` : ''}
                            </div>
                        </div>
                        <div class="flex justify-end gap-2 border-t border-white/5 pt-3">
                            <button onclick="AdminApp.editEvent('${safeEvId}')" class="text-xs text-gray-300 hover:text-white px-2.5 py-1 bg-white/5 rounded border border-white/10">تعديل</button>
                            <button onclick="AdminApp.deleteEvent('${safeEvId}', '${safeSchedId}')" class="text-xs text-gray-400 hover:text-gray-300 px-2.5 py-1 bg-white/5 rounded border border-white/10">حذف</button>
                        </div>
                    </div>
                `;
            });

            html += `
                    </div>
                </div>
            `;
        }

        container.innerHTML = html;
    },

    openEventModal() {
        document.getElementById('evt-id').value = '';
        document.getElementById('evt-title').value = '';
        document.getElementById('evt-type').value = 'start';
        document.getElementById('evt-date').value = new Date().toISOString().split('T')[0];
        document.getElementById('evt-end-date').value = '';
        document.getElementById('evt-hijri').value = '';
        
        const scopeSelect = document.getElementById('evt-filter-scope');
        const scope = scopeSelect ? scopeSelect.value : 'all';

        const isGlobalChk = document.getElementById('evt-is-global');
        if (isGlobalChk) {
            isGlobalChk.checked = (scope === 'global');
        }

        if (this.focusMode && this.focusMode.enabled) {
            if (isGlobalChk) isGlobalChk.checked = false;
            if (document.getElementById('evt-entry-spec')) {
                document.getElementById('evt-entry-spec').value = this.focusMode.specialty;
                this.updateYearOptions('evt-entry-spec', 'evt-entry-year');
            }
            if (document.getElementById('evt-entry-year')) {
                document.getElementById('evt-entry-year').value = this.focusMode.year;
            }
            if (document.getElementById('evt-entry-sem')) {
                document.getElementById('evt-entry-sem').value = this.focusMode.semester;
            }
        } else if (document.getElementById('evt-entry-spec')) {
            if (scope === 'dentistry' || scope === 'medicine' || scope === 'pre-med') {
                document.getElementById('evt-entry-spec').value = scope;
            } else {
                document.getElementById('evt-entry-spec').value = 'dentistry';
            }
            this.updateYearOptions('evt-entry-spec', 'evt-entry-year');
        }

        this.toggleEventTargetFields();
        document.getElementById('event-modal-title').innerText = 'إضافة حدث جديد';
        this.openModal('event-modal');
    },

    editEvent(id) {
        const ev = (this.eventsData || []).find(item => item.id === id);
        if (!ev) return;

        document.getElementById('evt-id').value = ev.id;
        document.getElementById('evt-title').value = ev.title || '';
        document.getElementById('evt-type').value = ev.type || 'other';
        document.getElementById('evt-date').value = ev.date || '';
        document.getElementById('evt-end-date').value = ev.end_date || '';
        document.getElementById('evt-hijri').value = ev.hijri || '';

        const isGlobal = !!ev.is_global || ev.schedule_id === 'global';
        const isGlobalChk = document.getElementById('evt-is-global');
        if (isGlobalChk) isGlobalChk.checked = isGlobal;

        if (!isGlobal) {
            const spec = ev.specialty || 'dentistry';
            const year = ev.year || (spec === 'pre-med' ? 1 : 2);
            const sem = ev.semester || 1;

            if (document.getElementById('evt-entry-spec')) document.getElementById('evt-entry-spec').value = spec;
            this.updateYearOptions('evt-entry-spec', 'evt-entry-year');
            if (document.getElementById('evt-entry-year')) document.getElementById('evt-entry-year').value = year;
            if (document.getElementById('evt-entry-sem')) document.getElementById('evt-entry-sem').value = sem;
        }

        this.toggleEventTargetFields();
        document.getElementById('event-modal-title').innerText = `تعديل الحدث: ${ev.title || ev.id}`;
        this.openModal('event-modal');
    },

    saveEvent() {
        const id = document.getElementById('evt-id').value.trim();
        const title = document.getElementById('evt-title').value.trim();
        const type = document.getElementById('evt-type').value;
        const date = document.getElementById('evt-date').value;
        const endDate = document.getElementById('evt-end-date').value;
        const hijri = document.getElementById('evt-hijri').value.trim();
        const isGlobal = document.getElementById('evt-is-global').checked;

        if (!title || !date) {
            this.showToast('يرجى إدخال عنوان الحدث وتاريخ البداية', true);
            return;
        }

        let scheduleId = 'global';

        let payload = {
            password: this.pass,
            action: id ? 'edit' : 'add',
            id: id || ('evt_' + Math.random().toString(36).substring(2, 9)),
            title: title,
            type: type,
            date: date,
            end_date: endDate || null,
            hijri: hijri,
            is_global: isGlobal
        };

        if (!isGlobal) {
            const spec = document.getElementById('evt-entry-spec').value;
            const year = document.getElementById('evt-entry-year').value;
            const sem = document.getElementById('evt-entry-sem').value;
            scheduleId = `${spec}_y${year}_s${sem}`;
            payload.specialty = spec;
            payload.year = parseInt(year);
            payload.semester = parseInt(sem);
        }
        payload.schedule_id = scheduleId;

        this.showLoading(true);
        fetch(API_BASE + '/schedule_backend.php', {
            method: 'POST',
            body: JSON.stringify(payload)
        })
        .then(r => r.json())
        .then(res => {
            this.showLoading(false);
            if (res.success) {
                Object.keys(sessionStorage).forEach(k => {
                    if (k.startsWith('dent2025_schedule_') || k.startsWith('dent2025_dashboard_data_')) {
                        sessionStorage.removeItem(k);
                    }
                });
                this.showToast('تم حفظ الحدث بنجاح');
                this.closeModal('event-modal');
                this.loadEvents();
            } else {
                this.showToast(res.message || 'فشل حفظ الحدث', true);
            }
        })
        .catch(e => {
            this.showLoading(false);
            console.error('saveEvent error:', e);
            this.showToast('خطأ في الاتصال بالخادم', true);
        });
    },

    deleteEvent(id, scheduleId) {
        if (!confirm('هل أنت متأكد من حذف هذا الحدث؟')) return;

        const isGlobal = (scheduleId === 'global' || !scheduleId);
        let payload = {
            password: this.pass,
            id: id,
            is_global: isGlobal,
            schedule_id: scheduleId || 'global'
        };

        this.showLoading(true);
        fetch(API_BASE + '/schedule_backend.php', {
            method: 'POST',
            body: JSON.stringify({ ...payload, action: 'delete' })
        })
        .then(r => r.json())
        .then(res => {
            if (!res.success) {
                // Try DELETE method if POST action fails
                return fetch(API_BASE + '/schedule_backend.php', {
                    method: 'DELETE',
                    body: JSON.stringify(payload)
                }).then(r => r.json());
            }
            return res;
        })
        .then(res => {
            this.showLoading(false);
            if (res.success) {
                Object.keys(sessionStorage).forEach(k => {
                    if (k.startsWith('dent2025_schedule_') || k.startsWith('dent2025_dashboard_data_')) {
                        sessionStorage.removeItem(k);
                    }
                });
                this.showToast('تم حذف الحدث');
                this.loadEvents();
            } else {
                this.showToast(res.message || 'فشل حذف الحدث', true);
            }
        })
        .catch(e => {
            this.showLoading(false);
            console.error('deleteEvent error:', e);
            this.showToast('خطأ في الاتصال بالخادم', true);
        });
    },

    // --- TAB 3: SUBJECTS & LINKS ---

    loadSubjects() {
        let spec = 'dentistry';
        let year = '3';
        let sem = '1';

        if (this.focusMode && this.focusMode.enabled) {
            spec = this.focusMode.specialty;
            year = String(this.focusMode.year);
            sem = String(this.focusMode.semester);

            const specEl = document.getElementById('sub-spec');
            const yearEl = document.getElementById('sub-year');
            const semEl = document.getElementById('sub-sem');
            if (specEl) {
                specEl.value = spec;
                this.updateYearOptions('sub-spec', 'sub-year');
            }
            if (yearEl) yearEl.value = year;
            if (semEl) semEl.value = sem;
        } else {
            this.updateYearOptions('sub-spec', 'sub-year');
            const specEl = document.getElementById('sub-spec');
            const yearEl = document.getElementById('sub-year');
            const semEl = document.getElementById('sub-sem');
            if (specEl) spec = specEl.value;
            if (yearEl) year = yearEl.value;
            if (semEl) sem = semEl.value;
        }

        this.showLoading(true);
        fetch(`${API_BASE}/dent2025_api.php?action=data&specialty=${spec}&year=${year}&semester=${sem}&nocache=1`)
        .then(r => r.json())
        .then(res => {
            this.showLoading(false);
            if (res.success && res.data && Array.isArray(res.data.subjects)) {
                this.subjectsData = res.data.subjects;
                this.renderSubjects();
            } else {
                this.showToast(res.message || 'فشل تحميل المواد', true);
            }
        })
        .catch(e => {
            this.showLoading(false);
            console.error('loadSubjects error:', e);
            this.showToast('خطأ في الاتصال بالخادم', true);
        });
    },

    renderSubjects() {
        const container = document.getElementById('subjects-list');
        if (!container) return;

        if (!this.subjectsData || this.subjectsData.length === 0) {
            container.innerHTML = `
                <div class="p-8 text-center text-gray-400">
                    <span class="text-3xl block mb-2"></span>
                    <h3 class="text-lg font-bold mb-1 text-white">لا توجد مواد مسجلة</h3>
                    <p class="text-xs text-gray-400">انقر على "إضافة مادة جديدة" لإضافة أول مادة في هذا الترم.</p>
                </div>
            `;
            return;
        }

        let html = '';

        this.subjectsData.forEach(sub => {
            const links = sub.links || [];
            let linksHtml = '';

            if (links.length > 0) {
                linksHtml = links.map(l => {
                    let icon = '';
                    
                    
                    

                    const safeUrl = this.sanitizeUrl(l.url);
                    const safeTitle = this.escapeHtml(l.title || l.url);
                    const safeLinkId = parseInt(l.id, 10) || 0;

                    return `
                        <div class="flex justify-between items-center bg-black/30 p-2 rounded-lg border border-white/5 text-xs gap-2 min-w-0 overflow-hidden">
                            <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="text-gray-300 hover:text-white flex items-center gap-1.5 min-w-0 flex-1 truncate">
                                <span class="shrink-0">${icon}</span>
                                <span class="truncate min-w-0">${safeTitle}</span>
                            </a>
                            <button onclick="AdminApp.deleteLink(${safeLinkId})" class="text-red-400 hover:text-red-300 text-[11px] px-2 py-0.5 bg-red-500/10 hover:bg-red-500/20 rounded border border-red-500/20 shrink-0">حذف</button>
                        </div>
                    `;
                }).join('');
            } else {
                linksHtml = '<p class="text-[11px] text-gray-500 py-1">لا توجد روابط مساعدة مضافة بعد.</p>';
            }

            const safeSubId = parseInt(sub.id, 10) || 0;
            const safeSubName = this.escapeHtml(sub.name);
            const safeHours = this.escapeHtml(sub.hours || '0');
            const safeMarks = this.escapeHtml(sub.marks || 'غير محدد');
            const safeChapId = this.escapeHtml(sub.chapters_folder_id || 'غير مرتبط');
            const safeMatId = this.escapeHtml(sub.materials_folder_id || 'غير مرتبط');

            html += `
                <div class="bg-black/30 p-3 sm:p-4 rounded-xl border border-white/10 relative hover:border-white/20 transition max-w-full overflow-hidden">
                    <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2.5 mb-3 border-b border-white/5 pb-2.5 w-full min-w-0">
                        <div class="min-w-0 flex-1 w-full">
                            <h3 class="text-base sm:text-lg font-bold text-white leading-snug mb-1.5 break-words max-w-full">${safeSubName}</h3>
                            <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-gray-400 max-w-full">
                                <span class="shrink-0">الساعات: <strong class="text-gray-200 font-mono">${safeHours}</strong></span>
                                <span class="text-gray-600 shrink-0">•</span>
                                <span class="break-words min-w-0">توزيع الدرجات: <strong class="text-gray-200 font-medium break-words">${safeMarks}</strong></span>
                            </div>
                        </div>
                        <div class="grid grid-cols-3 gap-1.5 w-full sm:w-auto shrink-0 pt-1 sm:pt-0">
                            <button onclick="AdminApp.openAddLinkModal(${safeSubId})" class="btn btn-secondary text-xs py-1.5 px-2.5 flex items-center justify-center gap-1">+ رابط</button>
                            <button onclick="AdminApp.openEditSubjectModal(${safeSubId})" class="btn btn-primary text-xs py-1.5 px-2.5 flex items-center justify-center gap-1">تعديل</button>
                            <button onclick="AdminApp.deleteSubject(${safeSubId})" class="btn btn-danger text-xs py-1.5 px-2.5 flex items-center justify-center gap-1">حذف</button>
                        </div>
                    </div>

                    <!-- Mobile Details Accordion Toggle Button -->
                    <button type="button" onclick="AdminApp.toggleSubjectDetails(${safeSubId})" class="text-[11px] text-gray-400 hover:text-white flex items-center justify-between sm:hidden w-full pt-1.5 transition select-none" aria-label="عرض التفاصيل والروابط">
                        <span class="font-medium">التفاصيل والروابط (${links.length})</span>
                        <svg class="w-3.5 h-3.5 transform transition-transform" id="sub-arrow-${safeSubId}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
                        </svg>
                    </button>

                    <!-- Details Container: Collapsible on phone, always visible on tablet/desktop -->
                    <div id="sub-details-${safeSubId}" class="hidden sm:block space-y-2.5 mt-2.5 max-w-full overflow-hidden">
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                            <div class="bg-black/25 p-2 rounded-lg border border-white/5 flex items-center justify-between gap-2 min-w-0 overflow-hidden">
                                <span class="text-gray-400 text-[11px] shrink-0 font-medium">الشباتر:</span>
                                <code class="text-gray-300 font-mono text-[11px] bg-black/40 px-2 py-0.5 rounded select-all truncate border border-white/5 min-w-0 flex-1 text-left" dir="ltr">${safeChapId}</code>
                            </div>
                            <div class="bg-black/25 p-2 rounded-lg border border-white/5 flex items-center justify-between gap-2 min-w-0 overflow-hidden">
                                <span class="text-gray-400 text-[11px] shrink-0 font-medium">التجميعات:</span>
                                <code class="text-gray-300 font-mono text-[11px] bg-black/40 px-2 py-0.5 rounded select-all truncate border border-white/5 min-w-0 flex-1 text-left" dir="ltr">${safeMatId}</code>
                            </div>
                        </div>

                        <div class="max-w-full min-w-0">
                            <h4 class="text-[11px] font-semibold text-gray-400 mb-1.5">الروابط المساعدة والمصادر:</h4>
                            <div class="space-y-1.5 max-w-full min-w-0">${linksHtml}</div>
                        </div>
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;
    },

    toggleSubjectDetails(id) {
        const el = document.getElementById(`sub-details-${id}`);
        const arrow = document.getElementById(`sub-arrow-${id}`);
        if (!el) return;
        const isHidden = el.classList.contains('hidden');
        if (isHidden) {
            el.classList.remove('hidden');
            if (arrow) arrow.classList.add('rotate-180');
        } else {
            el.classList.add('hidden');
            if (arrow) arrow.classList.remove('rotate-180');
        }
    },

    openAddSubjectModal() {
        document.getElementById('add-sub-name').value = '';
        const docEl = document.getElementById('add-sub-doctor');
        if (docEl) docEl.value = '';
        document.getElementById('add-sub-hours').value = '';
        document.getElementById('add-sub-marks').value = '';

        if (this.focusMode && this.focusMode.enabled) {
            const specEl = document.getElementById('sub-spec');
            const yearEl = document.getElementById('sub-year');
            const semEl = document.getElementById('sub-sem');
            if (specEl) {
                specEl.value = this.focusMode.specialty;
                this.updateYearOptions('sub-spec', 'sub-year');
            }
            if (yearEl) yearEl.value = this.focusMode.year;
            if (semEl) semEl.value = this.focusMode.semester;
        }

        const badge = document.getElementById('add-sub-target-badge');
        if (badge) {
            const s = document.getElementById('sub-spec') ? document.getElementById('sub-spec').value : 'dentistry';
            const y = document.getElementById('sub-year') ? document.getElementById('sub-year').value : '3';
            const m = document.getElementById('sub-sem') ? document.getElementById('sub-sem').value : '1';
            badge.innerText = `يضاف إلى: ${this.getTrackLabel(s, y, m)}`;
        }

        this.openModal('add-subject-modal');
    },

    saveNewSubject() {
        const spec = document.getElementById('sub-spec').value;
        const year = parseInt(document.getElementById('sub-year').value);
        const sem = parseInt(document.getElementById('sub-sem').value);

        const name = document.getElementById('add-sub-name').value.trim();
        const hours = document.getElementById('add-sub-hours').value.trim();
        const marks = document.getElementById('add-sub-marks').value.trim();

        if (!name) {
            this.showToast('يرجى إدخال اسم المادة بالإنجليزية', true);
            return;
        }

        this.showLoading(true);
        fetch(API_BASE + '/dent2025_api.php?action=add', {
            method: 'POST',
            body: JSON.stringify({
                password: this.pass,
                specialty: spec,
                year: year,
                semester: sem,
                name: name,
                doctor: '',
                hours: hours,
                marks: marks
            })
        })
        .then(r => r.json())
        .then(res => {
            this.showLoading(false);
            if (res.success) {
                this.showToast('تمت إضافة المادة وإنشاء مجلدات قوقل درايف بنجاح');
                this.closeModal('add-subject-modal');
                this.loadSubjects();
            } else {
                this.showToast(res.message || 'فشل إضافة المادة', true);
            }
        })
        .catch(e => {
            this.showLoading(false);
            console.error('saveNewSubject error:', e);
            this.showToast('خطأ في الاتصال بالخادم', true);
        });
    },

    openEditSubjectModal(subId) {
        const sub = (this.subjectsData || []).find(item => item.id == subId);
        if (!sub) return;

        const hasCore = (this.permissions && (this.permissions.edit_core_subject || this.permissions.manage_passwords));

        const nameEl = document.getElementById('edit-sub-name');
        const chapEl = document.getElementById('edit-sub-chap-folder');
        const matEl = document.getElementById('edit-sub-mat-folder');

        if (nameEl) {
            nameEl.value = sub.name || '';
            nameEl.readOnly = !hasCore;
            if (!hasCore) nameEl.title = 'تعديل اسم المادة متاح لحسابات الماستر والصلاحيات الأساسية فقط';
        }
        if (chapEl) {
            chapEl.value = sub.chapters_folder_id || '';
            chapEl.readOnly = !hasCore;
        }
        if (matEl) {
            matEl.value = sub.materials_folder_id || '';
            matEl.readOnly = !hasCore;
        }

        document.getElementById('edit-sub-id').value = sub.id;
        const hoursEl = document.getElementById('edit-sub-hours');
        if (hoursEl) hoursEl.value = sub.hours || '';
        const marksEl = document.getElementById('edit-sub-marks');
        if (marksEl) marksEl.value = sub.marks || '';

        this.openModal('edit-subject-modal');
    },

    saveEditedSubject() {
        const id = document.getElementById('edit-sub-id').value;
        const nameEl = document.getElementById('edit-sub-name');
        const name = nameEl ? nameEl.value.trim() : '';
        const hoursEl = document.getElementById('edit-sub-hours');
        const hours = hoursEl ? hoursEl.value.trim() : '';
        const marksEl = document.getElementById('edit-sub-marks');
        const marks = marksEl ? marksEl.value.trim() : '';
        const extractId = (str) => {
            if (!str) return '';
            str = str.trim();
            let m = str.match(/folders\/([a-zA-Z0-9_-]+)/);
            if (m) return m[1];
            m = str.match(/id=([a-zA-Z0-9_-]+)/);
            if (m) return m[1];
            m = str.match(/\/d\/([a-zA-Z0-9_-]+)/);
            if (m) return m[1];
            return str;
        };

        const chapEl = document.getElementById('edit-sub-chap-folder');
        const chapters_folder_id = chapEl ? extractId(chapEl.value) : '';
        const matEl = document.getElementById('edit-sub-mat-folder');
        const materials_folder_id = matEl ? extractId(matEl.value) : '';

        if (!id) return;

        this.showLoading(true);
        fetch(API_BASE + '/dent2025_api.php?action=edit', {
            method: 'POST',
            body: JSON.stringify({
                password: this.pass,
                id: id,
                name: name,
                doctor: '',
                hours: hours,
                marks: marks,
                chapters_folder_id: chapters_folder_id,
                materials_folder_id: materials_folder_id
            })
        })
        .then(r => r.json())
        .then(res => {
            this.showLoading(false);
            if (res.success) {
                this.showToast('تم تحديث بيانات المادة بنجاح');
                this.closeModal('edit-subject-modal');
                this.loadSubjects();
            } else {
                this.showToast(res.message || 'فشل تحديث بيانات المادة', true);
            }
        })
        .catch(e => {
            this.showLoading(false);
            console.error('saveEditedSubject error:', e);
            this.showToast('خطأ في الاتصال بالخادم', true);
        });
    },

    deleteSubject(subId) {
        if (!confirm('هل أنت متأكد من حذف هذه المادة وجميع روابطها؟')) return;

        this.showLoading(true);
        fetch(API_BASE + '/dent2025_api.php?action=delete', {
            method: 'POST',
            body: JSON.stringify({
                password: this.pass,
                id: subId
            })
        })
        .then(r => r.json())
        .then(res => {
            this.showLoading(false);
            if (res.success) {
                this.showToast('تم حذف المادة بنجاح');
                this.loadSubjects();
            } else {
                this.showToast(res.message || 'فشل حذف المادة', true);
            }
        })
        .catch(e => {
            this.showLoading(false);
            console.error('deleteSubject error:', e);
            this.showToast('خطأ في الاتصال بالخادم', true);
        });
    },

    openAddLinkModal(subjectId) {
        document.getElementById('link-sub-id').value = subjectId;
        document.getElementById('link-title').value = '';
        document.getElementById('link-url').value = '';

        this.openModal('add-link-modal');
    },

    saveNewLink() {
        const subject_id = document.getElementById('link-sub-id').value;
        const title = document.getElementById('link-title').value.trim();
        const url = document.getElementById('link-url').value.trim();

        if (!title || !url) {
            this.showToast('يرجى إدخال عنوان الرابط ورابط URL', true);
            return;
        }

        this.showLoading(true);
        fetch(API_BASE + '/dent2025_api.php?action=add_link', {
            method: 'POST',
            body: JSON.stringify({
                password: this.pass,
                subject_id: subject_id,
                title: title,
                url: url
            })
        })
        .then(r => r.json())
        .then(res => {
            this.showLoading(false);
            if (res.success) {
                this.showToast('تمت إضافة الرابط بنجاح');
                this.closeModal('add-link-modal');
                this.loadSubjects();
            } else {
                this.showToast(res.message || 'فشل إضافة الرابط', true);
            }
        })
        .catch(e => {
            this.showLoading(false);
            console.error('saveNewLink error:', e);
            this.showToast('خطأ في الاتصال بالخادم', true);
        });
    },

    deleteLink(linkId) {
        if (!confirm('هل أنت متأكد من حذف هذا الرابط؟')) return;

        this.showLoading(true);
        fetch(API_BASE + '/dent2025_api.php?action=delete_link', {
            method: 'POST',
            body: JSON.stringify({
                password: this.pass,
                link_id: linkId
            })
        })
        .then(r => r.json())
        .then(res => {
            this.showLoading(false);
            if (res.success) {
                this.showToast('تم حذف الرابط');
                this.loadSubjects();
            } else {
                this.showToast(res.message || 'فشل حذف الرابط', true);
            }
        })
        .catch(e => {
            this.showLoading(false);
            console.error('deleteLink error:', e);
            this.showToast('خطأ في الاتصال بالخادم', true);
        });
    },

    // --- TAB 4: CLASSES TIMETABLE ---

    loadClasses() {
        let spec = 'dentistry';
        let year = '3';
        let sem = '1';

        if (this.focusMode && this.focusMode.enabled) {
            spec = this.focusMode.specialty;
            year = String(this.focusMode.year);
            sem = String(this.focusMode.semester);

            const specEl = document.getElementById('cls-spec');
            const yearEl = document.getElementById('cls-year');
            const semEl = document.getElementById('cls-sem');
            if (specEl) {
                specEl.value = spec;
                this.updateYearOptions('cls-spec', 'cls-year');
            }
            if (yearEl) yearEl.value = year;
            if (semEl) semEl.value = sem;
        } else {
            this.updateYearOptions('cls-spec', 'cls-year');
            const specEl = document.getElementById('cls-spec');
            const yearEl = document.getElementById('cls-year');
            const semEl = document.getElementById('cls-sem');
            if (specEl) spec = specEl.value;
            if (yearEl) year = yearEl.value;
            if (semEl) sem = semEl.value;
        }

        const targetCohort = `${spec}_${year}_${sem}`;
        const hasCached = Array.isArray(this.classesData) && this.classesData.length > 0 && this._classesCohort === targetCohort;
        if (hasCached) {
            this.renderClasses();
        } else {
            this.showLoading(true);
        }

        fetch(`${API_BASE}/dent2025_api.php?action=get_classes&specialty=${spec}&year=${year}&semester=${sem}`)
        .then(r => r.json())
        .then(res => {
            if (!hasCached) this.showLoading(false);
            if (res.success && Array.isArray(res.data)) {
                this.classesData = res.data;
                this._classesCohort = targetCohort;
                this.renderClasses();
            } else if (!hasCached) {
                this.showToast(res.message || 'فشل تحميل الجدول الدراسي', true);
            }
        })
        .catch(e => {
            if (!hasCached) {
                this.showLoading(false);
                console.error('loadClasses error:', e);
                this.showToast('خطأ في الاتصال بالخادم', true);
            }
        });
    },

    renderClasses() {
        const container = document.getElementById('classes-timetable');
        if (!container) return;

        if (!this.selectedClassDay) {
            this.selectedClassDay = 'الأحد';
        }

        // Sync mobile 5-day tab buttons
        document.querySelectorAll('#classes-mobile-day-tabs .day-tab-btn').forEach(btn => {
            if (btn.dataset.day === this.selectedClassDay) {
                btn.className = 'day-tab-btn py-1.5 rounded-lg text-xs font-semibold bg-white/15 text-white shadow';
            } else {
                btn.className = 'day-tab-btn py-1.5 rounded-lg text-xs font-medium text-gray-400 hover:text-white';
            }
        });

        const groupFilter = document.getElementById('cls-group') ? document.getElementById('cls-group').value : 'all';

        const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'];
        let html = '';

        days.forEach(day => {
            const dayClasses = (this.classesData || []).filter(c => {
                if (c.day !== day) return false;
                if (groupFilter !== 'all' && c.group_name !== groupFilter && c.group_name !== 'كل المجموعات') return false;
                return true;
            });

            let entriesHtml = '';
            if (dayClasses.length > 0) {
                entriesHtml = dayClasses.map(c => {
                    const safeClassId = this.escapeHtml(c.id);
                    const safeStartTime = this.escapeHtml(c.start_time);
                    const safeEndTime = this.escapeHtml(c.end_time);
                    const safeSubject = this.escapeHtml(c.subject);
                    const safeType = this.escapeHtml(c.type || 'نظري');
                    const safeGroupName = this.escapeHtml(c.group_name || '');

                    return `
                        <div class="bg-black/40 p-3 rounded-lg border border-white/10 relative group hover:border-primary/50 transition">
                            <div class="flex justify-between items-start mb-1">
                                <span class="bg-white/10 text-gray-200 text-xs px-1.5 py-0.5 rounded font-mono">${safeStartTime} - ${safeEndTime}</span>
                                <button onclick="AdminApp.deleteClass('${safeClassId}')" class="opacity-100 md:opacity-0 md:group-hover:opacity-100 transition text-red-400 hover:text-red-300 text-xs px-2 py-1 rounded bg-red-500/10 hover:bg-red-500/20" title="حذف الحصة">حذف</button>
                            </div>
                            <h5 class="font-bold text-white text-sm mb-1 break-words">${safeSubject}</h5>
                            <div class="flex items-center justify-between text-xs text-gray-400">
                                <span class="bg-primary/10 text-accent px-1.5 py-0.5 rounded">${safeType}</span>
                                <span class="text-gray-500">${safeGroupName}</span>
                            </div>
                        </div>
                    `;
                }).join('');
            } else {
                entriesHtml = '<p class="text-xs text-gray-500 text-center py-4">لا يوجد محاضرات</p>';
            }

            const isDayActive = (day === this.selectedClassDay);
            const mobileVisibilityClass = isDayActive ? 'flex' : 'hidden md:flex';

            html += `
                <div class="day-column bg-black/20 rounded-xl p-3 border border-white/5 flex-col ${mobileVisibilityClass}" data-day="${day}">
                    <h4 class="text-sm font-bold text-center text-primary bg-primary/10 py-2 rounded-lg mb-3 border border-primary/20">${day}</h4>
                    <div class="space-y-3 flex-1">${entriesHtml}</div>
                </div>
            `;
        });

        container.innerHTML = html;
    },

    switchClassDay(day) {
        this.selectedClassDay = day;
        document.querySelectorAll('#classes-mobile-day-tabs .day-tab-btn').forEach(btn => {
            if (btn.dataset.day === day) {
                btn.className = 'day-tab-btn py-1.5 rounded-lg text-xs font-semibold bg-white/15 text-white shadow';
            } else {
                btn.className = 'day-tab-btn py-1.5 rounded-lg text-xs font-medium text-gray-400 hover:text-white';
            }
        });

        const dayColumns = document.querySelectorAll('#classes-timetable .day-column');
        dayColumns.forEach(col => {
            if (col.dataset.day === day) {
                col.classList.remove('hidden');
                col.classList.add('flex');
            } else {
                col.classList.remove('flex');
                col.classList.add('hidden', 'md:flex');
            }
        });
    },

    openClassModal() {
        this.updateYearOptions('cls-entry-spec', 'cls-entry-year');
        let spec = 'dentistry';
        let year = '3';
        let sem = '1';

        if (this.focusMode && this.focusMode.enabled) {
            spec = this.focusMode.specialty;
            year = this.focusMode.year;
            sem = this.focusMode.semester;
        } else {
            spec = document.getElementById('cls-spec') ? document.getElementById('cls-spec').value : 'dentistry';
            year = document.getElementById('cls-year') ? document.getElementById('cls-year').value : '2';
            sem = document.getElementById('cls-sem') ? document.getElementById('cls-sem').value : '1';
        }

        const entrySpec = document.getElementById('cls-entry-spec');
        if (entrySpec) {
            entrySpec.value = spec;
            this.updateYearOptions('cls-entry-spec', 'cls-entry-year');
        }
        if (document.getElementById('cls-entry-year')) document.getElementById('cls-entry-year').value = year;
        if (document.getElementById('cls-entry-sem')) document.getElementById('cls-entry-sem').value = sem;

        const badge = document.getElementById('class-modal-target-badge');
        if (badge) {
            badge.innerText = `يضاف إلى: ${this.getTrackLabel(spec, year, sem)}`;
        }

        document.getElementById('cls-entry-subject').value = '';
        document.getElementById('cls-entry-start').value = '08:00';
        document.getElementById('cls-entry-end').value = '10:00';

        this.openModal('class-modal');
    },

    saveNewClass() {
        const spec = document.getElementById('cls-entry-spec').value;
        const year = parseInt(document.getElementById('cls-entry-year').value);
        const sem = parseInt(document.getElementById('cls-entry-sem').value);
        const day = document.getElementById('cls-entry-day').value;
        const group_name = document.getElementById('cls-entry-group').value;
        const subject = document.getElementById('cls-entry-subject').value.trim();
        const start_time = document.getElementById('cls-entry-start').value.trim();
        const end_time = document.getElementById('cls-entry-end').value.trim();
        const type = document.getElementById('cls-entry-type').value;

        if (!subject) {
            this.showToast('يرجى إدخال اسم المادة / المحاضرة', true);
            return;
        }

        this.showLoading(true);
        fetch(API_BASE + '/dent2025_api.php?action=save_classes', {
            method: 'POST',
            body: JSON.stringify({
                password: this.pass,
                sub_action: 'add',
                specialty: spec,
                year: year,
                semester: sem,
                day: day,
                group_name: group_name,
                subject: subject,
                start_time: start_time,
                end_time: end_time,
                type: type
            })
        })
        .then(r => r.json())
        .then(res => {
            this.showLoading(false);
            if (res.success) {
                this.showToast('تمت إضافة المحاضرة إلى الجدول بنجاح');
                this.closeModal('class-modal');
                this.loadClasses();
            } else {
                this.showToast(res.message || 'فشل إضافة المحاضرة', true);
            }
        })
        .catch(e => {
            this.showLoading(false);
            console.error('saveNewClass error:', e);
            this.showToast('خطأ في الاتصال بالخادم', true);
        });
    },

    deleteClass(classId) {
        if (!confirm('هل أنت متأكد من حذف هذه المحاضرة من الجدول؟')) return;

        const spec = document.getElementById('cls-spec').value;
        const year = parseInt(document.getElementById('cls-year').value);
        const sem = parseInt(document.getElementById('cls-sem').value);

        this.showLoading(true);
        fetch(API_BASE + '/dent2025_api.php?action=save_classes', {
            method: 'POST',
            body: JSON.stringify({
                password: this.pass,
                sub_action: 'delete',
                class_id: classId,
                specialty: spec,
                year: year,
                semester: sem
            })
        })
        .then(r => r.json())
        .then(res => {
            this.showLoading(false);
            if (res.success) {
                this.showToast('تم حذف المحاضرة من الجدول');
                this.loadClasses();
            } else {
                this.showToast(res.message || 'فشل حذف المحاضرة', true);
            }
        })
        .catch(e => {
            this.showLoading(false);
            console.error('deleteClass error:', e);
            this.showToast('خطأ في الاتصال بالخادم', true);
        });
    },

    // --- TAB 5: ANNOUNCEMENTS ---

    loadAnnouncements() {
        if (this.focusMode && this.focusMode.enabled) {
            const formSpec = document.getElementById('ann-spec');
            const formYear = document.getElementById('ann-year');
            const formSem = document.getElementById('ann-sem');
            if (formSpec) {
                formSpec.value = this.focusMode.specialty;
                this.updateYearOptions('ann-spec', 'ann-year');
            }
            if (formYear) formYear.value = this.focusMode.year;
            if (formSem) formSem.value = this.focusMode.semester;

            const filterSpec = document.getElementById('ann-filter-spec');
            const filterYear = document.getElementById('ann-filter-year');
            const filterSem = document.getElementById('ann-filter-sem');
            if (filterSpec) {
                filterSpec.value = this.focusMode.specialty;
                this.updateYearOptions('ann-filter-spec', 'ann-filter-year');
            }
            if (filterYear) filterYear.value = this.focusMode.year;
            if (filterSem) filterSem.value = this.focusMode.semester;
        } else {
            const filterSpec = document.getElementById('ann-filter-spec');
            const filterYear = document.getElementById('ann-filter-year');
            const filterSem = document.getElementById('ann-filter-sem');
            if (filterSpec) {
                filterSpec.value = 'all';
                this.updateYearOptions('ann-filter-spec', 'ann-filter-year');
            }
            if (filterYear) filterYear.value = 'all';
            if (filterSem) filterSem.value = 'all';
        }

        const hasCached = Array.isArray(this.announcementsData) && this.announcementsData.length > 0;
        if (hasCached) {
            this.renderAnnouncements();
        } else {
            this.showLoading(true);
        }

        fetch(API_BASE + '/announcements_api.php?action=get_all')
        .then(r => r.json())
        .then(res => {
            if (!hasCached) this.showLoading(false);
            if (res.success && res.data) {
                this.announcementsData = res.data;
                this.renderAnnouncements();
            }
        })
        .catch(e => {
            if (!hasCached) {
                this.showLoading(false);
                console.error('Announcements load error:', e);
                this.showToast('خطأ في تحميل الإعلانات', true);
            }
        });
    },

    renderAnnouncements() {
        const list = document.getElementById('announcements-list');
        if (!list) return;

        const specFilter = document.getElementById('ann-filter-spec') ? document.getElementById('ann-filter-spec').value : 'all';
        const yearFilter = document.getElementById('ann-filter-year') ? document.getElementById('ann-filter-year').value : 'all';
        const semFilter = document.getElementById('ann-filter-sem') ? document.getElementById('ann-filter-sem').value : 'all';
        const searchFilter = document.getElementById('ann-filter-search') ? document.getElementById('ann-filter-search').value.toLowerCase().trim() : '';

        const specNames = { 'dentistry': 'طب الأسنان', 'medicine': 'الطب البشري', 'pre-med': 'تحضيري' };

        let hasActive = false;
        let html = '';

        (this.announcementsData || []).forEach((ann, index) => {
            if (!ann.content || ann.content.trim() === '') return;

            // Apply Filters
            if (this.focusMode && this.focusMode.enabled) {
                const isGeneral = !ann.specialty || ann.specialty === 'all';
                if (!isGeneral) {
                    if (ann.specialty !== this.focusMode.specialty) return;
                    if (ann.year && ann.year !== 'all' && String(ann.year) !== String(this.focusMode.year)) return;
                    if (ann.semester && ann.semester !== 'all' && String(ann.semester) !== String(this.focusMode.semester)) return;
                }
            } else {
                if (specFilter !== 'all' && ann.specialty !== specFilter && ann.specialty !== 'all') return;
                if (yearFilter !== 'all' && String(ann.year) !== String(yearFilter) && ann.year !== 'all') return;
                if (semFilter !== 'all' && String(ann.semester) !== String(semFilter) && ann.semester !== 'all') return;
            }

            if (searchFilter && !this.normalizeArabic(ann.content).includes(this.normalizeArabic(searchFilter))) return;

            hasActive = true;
            const d = new Date(ann.last_updated * 1000);
            const dateStr = d.toLocaleString('ar-SA');
            const safeSpecLabel = this.escapeHtml(specNames[ann.specialty] || ann.specialty);
            const safeSpec = this.escapeHtml(ann.specialty);
            const safeYear = parseInt(ann.year, 10) || 0;
            const safeSem = parseInt(ann.semester, 10) || 0;
            const safeDateStr = this.escapeHtml(dateStr);
            const safeIndex = parseInt(index, 10) || 0;
            
            html += `
                <div class="glass p-5 rounded-xl border border-white/10 hover:border-white/20 transition relative group">
                    <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-3 border-b border-white/5 pb-3">
                        <span class="bg-primary/20 text-accent px-3 py-1 rounded text-xs sm:text-sm font-semibold flex items-center gap-2 border border-primary/30 break-words">
                            ${safeSpecLabel} | سنة ${safeYear} | ترم ${safeSem}
                        </span>
                        <div class="flex items-center gap-3">
                            <span class="text-xs text-gray-500 font-mono">${safeDateStr}</span>
                            <div class="opacity-100 md:opacity-0 md:group-hover:opacity-100 transition flex gap-1.5 sm:gap-2">
                                <button onclick="AdminApp.editAnnouncement(${safeIndex})" class="btn btn-secondary text-xs px-2.5 py-1">تعديل</button>
                                <button onclick="AdminApp.deleteAnnouncement('${safeSpec}', ${safeYear}, ${safeSem})" class="btn btn-danger text-xs px-2.5 py-1">حذف</button>
                            </div>
                        </div>
                    </div>
                    <div class="text-gray-300 text-sm list-disc list-inside quill-render prose prose-invert max-w-none">
                        ${ann.content}
                    </div>
                </div>
            `;
        });
        
        if (!hasActive) {
            list.innerHTML = `
                <div class="p-12 text-center text-gray-400 glass rounded-2xl">
                    <span class="text-4xl block mb-3"></span>
                    <h3 class="text-xl font-bold mb-1 text-white">لا توجد إعلانات</h3>
                    <p class="text-xs">جرب تغيير خيارات التصفية أو أضف إعلاناً جديداً.</p>
                </div>
            `;
        } else {
            list.innerHTML = html;
        }
    },

    editAnnouncement(index) {
        if (!this.announcementsData || !this.announcementsData[index]) return;
        const ann = this.announcementsData[index];
        
        document.getElementById('ann-spec').value = ann.specialty;
        document.getElementById('ann-year').value = ann.year;
        document.getElementById('ann-sem').value = ann.semester;
        
        if (this.quill) {
            this.quill.clipboard.dangerouslyPasteHTML(ann.content);
        }
        
        const editorCard = document.querySelector('#ann-editor-container');
        if (editorCard) editorCard.scrollIntoView({ behavior: 'smooth' });
    },

    deleteAnnouncement(spec, year, sem) {
        if (!confirm('هل أنت متأكد من حذف هذا الإعلان؟ يمكنك التراجع لاحقاً.')) return;
        this.showLoading(true);
        fetch(API_BASE + '/announcements_api.php', {
            method: 'POST',
            body: JSON.stringify({
                password: this.pass,
                action: 'update',
                specialty: spec,
                year: year,
                semester: sem,
                content: ''
            })
        })
        .then(r => r.json())
        .then(res => {
            this.showLoading(false);
            if (res.success) {
                this.showToast('تم حذف الإعلان');
                this.loadAnnouncements();
            } else {
                this.showToast(res.message, true);
            }
        });
    },

    saveAnnouncements() {
        const spec = document.getElementById('ann-spec').value;
        const year = document.getElementById('ann-year').value;
        const sem = document.getElementById('ann-sem').value;
        
        let content = '';
        if (this.quill) {
            content = this.quill.root.innerHTML;
            if (content === '<p><br></p>') content = '';
        }

        this.showLoading(true);

        let action = 'update';
        let payload = { password: this.pass, content: content };

        if (spec === 'all' || year === 'all' || sem === 'all') {
            action = 'bulk_update';
            let contexts = [];
            let specs = spec === 'all' ? ['dentistry', 'medicine', 'pre-med'] : [spec];
            
            for (let s of specs) {
                let years = [];
                if (year === 'all') {
                    if (s === 'pre-med') {
                        years = [0];
                    } else {
                        years = [2, 3, 4, 5, 6];
                    }
                } else {
                    years = [parseInt(year)];
                }
                let sems = sem === 'all' ? [1, 2] : [parseInt(sem)];
                
                for (let y of years) {
                    if (s === 'pre-med' && y !== 0) continue;
                    if (s !== 'pre-med' && y === 0) continue;

                    for (let sm of sems) {
                        contexts.push({ specialty: s, year: y, semester: sm });
                    }
                }
            }
            payload.contexts = contexts;
            payload.action = action;
        } else {
            payload.action = 'update';
            payload.specialty = spec;
            payload.year = parseInt(year);
            payload.semester = parseInt(sem);
        }

        fetch(API_BASE + '/announcements_api.php', {
            method: 'POST',
            body: JSON.stringify(payload)
        })
        .then(r => r.json())
        .then(res => {
            this.showLoading(false);
            if (res.success) {
                this.showToast(res.message);
                if (this.quill) this.quill.root.innerHTML = '';
                this.loadAnnouncements();
            } else {
                this.showToast(res.message, true);
            }
        });
    },

    clearAllAnnouncements() {
        if (!confirm('هل أنت متأكد من مسح جميع الإعلانات؟ يمكنك التراجع لاحقاً.')) return;
        
        this.showLoading(true);
        fetch(API_BASE + '/announcements_api.php', {
            method: 'POST',
            body: JSON.stringify({ password: this.pass, action: 'bulk_clear' })
        })
        .then(r => r.json())
        .then(res => {
            this.showLoading(false);
            if (res.success) {
                this.showToast(res.message);
                this.loadAnnouncements();
            } else {
                this.showToast(res.message, true);
            }
        });
    },

    undoAnnouncements() {
        if (!confirm('هل ترغب بالتراجع عن آخر تعديل للإعلانات واستعادة الحالة السابقة؟')) return;
        this.showLoading(true);
        fetch(API_BASE + '/announcements_api.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: this.pass, action: 'undo' })
        })
        .then(r => r.json())
        .then(res => {
            this.showLoading(false);
            if (res.success) {
                this.showToast(res.message || 'تم التراجع بنجاح');
                this.loadAnnouncements();
            } else {
                this.showToast(res.message || 'فشل التراجع', true);
            }
        })
        .catch(e => {
            this.showLoading(false);
            this.showToast('خطأ في الاتصال بالخادم', true);
        });
    },

    // --- HISTORY & ROLLBACK ENGINE METHODS ---

    escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    saveManualSnapshot() {
        const noteEl = document.getElementById('manual-snapshot-note');
        const note = noteEl ? noteEl.value.trim() : '';
        if (!note) {
            this.showToast('اكتب ملاحظة أولاً', true);
            return;
        }

        const btn = document.querySelector('[onclick="AdminApp.saveManualSnapshot()"]');
        if (btn) btn.disabled = true;

        fetch(API_BASE + '/history_api.php', {
            method: 'POST',
            body: JSON.stringify({
                password: this.pass,
                action: 'save_manual_snapshot',
                note: note,
                passkey_label: this.passkeyInfo?.label || 'الأدمن'
            })
        })
        .then(r => r.json())
        .then(res => {
            if (btn) btn.disabled = false;
            if (res.success) {
                this.showToast('تم حفظ النقطة المرجعية');
                if (noteEl) noteEl.value = '';
                this.loadManualSnapshots();
            } else {
                this.showToast(res.message || 'فشل الحفظ', true);
            }
        })
        .catch(() => {
            if (btn) btn.disabled = false;
            this.showToast('خطأ في الاتصال', true);
        });
    },

    loadManualSnapshots() {
        fetch(API_BASE + '/history_api.php?action=get_manual_snapshots', { headers: { 'X-Admin-Pass': this.pass || '' } })
            .then(r => r.json())
            .then(res => {
                const list = document.getElementById('manual-snapshots-list');
                if (!list) return;
                const items = res.data || [];
                if (items.length === 0) {
                    list.innerHTML = '<p class="text-xs text-gray-500">لا يوجد حتى الآن.</p>';
                    return;
                }
                list.innerHTML = items.map(item => `
                    <div class="bg-black/30 border border-white/8 rounded-lg p-3 flex justify-between items-start gap-3">
                        <div class="min-w-0">
                            <p class="text-sm text-white font-medium leading-snug truncate">${this.escapeHtml(item.description)}</p>
                            <p class="text-xs text-gray-500 mt-0.5">${item.date_formatted}</p>
                        </div>
                        <button onclick="AdminApp.previewSnapshot('${item.snapshot_id}')" class="text-xs text-gray-300 hover:text-gray-200 border border-gray-500/30 px-2 py-1 rounded shrink-0">عرض</button>
                    </div>
                `).join('');
            })
            .catch(() => {});
    },

    formatArabicRelativeTime(dateStrOrTs) {
        if (!dateStrOrTs) return '';
        let timeMs = 0;
        if (typeof dateStrOrTs === 'number') {
            timeMs = dateStrOrTs > 10000000000 ? dateStrOrTs : dateStrOrTs * 1000;
        } else {
            // Replace space with T for valid ISO parsing
            const clean = String(dateStrOrTs).replace(' ', 'T');
            const d = new Date(clean);
            timeMs = isNaN(d.getTime()) ? 0 : d.getTime();
        }
        if (!timeMs) return dateStrOrTs;

        const diffSec = Math.floor((Date.now() - timeMs) / 1000);
        if (diffSec < 45) return 'الآن';
        if (diffSec < 90) return 'منذ دقيقة';
        if (diffSec < 3600) {
            const min = Math.floor(diffSec / 60);
            if (min === 2) return 'منذ دقيقتين';
            if (min >= 3 && min <= 10) return `منذ ${min} دقائق`;
            return `منذ ${min} دقيقة`;
        }
        if (diffSec < 7200) return 'منذ ساعة';
        if (diffSec < 86400) {
            const hours = Math.floor(diffSec / 3600);
            if (hours === 2) return 'منذ ساعتين';
            if (hours >= 3 && hours <= 10) return `منذ ${hours} ساعات`;
            return `منذ ${hours} ساعة`;
        }
        if (diffSec < 172800) return 'أمس';
        if (diffSec < 604800) {
            const days = Math.floor(diffSec / 86400);
            if (days === 2) return 'منذ يومين';
            if (days >= 3 && days <= 10) return `منذ ${days} أيام`;
            return `منذ ${days} يوم`;
        }
        if (diffSec < 2592000) {
            const weeks = Math.floor(diffSec / 604800);
            if (weeks === 1) return 'منذ أسبوع';
            if (weeks === 2) return 'منذ أسبوعين';
            return `منذ ${weeks} أسابيع`;
        }
        const months = Math.floor(diffSec / 2592000);
        if (months === 1) return 'منذ شهر';
        if (months === 2) return 'منذ شهرين';
        return `منذ ${months} أشهر`;
    },

    copyToClipboard(text, successMsg = 'تم النسخ إلى الحافظة بنجاح') {
        if (!text) return;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text)
                .then(() => this.showToast(successMsg))
                .catch(() => this.fallbackCopyText(text, successMsg));
        } else {
            this.fallbackCopyText(text, successMsg);
        }
    },

    fallbackCopyText(text, successMsg) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try {
            document.execCommand('copy');
            this.showToast(successMsg || 'تم النسخ بنجاح');
        } catch (e) {
            this.showToast('تعذر النسخ التلقائي', true);
        }
        document.body.removeChild(ta);
    },

    loadHistory() {
        const hasCached = Array.isArray(this.historyData) && this.historyData.length > 0;
        if (hasCached) {
            const hasRollback = this.historyData.some(h => h.action_type === 'safety_backup' || h.action_type === 'rollback');
            const undoBtn = document.getElementById('btn-undo-rollback');
            if (undoBtn) {
                if (hasRollback) undoBtn.classList.remove('hidden');
                else undoBtn.classList.add('hidden');
            }
            this.filterHistory();
        } else {
            this.showLoading(true);
        }

        fetch(API_BASE + '/history_api.php?action=get_history', { headers: { 'X-Admin-Pass': this.pass || '' } })
            .then(r => r.json())
            .then(res => {
                if (!hasCached) this.showLoading(false);
                if (res.success) {
                    // Filter out manual saves from the main auto log
                    const allData = res.data || [];
                    this.historyData = allData.filter(h => h.action_type !== 'manual_save');

                    // Check if safety backup or rollback exists to toggle Undo Rollback button
                    const hasRollback = this.historyData.some(h => h.action_type === 'safety_backup' || h.action_type === 'rollback');
                    const undoBtn = document.getElementById('btn-undo-rollback');
                    if (undoBtn) {
                        if (hasRollback) undoBtn.classList.remove('hidden');
                        else undoBtn.classList.add('hidden');
                    }

                    this.filterHistory();
                } else if (!hasCached) {
                    this.showToast(res.message || 'فشل تحميل سجل التغييرات', true);
                }
            })
            .catch(e => {
                if (!hasCached) {
                    this.showLoading(false);
                    console.error('History load error:', e);
                    this.showToast('خطأ بالاتصال أثناء تحميل سجل التغييرات', true);
                }
            });
    },

    filterHistory() {
        const catSelect = document.getElementById('hist-filter-category');
        const actSelect = document.getElementById('hist-filter-action');
        const periodSelect = document.getElementById('hist-filter-period');
        const searchInput = document.getElementById('hist-filter-search');

        const cat = catSelect ? catSelect.value : '';
        const act = actSelect ? actSelect.value : '';
        const period = periodSelect ? periodSelect.value : 'all';
        const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

        const now = Date.now();

        const filtered = (this.historyData || []).filter(item => {
            const matchCat = !cat || item.category === cat;
            const matchAct = !act || item.action_type === act;

            let matchPeriod = true;
            if (period !== 'all' && item.timestamp) {
                const itemTime = item.timestamp * 1000;
                const diffHours = (now - itemTime) / (1000 * 3600);
                if (period === 'today') matchPeriod = diffHours <= 24;
                else if (period === 'week') matchPeriod = diffHours <= (24 * 7);
                else if (period === 'month') matchPeriod = diffHours <= (24 * 30);
            }

            const matchSearch = !query ||
                (item.description && item.description.toLowerCase().includes(query)) ||
                (item.passkey_label && item.passkey_label.toLowerCase().includes(query)) ||
                (item.snapshot_id && item.snapshot_id.toLowerCase().includes(query)) ||
                (item.date_formatted && item.date_formatted.toLowerCase().includes(query));

            return matchCat && matchAct && matchPeriod && matchSearch;
        });

        const statusEl = document.getElementById('hist-total-status');
        if (statusEl) {
            statusEl.textContent = `عرض ${filtered.length} من إجمالي ${(this.historyData || []).length} سجل مسجل`;
        }

        this.renderHistory(filtered);
    },

    renderHistory(itemsToRender = null) {
        const container = document.getElementById('history-timeline-container');
        if (!container) return;

        const items = itemsToRender !== null ? itemsToRender : this.historyData;

        if (!items || items.length === 0) {
            container.innerHTML = `
                <div class="text-center py-12 text-gray-400">
                    <p class="text-3xl mb-2"></p>
                    <p class="text-base font-semibold text-white">لا توجد سجلات تطابق الفلترة الحالية</p>
                    <p class="text-xs text-gray-500 mt-1">جرب تغيير معايير البحث أو اختيار "جميع الأقسام".</p>
                </div>
            `;
            return;
        }

        const categoryBadges = {
            subjects: { label: 'المواد والروابط', class: 'text-indigo-300 border-indigo-500/30 bg-indigo-500/10' },
            classes: { label: 'الجداول الدراسية', class: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' },
            announcements: { label: 'الإعلانات والمهام', class: 'text-amber-300 border-amber-500/30 bg-amber-500/10' },
            events: { label: 'التقويم والأحداث', class: 'text-sky-300 border-sky-500/30 bg-sky-500/10' },
            passkeys: { label: 'الصلاحيات والمفاتيح', class: 'text-pink-300 border-pink-500/30 bg-pink-500/10' },
            rollback: { label: 'استعادة وتراجع', class: 'text-rose-300 border-rose-500/30 bg-rose-500/10' },
            manual: { label: 'نقطة يدوية', class: 'text-purple-300 border-purple-500/30 bg-purple-500/10' }
        };

        const actionBadges = {
            add: { label: 'إضافة جديدة', class: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' },
            edit: { label: 'تعديل بيانات', class: 'bg-sky-500/15 text-sky-400 border border-sky-500/30' },
            delete: { label: 'حذف عنصر', class: 'bg-rose-500/15 text-rose-400 border border-rose-500/30' },
            bulk_update: { label: 'تحديث مجمع', class: 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/30' },
            bulk_clear: { label: 'مسح شامل', class: 'bg-orange-500/15 text-orange-400 border border-orange-500/30' },
            rollback: { label: 'استعادة نظام', class: 'bg-rose-600/25 text-rose-300 border border-rose-500/50 font-bold' },
            undo_rollback: { label: 'تراجع عن استعادة', class: 'bg-purple-600/25 text-purple-300 border border-purple-500/50 font-bold' },
            safety_backup: { label: 'أمان تلقائي', class: 'bg-teal-500/15 text-teal-300 border border-teal-500/30' },
            manual_save: { label: 'حفظ مرجعي', class: 'bg-purple-500/15 text-purple-300 border border-purple-500/30 font-bold' }
        };

        const catIcons = { subjects: '', classes: '', announcements: '', events: '', passkeys: '', rollback: '', manual: '' };

        let html = '';
        items.forEach((item) => {
            const cat = categoryBadges[item.category] || { label: item.category, class: 'bg-gray-500/20 text-gray-300 border-gray-500/30' };
            const act = actionBadges[item.action_type] || { label: item.action_type, class: 'bg-gray-500/20 text-gray-300' };
            const icon = catIcons[item.category] || '';
            const relTime = this.formatArabicRelativeTime(item.timestamp || item.date_formatted);

            // Special styling for rollback/safety entries
            const isRollback = item.action_type === 'rollback' || item.action_type === 'undo_rollback' || item.action_type === 'safety_backup';
            const cardBorder = isRollback ? 'border-rose-500/30 bg-rose-950/10' : 'border-white/10 hover:border-sky-500/30';

            html += `
                <div class="glass p-3.5 sm:p-4 rounded-xl border ${cardBorder} transition-all duration-200 hover:shadow-lg">
                    <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
                        <!-- Info Column -->
                        <div class="flex items-start gap-3 flex-1 min-w-0">
                            <div class="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-xl shrink-0 mt-0.5 shadow-inner">
                                ${icon}
                            </div>
                            <div class="min-w-0 flex-1">
                                <!-- Badge Header -->
                                <div class="flex flex-wrap items-center gap-1.5 mb-1.5">
                                    <span class="px-2 py-0.5 rounded-md text-[11px] font-semibold border ${cat.class}">${cat.label}</span>
                                    <span class="px-2 py-0.5 rounded-md text-[11px] font-semibold ${act.class}">${act.label}</span>
                                    <span class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-white/5 text-gray-300 border border-white/10">${relTime}</span>
                                </div>
                                <!-- Description -->
                                <p class="text-white font-medium text-sm leading-snug mb-1.5 break-words">${this.escapeHtml(item.description)}</p>
                                <!-- Meta Row -->
                                <div class="flex flex-wrap items-center gap-2.5 text-xs text-gray-400">
                                    <span class="flex items-center gap-1 font-mono text-[11px] text-gray-400">
                                         ${item.date_formatted}
                                    </span>
                                    <span>•</span>
                                    <span class="flex items-center gap-1 text-sky-400 text-[11px]">
                                         ${this.escapeHtml(item.passkey_label || 'الأدمن')}
                                    </span>
                                    ${item.snapshot_id ? `
                                        <span>•</span>
                                        <span class="font-mono text-[10px] text-gray-500 cursor-pointer hover:text-gray-300 select-all" title="معرف اللقطة - انقر للنسخ" onclick="AdminApp.copyToClipboard('${item.snapshot_id}', 'تم نسخ معرف اللقطة')">
                                            #${item.snapshot_id}
                                        </span>
                                    ` : ''}
                                </div>
                            </div>
                        </div>
                        <!-- Action Buttons -->
                        <div class="flex items-center gap-2 self-end md:self-center shrink-0">
                            <button onclick="AdminApp.copyAuditItemSummary(${JSON.stringify(item).replace(/"/g, '&quot;')})" class="btn bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white text-xs py-1.5 px-2.5 rounded-lg border border-white/10" title="نسخ ملخص السجل">
                                 نسخ
                            </button>
                            <button onclick="AdminApp.previewSnapshot('${item.snapshot_id}')" class="btn btn-secondary text-xs py-2 px-3.5 flex items-center gap-1.5 border-sky-500/30 text-sky-300 hover:bg-sky-500/15 font-semibold">
                                 عرض ومقارنة حية
                            </button>
                        </div>
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;
    },

    copyAuditItemSummary(item) {
        if (!item) return;
        const text = `[Dent2025 Audit Log]
القسم: ${item.category}
الإجراء: ${item.action_type}
الوصف: ${item.description}
التاريخ: ${item.date_formatted}
المنفذ: ${item.passkey_label || 'الأدمن'}
معرف اللقطة: ${item.snapshot_id || '—'}`;
        this.copyToClipboard(text, 'تم نسخ تفاصيل السجل إلى الحافظة');
    },

    previewSnapshot(snapId) {
        if (!snapId) {
            this.showToast('معرف اللقطة غير متوفر', true);
            return;
        }
        this.showLoading(true);
        fetch(API_BASE + `/history_api.php?action=get_snapshot&snapshot_id=${snapId}`, { headers: { 'X-Admin-Pass': this.pass || '' } })
            .then(r => r.json())
            .then(res => {
                this.showLoading(false);
                if (res.success && res.summary) {
                    this.currentSnapshotData = res;
                    const sum = res.summary;
                    const snapData = res.data || {};
                    const diff = res.live_diff || {};
                    const state = snapData.state || {};

                    // Header Info
                    const subtitle = document.getElementById('snap-modal-subtitle');
                    if (subtitle) subtitle.innerText = `التاريخ الدقيق: ${snapData.date_formatted}`;

                    const relTimeEl = document.getElementById('snap-modal-rel-time');
                    if (relTimeEl) relTimeEl.innerText = this.formatArabicRelativeTime(snapData.timestamp || snapData.date_formatted);

                    const idBadge = document.getElementById('snap-modal-id-badge');
                    if (idBadge) idBadge.innerText = snapId;

                    // What happened
                    const desc = document.getElementById('snap-modal-desc');
                    if (desc) desc.innerText = this.escapeHtml(snapData.description || 'لا يوجد وصف');

                    // Who did it
                    const actor = document.getElementById('snap-modal-actor');
                    if (actor) actor.innerText = ` المنفِّذ: ${snapData.passkey_label || 'الأدمن'}`;

                    // TAB 1: Metrics & Live Diff Grid
                    const grid = document.getElementById('snap-metrics-grid');
                    if (grid) {
                        const subDiff = diff.subjects || {};
                        const linkDiff = diff.links || {};
                        const clsDiff = diff.classes || {};
                        const annDiff = diff.announcements || {};
                        const evtDiff = diff.events || {};
                        const pwdDiff = diff.passwords || {};

                        const getDeltaBadge = (d) => {
                            if (!d || d.snapshot_count === undefined || d.live_count === undefined) return '';
                            const delta = d.snapshot_count - d.live_count;
                            if (delta === 0) return '<span class="text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">متطابق</span>';
                            if (delta > 0) return `<span class="text-[10px] text-sky-400 bg-sky-500/10 px-1.5 py-0.5 rounded border border-sky-500/20 font-bold">+${delta} باللقطة</span>`;
                            return `<span class="text-[10px] text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20 font-bold">${delta} باللقطة</span>`;
                        };

                        const metrics = [
                            { icon: '', label: 'مادة دراسية', snapVal: sum.subjects_count, liveVal: subDiff.live_count ?? sum.subjects_count, delta: getDeltaBadge(subDiff) },
                            { icon: '', label: 'رابط مواد', snapVal: sum.links_count, liveVal: linkDiff.live_count ?? sum.links_count, delta: getDeltaBadge(linkDiff) },
                            { icon: '', label: 'حصة بالجدول', snapVal: sum.classes_count, liveVal: clsDiff.live_count ?? sum.classes_count, delta: getDeltaBadge(clsDiff) },
                            { icon: '', label: 'ملف إعلانات', snapVal: sum.announcements_count, liveVal: annDiff.live_count ?? sum.announcements_count, delta: getDeltaBadge(annDiff) },
                            { icon: '', label: 'ملف أحداث', snapVal: sum.events_files_count, liveVal: evtDiff.live_count ?? sum.events_files_count, delta: getDeltaBadge(evtDiff) },
                            { icon: '', label: 'مفتاح وصول', snapVal: sum.passwords_count, liveVal: pwdDiff.live_count ?? sum.passwords_count, delta: getDeltaBadge(pwdDiff) }
                        ];

                        grid.innerHTML = metrics.map(m => `
                            <div class="bg-black/30 p-2.5 rounded-xl border border-white/8 text-center flex flex-col justify-between">
                                <div>
                                    <span class="text-sm block mb-0.5">${m.icon}</span>
                                    <strong class="text-base text-white font-mono block">${m.snapVal}</strong>
                                    <span class="text-[10px] text-gray-400 leading-tight block mt-0.5">${m.label}</span>
                                </div>
                                <div class="mt-2 pt-1.5 border-t border-white/5 flex flex-col items-center gap-0.5">
                                    <span class="text-[9px] text-gray-500">حالي: ${m.liveVal}</span>
                                    ${m.delta}
                                </div>
                            </div>
                        `).join('');
                    }

                    // TAB 1: Live Diff Detailed Changes Breakdown
                    const diffContainer = document.getElementById('snap-diff-container');
                    if (diffContainer) {
                        const subDiff = diff.subjects || {};
                        const inSnapOnly = subDiff.in_snapshot_only || [];
                        const inLiveOnly = subDiff.in_live_only || [];
                        const modified = subDiff.modified || [];

                        let diffHtml = '';

                        if (inLiveOnly.length > 0) {
                            diffHtml += `
                                <div class="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30">
                                    <p class="font-bold text-rose-300 mb-1.5"> مواد أُضيفت بعد هذا التاريخ (ستُحذف عند الاستعادة): <span class="text-white font-mono font-bold">${inLiveOnly.length}</span></p>
                                    <div class="flex flex-wrap gap-1.5">
                                        ${inLiveOnly.map(s => `<span class="px-2 py-0.5 rounded text-[11px] bg-rose-950/60 text-rose-200 border border-rose-500/30 font-medium">${this.escapeHtml(s.name)} <span class="text-[10px] text-rose-400">(${s.specialty} س${s.year} ت${s.semester})</span></span>`).join('')}
                                    </div>
                                </div>
                            `;
                        }

                        if (inSnapOnly.length > 0) {
                            diffHtml += `
                                <div class="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                                    <p class="font-bold text-emerald-300 mb-1.5"> مواد كانت موجودة وحُذفت لاحقاً (ستُسترجع): <span class="text-white font-mono font-bold">${inSnapOnly.length}</span></p>
                                    <div class="flex flex-wrap gap-1.5">
                                        ${inSnapOnly.map(s => `<span class="px-2 py-0.5 rounded text-[11px] bg-emerald-950/60 text-emerald-200 border border-emerald-500/30 font-medium">${this.escapeHtml(s.name)} <span class="text-[10px] text-emerald-400">(${s.specialty} س${s.year} ت${s.semester})</span></span>`).join('')}
                                    </div>
                                </div>
                            `;
                        }

                        if (modified.length > 0) {
                            diffHtml += `
                                <div class="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30">
                                    <p class="font-bold text-amber-300 mb-1.5"> مواد تم تعديل بياناتها لاحقاً (ستُعاد لقيم هذه اللحظة): <span class="text-white font-mono font-bold">${modified.length}</span></p>
                                    <div class="space-y-1.5 mt-1">
                                        ${modified.map(m => `
                                            <div class="bg-black/30 p-2 rounded border border-amber-500/20 text-[11px]">
                                                <strong class="text-white">${this.escapeHtml(m.name)}</strong>
                                                <span class="text-gray-400 text-[10px] mr-1">(${m.specialty} س${m.year} ت${m.semester})</span>
                                                <div class="flex flex-wrap gap-2 mt-1 text-gray-300">
                                                    ${(m.changed_fields || []).map(f => `<span class="text-[10px] bg-amber-500/15 text-amber-200 px-1.5 py-0.5 rounded font-mono">${f.field}: ${this.escapeHtml(String(f.snap_value || '—'))}  حالي: ${this.escapeHtml(String(f.live_value || '—'))}</span>`).join('')}
                                                </div>
                                            </div>
                                        `).join('')}
                                    </div>
                                </div>
                            `;
                        }

                        if (inLiveOnly.length === 0 && inSnapOnly.length === 0 && modified.length === 0) {
                            diffHtml = `
                                <div class="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 flex items-center gap-2">
                                    <span class="text-lg"></span>
                                    <span><strong>حالة المواد والروابط متطابقة 100%</strong> مع الوضع الحالي المباشر بدون أي تغييرات مفقودة.</span>
                                </div>
                            `;
                        }

                        diffContainer.innerHTML = diffHtml;
                    }

                    // TAB 2: Subjects Explorer
                    const subCountEl = document.getElementById('snap-tab-subjects-count');
                    if (subCountEl) subCountEl.innerText = (state.subjects || []).length;
                    this.renderSnapshotSubjectsList(state.subjects || [], state.subject_links || []);

                    // TAB 3: Schedules, Announcements, Events
                    this.renderSnapshotContentSubTabs(state);

                    // TAB 4: Raw JSON Preview
                    const rawBox = document.getElementById('snap-raw-json-box');
                    if (rawBox) {
                        rawBox.textContent = JSON.stringify(snapData, null, 2);
                    }

                    // Wire rollback button
                    const execBtn = document.getElementById('snap-execute-rollback-btn');
                    if (execBtn) {
                        execBtn.onclick = () => {
                            this.closeModal('snapshot-modal');
                            this.rollbackToSnapshot(snapId, snapData.date_formatted);
                        };
                    }

                    // Switch to default overview tab
                    this.switchSnapshotModalTab('overview');
                    this.openModal('snapshot-modal');
                } else {
                    this.showToast(res.message || 'فشل قراءة تفاصيل اللقطة', true);
                }
            })
            .catch(e => {
                this.showLoading(false);
                console.error('Snapshot fetch error:', e);
                this.showToast('خطأ أثناء قراءة اللقطة', true);
            });
    },

    switchSnapshotModalTab(tabName) {
        const tabs = ['overview', 'subjects', 'content', 'export'];
        tabs.forEach(t => {
            const btn = document.getElementById(`snap-nav-${t}`);
            const content = document.getElementById(`snap-tab-${t}-content`);
            if (btn) {
                if (t === tabName) {
                    btn.className = 'snap-modal-tab-btn px-3.5 py-2 text-xs font-semibold rounded-lg bg-sky-600/30 text-sky-300 border border-sky-500/30 flex items-center gap-1.5 whitespace-nowrap shadow-sm';
                } else {
                    btn.className = 'snap-modal-tab-btn px-3.5 py-2 text-xs font-semibold rounded-lg text-gray-400 hover:bg-white/5 hover:text-white border border-transparent flex items-center gap-1.5 whitespace-nowrap';
                }
            }
            if (content) {
                if (t === tabName) content.classList.remove('hidden');
                else content.classList.add('hidden');
            }
        });
    },

    renderSnapshotSubjectsList(subjects, links) {
        const list = document.getElementById('snap-subjects-list');
        if (!list) return;

        if (!subjects || subjects.length === 0) {
            list.innerHTML = '<p class="text-xs text-gray-400 py-6 text-center">لا توجد مواد مسجلة في هذه اللحظة.</p>';
            return;
        }

        // Links count map
        const linkCountMap = {};
        (links || []).forEach(l => {
            linkCountMap[l.subject_id] = (linkCountMap[l.subject_id] || 0) + 1;
        });

        // Group subjects by specialty
        const specLabels = { dentistry: ' طب الأسنان', medicine: ' الطب البشري', 'pre-med': ' المسار التحضيري' };

        list.innerHTML = subjects.map(s => {
            const specLabel = specLabels[s.specialty] || s.specialty;
            const lCount = linkCountMap[s.id] || 0;
            return `
                <div class="snap-sub-item bg-black/30 border border-white/8 rounded-xl p-3 hover:border-white/20 transition" data-spec="${s.specialty}" data-name="${(s.name || '').toLowerCase()}" data-doctor="${(s.doctor || '').toLowerCase()}">
                    <div class="flex flex-col sm:flex-row justify-between items-start gap-2">
                        <div class="min-w-0 flex-1">
                            <div class="flex flex-wrap items-center gap-1.5 mb-1">
                                <span class="px-2 py-0.5 rounded text-[10px] font-semibold bg-white/5 text-sky-300 border border-white/10">${specLabel}</span>
                                <span class="px-2 py-0.5 rounded text-[10px] bg-white/5 text-gray-300 border border-white/10">سنة ${s.year} - ترم ${s.semester}</span>
                                <span class="px-2 py-0.5 rounded text-[10px] bg-indigo-500/15 text-indigo-300 border border-indigo-500/25">${lCount} روابط</span>
                            </div>
                            <h4 class="text-sm font-bold text-white leading-snug">${this.escapeHtml(s.name)}</h4>
                            <div class="flex flex-wrap items-center gap-3 text-xs text-gray-400 mt-1">
                                <span>‍ ${this.escapeHtml(s.doctor || 'غير محدد')}</span>
                                <span>•</span>
                                <span>${s.hours || 0} ساعات</span>
                                <span>•</span>
                                <span> ${s.marks || 100} درجة</span>
                            </div>
                        </div>
                        <div class="flex items-center gap-1.5 shrink-0 text-xs">
                            ${s.chapters_folder_id ? `<span class="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-[10px]"> مجلد الشباتر</span>` : ''}
                            ${s.materials_folder_id ? `<span class="px-2 py-0.5 rounded bg-sky-500/10 text-sky-300 border border-sky-500/20 text-[10px]"> مجلد المراجع</span>` : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    },

    filterSnapshotSubjects() {
        const searchInput = document.getElementById('snap-sub-search');
        const specSelect = document.getElementById('snap-sub-spec-filter');
        const q = searchInput ? searchInput.value.trim().toLowerCase() : '';
        const spec = specSelect ? specSelect.value : '';

        const items = document.querySelectorAll('.snap-sub-item');
        items.forEach(el => {
            const itemSpec = el.getAttribute('data-spec') || '';
            const itemName = el.getAttribute('data-name') || '';
            const itemDoctor = el.getAttribute('data-doctor') || '';

            const matchSpec = !spec || itemSpec === spec;
            const matchQ = !q || itemName.includes(q) || itemDoctor.includes(q);

            if (matchSpec && matchQ) el.classList.remove('hidden');
            else el.classList.add('hidden');
        });
    },

    renderSnapshotContentSubTabs(state) {
        // 1. Classes
        const clsContainer = document.getElementById('snap-subtab-classes');
        if (clsContainer) {
            const classes = state.classes || [];
            if (classes.length === 0) {
                clsContainer.innerHTML = '<p class="text-xs text-gray-400 py-6 text-center">لا توجد حصص مسجلة في هذه اللحظة.</p>';
            } else {
                clsContainer.innerHTML = classes.map(c => `
                    <div class="bg-black/30 border border-white/8 rounded-lg p-2.5 text-xs">
                        <div class="flex justify-between items-center mb-1">
                            <span class="font-bold text-white">${this.escapeHtml(c.subject || c.title || 'حصة دراسية')}</span>
                            <span class="text-gray-400 font-mono text-[11px]">${c.day || ''} | ${c.time || ''}</span>
                        </div>
                        <p class="text-gray-400 text-[11px]">${c.room ? `القاعة: ${this.escapeHtml(c.room)}` : ''} ${c.doctor ? `| الدكتور: ${this.escapeHtml(c.doctor)}` : ''} ${c.group ? `| المجموعة: ${this.escapeHtml(c.group)}` : ''}</p>
                    </div>
                `).join('');
            }
        }

        // 2. Announcements
        const annContainer = document.getElementById('snap-subtab-announcements');
        if (annContainer) {
            const annFiles = state.announcements || {};
            const keys = Object.keys(annFiles);
            if (keys.length === 0) {
                annContainer.innerHTML = '<p class="text-xs text-gray-400 py-6 text-center">لا توجد إعلانات مسجلة في هذه اللحظة.</p>';
            } else {
                annContainer.innerHTML = keys.map(k => {
                    const content = annFiles[k];
                    const contentText = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
                    return `
                        <div class="bg-black/30 border border-white/8 rounded-lg p-3 text-xs space-y-1">
                            <p class="font-mono text-[11px] text-amber-300 font-bold"> ${k}</p>
                            <div class="text-gray-300 text-xs bg-black/40 p-2 rounded border border-white/5 max-h-32 overflow-y-auto">${contentText || 'إعلان فارغ'}</div>
                        </div>
                    `;
                }).join('');
            }
        }

        // 3. Events
        const evtContainer = document.getElementById('snap-subtab-events');
        if (evtContainer) {
            const evtFiles = state.events || {};
            const keys = Object.keys(evtFiles);
            if (keys.length === 0) {
                evtContainer.innerHTML = '<p class="text-xs text-gray-400 py-6 text-center">لا توجد أحداث تقويم مسجلة في هذه اللحظة.</p>';
            } else {
                let allEvents = [];
                keys.forEach(k => {
                    const evts = evtFiles[k] || [];
                    if (Array.isArray(evts)) {
                        evts.forEach(e => allEvents.push({ ...e, sourceFile: k }));
                    }
                });
                if (allEvents.length === 0) {
                    evtContainer.innerHTML = '<p class="text-xs text-gray-400 py-6 text-center">لا توجد أحداث في ملفات التقويم.</p>';
                } else {
                    evtContainer.innerHTML = allEvents.map(e => `
                        <div class="bg-black/30 border border-white/8 rounded-lg p-2.5 text-xs flex justify-between items-center gap-2">
                            <div>
                                <h5 class="font-bold text-white">${this.escapeHtml(e.title || 'حدث')}</h5>
                                <p class="text-[11px] text-gray-400 mt-0.5"> ميلادي: ${e.date || '—'} |  هجري: ${e.hijri || '—'}</p>
                            </div>
                            <span class="px-2 py-0.5 rounded text-[10px] font-semibold bg-sky-500/15 text-sky-300 border border-sky-500/25 shrink-0">${e.type || 'عام'}</span>
                        </div>
                    `).join('');
                }
            }
        }
    },

    switchSnapshotContentSubTab(subTab) {
        const tabs = ['classes', 'announcements', 'events'];
        tabs.forEach(t => {
            const btn = document.getElementById(`snap-subtab-btn-${t}`);
            const box = document.getElementById(`snap-subtab-${t}`);
            if (btn) {
                if (t === subTab) {
                    btn.className = 'text-xs px-3 py-1.5 rounded-md bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30';
                } else {
                    btn.className = 'text-xs px-3 py-1.5 rounded-md text-gray-400 hover:text-white border border-transparent';
                }
            }
            if (box) {
                if (t === subTab) box.classList.remove('hidden');
                else box.classList.add('hidden');
            }
        });
    },

    downloadSnapshotJson() {
        if (!this.currentSnapshotData || !this.currentSnapshotData.data) {
            this.showToast('بيانات اللقطة غير متوفرة للتحميل', true);
            return;
        }
        const snap = this.currentSnapshotData.data;
        const snapId = snap.snapshot_id || 'snapshot';
        const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `dent2025_${snapId}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        this.showToast('تم تحميل ملف اللقطة بصيغة JSON بنجاح');
    },

    copySnapshotJson() {
        if (!this.currentSnapshotData || !this.currentSnapshotData.data) {
            this.showToast('بيانات اللقطة غير متوفرة', true);
            return;
        }
        const text = JSON.stringify(this.currentSnapshotData.data, null, 2);
        this.copyToClipboard(text, 'تم نسخ بيانات JSON إلى الحافظة');
    },

    rollbackToSnapshot(snapId, dateStr) {
        if (!confirm(`هل أنت متأكد تماماً من استعادة حالة النظام إلى تاريخ [${dateStr}]؟\n\nسيقوم النظام تلقائياً بحفظ نسخة أمان من الحالة الحالية، ويمكنك التراجع عن عملية الاستعادة في أي وقت.`)) {
            return;
        }

        this.showLoading(true);
        fetch(API_BASE + '/history_api.php', {
            method: 'POST',
            body: JSON.stringify({
                password: this.pass,
                action: 'rollback',
                snapshot_id: snapId
            })
        })
        .then(r => r.json())
        .then(res => {
            this.showLoading(false);
            if (res.success) {
                this.showToast(' ' + (res.message || 'تمت استعادة النظام بنجاح!'));
                this.loadHistory();
            } else {
                this.showToast(res.message || 'فشلت عملية الاستعادة', true);
            }
        })
        .catch(e => {
            this.showLoading(false);
            console.error('Rollback error:', e);
            this.showToast('خطأ بالاتصال أثناء استعادة النظام', true);
        });
    },

    undoLastRollback() {
        if (!confirm('هل ترغب بالتراجع عن آخر عملية استعادة وإعادة النظام للحالة التي كان عليها؟')) {
            return;
        }

        this.showLoading(true);
        fetch(API_BASE + '/history_api.php', {
            method: 'POST',
            body: JSON.stringify({
                password: this.pass,
                action: 'undo_rollback'
            })
        })
        .then(r => r.json())
        .then(res => {
            this.showLoading(false);
            if (res.success) {
                this.showToast('' + (res.message || 'تم التراجع عن الاستعادة وإعادة النظام للحالة السابقة!'));
                this.loadHistory();
            } else {
                this.showToast(res.message || 'فشلت عملية التراجع', true);
            }
        })
        .catch(e => {
            this.showLoading(false);
            console.error('Undo rollback error:', e);
            this.showToast('خطأ بالاتصال أثناء التراجع عن الاستعادة', true);
        });
    },


    fetchGeminiApi(actionQuery) {
        const authed = actionQuery + '&password=' + encodeURIComponent(this.pass || '');
        const url1 = '/backend/api_ai_exam.php?' + authed;
        const url2 = '/backend/api_ai_exam.php?' + authed;

        return fetch(url1)
        .then(r => {
            if (r.status === 404) {
                return fetch(url2);
            }
            return r;
        })
        .then(r => {
            if (!r.ok) {
                return r.text().then(text => { throw new Error('HTTP ' + r.status + ': ' + text.substring(0, 100)); });
            }
            return r.json();
        });
    },

    loadGeminiStatus() {
        const hasCached = !!this.geminiData;
        if (hasCached) {
            this.renderGeminiUI(this.geminiData);
        } else {
            this.showLoading(true);
        }

        this.fetchGeminiApi('action=gemini_status')
        .then(res => {
            if (!hasCached) this.showLoading(false);
            if (res.success && res.data) {
                this.geminiData = res.data;
                this.renderGeminiUI(res.data);
            } else if (!hasCached) {
                this.showToast(res.message || 'فشل في تحميل حالة مفاتيح المعالجة الذكية', true);
            }
        })
        .catch(e => {
            if (!hasCached) {
                this.showLoading(false);
                console.error('Error loading Gemini status:', e);
                this.showToast('خطأ بالاتصال أثناء جلب حالة المعالجة الذكية (' + (e.message || '') + ')', true);
            }
        });
    },

    renderGeminiUI(data) {
        if (!data) return;
        const summary = data.summary || {};
        this.geminiKeysData = data.keys || [];

                const reqEl = document.getElementById('gemini-stat-requests');
                if (reqEl) reqEl.innerText = (summary.total_requests_today || 0).toLocaleString();

                const tokEl = document.getElementById('gemini-stat-tokens');
                if (tokEl) tokEl.innerText = (summary.total_tokens_today || 0).toLocaleString();

                const actEl = document.getElementById('gemini-stat-active');
                if (actEl) actEl.innerText = (summary.active_keys || 0) + ' / ' + (summary.total_keys || 0);

                const exhEl = document.getElementById('gemini-stat-exhausted');
                if (exhEl) exhEl.innerText = ((summary.exhausted_keys || 0) + (summary.invalid_keys || 0));

                // Render Keys Grid
                const gridEl = document.getElementById('gemini-keys-grid');
                if (gridEl) {
                    if (data.keys && data.keys.length > 0) {
                        gridEl.innerHTML = data.keys.map(k => {
                            let statusBadge = '<span class="px-2.5 py-1 text-xs rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">نشط</span>';
                            if (k.status === 'quota_exhausted') {
                                statusBadge = '<span class="px-2.5 py-1 text-xs rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">متجاوز للكوتا (429)</span>';
                            } else if (k.status === 'invalid') {
                                statusBadge = '<span class="px-2.5 py-1 text-xs rounded-full bg-red-500/10 text-red-400 border border-red-500/20">غير صالح</span>';
                            }

                            const rpdPct = Math.min(100, Math.round(((k.requests_today || 0) / (k.rpd_limit || 1500)) * 100));
                            let barColor = 'bg-emerald-500';
                            if (rpdPct >= 90) barColor = 'bg-red-500';
                            else if (rpdPct >= 75) barColor = 'bg-amber-500';

                            const latencyText = k.latency_ms ? (k.latency_ms + ' ms') : 'غير مختبر';

                            return `
                                <div class="glass p-5 rounded-2xl border border-white/10 space-y-3 relative flex flex-col justify-between">
                                    <div>
                                        <div class="flex justify-between items-start mb-2">
                                            <div class="min-w-0 flex-1">
                                                <h4 class="font-bold text-white text-base truncate">${this.escapeHtml(k.label)}</h4>
                                                <div class="flex items-center gap-2 mt-1">
                                                    <span id="gemini-key-display-${k.index}" class="text-xs font-mono text-gray-400 select-all">${k.key_masked}</span>
                                                    <button onclick="AdminApp.toggleGeminiKeyMask(${k.index})" class="text-gray-400 hover:text-white text-xs p-1 rounded transition" title="إظهار / إخفاء المفتاح">
                                                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                                                    </button>
                                                    <button onclick="AdminApp.copyGeminiKey(${k.index})" class="text-gray-400 hover:text-white text-xs p-1 rounded transition" title="نسخ المفتاح">
                                                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
                                                    </button>
                                                </div>
                                            </div>
                                            <div class="shrink-0 mr-2">${statusBadge}</div>
                                        </div>

                                        <div class="mt-3">
                                            <div class="flex justify-between text-xs text-gray-400 mb-1">
                                                <span>الطلبات اليوم</span>
                                                <span class="font-mono text-white">${k.requests_today} / ${k.rpd_limit} RPD</span>
                                            </div>
                                            <div class="w-full bg-black/40 h-2 rounded-full overflow-hidden border border-white/5">
                                                <div class="${barColor} h-full transition-all duration-500" style="width: ${rpdPct}%"></div>
                                            </div>
                                        </div>
                                    </div>

                                    <div class="pt-3 border-t border-white/5 flex flex-col gap-2">
                                        <div class="flex justify-between items-center text-xs text-gray-400">
                                            <span>الاستجابة: <strong class="font-mono text-white">${latencyText}</strong></span>
                                            <span class="text-[10px] text-gray-500">${k.last_tested ? k.last_tested.split(' ')[1] : ''}</span>
                                        </div>
                                        <div class="flex gap-1.5 pt-1">
                                            <button onclick="AdminApp.testGeminiKeys(${k.index})" class="btn btn-secondary text-xs px-2.5 py-1 flex-1 flex items-center justify-center gap-1">
                                                <span>فحص</span>
                                            </button>
                                            <button onclick="AdminApp.openEditGeminiKeyModal(${k.index})" class="btn btn-secondary text-xs px-2.5 py-1 flex-1 flex items-center justify-center gap-1 border-white/10 hover:border-white/30 text-white">
                                                <span>تعديل</span>
                                            </button>
                                            <button onclick="AdminApp.deleteGeminiKey(${k.index})" class="btn btn-danger text-xs px-2.5 py-1 flex items-center justify-center gap-1" title="حذف المفتاح">
                                                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                                                <span>حذف</span>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            `;
                        }).join('');
                    } else {
                        gridEl.innerHTML = '<p class="text-gray-400 text-center py-4 col-span-3">لا توجد مفاتيح مسجلة</p>';
                    }
                }

                // Render Logs Table
                const logsBody = document.getElementById('gemini-logs-body');
                if (logsBody) {
                    if (data.recent_logs && data.recent_logs.length > 0) {
                        logsBody.innerHTML = data.recent_logs.map(log => {
                            let statusTag = '<span class="text-emerald-400">200 OK</span>';
                            if (log.http_code === 429) {
                                statusTag = '<span class="text-amber-400">429 Exceeded</span>';
                            } else if (log.http_code >= 400) {
                                statusTag = `<span class="text-red-400">${log.http_code} Error</span>`;
                            }

                            return `
                                <tr class="hover:bg-white/5 transition">
                                    <td class="p-3 font-mono text-xs text-gray-300">${log.timestamp}</td>
                                    <td class="p-3 font-mono text-xs text-gray-400">${log.key_masked}</td>
                                    <td class="p-3 font-mono text-white">${log.num_questions || '-'}</td>
                                    <td class="p-3 font-mono text-blue-300">${(log.total_tokens || 0).toLocaleString()}</td>
                                    <td class="p-3 font-mono text-gray-300">${log.latency_ms || 0} ms</td>
                                    <td class="p-3 font-mono">${statusTag}</td>
                                </tr>
                            `;
                        }).join('');
                    } else {
                        logsBody.innerHTML = '<tr><td colspan="6" class="p-4 text-center text-gray-500 font-sans">لا توجد سجلات طلبات حتى الآن</td></tr>';
                    }
                }
    },

    testGeminiKeys(keyIndex) {
        this.showLoading(true);
        let query = 'action=test_keys';
        if (keyIndex !== undefined && keyIndex >= 0) {
            query += '&key_index=' + keyIndex;
        }

        this.fetchGeminiApi(query)
        .then(res => {
            this.showLoading(false);
            if (res.success && res.data) {
                this.showToast('تم اختبار مفاتيح المعالجة الذكية بنجاح');
                this.loadGeminiStatus();
            } else {
                this.showToast(res.message || 'فشل اختبار المفاتيح', true);
            }
        })
        .catch(e => {
            this.showLoading(false);
            console.error('Error testing Gemini keys:', e);
            this.showToast('خطأ بالاتصال أثناء اختبار المفاتيح (' + (e.message || '') + ')', true);
        });
    },

    openAddGeminiKeyModal() {
        const titleEl = document.getElementById('gemini-key-modal-title');
        if (titleEl) titleEl.innerText = 'إضافة مفتاح معالجة ذكية جديد';

        document.getElementById('gemini-key-index').value = '-1';
        document.getElementById('gemini-key-id').value = '';
        document.getElementById('gemini-key-label').value = '';
        document.getElementById('gemini-key-val').value = '';

        const saveBtn = document.getElementById('gemini-key-save-btn');
        if (saveBtn) saveBtn.innerText = 'حفظ واختبار المفتاح';

        this.openModal('gemini-key-modal');
    },

    openEditGeminiKeyModal(index) {
        if (!this.geminiKeysData || !this.geminiKeysData[index]) {
            this.showToast('تعذر العثور على بيانات المفتاح', true);
            return;
        }
        const k = this.geminiKeysData[index];

        const titleEl = document.getElementById('gemini-key-modal-title');
        if (titleEl) titleEl.innerText = 'تعديل: ' + (k.label || 'مفتاح المعالجة الذكية');

        document.getElementById('gemini-key-index').value = index;
        document.getElementById('gemini-key-id').value = k.id || '';
        document.getElementById('gemini-key-label').value = k.label || '';
        const keyInput = document.getElementById('gemini-key-val');
        if (keyInput) {
            keyInput.value = '';
            keyInput.placeholder = k.key_masked ? `المفتاح الحالي: ${k.key_masked} (اتركه فارغاً للإبقاء عليه)` : 'أدخل رمز المفتاح (AIzaSy...)';
        }

        const saveBtn = document.getElementById('gemini-key-save-btn');
        if (saveBtn) saveBtn.innerText = 'حفظ التعديلات';

        this.openModal('gemini-key-modal');
    },

    saveGeminiKey() {
        const index = parseInt(document.getElementById('gemini-key-index').value, 10);
        const id = document.getElementById('gemini-key-id').value.trim();
        const label = document.getElementById('gemini-key-label').value.trim();
        const key = document.getElementById('gemini-key-val').value.trim();

        const isAdd = (index === -1);
        if (isAdd && !key) {
            this.showToast('يرجى إدخال رمز المفتاح API Key', true);
            return;
        }

        if (key && key.length < 15) {
            this.showToast('رمز المفتاح قصير جداً وغير صالح', true);
            return;
        }

        const actionName = isAdd ? 'add_gemini_key' : 'edit_gemini_key';
        const payload = {
            password: this.pass,
            label: label,
            key: key
        };

        if (!isAdd) {
            payload.index = index;
            payload.id = id;
        }

        this.showLoading(true);
        const apiBase = (typeof API_BASE !== 'undefined' && API_BASE) ? API_BASE : '';
        fetch(`${apiBase}/backend/api_ai_exam.php?action=${actionName}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
        .then(r => r.json())
        .then(res => {
            this.showLoading(false);
            if (res.success) {
                this.showToast(res.message || 'تم حفظ المفتاح بنجاح!');
                this.closeModal('gemini-key-modal');
                this.loadGeminiStatus();
            } else {
                this.showToast(res.message || 'فشل حفظ المفتاح', true);
            }
        })
        .catch(e => {
            this.showLoading(false);
            console.error('saveGeminiKey error:', e);
            this.showToast('خطأ بالاتصال أثناء حفظ المفتاح: ' + (e.message || ''), true);
        });
    },

    deleteGeminiKey(index) {
        if (!this.geminiKeysData || !this.geminiKeysData[index]) return;
        const k = this.geminiKeysData[index];

        if (this.geminiKeysData.length <= 1) {
            this.showToast('لا يمكن حذف المفتاح الأخير! يجب الإبقاء على مفتاح واحد على الأقل.', true);
            return;
        }

        if (!confirm(`هل أنت متأكد من حذف ${k.label} (${k.key_masked})؟`)) {
            return;
        }

        this.showLoading(true);
        const apiBase = (typeof API_BASE !== 'undefined' && API_BASE) ? API_BASE : '';
        fetch(apiBase + '/backend/api_ai_exam.php?action=delete_gemini_key', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                password: this.pass,
                index: index,
                id: k.id || ''
            })
        })
        .then(r => r.json())
        .then(res => {
            this.showLoading(false);
            if (res.success) {
                this.showToast(res.message || 'تم حذف المفتاح بنجاح');
                this.loadGeminiStatus();
            } else {
                this.showToast(res.message || 'فشل حذف المفتاح', true);
            }
        })
        .catch(e => {
            this.showLoading(false);
            console.error('deleteGeminiKey error:', e);
            this.showToast('خطأ بالاتصال أثناء حذف المفتاح: ' + (e.message || ''), true);
        });
    },

    toggleGeminiKeyMask(index) {
        if (!this.geminiKeysData || !this.geminiKeysData[index]) return;
        const k = this.geminiKeysData[index];
        const displayEl = document.getElementById(`gemini-key-display-${index}`);
        if (!displayEl) return;

        if (displayEl.innerText === k.key_masked) {
            displayEl.innerText = k.key_raw || k.key_masked;
            displayEl.classList.add('text-blue-300', 'font-bold');
            displayEl.classList.remove('text-gray-400');
        } else {
            displayEl.innerText = k.key_masked;
            displayEl.classList.remove('text-blue-300', 'font-bold');
            displayEl.classList.add('text-gray-400');
        }
    },

    copyGeminiKey(index) {
        if (!this.geminiKeysData || !this.geminiKeysData[index]) return;
        const k = this.geminiKeysData[index];
        const raw = k.key_raw || '';
        if (raw) {
            navigator.clipboard.writeText(raw)
            .then(() => this.showToast('تم نسخ مفتاح API للحافظة!'))
            .catch(() => this.showToast('تعذر النسخ للحافظة', true));
        }
    },

    loadQuizzes() {
        const hasCached = Array.isArray(this.quizzesData) && this.quizzesData.length > 0;
        if (hasCached) {
            this.renderQuizzesTable(this.quizzesData);
        } else {
            this.showLoading(true);
        }

        let params = new URLSearchParams({ action: 'list_quizzes' });

        fetch(API_BASE + '/backend/api_ai_exam.php?' + params.toString())
        .then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
            return r.text();
        })
        .then(text => {
            if (!hasCached) this.showLoading(false);
            if (!text || text.trim() === '') {
                if (!hasCached) {
                    console.error('Empty response from API');
                    this.showToast('الخادم لم يرد بأي بيانات - تحقق من سجلات الخادم', true);
                }
                return;
            }
            try {
                const res = JSON.parse(text);
                if (res.success && Array.isArray(res.data)) {
                    this.quizzesData = res.data;
                    this.renderQuizzesTable(res.data);
                } else if (!hasCached) {
                    this.showToast(res.message || 'فشل تحميل الاختبارات', true);
                }
            } catch (parseErr) {
                if (!hasCached) {
                    console.error('JSON Parse Error:', parseErr);
                    this.showToast('خطأ في تحليل البيانات: ' + text.substring(0, 100), true);
                }
            }
        })
        .catch(e => {
            if (!hasCached) {
                this.showLoading(false);
                console.error('Error loading quizzes:', e);
                this.showToast('خطأ في الاتصال بالخادم: ' + e.message, true);
            }
        });
    },

    renderQuizzesTable(list) {
        let displayList = (list || []).filter(q => {
            if (!q || !q.id || q.id === 'exam_generation_limits') return false;
            if (!q.id.startsWith('quiz_') && (!q.num_questions || q.num_questions <= 0)) return false;
            return true;
        });
        if (this.focusMode && this.focusMode.enabled) {
            displayList = displayList.filter(q => {
                if (q.specialty && q.specialty !== this.focusMode.specialty) return false;
                if (q.year !== null && q.year !== undefined && q.year !== '' && String(q.year) !== String(this.focusMode.year)) return false;
                if (q.semester !== null && q.semester !== undefined && q.semester !== '' && String(q.semester) !== String(this.focusMode.semester)) return false;
                return true;
            });
        }
        const tbody = document.getElementById('quizzes-table-body');
        const mobileCards = document.getElementById('quizzes-mobile-cards');
        const countSpan = document.getElementById('quizzes-count');

        if (countSpan) countSpan.innerText = displayList.length;

        if (displayList.length === 0) {
            if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="p-8 text-center text-gray-400">لا توجد اختبارات محفوظة حالياً في هذا النطاق.</td></tr>';
            if (mobileCards) mobileCards.innerHTML = '<div class="p-8 text-center text-xs text-gray-400">لا توجد اختبارات محفوظة حالياً في هذا النطاق.</div>';
            return;
        }

        let html = '';
        let cardsHtml = '';
        displayList.forEach(q => {
            let rawChap = (q.chapter_name || '').replace(/^[\s\-\-]+/, '').trim();
            if (!rawChap || rawChap === 'المحاضرة العامة' || rawChap === 'عام') rawChap = 'ملف المحاضرة';

            let chapList = rawChap.split(/[,•+&\n|]/).map(s => s.trim()).filter(Boolean);
            if (chapList.length === 0) chapList = ['ملف المحاضرة'];

            let chaptersDropdownHTML = `
                <select class="input-field text-xs py-1 px-2.5 bg-black/40 border-white/10 text-emerald-400 font-mono max-w-[220px]" onclick="event.stopPropagation()">
                    ${chapList.map(c => `<option class="bg-card text-gray-200">${this.escapeHtml(c)}</option>`).join('')}
                </select>
            `;

            const scopeParts = [];
            if (q.specialty) scopeParts.push(q.specialty === 'dentistry' ? 'طب الأسنان' : (q.specialty === 'medicine' ? 'الطب البشري' : q.specialty));
            if (q.year !== null && q.year !== undefined && q.year !== '') scopeParts.push(`سنة ${q.year}`);
            if (q.semester !== null && q.semester !== undefined && q.semester !== '') scopeParts.push(`فصل ${q.semester}`);
            const scopeLabel = scopeParts.length > 0 ? scopeParts.join(' | ') : 'غير محدد';

            html += `
                <tr class="hover:bg-white/5 transition">
                    <td class="p-4 font-semibold text-white">${this.escapeHtml(q.quiz_name)}</td>
                    <td class="p-4 text-gray-300">${this.escapeHtml(q.subject_name || 'مادة دراسية')}</td>
                    <td class="p-4">${chaptersDropdownHTML}</td>
                    <td class="p-4 text-center text-xs text-gray-300">${this.escapeHtml(scopeLabel)}</td>
                    <td class="p-4 text-center font-bold text-gray-300">${q.num_questions}</td>
                    <td class="p-4 text-center text-xs text-gray-400 font-mono">${q.created_at || 'N/A'}</td>
                    <td class="p-4 text-center">
                        <div class="flex items-center justify-center gap-2">
                            <button onclick="AdminApp.openRenameQuizModal('${q.id}')" class="btn btn-secondary text-xs px-2.5 py-1.5 font-medium">
                                تعديل الاسم
                            </button>
                            <button onclick="AdminApp.deleteQuiz('${q.id}')" class="btn btn-danger text-xs px-2.5 py-1.5 font-medium">
                                حذف
                            </button>
                        </div>
                    </td>
                </tr>
            `;

            cardsHtml += `
                <div class="bg-black/30 border border-white/10 rounded-xl p-3 space-y-2 max-w-full overflow-hidden">
                    <div class="flex items-start justify-between gap-2">
                        <h5 class="text-white font-semibold text-sm leading-snug break-words min-w-0 flex-1">${this.escapeHtml(q.quiz_name)}</h5>
                        <span class="text-[11px] font-mono font-bold bg-primary/10 text-accent px-2 py-0.5 rounded-full shrink-0">${q.num_questions} س</span>
                    </div>
                    <div class="flex flex-wrap items-center gap-1.5 text-xs text-gray-400">
                        <span class="text-gray-300">${this.escapeHtml(q.subject_name || 'مادة دراسية')}</span>
                        <span>•</span>
                        <span class="text-gray-400">${this.escapeHtml(scopeLabel)}</span>
                    </div>
                    <div class="pt-1.5 border-t border-white/5 flex items-center justify-between gap-2 text-xs">
                        <span class="text-gray-500 font-mono text-[11px]">${q.created_at || ''}</span>
                        <div class="flex items-center gap-2">
                            <button onclick="AdminApp.openRenameQuizModal('${q.id}')" class="btn btn-secondary text-xs px-2.5 py-1">تعديل الاسم</button>
                            <button onclick="AdminApp.deleteQuiz('${q.id}')" class="btn btn-danger text-xs px-2.5 py-1">حذف</button>
                        </div>
                    </div>
                </div>
            `;
        });

        if (tbody) tbody.innerHTML = html;
        if (mobileCards) mobileCards.innerHTML = cardsHtml;
    },

    filterQuizzesTable() {
        const input = document.getElementById('quizzes-search-input');
        if (!input || !this.quizzesData) return;

        const rawQuery = input.value.trim();
        if (!rawQuery) {
            this.renderQuizzesTable(this.quizzesData);
            return;
        }

        const query = this.normalizeArabic(rawQuery);
        const filtered = this.quizzesData.filter(q => {
            const nameNorm = this.normalizeArabic(q.quiz_name);
            const chapNorm = this.normalizeArabic(q.chapter_name);
            const subjNorm = this.normalizeArabic(q.subject_name);
            return nameNorm.includes(query) || chapNorm.includes(query) || subjNorm.includes(query);
        });

        this.renderQuizzesTable(filtered);
    },

    openRenameQuizModal(quizId) {
        const quiz = (this.quizzesData || []).find(q => q.id === quizId);
        if (!quiz) {
            this.showToast('لم يتم العثور على بيانات الاختبار', true);
            return;
        }
        const idInput = document.getElementById('rename-quiz-id');
        const oldNameDiv = document.getElementById('rename-quiz-old-name');
        const newNameInput = document.getElementById('rename-quiz-new-name');

        if (idInput) idInput.value = quiz.id;
        if (oldNameDiv) oldNameDiv.innerText = quiz.quiz_name || 'بدون اسم';
        if (newNameInput) {
            newNameInput.value = quiz.quiz_name || '';
            setTimeout(() => {
                newNameInput.focus();
                newNameInput.select();
            }, 100);
        }
        this.openModal('rename-quiz-modal');
    },

    async submitRenameQuiz() {
        const idInput = document.getElementById('rename-quiz-id');
        const newNameInput = document.getElementById('rename-quiz-new-name');
        const saveBtn = document.getElementById('rename-quiz-save-btn');

        if (!idInput || !newNameInput) return;
        const quizId = idInput.value.trim();
        const newName = newNameInput.value.trim();

        if (!quizId) {
            this.showToast('معرف الاختبار غير صالح', true);
            return;
        }
        if (!newName) {
            this.showToast('يرجى إدخال اسم الاختبار الجديد', true);
            newNameInput.focus();
            return;
        }

        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerText = 'جاري الحفظ...';
        }

        try {
            const res = await fetch(API_BASE + '/backend/api_ai_exam.php?action=rename_quiz', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    password: this.pass,
                    id: quizId,
                    quiz_name: newName
                })
            });

            const data = await res.json();
            if (data && data.success) {
                this.showToast('تم تعديل اسم الاختبار بنجاح');
                if (Array.isArray(this.quizzesData)) {
                    const target = this.quizzesData.find(q => q.id === quizId);
                    if (target) target.quiz_name = newName;
                    this.renderQuizzesTable(this.quizzesData);
                }
                this.closeModal('rename-quiz-modal');
            } else {
                this.showToast(data && data.message ? data.message : 'فشل تعديل اسم الاختبار', true);
            }
        } catch (err) {
            console.error('Error renaming quiz:', err);
            this.showToast('حدث خطأ أثناء تعديل اسم الاختبار', true);
        } finally {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerText = 'حفظ التعديل';
            }
        }
    },

    deleteQuiz(quizId) {
        const quiz = (this.quizzesData || []).find(q => q.id === quizId);
        const quizName = quiz ? quiz.quiz_name : 'هذا الاختبار';
        if (!confirm(`هل أنت متأكد من حذف الاختبار "${quizName}"؟\nسيتم حذفه نهائياً من بنك الأسئلة والملفات.`)) {
            return;
        }

        this.showLoading(true);
        fetch(API_BASE + '/backend/api_ai_exam.php?action=delete_quiz', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: quizId, password: this.pass })
        })
        .then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
            return r.json();
        })
        .then(res => {
            this.showLoading(false);
            if (res.success) {
                this.showToast(`تم حذف الاختبار "${quizName}" بنجاح`);
                this.loadQuizzes();
            } else {
                this.showToast(res.message || 'فشل حذف الاختبار', true);
            }
        })
        .catch(e => {
            this.showLoading(false);
            console.error('Error deleting quiz:', e);
            this.showToast('خطأ في حذف الاختبار: ' + e.message, true);
        });
    },

    // --- CACHE & PRE-WARM MANAGEMENT METHODS ---
    aiExamUrl(action) {
        return `${AI_API_BASE}?action=${encodeURIComponent(action)}`;
    },

    loadCacheStats() {
        const hasCached = !!this.cacheStatsData;
        if (hasCached) {
            this.renderCacheTab(this.cacheStatsData);
        } else {
            this.showLoading(true);
        }

        fetch(this.aiExamUrl('get_cache_stats'), {
            headers: { 'X-Admin-Pass': this.pass || '' }
        })
        .then(r => r.json())
        .then(res => {
            if (!hasCached) this.showLoading(false);
            if (res.success && res.data) {
                this.cacheStatsData = res.data;
                this.renderCacheTab(res.data);
            } else if (!hasCached) {
                this.showToast(res.message || 'فشل جلب إحصائيات الكاش', true);
            }
        })
        .catch(err => {
            if (!hasCached) {
                this.showLoading(false);
                console.error('Error loading cache stats:', err);
                this.showToast('خطأ في الاتصال بالسيرفر أثناء جلب الكاش', true);
            }
        });
    },

    scanDriveCatalog(force = true) {
        this.showLoading(true);
        const action = force ? 'scan_cache_catalog&force=1' : 'scan_cache_catalog';
        fetch(this.aiExamUrl(action), {
            headers: { 'X-Admin-Pass': this.pass || '' }
        })
        .then(r => r.json())
        .then(res => {
            this.showLoading(false);
            if (res.success && res.data) {
                this.showToast('تم تحديث وفهرسة ملفات قوقل درايف بنجاح');
                if (res.data.stats) {
                    this.cacheStatsData = res.data.stats;
                    this.renderCacheTab(res.data.stats);
                } else {
                    this.loadCacheStats();
                }
            } else {
                this.showToast(res.message || 'فشل فحص الفهرس', true);
            }
        })
        .catch(err => {
            this.showLoading(false);
            console.error('Error scanning catalog:', err);
            this.showToast('خطأ في الاتصال أثناء فحص الفهرس', true);
        });
    },

    migrateCacheHierarchy() {
        this.showLoading(true);
        fetch(this.aiExamUrl('migrate_cache_structure'), {
            headers: { 'X-Admin-Pass': this.pass || '' }
        })
        .then(r => r.json())
        .then(res => {
            this.showLoading(false);
            if (res.success && res.data) {
                const moved = Number(res.data.migrated || 0);
                const errors = Array.isArray(res.data.errors) ? res.data.errors.length : 0;
                const message = res.data.message || (moved > 0
                    ? `تم تنظيم المجلدات بنجاح (${moved} ملف تم نقله)`
                    : 'الكاش منظم مسبقاً؛ تم تحديث بيانات التصنيف.');
                this.showToast(errors > 0 ? `${message} (${errors} ملاحظة)` : message, errors > 0);
                if (res.data.stats) {
                    this.renderCacheTab(res.data.stats);
                } else {
                    this.loadCacheStats();
                }
            } else {
                this.showToast(res.message || 'فشل تنظيم المجلدات', true);
            }
        })
        .catch(err => {
            this.showLoading(false);
            console.error('Error migrating cache hierarchy:', err);
            this.showToast('خطأ في الاتصال أثناء تنظيم المجلدات', true);
        });
    },

    prewarmSingleFile(fileId, fileName, subjectName, subjectId, specialty = '', year = '', semester = '') {
        if (!fileId) return;
        if (!specialty && this.focusMode && this.focusMode.enabled) {
            specialty = this.focusMode.specialty || '';
            year = this.focusMode.year || '';
            semester = this.focusMode.semester || '';
        }
        this.showLoading(true);
        fetch(this.aiExamUrl('prewarm_single_file'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                password: this.pass,
                file_id: fileId,
                file_name: fileName || 'ملف مقرر',
                subject_name: subjectName || 'مادة دراسية',
                subject_id: subjectId || null,
                specialty: specialty,
                year: year,
                semester: semester
            })
        })
        .then(r => r.json())
        .then(res => {
            this.showLoading(false);
            if (res.success) {
                this.showToast(`تم استخراج وتخزين (${fileName}) بنجاح`);
                if (res.data && res.data.stats) {
                    this.renderCacheTab(res.data.stats);
                } else {
                    this.loadCacheStats();
                }
            } else {
                this.showToast(res.message || 'فشل استخراج الملف', true);
            }
        })
        .catch(err => {
            this.showLoading(false);
            console.error('Error prewarming single file:', err);
            this.showToast('خطأ في الاتصال أثناء استخراج الملف', true);
        });
    },

    matchesFocusTrack(item) {
        if (!this.focusMode || !this.focusMode.enabled) return true;
        const fSpec = (this.focusMode.specialty || '').toLowerCase().trim();
        const fYear = String(this.focusMode.year !== null && this.focusMode.year !== undefined ? this.focusMode.year : '');
        const fSem = String(this.focusMode.semester !== null && this.focusMode.semester !== undefined ? this.focusMode.semester : '');

        const itemSpec = (item.specialty || '').toLowerCase().trim();
        // Strict specialty match
        if (itemSpec !== fSpec) return false;

        // Pre-Med has only 1 foundation year (accepts 0, 1, '0', '1')
        if (fSpec === 'pre-med' || itemSpec === 'pre-med') {
            // Foundation track year matches
        } else {
            const itemYear = String(item.year !== null && item.year !== undefined ? item.year : '');
            if (itemYear !== fYear) return false;
        }

        // Semester match
        const itemSem = String(item.semester !== null && item.semester !== undefined ? item.semester : '');
        if (itemSem !== fSem) return false;

        return true;
    },

    cacheSubTab: 'cached',
    cacheSearchQuery: '',
    cacheSubjectFilter: 'all',

    switchCacheSubTab(tab) {
        this.cacheSubTab = tab;
        const panelCached = document.getElementById('panel-cached-files');
        const panelUncached = document.getElementById('panel-uncached-files');
        const btnStored = document.getElementById('cache-tab-btn-stored');
        const btnPending = document.getElementById('cache-tab-btn-pending');
        const filterControls = document.getElementById('cache-filter-controls');

        if (tab === 'uncached') {
            if (panelCached) panelCached.classList.add('hidden');
            if (panelUncached) panelUncached.classList.remove('hidden');

            if (btnStored) {
                btnStored.className = 'px-3.5 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-2 text-gray-400 hover:text-white hover:bg-white/5 border border-transparent';
            }
            if (btnPending) {
                btnPending.className = 'px-3.5 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-2 bg-white/10 text-white border border-white/15';
            }
            if (filterControls) filterControls.classList.add('hidden');
        } else {
            if (panelCached) panelCached.classList.remove('hidden');
            if (panelUncached) panelUncached.classList.add('hidden');

            if (btnStored) {
                btnStored.className = 'px-3.5 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-2 bg-white/10 text-white border border-white/15';
            }
            if (btnPending) {
                btnPending.className = 'px-3.5 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-2 text-gray-400 hover:text-white hover:bg-white/5 border border-transparent';
            }
            if (filterControls) filterControls.classList.remove('hidden');
        }
    },

    onCacheSearch(query) {
        this.cacheSearchQuery = (query || '').toLowerCase().trim();
        if (this.lastCacheData) {
            this.renderCachedFilesListOnly();
        }
    },

    onCacheSubjectFilter(subject) {
        this.cacheSubjectFilter = subject || 'all';
        if (this.lastCacheData) {
            this.renderCachedFilesListOnly();
        }
    },

    getTrackBadge(spec, year, sem) {
        const s = (spec || '').toLowerCase().trim();
        const y = (year !== null && year !== undefined && year !== '') ? year : 1;
        const sm = (sem !== null && sem !== undefined && sem !== '') ? sem : 1;
        if (s === 'pre-med') {
            return `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-white/[0.06] text-purple-200 border border-purple-500/20">تحضيري - ف${sm}</span>`;
        } else if (s === 'medicine') {
            return `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-white/[0.06] text-emerald-200 border border-emerald-500/20">طب بشري - س${y} ف${sm}</span>`;
        } else if (s === 'unassigned') {
            return `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-white/[0.06] text-gray-300 border border-white/10">غير مصنف</span>`;
        } else {
            return `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-white/[0.06] text-sky-200 border border-sky-500/20">أسنان - س${y} ف${sm}</span>`;
        }
    },

    renderCacheTab(data) {
        this.lastCacheData = data;
        const countEl = document.getElementById('cache-count-display');
        const sizeEl = document.getElementById('cache-size-display');
        const uncachedCountEl = document.getElementById('uncached-count-display');
        const subsWithFilesEl = document.getElementById('subjects-with-files-display');
        const autoCheck = document.getElementById('cache-auto-prewarm');
        const scheduleSel = document.getElementById('cache-periodic-schedule');
        const lastScanLbl = document.getElementById('cache-last-scan-label');
        const cachedTableCount = document.getElementById('cached-table-count');
        const uncachedTableCount = document.getElementById('uncached-table-count');
        const pendingAlert = document.getElementById('cache-pending-alert');
        const pendingAlertCount = document.getElementById('pending-alert-count');
        const subjectFilterSel = document.getElementById('cache-subject-filter');

        const summary = data.catalog_summary || {};
        const rawCachedFiles = data.cached_files || [];
        const rawUncachedFiles = data.uncached_files || [];

        // Check if Academic Focus Mode is active
        const isFocused = Boolean(this.focusMode && this.focusMode.enabled);
        let cachedFiles = rawCachedFiles.filter(f => this.matchesFocusTrack(f));
        let uncachedFiles = rawUncachedFiles.filter(u => this.matchesFocusTrack(u));

        // Compute stats (focused or global)
        let totalBytes = 0;
        cachedFiles.forEach(f => { totalBytes += (f.size_bytes || 0); });
        const sizeFormatted = (totalBytes > 1048576) 
            ? (totalBytes / 1048576).toFixed(2) + ' MB' 
            : (totalBytes / 1024).toFixed(1) + ' KB';

        const distinctSubjects = new Set();
        cachedFiles.forEach(f => { if (f.subject_name) distinctSubjects.add(f.subject_name); });
        uncachedFiles.forEach(u => { if (u.subject_name) distinctSubjects.add(u.subject_name); });

        if (countEl) countEl.innerText = cachedFiles.length;
        if (sizeEl) sizeEl.innerText = `${isFocused ? sizeFormatted : (data.text_cache_size_formatted || '0 KB')} نصوص مستخرجة`;
        if (uncachedCountEl) uncachedCountEl.innerText = uncachedFiles.length;
        if (subsWithFilesEl) {
            subsWithFilesEl.innerText = isFocused ? `${distinctSubjects.size} مادة` : `${summary.subjects_with_files || distinctSubjects.size || 8} مادة`;
        }

        if (cachedTableCount) cachedTableCount.innerText = cachedFiles.length;
        if (uncachedTableCount) {
            uncachedTableCount.innerText = uncachedFiles.length;
            if (uncachedFiles.length > 0) {
                uncachedTableCount.classList.remove('text-gray-400', 'bg-white/5');
                uncachedTableCount.classList.add('text-amber-300', 'bg-amber-500/20');
            } else {
                uncachedTableCount.classList.remove('text-amber-300', 'bg-amber-500/20');
                uncachedTableCount.classList.add('text-gray-400', 'bg-white/5');
            }
        }

        // Pending alert banner inside stored files tab
        if (pendingAlert && pendingAlertCount) {
            if (uncachedFiles.length > 0) {
                pendingAlertCount.innerText = uncachedFiles.length;
                pendingAlert.classList.remove('hidden');
            } else {
                pendingAlert.classList.add('hidden');
            }
        }

        // Populate Subject Filter options dynamically
        if (subjectFilterSel) {
            const currentSubVal = this.cacheSubjectFilter || 'all';
            let optionsHtml = '<option value="all">جميع المواد</option>';
            const sortedSubjects = Array.from(distinctSubjects).sort();
            sortedSubjects.forEach(s => {
                optionsHtml += `<option value="${this.escapeHtml(s)}"${currentSubVal === s ? ' selected' : ''}>${this.escapeHtml(s)}</option>`;
            });
            subjectFilterSel.innerHTML = optionsHtml;
        }

        const settings = data.settings || {};
        if (autoCheck) autoCheck.checked = (settings.auto_prewarm_on_upload !== false);
        if (scheduleSel) scheduleSel.value = settings.periodic_schedule || 'daily_12pm';

        if (lastScanLbl) {
            lastScanLbl.innerText = summary.last_scan_time ? `آخر فحص: ${summary.last_scan_time}` : 'فهرس نشط';
        }

        // Ensure proper sub-tab display
        this.switchCacheSubTab(this.cacheSubTab || 'cached');

        // Render both lists
        this.renderCachedFilesListOnly();
        this.renderUncachedFilesList(uncachedFiles, isFocused);
    },

    renderCachedFilesListOnly() {
        if (!this.lastCacheData) return;
        const cachedTbody = document.getElementById('cached-files-list');
        const showingCountEl = document.getElementById('cache-showing-count');
        if (!cachedTbody) return;

        const rawCachedFiles = this.lastCacheData.cached_files || [];
        const isFocused = Boolean(this.focusMode && this.focusMode.enabled);
        let cachedFiles = rawCachedFiles.filter(f => this.matchesFocusTrack(f));

        // Filter by subject
        if (this.cacheSubjectFilter && this.cacheSubjectFilter !== 'all') {
            cachedFiles = cachedFiles.filter(f => f.subject_name === this.cacheSubjectFilter);
        }

        // Filter by search query
        if (this.cacheSearchQuery) {
            const q = this.cacheSearchQuery;
            cachedFiles = cachedFiles.filter(f => {
                const sName = (f.subject_name || '').toLowerCase();
                const fName = (f.file_name || '').toLowerCase();
                const fId = (f.file_id || '').toLowerCase();
                const relPath = (f.rel_path || '').toLowerCase();
                return sName.includes(q) || fName.includes(q) || fId.includes(q) || relPath.includes(q);
            });
        }

        if (showingCountEl) {
            const totalInScope = rawCachedFiles.filter(f => this.matchesFocusTrack(f)).length;
            showingCountEl.innerText = `عرض ${cachedFiles.length} من أصل ${totalInScope} ملف مخزن`;
        }

        if (cachedFiles.length === 0) {
            cachedTbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-gray-500">${this.cacheSearchQuery ? 'لا توجد نتائج مطابقة لبحثك في ملفات الكاش.' : (isFocused ? 'لا توجد ملفات مخزنة في الكاش لهذا المسار المحدد حالياً.' : 'لا توجد ملفات مخزنة حالياً في الكاش.')}</td></tr>`;
            return;
        }

        cachedTbody.innerHTML = cachedFiles.map(f => {
            const sName = f.subject_name || 'مادة دراسية';
            const fName = f.file_name || f.file_id;
            const fId = f.file_id;
            const fSize = f.size_formatted || '';
            const relPath = f.rel_path || '';
            const trackBadge = this.getTrackBadge(f.specialty, f.year, f.semester);
            return `
                <tr class="hover:bg-white/[0.02] transition">
                    <td class="p-2.5 text-white font-medium max-w-[220px]">
                        <div class="flex items-center gap-1.5 flex-wrap">
                            ${trackBadge}
                            <span class="truncate font-semibold text-xs text-gray-200" title="${sName}">${sName}</span>
                        </div>
                    </td>
                    <td class="p-2.5 text-gray-300 max-w-[240px]">
                        <div class="truncate font-medium text-xs text-gray-200" title="${fName}">${fName}</div>
                        <div class="text-[10px] text-gray-500 font-mono select-all">${fId}</div>
                    </td>
                    <td class="p-2.5 text-gray-400 font-mono text-[10px] hidden md:table-cell max-w-[200px]" dir="ltr">
                        <div class="truncate" title="${relPath}">${relPath || '-'}</div>
                    </td>
                    <td class="p-2.5 text-center text-gray-300 font-mono text-xs whitespace-nowrap">
                        ${fSize}
                    </td>
                    <td class="p-2.5 text-center whitespace-nowrap">
                        <button onclick="AdminApp.clearCache('${fId}')" class="text-gray-400 hover:text-red-400 hover:bg-red-500/10 border border-white/5 hover:border-red-500/20 px-2.5 py-1 rounded-lg text-xs transition inline-flex items-center gap-1" title="حذف من الكاش">
                            <span>حذف</span>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    },

    renderUncachedFilesList(uncachedFiles, isFocused) {
        const uncachedTbody = document.getElementById('uncached-files-list');
        if (!uncachedTbody) return;

        if (uncachedFiles.length === 0) {
            uncachedTbody.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-gray-500">${isFocused ? 'جميع ملفات هذا المسار مخزنة وجاهزة في الكاش.' : 'جميع ملفات قوقل درايف مخزنة وجاهزة في الكاش.'}</td></tr>`;
            return;
        }

        uncachedTbody.innerHTML = uncachedFiles.map(u => {
            const sName = u.subject_name || 'مادة دراسية';
            const fName = u.file_name || u.file_id;
            const fId = u.file_id;
            const sId = u.subject_id || '';
            const uSpec = u.specialty || '';
            const uYear = u.year || '';
            const uSem = u.semester || '';
            const trackBadge = this.getTrackBadge(u.specialty, u.year, u.semester);
            return `
                <tr class="hover:bg-white/[0.02] transition">
                    <td class="p-2.5 text-white font-medium max-w-[220px]">
                        <div class="flex items-center gap-1.5 flex-wrap">
                            ${trackBadge}
                            <span class="truncate font-semibold text-xs text-gray-200" title="${sName}">${sName}</span>
                        </div>
                    </td>
                    <td class="p-2.5 text-gray-300 max-w-[240px]">
                        <div class="truncate font-medium text-xs text-gray-200" title="${fName}">${fName}</div>
                        <div class="text-[10px] text-gray-500 font-mono select-all">${fId}</div>
                    </td>
                    <td class="p-2.5 text-center whitespace-nowrap">
                        <span class="bg-white/[0.05] text-neutral-300 border border-white/10 text-[11px] px-2 py-0.5 rounded font-mono">بانتظار الاستخراج</span>
                    </td>
                    <td class="p-2.5 text-center whitespace-nowrap">
                        <button onclick="AdminApp.prewarmSingleFile('${fId}', '${fName.replace(/'/g, "\\'")}', '${sName.replace(/'/g, "\\'")}', '${sId}', '${uSpec}', '${uYear}', '${uSem}')" class="btn btn-secondary text-xs py-1 px-3">
                            تجهيز الآن
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    },

    saveCacheSettings() {
        const autoCheck = document.getElementById('cache-auto-prewarm');
        const scheduleSel = document.getElementById('cache-periodic-schedule');

        const payload = {
            password: this.pass,
            auto_prewarm_on_upload: autoCheck ? autoCheck.checked : true,
            periodic_schedule: scheduleSel ? scheduleSel.value : 'daily_12pm'
        };

        this.showLoading(true);
        fetch(this.aiExamUrl('save_cache_settings'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
        .then(r => r.json())
        .then(res => {
            this.showLoading(false);
            if (res.success) {
                this.showToast(res.message || 'تم حفظ إعدادات الكاش بنجاح!');
                this.loadCacheStats();
            } else {
                this.showToast(res.message || 'فشل حفظ الإعدادات', true);
            }
        })
        .catch(err => {
            this.showLoading(false);
            this.showToast('خطأ بالاتصال أثناء حفظ الإعدادات', true);
        });
    },

    async prewarmPendingFilesOnly() {
        let uncached = (this.lastCacheData && this.lastCacheData.uncached_files) ? this.lastCacheData.uncached_files : [];
        if (this.focusMode && this.focusMode.enabled) {
            uncached = uncached.filter(u => this.matchesFocusTrack(u));
        }
        if (!uncached || uncached.length === 0) {
            this.showToast('جميع ملفات هذا المسار مخزنة مسبقاً في الكاش ولا توجد ملفات معلقة');
            return;
        }

        const btn = document.getElementById('btn-prewarm-pending');
        const pBox = document.getElementById('prewarm-progress-box');
        const pBar = document.getElementById('prewarm-bar');
        const pPct = document.getElementById('prewarm-pct');
        const pMsg = document.getElementById('prewarm-status-msg');
        const consoleEl = document.getElementById('prewarm-log-console');

        if (btn) {
            btn.disabled = true;
            btn.innerHTML = 'جاري التجهيز...';
        }

        if (pBox) pBox.classList.remove('hidden');
        if (pBar) pBar.style.width = '2%';
        if (pPct) pPct.innerText = '2%';
        if (pMsg) pMsg.innerText = `جاري تجهيز ${uncached.length} ملف معلق مباشرة...`;

        if (consoleEl) {
            consoleEl.innerHTML = `<div class="text-white font-medium">[${new Date().toLocaleTimeString()}] بدء تجهيز الملفات المعلقة (${uncached.length} ملف)...</div>`;
        }

        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < uncached.length; i++) {
            const u = uncached[i];
            const num = i + 1;
            const pct = Math.round((num / uncached.length) * 100);

            if (pBar) pBar.style.width = pct + '%';
            if (pPct) pPct.innerText = pct + '%';
            if (pMsg) pMsg.innerText = `(${num}/${uncached.length}) جاري استخراج: ${u.file_name || u.file_id}...`;

            try {
                const res = await fetch(this.aiExamUrl('prewarm_single_file'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(25000) : undefined,
                    body: JSON.stringify({
                        password: this.pass,
                        file_id: u.file_id,
                        file_name: u.file_name || 'ملف مقرر',
                        subject_name: u.subject_name || 'مادة دراسية',
                        subject_id: u.subject_id || null,
                        specialty: u.specialty || '',
                        year: u.year || null,
                        semester: u.semester || null
                    })
                });

                const data = await res.json();
                if (data.success) {
                    successCount++;
                    if (consoleEl) {
                        consoleEl.innerHTML += `<div class="text-emerald-400 font-medium">[${new Date().toLocaleTimeString()}]  (${num}/${uncached.length}) ${u.subject_name}: ${u.file_name}</div>`;
                        consoleEl.scrollTop = consoleEl.scrollHeight;
                    }
                    if (data.data && data.data.stats) {
                        this.renderCacheTab(data.data.stats);
                    }
                } else {
                    failCount++;
                    if (consoleEl) {
                        consoleEl.innerHTML += `<div class="text-red-400">[${new Date().toLocaleTimeString()}]  (${num}/${uncached.length}) ${u.file_name}: ${data.message || 'خطأ'}</div>`;
                        consoleEl.scrollTop = consoleEl.scrollHeight;
                    }
                }
            } catch (err) {
                failCount++;
                if (consoleEl) {
                    consoleEl.innerHTML += `<div class="text-red-400">[${new Date().toLocaleTimeString()}]  (${num}/${uncached.length}) ${u.file_name}: تعذر المعالجة (${err.message})</div>`;
                    consoleEl.scrollTop = consoleEl.scrollHeight;
                }
            }
        }

        if (pBar) pBar.style.width = '100%';
        if (pPct) pPct.innerText = '100%';
        if (pMsg) pMsg.innerText = `اكتمل تجهيز الملفات المعلقة: تم تخزين ${successCount} ملف بنجاح.`;

        if (btn) {
            btn.disabled = false;
            btn.innerHTML = 'تجهيز الملفات المعلقة';
        }

        this.showToast(`اكتملت المعالجة: تم تخزين ${successCount} ملف`);
        this.loadCacheStats();
    },

    async runPrewarmCache() {
        const btn = document.getElementById('btn-prewarm-now');
        const pBox = document.getElementById('prewarm-progress-box');
        const pBar = document.getElementById('prewarm-bar');
        const pPct = document.getElementById('prewarm-pct');
        const pMsg = document.getElementById('prewarm-status-msg');
        const consoleEl = document.getElementById('prewarm-log-console');

        if (btn) {
            btn.disabled = true;
            btn.innerHTML = 'جاري التجهيز...';
        }

        if (pBox) pBox.classList.remove('hidden');
        if (pBar) pBar.style.width = '2%';
        if (pPct) pPct.innerText = '2%';
        if (pMsg) pMsg.innerText = 'جاري جلب قائمة المواد من قاعدة البيانات...';

        if (consoleEl) {
            consoleEl.innerHTML = `<div class="text-white font-medium">[${new Date().toLocaleTimeString()}] بدء عملية التجهيز والاستخراج المسبق لجميع المواد...</div>`;
        }

        try {
            // 1. Get subjects list
            const subRes = await fetch(this.aiExamUrl('get_prewarm_subjects'), {
                headers: { 'X-Admin-Pass': this.pass || '' }
            });
            const subData = await subRes.json();

            if (!subData.success || !subData.data || !subData.data.subjects) {
                throw new Error(subData.message || 'فشل جلب قائمة المواد');
            }

            let subjects = subData.data.subjects;
            if (this.focusMode && this.focusMode.enabled) {
                subjects = subjects.filter(s => this.matchesFocusTrack(s));
            }
            const total = subjects.length;

            if (total === 0) {
                if (pMsg) pMsg.innerText = (this.focusMode && this.focusMode.enabled) ? 'لا توجد مواد مرتبطة بقوقل درايف لهذا المسار المحدد.' : 'لا توجد مواد مرتبطة بمجلدات قوقل درايف.';
                if (btn) { btn.disabled = false; btn.innerHTML = 'بدء التجهيز الشامل الآن'; }
                return;
            }

            let totalFilesScanned = 0;
            let newlyCachedCount = 0;
            let alreadyCachedCount = 0;
            let errorsCount = 0;

            if (consoleEl) {
                consoleEl.innerHTML += `<div class="text-gray-400">تم العثور على ${total} مادة دراسية. جاري مسح واستخراج الملفات بالتتابع...</div>`;
            }

            // 2. Process subjects sequentially
            for (let i = 0; i < total; i++) {
                const sub = subjects[i];
                const sNum = i + 1;
                const pct = Math.round((sNum / total) * 100);

                if (pBar) pBar.style.width = pct + '%';
                if (pPct) pPct.innerText = pct + '%';
                if (pMsg) pMsg.innerText = `(${sNum}/${total}) جاري فحص مادة: ${sub.name}...`;

                let offset = 0;
                let hasMore = true;
                let subTotalFiles = 0;
                let subNewlyCached = 0;
                let subAlreadyCached = 0;

                while (hasMore) {
                    try {
                        const itemRes = await fetch(this.aiExamUrl('prewarm_subject'), {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(20000) : undefined,
                            body: JSON.stringify({
                                password: this.pass,
                                subject_id: sub.id,
                                folder_id: sub.chapters_folder_id,
                                subject_name: sub.name,
                                specialty: sub.specialty || '',
                                year: sub.year || 1,
                                semester: sub.semester || 1,
                                offset: offset,
                                limit: 1
                            })
                        });

                        const itemData = await itemRes.json();
                        if (itemData.success && itemData.data) {
                            const d = itemData.data;
                            subTotalFiles = d.total_files || 0;
                            subNewlyCached += (d.newly_cached || 0);
                            subAlreadyCached += (d.already_cached || 0);
                            hasMore = (d.has_more === true);
                            offset = (d.next_offset !== undefined) ? d.next_offset : (offset + 1);

                            if (d.log && d.log.length > 0 && consoleEl) {
                                consoleEl.innerHTML += d.log.map(l => `<div class="text-emerald-400 font-medium">[${new Date().toLocaleTimeString()}] تم تخزين: ${sub.name} - ${l}</div>`).join('');
                                consoleEl.scrollTop = consoleEl.scrollHeight;
                            }

                            if (!hasMore) {
                                totalFilesScanned += subTotalFiles;
                                newlyCachedCount += subNewlyCached;
                                alreadyCachedCount += subAlreadyCached;
                                if (consoleEl && subTotalFiles > 0) {
                                    consoleEl.innerHTML += `<div class="text-gray-300">[${new Date().toLocaleTimeString()}] اكتملت: ${sub.name} (${subTotalFiles} ملف)</div>`;
                                    consoleEl.scrollTop = consoleEl.scrollHeight;
                                }
                            }
                        } else {
                            hasMore = false;
                            errorsCount++;
                            if (consoleEl) {
                                consoleEl.innerHTML += `<div class="text-red-400">[${new Date().toLocaleTimeString()}] تنبيه (${sNum}/${total}) ${sub.name}: ${itemData.message || 'خطأ'}</div>`;
                                consoleEl.scrollTop = consoleEl.scrollHeight;
                            }
                        }
                    } catch (subErr) {
                        hasMore = false;
                        errorsCount++;
                        if (consoleEl) {
                            consoleEl.innerHTML += `<div class="text-red-400">[${new Date().toLocaleTimeString()}] تنبيه (${sNum}/${total}) ${sub.name}: تعذر الاتصال بالملفات</div>`;
                            consoleEl.scrollTop = consoleEl.scrollHeight;
                        }
                    }
                }
            }

            // 3. Completed
            if (pBar) pBar.style.width = '100%';
            if (pPct) pPct.innerText = '100%';
            if (pMsg) pMsg.innerText = `اكتمل التجهيز: تم فحص ${totalFilesScanned} ملف، وتخزين ${newlyCachedCount} ملفات جديدة بنجاح.`;

            if (consoleEl) {
                consoleEl.innerHTML += `<div class="text-emerald-400 font-medium border-t border-white/10 pt-2 mt-2">اكتملت العملية بنجاح. إجمالي المواد: ${total} | ملفات مخزنة جديدة: ${newlyCachedCount} | كانت مخزنة مسبقاً: ${alreadyCachedCount}</div>`;
                consoleEl.scrollTop = consoleEl.scrollHeight;
            }

            this.showToast('اكتمل التجهيز المسبق لجميع المواد بنجاح');
            this.loadCacheStats();

        } catch (err) {
            console.error('Prewarm error:', err);
            if (pMsg) pMsg.innerText = 'حدث خطأ أثناء التجهيز المسبق.';
            this.showToast('حدث خطأ أثناء عملية التجهيز: ' + err.message, true);
            if (consoleEl) {
                consoleEl.innerHTML += `<div class="text-rose-400 font-medium">[${new Date().toLocaleTimeString()}] خطأ: ${err.message}</div>`;
            }
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = 'بدء التجهيز الشامل الآن';
            }
        }
    },

    clearCache(fileId = null) {
        const confirmMsg = fileId 
            ? `هل أنت متأكد من حذف هذا الملف من الذاكرة السريعة؟`
            : 'هل أنت متأكد من تفريغ كامل الذاكرة السريعة (Cache) لجميع الشباتر؟';

        if (!confirm(confirmMsg)) return;

        this.showLoading(true);
        fetch(this.aiExamUrl('clear_cache'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: this.pass, file_id: fileId || '' })
        })
        .then(r => r.json())
        .then(res => {
            this.showLoading(false);
            if (res.success) {
                this.showToast(res.message || 'تم تحديث الكاش بنجاح');
                if (res.data && res.data.cache_stats) {
                    this.renderCacheTab(res.data.cache_stats);
                } else {
                    this.loadCacheStats();
                }
            } else {
                this.showToast(res.message || 'فشل تفريغ الكاش', true);
            }
        })
        .catch(err => {
            this.showLoading(false);
            this.showToast('خطأ بالاتصال أثناء تفريغ الكاش', true);
        });
    }
};

document.addEventListener('DOMContentLoaded', () => {
    window.AdminApp.init();
});



