const API_BASE = (window.location.pathname === '/dev' || window.location.pathname.startsWith('/dev/')) ? '/dev' : '';
// dashboard.js
// This script fetches data from the PHP API and dynamically builds the chapters and materials blocks.

const API_BASE_URL = API_BASE + '/dent2025_api.php';

// Safe HTML entity escaping helper
function dentEscapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/[&<>"']/g, function(m) {
        return {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        }[m];
    });
}

// Protocol validator for links
function dentSafeUrl(url) {
    if (!url) return '#';
    const trimmed = String(url).trim();
    if (trimmed.startsWith('https://') || trimmed.startsWith('http://') || trimmed.startsWith('mailto:')) {
        return trimmed;
    }
    return '#';
}

// Safe rich-text sanitizer for announcements
function dentSanitizeRichText(dirtyHtml) {
    if (!dirtyHtml) return '';
    try {
        const doc = new DOMParser().parseFromString(dirtyHtml, 'text/html');
        doc.querySelectorAll('script, style, iframe, object, embed, meta, link, base').forEach(el => el.remove());
        doc.querySelectorAll('*').forEach(el => {
            Array.from(el.attributes).forEach(attr => {
                const name = attr.name.toLowerCase();
                const val = attr.value.trim().toLowerCase();
                if (name.startsWith('on') || val.startsWith('javascript:') || val.startsWith('data:text/html')) {
                    el.removeAttribute(attr.name);
                }
            });
        });
        return doc.body.innerHTML;
    } catch (e) {
        return String(dirtyHtml).replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    }
}

let currentSubjectsData = [];

// Global queue for background iframe loading
window.dentIframeQueue = [];
window.isDentIframeProcessing = false;

function processDentIframeQueue() {
    if (!window.dentIframeQueue || window.dentIframeQueue.length === 0) {
        window.isDentIframeProcessing = false;
        return;
    }
    window.isDentIframeProcessing = true;
    
    let iframe = window.dentIframeQueue.shift();
    if (iframe && (iframe.src === '' || iframe.src === 'about:blank' || iframe.src === window.location.href)) {
        const dataSrc = iframe.getAttribute('data-src');
        if (dataSrc) {
            iframe.src = dataSrc;
        }
        // Responsive interval between sequential background iframe loads
        setTimeout(processDentIframeQueue, 800);
    } else {
        processDentIframeQueue();
    }
}

function loadSubjectIframes(detailsEl) {
    if (!detailsEl || !detailsEl.open) return;
    const iframes = detailsEl.querySelectorAll('iframe[data-src]');
    iframes.forEach(iframe => {
        if (!iframe.src || iframe.src === 'about:blank' || iframe.src === window.location.href) {
            const dataSrc = iframe.getAttribute('data-src');
            if (dataSrc) {
                iframe.src = dataSrc;
            }
        }
    });
}

// Analytics helper: safe no-op if tracker not loaded yet
function dentTrack(type, data) {
    try {
        if (window.dentAnalytics && typeof window.dentAnalytics.track === 'function') {
            return window.dentAnalytics.track(type, data || {});
        }
    } catch (e) {}
}

// IMMEDIATE CHECK: Redirect BEFORE the page even renders if no selection exists or selection is invalid
// This prevents the ugly flash/glitch when visiting any page without choosing a specialty first
(function() {
    const isWelcomePage = window.location.pathname.includes('wolcome') || window.location.pathname.includes('welcome');
    if (isWelcomePage) return; // Don't redirect FROM the welcome page itself

    let isValidSelection = false;
    try {
        const raw = localStorage.getItem('dent2025_selection');
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && parsed.specialty && parsed.semester !== undefined) {
                isValidSelection = true;
            }
        }
    } catch (e) {}

    if (!isValidSelection) {
        // Save the page the user was trying to visit so we can redirect back after selection
        sessionStorage.setItem('dent2025_redirect_after', window.location.pathname);
        // Hide everything instantly to prevent visual flash
        document.documentElement.style.visibility = 'hidden';
        window.location.replace(API_BASE + '/wolcome/');
        return;
    }
})();

function dentInitDashboard() {
    const isWelcomePage = window.location.pathname.includes('wolcome') || window.location.pathname.includes('welcome');
    let selectionData = null;
    try {
        const raw = localStorage.getItem('dent2025_selection');
        if (raw) selectionData = JSON.parse(raw);
    } catch(e) {}
    
    // Always inject the path changer if we have a selection and we are not on the welcome page
    if (!isWelcomePage && selectionData && selectionData.specialty) {
        injectPathChanger(selectionData);
    }

    if (isWelcomePage) return; // Nothing to do on the welcome page

    const isMainPage = window.location.pathname === API_BASE + '/' || window.location.pathname === '/dev';
    
    // On the main page, only swap logo and load announcements (no chapters/materials)
    if (isMainPage) {
        if (selectionData) {
            const selection = selectionData;
            renderLogo(selection);
            loadAnnouncements(selection);
        }
        return;
    }

    loadDashboardData();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', dentInitDashboard);
} else {
    dentInitDashboard();
}

function loadDashboardData(forceRefresh = false) {
    const selectionData = localStorage.getItem('dent2025_selection');
    if (!selectionData) return;

    const selection = JSON.parse(selectionData);
    dentTrack('context_select', { ctx: { specialty: selection.specialty, year: selection.year, semester: selection.semester } });

    // Update top nav if you have an element for it
    const navText = document.getElementById('current-selection-text');
    if (navText) {
        let specName = selection.specialty === 'dentistry' ? 'طب الأسنان' : (selection.specialty === 'medicine' ? 'الطب البشري' : 'التحضيري');
        let semText = `السنة ${selection.year} - الفصل ${selection.semester}`;
        if (selection.specialty === 'medicine') {
            let levelPart1 = (selection.year * 2) - 1;
            let levelPart2 = selection.year * 2;
            let semLevel = selection.semester == 1 ? levelPart1 : levelPart2;
            semText = `السنة ${selection.year} - الفصل ${selection.semester} (مستوى ${semLevel} - جزء ${selection.semester})`;
        } else if (selection.specialty === 'pre-med') {
            semText = `السنة التحضيرية - الفصل ${selection.semester}`;
        }
        navText.innerText = `${specName} - ${semText}`;
    }

    renderLogo(selection);
    loadAnnouncements(selection);
    loadClassesData(selection);

    const cacheKey = `dent2025_dashboard_data_${selection.specialty}_${selection.year}_${selection.semester}`;
    const cacheBuster = forceRefresh ? `&nocache=1&_t=${Date.now()}` : '';

    if (forceRefresh) {
        sessionStorage.removeItem(cacheKey);
    }

    // Fetch data with sessionStorage caching unless the caller requested a hard refresh
    const cachedData = forceRefresh ? null : sessionStorage.getItem(cacheKey);

    const processData = (data) => {
        currentSubjectsData = data.subjects || [];
        renderChapters(currentSubjectsData);
        renderMaterials(currentSubjectsData);
        loadClassesData(selection);
    };

    if (cachedData) {
        processData(JSON.parse(cachedData));
        // Update cache in background and hot-refresh if server data was updated
        fetch(`${API_BASE_URL}?action=data&specialty=${selection.specialty}&year=${selection.year}&semester=${selection.semester}${cacheBuster}`)
            .then(res => res.json())
            .then(data => { 
                if (data.success && data.data && Array.isArray(data.data.subjects)) {
                    const freshJson = JSON.stringify(data.data);
                    if (freshJson !== cachedData) {
                        sessionStorage.setItem(cacheKey, freshJson);
                        processData(data.data);
                    }
                }
            })
            .catch(e => {});
        return;
    }

    fetch(`${API_BASE_URL}?action=data&specialty=${selection.specialty}&year=${selection.year}&semester=${selection.semester}${cacheBuster}`)
        .then(res => {
            if (!res.ok) throw new Error(`Server returned ${res.status}`);
            return res.json();
        })
        .then(data => {
            if (data.success) {
                if (data.data && Array.isArray(data.data.subjects)) {
                    sessionStorage.setItem(cacheKey, JSON.stringify(data.data));
                }
                processData(data.data);
            } else {
                showError('chapters', data.message || 'Unknown error from API');
                showError('materials', data.message || 'Unknown error from API');
            }
        })
        .catch(err => {
            console.error("API Error:", err);
            showError('chapters', 'تعذر الاتصال بالسيرفر (' + err.message + ')');
            showError('materials', 'تعذر الاتصال بالسيرفر (' + err.message + ')');
        });
}

function showError(section, msg) {
    const containerId = section === 'chapters' ? 'dynamic-chapters-container' : 'dynamic-materials-container';
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = `
        <div style="background: rgba(239,68,68,0.1); border: 1px dashed rgba(239,68,68,0.4); border-radius: 12px; padding: 30px; text-align: center; margin: 10px 0;">
            <p style="color:#f87171; font-size:1rem;">${msg}</p>
        </div>
    `;
}

// Check if user is in admin mode
function isAdmin() {
    return sessionStorage.getItem('dent2025_admin_pass') !== null;
}

// Determine "master" (full) admin privileges from server-granted permissions
// returned by check_auth at login -- NEVER from hardcoded client-side passkeys.
function dentIsMaster() {
    if (!isAdmin()) return false;
    let perms = {};
    try { perms = JSON.parse(sessionStorage.getItem('dent2025_permissions') || '{}'); } catch(e) {}
    return !!perms.edit_core_subject || !!perms.delete_subject || !!perms.manage_passwords;
}

// Generate Admin Action Buttons HTML
function getAdminButtons(sub) {
    if (!isAdmin()) return '';
    const isMaster = dentIsMaster();
    
    const deleteBtn = isMaster ? `<button onclick="deleteSubject(${sub.id})" style="background: rgba(185,28,28,0.12); border: 1px solid rgba(185,28,28,0.25); padding: 6px 12px; border-radius: 8px; color: #ef4444; cursor: pointer; transition: all 0.2s ease; font-family: inherit; font-size: 0.9rem;" onmouseover="this.style.background='rgba(185,28,28,0.25)'" onmouseout="this.style.background='rgba(185,28,28,0.12)'">حذف (Delete)</button>` : '';

    return `
        <div style="margin-top: 15px; display: flex; gap: 8px; justify-content: flex-end; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 12px;">
            <button onclick="editSubject(${sub.id})" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); padding: 6px 12px; border-radius: 8px; color: #cbd5e1; cursor: pointer; transition: all 0.2s ease; font-family: inherit; font-size: 0.9rem;" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'">تعديل (Edit)</button>
            ${deleteBtn}
        </div>
    `;
}

// Global helper for tab switching inside subject cards
window.switchDentTab = function(subId, tabType, event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    const card = document.getElementById(`dent-subject-card-${subId}`);
    if (!card) return;

    if (tabType === 'materials') {
        const sub = currentSubjectsData.find(s => s.id == subId);
        dentTrack('materials_open', { subject: sub ? sub.name : 'مادة' });
    }

    // Toggle button active classes
    const btns = card.querySelectorAll('.dent-tab-btn');
    btns.forEach(b => b.classList.remove('active'));

    const clickedBtn = (event && event.currentTarget) ? event.currentTarget : card.querySelector(`.dent-tab-btn[data-tab="${tabType}"]`);
    if (clickedBtn) clickedBtn.classList.add('active');

    // Toggle panel active classes
    const panels = card.querySelectorAll('.dent-tab-panel');
    panels.forEach(p => p.classList.remove('active'));

    const activePanel = document.getElementById(`dent-panel-${tabType}-${subId}`);
    if (activePanel) {
        activePanel.classList.add('active');

        // Lazy-load iframe if not loaded yet
        const iframe = activePanel.querySelector('iframe');
        if (iframe && (iframe.src === '' || iframe.src === 'about:blank' || iframe.src === window.location.href)) {
            const dataSrc = iframe.getAttribute('data-src');
            if (dataSrc) {
                iframe.src = dataSrc;
            }
        }
    }
};

// ---------------------------------------------------------
// Render Chapters (Unified Subjects Hub)
// ---------------------------------------------------------
function renderChapters(subjects) {
    const container = document.getElementById('dynamic-chapters-container');
    if (!container) return;

    container.innerHTML = '';

    if (!subjects || subjects.length === 0) {
        container.innerHTML = `
            <div class="dent-chapters-wrapper">
                <div style="background: rgba(0,0,0,0.2); border: 1px dashed rgba(255,255,255,0.1); padding: 30px; text-align: center; border-radius: 12px;">
                    <p style="color:#94a3b8; font-size:0.9rem;">(لم يتم إضافة مواد لهذا الفصل بعد. تواصل مع الليدر لإضافتها)</p>
                </div>
            </div>
        `;
        container.style.opacity = '1';
        return;
    }

    let html = `
    <div class="dent-section-header">
        <h2 class="dent-section-title">المواد الدراسية</h2>
        <p class="dent-section-subtitle">اختر المادة للوصول إلى الشابترات والمحاضرات والمصادر الإضافية</p>
    </div>
    <div class="dent-chapters-wrapper">`;

    subjects.forEach((sub) => {
        let infoHtml = "";
        if (sub.hours) infoHtml += `<div class="dent-info-item"><span class="dent-info-label">الساعات:</span><span class="dent-info-value" dir="auto">${sub.hours}</span></div>`;
        if (sub.marks) infoHtml += `<div class="dent-info-item"><span class="dent-info-label">توزيع الدرجات:</span><span class="dent-info-value" dir="auto">${sub.marks}</span></div>`;

        let adminBtns = getAdminButtons(sub);
        let infoBox = (infoHtml || adminBtns) ? `<div class="dent-chapter-info-box">${infoHtml}${adminBtns}</div>` : '';

        html += `
        <details class="dent-chapter-details" id="dent-subject-card-${sub.id}" ontoggle="loadSubjectIframes(this)">
            <summary class="dent-chapter-summary">
                <span style="flex: 1;">${dentEscapeHtml(sub.name)}</span>
            </summary>
            ${infoBox}

            <div class="dent-tab-switcher">
                <button type="button" class="dent-tab-btn active" data-tab="chapters" onclick="switchDentTab(${sub.id}, 'chapters', event)">
                    الشابترات والمحاضرات
                </button>
                <button type="button" class="dent-tab-btn" data-tab="materials" onclick="switchDentTab(${sub.id}, 'materials', event)">
                    المصادر الإضافية والروابط
                </button>
            </div>

            <div class="dent-tab-content-container">
                <!-- TAB 1: CHAPTERS -->
                <div id="dent-panel-chapters-${sub.id}" class="dent-tab-panel active">
                    ${sub.chapters_folder_id ? `
                        <div class="dent-chapter-iframe-container" id="dent-iframe-container-chapters-${sub.id}">
                            <iframe src="about:blank" style="color-scheme: light;" data-src="https://drive.google.com/embeddedfolderview?id=${sub.chapters_folder_id}#list" title="${dentEscapeHtml(sub.name)} Chapters"></iframe>
                        </div>
                        <div class="dent-tab-footer">
                            <button type="button" class="dent-drive-action-btn dent-expand-toggle-btn" onclick="toggleIframeExpand('dent-iframe-container-chapters-${sub.id}', this)" title="تكبير أو تصغير مساحة العرض">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>
                                <span>تكبير العرض</span>
                            </button>
                            <a href="https://drive.google.com/drive/folders/${sub.chapters_folder_id}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" class="dent-drive-action-btn" title="فتح المجلد في جوجل درايف">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                                فتح المجلد في Google Drive
                            </a>
                        </div>
                    ` : `
                        <div style="padding: 30px 15px; text-align: center; color: #94a3b8; font-size: 0.88rem; background: rgba(0,0,0,0.15);">
                            لم يتم ربط مجلد جوجل درايف للشابترات بعد. (قيد التجهيز من قبل ممثل الدفعة)
                        </div>
                    `}
                </div>

                <!-- TAB 2: MATERIALS & LINKS -->
                <div id="dent-panel-materials-${sub.id}" class="dent-tab-panel">
                    ${sub.materials_folder_id ? `
                        <div class="dent-chapter-iframe-container" id="dent-iframe-container-materials-${sub.id}">
                            <iframe src="about:blank" style="color-scheme: light;" data-src="https://drive.google.com/embeddedfolderview?id=${sub.materials_folder_id}#list" title="${dentEscapeHtml(sub.name)} Materials"></iframe>
                        </div>
                    ` : `
                        <div style="padding: 20px 15px; text-align: center; color: #94a3b8; font-size: 0.88rem; background: rgba(0,0,0,0.15);">
                            لم يتم ربط مجلد جوجل درايف للمصادر بعد.
                        </div>
                    `}
                    <div class="dent-materials-links" style="padding: 12px 16px; border-top: 1px solid rgba(255,255,255,0.05);">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <h4 style="margin: 0; font-size: 0.85rem; font-weight: 600; color: #cbd5e1;">روابط مساعدة <span class="en" style="font-size: 0.75rem; color: #94a3b8; font-weight: 400;">(Helpful Links)</span></h4>
                            ${isAdmin() ? `<button onclick="openAddLinkModal(${sub.id})" class="dent-add-link-btn" style="padding: 3px 10px; font-size: 0.75rem;">+ إضافة رابط</button>` : ''}
                        </div>
                        ${generateLinksHtml(sub.links)}
                    </div>
                    ${sub.materials_folder_id ? `
                        <div class="dent-tab-footer">
                            <button type="button" class="dent-drive-action-btn dent-expand-toggle-btn" onclick="toggleIframeExpand('dent-iframe-container-materials-${sub.id}', this)" title="تكبير أو تصغير مساحة العرض">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>
                                <span>تكبير العرض</span>
                            </button>
                            <a href="https://drive.google.com/drive/folders/${sub.materials_folder_id}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" class="dent-drive-action-btn" title="فتح مجلد المصادر في جوجل درايف">
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                                فتح مجلد المصادر في Google Drive
                            </a>
                        </div>
                    ` : ''}
                </div>
            </div>
        </details>
        `;
    });

    html += '</div>';
    container.innerHTML = html;
    container.style.opacity = '1';

    // Queue iframes sequentially in background (Chapters first, then Materials)
    window.dentIframeQueue = [];
    const details = container.querySelectorAll('.dent-chapter-details');

    // 1. Queue all Chapters iframes first
    details.forEach((det) => {
        const chaptersIframe = det.querySelector('.dent-tab-panel[id^="dent-panel-chapters-"] iframe');
        if (chaptersIframe) window.dentIframeQueue.push(chaptersIframe);
    });

    // 2. Queue all Materials iframes in sequence
    details.forEach((det) => {
        const materialsIframe = det.querySelector('.dent-tab-panel[id^="dent-panel-materials-"] iframe');
        if (materialsIframe) window.dentIframeQueue.push(materialsIframe);
    });

    details.forEach((det) => {
        det.addEventListener('toggle', () => {
            if (det.open) {
                const subId = parseInt((det.id || '').replace('dent-subject-card-', ''), 10);
                const sub = currentSubjectsData.find(s => s.id == subId);
                dentTrack('subject_open', { subject: sub ? sub.name : 'مادة' });

                // 1. Immediately load active iframe in this card
                const visibleIframe = det.querySelector('.dent-tab-panel.active iframe');
                if (visibleIframe && (visibleIframe.src === '' || visibleIframe.src === 'about:blank' || visibleIframe.src === window.location.href)) {
                    const dataSrc = visibleIframe.getAttribute('data-src');
                    if (dataSrc) visibleIframe.src = dataSrc;
                }

                // 2. Prioritize this clicked subject's other tab (e.g. Materials) to the front of queue
                const otherIframe = det.querySelector('.dent-tab-panel:not(.active) iframe');
                if (otherIframe && (otherIframe.src === '' || otherIframe.src === 'about:blank' || otherIframe.src === window.location.href)) {
                    window.dentIframeQueue = window.dentIframeQueue.filter(f => f !== otherIframe && f !== visibleIframe);
                    window.dentIframeQueue.unshift(otherIframe);
                    if (!window.isDentIframeProcessing) {
                        window.isDentIframeProcessing = true;
                        setTimeout(processDentIframeQueue, 300);
                    }
                }
            }
        });
    });

    if (!window.isDentIframeProcessing) {
        window.isDentIframeProcessing = true;
        setTimeout(processDentIframeQueue, 600);
    }
}

// ---------------------------------------------------------
// Render Materials (Clears & Hides second container)
// ---------------------------------------------------------
function renderMaterials(subjects) {
    const container = document.getElementById('dynamic-materials-container');
    if (!container) return;
    container.innerHTML = '';
    container.style.display = 'none';
}

window.refreshIframe = function(iframeId) {
    const iframe = document.getElementById(iframeId);
    if (iframe && iframe.src && iframe.src.includes('drive.google.com')) {
        let currentSrc = iframe.src;
        iframe.src = 'about:blank';
        setTimeout(() => { iframe.src = currentSrc; }, 100);
    }
};

window.toggleIframeExpand = function(containerId, btn) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const isExpanded = container.classList.toggle('is-expanded');
    if (btn) {
        const label = btn.querySelector('span');
        const svg = btn.querySelector('svg');
        if (isExpanded) {
            if (label) label.textContent = 'تصغير العرض';
            if (svg) svg.innerHTML = '<polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="3" y1="21" x2="10" y2="14"></line>';
        } else {
            if (label) label.textContent = 'تكبير العرض';
            if (svg) svg.innerHTML = '<polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line>';
        }
    }
};

// API calls for Edit and Delete
window.editSubject = function(id) {
    const sub = currentSubjectsData.find(s => s.id == id);
    if (!sub) return;
    
    // Parse hours to get theory and practical (e.g. "2 نظري، 1 عملي" or "3 نظري")
    let th = 0, pr = 0;
    if (sub.hours) {
        const tMatch = sub.hours.match(/(\d+)\s*نظري/);
        const pMatch = sub.hours.match(/(\d+)\s*عملي/);
        if (tMatch) th = parseInt(tMatch[1]);
        if (pMatch) pr = parseInt(pMatch[1]);
        if (!tMatch && !pMatch && !isNaN(parseInt(sub.hours))) {
            th = parseInt(sub.hours);
        }
    }
    
    const isMaster = dentIsMaster();
    
    // Re-create modal HTML dynamically so master fields render appropriately
    let modal = document.getElementById('dent-admin-modal');
    if (modal) modal.remove();
    
    const masterFieldsHTML = isMaster ? `
        <div style="margin-bottom:16px;">
            <label style="font-size:0.8rem; color:#f87171; font-weight:500; display:block; margin-bottom:6px;">رابط/ID مجلد الشابترات (خيارات الماستر)</label>
            <input type="text" id="dent-modal-chapters-id" placeholder="الصق ID مجلد الشابترات هنا" style="width:100%; box-sizing:border-box; background:#121212; border:1px solid rgba(239,68,68,0.3); padding:10px 14px; border-radius:10px; color:#fff; font-size:0.9rem; outline:none; transition:all 0.2s;" onfocus="this.style.borderColor='#f87171'; this.style.boxShadow='0 0 0 3px rgba(239,68,68,0.15)';" onblur="this.style.borderColor='rgba(239,68,68,0.3)'; this.style.boxShadow='none';">
        </div>
        <div style="margin-bottom:20px;">
            <label style="font-size:0.8rem; color:#f87171; font-weight:500; display:block; margin-bottom:6px;">رابط/ID مجلد المصادر الإضافية (خيارات الماستر)</label>
            <input type="text" id="dent-modal-materials-id" placeholder="الصق ID مجلد المصادر هنا" style="width:100%; box-sizing:border-box; background:#121212; border:1px solid rgba(239,68,68,0.3); padding:10px 14px; border-radius:10px; color:#fff; font-size:0.9rem; outline:none; transition:all 0.2s;" onfocus="this.style.borderColor='#f87171'; this.style.boxShadow='0 0 0 3px rgba(239,68,68,0.15)';" onblur="this.style.borderColor='rgba(239,68,68,0.3)'; this.style.boxShadow='none';">
        </div>
    ` : '';
    
    const nameInputHTML = isMaster ? `
        <input type="text" id="dent-modal-name" style="width:100%; box-sizing:border-box; background:#121212; border:1px solid rgba(255,255,255,0.12); padding:10px 14px; border-radius:10px; color:#fff; font-size:0.9rem; outline:none; transition:all 0.2s;" onfocus="this.style.borderColor='rgba(255,255,255,0.4)'; this.style.boxShadow='0 0 0 3px rgba(255,255,255,0.08)';" onblur="this.style.borderColor='rgba(255,255,255,0.12)'; this.style.boxShadow='none';">
    ` : `
        <input type="text" id="dent-modal-name" readonly style="width:100%; box-sizing:border-box; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); padding:10px 14px; border-radius:10px; color:#94a3b8; font-size:0.9rem; outline:none; cursor:not-allowed;">
        <span style="font-size:0.75rem; color:#64748b; margin-top:4px; display:block;">(تعديل اسم المادة متاح لحساب الماستر فقط)</span>
    `;

    const modalHTML = `
    <div id="dent-admin-modal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(10,10,15,0.75); backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px); z-index:99999; align-items:center; justify-content:center; font-family:'Outfit', 'Noto Kufi Arabic', sans-serif; direction:rtl;">
        <div style="background: #18181b; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 16px; padding: 28px; width: 90%; max-width: 420px; box-shadow: 0 20px 50px rgba(0,0,0,0.6); color: #fff;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 22px;">
                <h3 style="margin:0; font-size:1.15rem; font-weight:600; color:#f8fafc;">تعديل بيانات المادة</h3>
                <button type="button" onclick="document.getElementById('dent-admin-modal').style.display='none'" style="background:rgba(255,255,255,0.06); border:none; color:#9ca3af; width:32px; height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:1.2rem; cursor:pointer; transition:all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.12)'; this.style.color='#fff';" onmouseout="this.style.background='rgba(255,255,255,0.06)'; this.style.color='#9ca3af';">×</button>
            </div>
            <input type="hidden" id="dent-modal-id">
            
            <div style="margin-bottom:16px;">
                <label style="font-size:0.8rem; color:#9ca3af; font-weight:500; display:block; margin-bottom:6px;">اسم المادة (Name)</label>
                ${nameInputHTML}
            </div>
            
            <div style="display:flex; gap:12px; margin-bottom:16px;">
                <div style="width:50%;">
                    <label style="font-size:0.8rem; color:#9ca3af; font-weight:500; display:block; margin-bottom:6px;">ساعات النظري</label>
                    <input type="number" id="dent-modal-th" min="0" style="width:100%; box-sizing:border-box; background:#121212; border:1px solid rgba(255,255,255,0.12); padding:10px 14px; border-radius:10px; color:#fff; font-size:0.9rem; outline:none; transition:all 0.2s;" onfocus="this.style.borderColor='rgba(255,255,255,0.4)'; this.style.boxShadow='0 0 0 3px rgba(255,255,255,0.08)';" onblur="this.style.borderColor='rgba(255,255,255,0.12)'; this.style.boxShadow='none';">
                </div>
                <div style="width:50%;">
                    <label style="font-size:0.8rem; color:#9ca3af; font-weight:500; display:block; margin-bottom:6px;">ساعات العملي</label>
                    <input type="number" id="dent-modal-pr" min="0" style="width:100%; box-sizing:border-box; background:#121212; border:1px solid rgba(255,255,255,0.12); padding:10px 14px; border-radius:10px; color:#fff; font-size:0.9rem; outline:none; transition:all 0.2s;" onfocus="this.style.borderColor='rgba(255,255,255,0.4)'; this.style.boxShadow='0 0 0 3px rgba(255,255,255,0.08)';" onblur="this.style.borderColor='rgba(255,255,255,0.12)'; this.style.boxShadow='none';">
                </div>
            </div>
            <div style="font-size:0.73rem; color:#94a3b8; margin-top:-10px; margin-bottom:16px; line-height:1.4;">
                💡 إذا كانت المادة نظرية بالكامل بدون معمل، ضع الساعات في النظري والعملي 0
            </div>
            
            <div style="margin-bottom:20px;">
                <label style="font-size:0.8rem; color:#9ca3af; font-weight:500; display:block; margin-bottom:6px;">توزيع الدرجات (Marks)</label>
                <input type="text" id="dent-modal-marks" style="width:100%; box-sizing:border-box; background:#121212; border:1px solid rgba(255,255,255,0.12); padding:10px 14px; border-radius:10px; color:#fff; font-size:0.9rem; outline:none; transition:all 0.2s;" onfocus="this.style.borderColor='rgba(255,255,255,0.4)'; this.style.boxShadow='0 0 0 3px rgba(255,255,255,0.08)';" onblur="this.style.borderColor='rgba(255,255,255,0.12)'; this.style.boxShadow='none';">
            </div>
            
            ${masterFieldsHTML}
            
            <div style="display:flex; gap:12px; justify-content:flex-end;">
                <button type="button" onclick="document.getElementById('dent-admin-modal').style.display='none'" style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); padding:10px 18px; border-radius:10px; color:#cbd5e1; font-weight:500; font-size:0.9rem; cursor:pointer; transition:all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.1)'; this.style.color='#fff';" onmouseout="this.style.background='rgba(255,255,255,0.05)'; this.style.color='#cbd5e1';">إلغاء</button>
                <button type="button" onclick="saveAdminModal()" style="background:#27272a; color:#f8fafc; border:1px solid rgba(255,255,255,0.15); padding:10px 22px; border-radius:10px; font-weight:600; font-size:0.9rem; cursor:pointer; transition:all 0.2s;" onmouseover="this.style.background='#3f3f46'; this.style.borderColor='rgba(255,255,255,0.25)';" onmouseout="this.style.background='#27272a'; this.style.borderColor='rgba(255,255,255,0.15)';">حفظ التعديلات</button>
            </div>
        </div>
    </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    modal = document.getElementById('dent-admin-modal');
    
    // Prefill
    document.getElementById('dent-modal-id').value = id;
    document.getElementById('dent-modal-name').value = sub.name || '';
    document.getElementById('dent-modal-th').value = th;
    document.getElementById('dent-modal-pr').value = pr;
    document.getElementById('dent-modal-marks').value = sub.marks || '';
    
    if (isMaster) {
        const chapEl = document.getElementById('dent-modal-chapters-id');
        const matEl = document.getElementById('dent-modal-materials-id');
        if (chapEl) chapEl.value = sub.chapters_folder_id || '';
        if (matEl) matEl.value = sub.materials_folder_id || '';
    }
    
    modal.style.display = 'flex';
};

window.saveAdminModal = function() {
    const id = document.getElementById('dent-modal-id').value;
    const name = document.getElementById('dent-modal-name').value;
    if (!name) return alert("الرجاء إدخال اسم المادة.");
    
    const th = parseInt(document.getElementById('dent-modal-th').value) || 0;
    const pr = parseInt(document.getElementById('dent-modal-pr').value) || 0;
    const marks = document.getElementById('dent-modal-marks').value;
    
    let hrsString = "";
    if (th > 0 && pr > 0) hrsString = `${th} نظري، ${pr} عملي`;
    else if (th > 0) hrsString = `${th} نظري`;
    else if (pr > 0) hrsString = `${pr} عملي`;
    
    const pass = sessionStorage.getItem('dent2025_admin_pass');
    document.getElementById('dent-admin-modal').style.display = 'none';
    
    const payload = {
        password: pass, id: id, name: name, doctor: '', hours: hrsString, marks: marks
    };
    
    const chapInput = document.getElementById('dent-modal-chapters-id');
    const matInput = document.getElementById('dent-modal-materials-id');
    
    if (chapInput && matInput) {
        const extractId = (str) => {
            if (!str) return '';
            const match = str.match(/folders\/([a-zA-Z0-9_-]+)/);
            return match ? match[1] : str;
        };
        payload.chapters_folder_id = extractId(chapInput.value.trim());
        payload.materials_folder_id = extractId(matInput.value.trim());
    }
    
    fetch(API_BASE + '/dent2025_api.php?action=edit', {
        method: 'POST',
        body: JSON.stringify(payload)
    }).then(r=>r.json()).then(res => {
        if(res.success) {
            // Clear session cache for current selection so updated subject details reload cleanly
            const selData = localStorage.getItem('dent2025_selection');
            if (selData) {
                try {
                    const sel = JSON.parse(selData);
                    sessionStorage.removeItem(`dent2025_dashboard_data_${sel.specialty}_${sel.year}_${sel.semester}`);
                } catch(e) {}
            }
            loadDashboardData(true);
        } else {
            alert(res.message || "حدث خطأ أثناء التعديل");
        }
    }).catch(() => alert("Connection error"));
};

window.deleteSubject = function(id) {
    if (!confirm("هل أنت متأكد من حذف هذه المادة؟ (لن تحذف المجلدات من درايف)")) return;

    const pass = sessionStorage.getItem('dent2025_admin_pass');
    fetch(API_BASE + '/dent2025_api.php?action=delete', {
        method: 'POST',
        body: JSON.stringify({ password: pass, id: id })
    }).then(r=>r.json()).then(res => {
        alert(res.message || res.data);
        if(res.success) loadDashboardData(true);
    }).catch(() => alert("Connection error"));
};

// ---------------------------------------------------------
// Inject Path Changer UI
// ---------------------------------------------------------
function injectPathChanger(selection) {
    if (document.getElementById('dent-path-changer')) return;

    let specName = selection.specialty === 'dentistry' ? 'طب الأسنان' : (selection.specialty === 'medicine' ? 'الطب البشري' : 'التحضيري');
    let extraText = ` | السنة ${selection.year} | الفصل ${selection.semester}`;
    if (selection.specialty === 'medicine') {
        let levelPart1 = (selection.year * 2) - 1;
        let levelPart2 = selection.year * 2;
        let semLevel = selection.semester == 1 ? levelPart1 : levelPart2;
        extraText = ` | السنة ${selection.year} | الفصل ${selection.semester} (مستوى ${semLevel} - جزء ${selection.semester})`;
    } else if (selection.specialty === 'pre-med') {
        extraText = ` | الفصل ${selection.semester}`;
    }

    const changer = document.createElement('div');
    changer.id = 'dent-path-changer';
    changer.innerHTML = `
        <div class="dent-path-changer-content" role="button" tabindex="0" title="انقر نقرًا مزدوجًا لتغيير المسار">
            <span class="dent-path-text">
                <span class="dent-path-main">${specName}</span>
                <span class="dent-path-extra">${extraText}</span>
            </span>
            <span class="dent-path-edit-icon">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
            </span>
        </div>
    `;

    const style = document.createElement('style');
    style.textContent = `
        #dent-path-changer {
            position: fixed;
            top: max(10px, env(safe-area-inset-top, 10px));
            left: 50%;
            transform: translateX(-50%);
            z-index: 9999;
            font-family: 'Outfit', 'Noto Kufi Arabic', sans-serif;
            direction: rtl;
        }
        .dent-path-changer-content {
            background: rgba(255, 255, 255, 0.08);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 20px;
            padding: 6px 14px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.2);
            cursor: pointer;
            transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            user-select: none;
            box-sizing: border-box;
            max-width: 500px;
            overflow: hidden;
            white-space: nowrap;
        }
        .dent-path-changer-content.minimized {
            padding: 4px 12px;
            border-radius: 12px;
            gap: 0;
            background: rgba(255, 255, 255, 0.05);
            border-color: rgba(255, 255, 255, 0.05);
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .dent-path-changer-content:hover {
            background: rgba(255, 255, 255, 0.12);
            border-color: rgba(255, 255, 255, 0.3);
            transform: translateY(-2px);
            box-shadow: 0 6px 25px rgba(0,0,0,0.4);
        }
        .dent-path-changer-content:active {
            transform: translateY(0);
        }
        .dent-path-text {
            display: flex;
            align-items: center;
            color: #f8fafc !important;
            font-size: 0.8rem;
            font-weight: 500;
            letter-spacing: 0.3px;
        }
        .dent-path-main {
            transition: all 0.4s ease;
            color: #f8fafc !important;
        }
        .dent-path-changer-content.minimized .dent-path-main {
            font-size: 0.75rem;
            color: #94a3b8 !important;
        }
        .dent-path-extra {
            overflow: hidden;
            max-width: 300px;
            opacity: 1;
            transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            color: #cbd5e1 !important;
        }
        .dent-path-changer-content.minimized .dent-path-extra {
            max-width: 0;
            opacity: 0;
            padding: 0;
            margin: 0;
        }
        .dent-path-edit-icon {
            color: #94a3b8 !important;
            display: flex;
            align-items: center;
            transition: all 0.4s ease;
            margin-right: 4px;
            overflow: hidden;
            max-width: 20px;
            opacity: 1;
        }
        .dent-path-changer-content.minimized .dent-path-edit-icon {
            max-width: 0;
            opacity: 0;
            margin-right: 0;
        }
        .dent-path-changer-content:hover .dent-path-edit-icon {
            color: #f8fafc !important;
        }
        @media (max-width: 768px) {
            #dent-path-changer {
                top: max(8px, env(safe-area-inset-top, 8px));
            }
            .dent-path-changer-content {
                padding: 4px 10px;
                gap: 6px;
            }
            .dent-path-text {
                font-size: 0.75rem;
            }
        }
    `;
    document.head.appendChild(style);
    document.body.appendChild(changer);

    const contentBox = changer.querySelector('.dent-path-changer-content');
    let expandTimeout;

    // Start fully expanded, auto-minimize after 2.5 seconds
    expandTimeout = setTimeout(() => {
        contentBox.classList.add('minimized');
    }, 2500);

    contentBox.addEventListener('click', (e) => {
        if (contentBox.classList.contains('minimized')) {
            // First click (when minimized): Expand it
            contentBox.classList.remove('minimized');
            clearTimeout(expandTimeout);
            expandTimeout = setTimeout(() => {
                contentBox.classList.add('minimized');
            }, 3000);
        } else {
            // Second click (when already expanded): Go to landing page
            window.getSelection().removeAllRanges();
            localStorage.removeItem('dent2025_selection');
            document.documentElement.style.visibility = 'hidden';
            window.location.href = API_BASE + '/wolcome/';
        }
    });
}

// ---------------------------------------------------------
// Render Dynamic Logo & Announcements
// ---------------------------------------------------------
function renderLogo(selection) {
    let logoPath = '/logos/dent2025.png'; // default fallback
    if (selection.specialty === 'dentistry') logoPath = API_BASE + '/logos/dentistry.webp';
    else if (selection.specialty === 'medicine') logoPath = API_BASE + '/logos/medicine.webp';
    else if (selection.specialty === 'pre-med') logoPath = API_BASE + '/logos/pre-med.webp';
    
    // Replace the main Astra theme logo in the header
    const siteLogos = document.querySelectorAll('.site-logo img, .custom-logo');
    siteLogos.forEach(img => {
        img.src = logoPath;
        img.removeAttribute('srcset'); // Prevent WP from loading a smaller fallback
    });

    let container = document.getElementById('dynamic-logo-container');
    if (container) {
        container.innerHTML = ''; // Clear out the container so the big logo doesn't show
    }
}

function loadAnnouncements(selection) {
    let container = document.getElementById('dynamic-announcements-container');
    if (!container) return;
    
    container.innerHTML = `<div style="text-align:center; color:#94a3b8; margin-bottom: 20px;">جاري تحميل المهام...</div>`;
    
    fetch(`${API_BASE}/announcements_api.php?specialty=${selection.specialty}&year=${selection.year}&semester=${selection.semester}`)
        .then(res => res.json())
        .then(data => {
            // Always render — even if success is false, show empty state so non-admins don't see a blank/spinner
            renderAnnouncements(data.success ? (data.data || {}) : {}, selection);
        })
        .catch(err => {
            console.error("Announcements Error:", err);
            // On network/parse failure, still render the empty state instead of going blank
            renderAnnouncements({}, selection);
        });
}

function formatAnnouncementsTimeAgo(timestamp) {
    if (!timestamp) return '';
    const nowSec = Math.floor(Date.now() / 1000);
    const diffSec = Math.max(0, nowSec - Number(timestamp));
    const diffDays = Math.floor(diffSec / 86400);

    if (diffDays === 0) {
        const diffHours = Math.floor(diffSec / 3600);
        if (diffHours === 0) {
            const diffMin = Math.floor(diffSec / 60);
            if (diffMin <= 1) return 'الآن';
            return `منذ ${diffMin} دقيقة`;
        }
        if (diffHours === 1) return 'منذ ساعة';
        if (diffHours === 2) return 'منذ ساعتين';
        if (diffHours >= 3 && diffHours <= 10) return `منذ ${diffHours} ساعات`;
        return `منذ ${diffHours} ساعة`;
    }
    if (diffDays === 1) return 'منذ يوم';
    if (diffDays === 2) return 'منذ يومين';
    if (diffDays >= 3 && diffDays <= 10) return `منذ ${diffDays} أيام`;
    return `منذ ${diffDays} يوم`;
}

function renderAnnouncements(dataObj, selection) {
    const container = document.getElementById('dynamic-announcements-container');
    if (!container) return;
    
    // Default text if empty
    let content = dataObj.content || "لا يوجد إعلانات حالياً.";
    let hasActualContent = dataObj.content && dataObj.content.trim() !== '' && dataObj.content.trim() !== '<p></p>' && dataObj.content.trim() !== '<br>';
    
    let timeAgoText = '';
    let dateTooltip = '';
    if (hasActualContent && dataObj.last_updated) {
        timeAgoText = formatAnnouncementsTimeAgo(dataObj.last_updated);
        try {
            const d = new Date(Number(dataObj.last_updated) * 1000);
            dateTooltip = d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'numeric', day: 'numeric' });
        } catch(e) {}
    }
    
    let html = `
    <style>
        .dent-announcements-simple {
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.05);
            border-radius: 14px; padding: 20px; margin-bottom: 25px;
            direction: rtl; font-family: 'Outfit', 'Noto Kufi Arabic', sans-serif;
            position: relative;
        }
        .dent-ann-content { font-size: 1rem; line-height: 1.7; color: #cbd5e1; min-height: 40px; }
        .dent-ann-content[contenteditable="true"] {
            background: rgba(0,0,0,0.3); border: 1px dashed #4f8cff; padding: 15px; border-radius: 8px; outline: none;
        }
        
        .dent-ann-toolbar { display: none; gap: 8px; margin-bottom: 15px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 10px; }
        .dent-toolbar-btn { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #cbd5e1; padding: 5px 10px; border-radius: 6px; font-size: 0.9rem; cursor: pointer; transition: all 0.2s; font-family: inherit; font-weight: bold; }
        .dent-toolbar-btn:hover { background: rgba(255,255,255,0.15); }
        
        .dent-ann-top-left {
            position: absolute;
            top: 15px;
            left: 15px;
            display: flex;
            align-items: center;
            gap: 8px;
            z-index: 10;
        }
        .dent-ann-time-badge {
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid rgba(255, 255, 255, 0.08);
            color: #94a3b8;
            padding: 3px 8px;
            border-radius: 6px;
            font-size: 0.75rem;
            font-weight: 500;
            user-select: none;
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }
        .dent-ann-edit-btn {
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.1);
            color: #cbd5e1;
            padding: 4px 10px;
            border-radius: 6px;
            font-size: 0.75rem;
            cursor: pointer;
            transition: all 0.2s;
        }
        .dent-ann-edit-btn:hover { background: rgba(255,255,255,0.1); }
        .dent-ann-save-btn {
            background: #4f8cff;
            border: none;
            color: white;
            padding: 4px 10px;
            border-radius: 6px;
            font-size: 0.75rem;
            font-weight: 600;
            cursor: pointer;
            display: none;
        }
    </style>
    <div class="dent-announcements-simple">
        <div class="dent-ann-top-left">
            ${timeAgoText ? `<span class="dent-ann-time-badge" ${dateTooltip ? `title="آخر تحديث: ${dateTooltip}"` : ''}>${timeAgoText}</span>` : ''}
            ${isAdmin() ? `<button id="btn-edit-ann" class="dent-ann-edit-btn" onclick="toggleEditAnnouncements()">تعديل</button>
                           <button id="btn-save-ann" class="dent-ann-save-btn" onclick="saveAnnouncements()">حفظ</button>` : ''}
        </div>
        
        <div id="dent-ann-toolbar" class="dent-ann-toolbar">
            <button class="dent-toolbar-btn" onmousedown="event.preventDefault()" onclick="document.execCommand('bold', false, null)" title="عريض (Bold)">B</button>
            <button class="dent-toolbar-btn" onmousedown="event.preventDefault()" onclick="document.execCommand('italic', false, null)" style="font-style: italic;" title="مائل (Italic)">I</button>
            <button class="dent-toolbar-btn" onmousedown="event.preventDefault()" onclick="document.execCommand('underline', false, null)" style="text-decoration: underline;" title="تسطير (Underline)">U</button>
            <span style="color:rgba(255,255,255,0.2);">|</span>
            <button class="dent-toolbar-btn" onmousedown="event.preventDefault()" onclick="document.execCommand('fontSize', false, '5')" title="نص كبير (Large Text)">كبير</button>
            <button class="dent-toolbar-btn" onmousedown="event.preventDefault()" onclick="document.execCommand('fontSize', false, '3')" title="نص عادي (Normal Text)">عادي</button>
            <button class="dent-toolbar-btn" onmousedown="event.preventDefault()" onclick="document.execCommand('insertUnorderedList', false, null)" title="قائمة نقطية (Bullet List)">• قائمة</button>
        </div>

        <div id="dent-ann-display" class="dent-ann-content">${content}</div>
    </div>
    `;
    container.innerHTML = html;
}

window.toggleEditAnnouncements = function() {
    const display = document.getElementById('dent-ann-display');
    const btnEdit = document.getElementById('btn-edit-ann');
    const btnSave = document.getElementById('btn-save-ann');
    const toolbar = document.getElementById('dent-ann-toolbar');
    
    if (display.getAttribute('contenteditable') === 'true') {
        // Cancel edit
        display.setAttribute('contenteditable', 'false');
        toolbar.style.display = 'none';
        btnEdit.style.display = 'block';
        btnSave.style.display = 'none';
        
        // Quick reload to discard unsaved changes
        const sel = JSON.parse(localStorage.getItem('dent2025_selection') || '{}');
        loadAnnouncements(sel);
    } else {
        // Start edit
        display.setAttribute('contenteditable', 'true');
        toolbar.style.display = 'flex';
        display.focus();
        btnEdit.style.display = 'none';
        btnSave.style.display = 'block';
    }
};

window.saveAnnouncements = function() {
    const display = document.getElementById('dent-ann-display');
    let content = display.innerHTML || '';
    
    // Safely sanitize HTML to prevent script injection while preserving formatting
    content = dentSanitizeRichText(content);
    if (!content.trim() || content.trim() === '<br>' || content.trim() === '<p></p>') {
        content = 'لا يوجد إعلانات حالياً.';
    }
    
    const pass = sessionStorage.getItem('dent2025_admin_pass');
    const sel = JSON.parse(localStorage.getItem('dent2025_selection') || '{}');
    
    const btnSave = document.getElementById('btn-save-ann');
    const oldText = btnSave.innerText;
    btnSave.innerText = 'جاري الحفظ...';

    fetch(API_BASE + '/announcements_api.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ specialty: sel.specialty, year: sel.year, semester: sel.semester, content: content, password: pass })
    })
    .then(r => r.json())
    .then(res => {
        if(res.success) {
            loadAnnouncements(sel);
        } else {
            btnSave.innerText = oldText;
            alert("Error: " + res.message);
        }
    }).catch(err => {
        btnSave.innerText = oldText;
        alert("حدث خطأ في الاتصال");
    });
};

// ---------------------------------------------------------
// Classes Schedule Logic
// ---------------------------------------------------------
let currentClassesData = [];

function formatTime(time) {
    if (!time || typeof time !== 'string') return '';
    let parts = time.split(':');
    if (parts.length < 2) return time;
    let h = parseInt(parts[0], 10);
    let m = parts[1];
    if (isNaN(h)) return time;
    let ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12; if (h === 0) h = 12;
    return `${h.toString().padStart(2,'0')}:${m} ${ampm}`;
}

function loadClassesData(selection) {
    fetch(`${API_BASE_URL}?action=get_classes&specialty=${selection.specialty}&year=${selection.year}&semester=${selection.semester}`)
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                currentClassesData = data.data || [];
                renderClassesWidget();
            }
        }).catch(err => console.error("Classes API Error:", err));
}

// Interactive Subject Spotlight for Weekly Schedule
window.dentHighlightedClassSubject = null;

window.toggleSubjectHighlight = function(subjectName) {
    if (!subjectName || window.dentHighlightedClassSubject === subjectName) {
        window.dentHighlightedClassSubject = null;
    } else {
        window.dentHighlightedClassSubject = subjectName;
    }
    updateClassHighlights();
};

function updateClassHighlights() {
    const selectedSub = window.dentHighlightedClassSubject;
    const cards = document.querySelectorAll('.dent-class-item');
    
    cards.forEach(card => {
        const rawAttr = card.getAttribute('data-subject') || '';
        const cardSub = decodeURIComponent(rawAttr);
        if (!selectedSub) {
            card.classList.remove('dent-spotlight-active', 'dent-spotlight-dimmed');
        } else if (cardSub === selectedSub) {
            card.classList.add('dent-spotlight-active');
            card.classList.remove('dent-spotlight-dimmed');
        } else {
            card.classList.add('dent-spotlight-dimmed');
            card.classList.remove('dent-spotlight-active');
        }
    });

    const widgetBar = document.getElementById('dent-widget-spotlight-container');
    const modalBar = document.getElementById('dent-week-spotlight-container');
    
    if (!selectedSub) {
        if (widgetBar) widgetBar.innerHTML = '';
        if (modalBar) modalBar.innerHTML = '';
        return;
    }

    const savedGroup = localStorage.getItem('dent2025_selected_group') || 'المجموعة A';
    const matches = currentClassesData
        .filter(c => c && c.subject === selectedSub && isClassInGroup(c, savedGroup))
        .sort((a, b) => {
            const dayOrder = { "الأحد": 1, "الإثنين": 2, "الثلاثاء": 3, "الأربعاء": 4, "الخميس": 5 };
            const dDiff = (dayOrder[a.day] || 9) - (dayOrder[b.day] || 9);
            if (dDiff !== 0) return dDiff;
            return String(a.start_time || '').localeCompare(String(b.start_time || ''));
        });

    const countText = matches.length === 1 ? 'محاضرة واحدة أسبوعياً' : 
                     (matches.length === 2 ? 'محاضرتين أسبوعياً' : `${matches.length} محاضرات أسبوعياً`);

    const daysFormatted = matches.map(m => `<b>${dentEscapeHtml(m.day)}</b> (${formatTime(m.start_time)} - ${formatTime(m.end_time)})`).join(' <span style="color:rgba(255,255,255,0.25); margin:0 4px;">•</span> ');

    const barHtml = `
    <div class="dent-spotlight-bar">
        <div class="dent-spotlight-bar-info">
            <div class="dent-spotlight-bar-title">
                <span>📌</span>
                <span>${dentEscapeHtml(selectedSub)}</span>
                <span class="dent-spotlight-count-badge">${countText}</span>
            </div>
            <div class="dent-spotlight-bar-days">${daysFormatted || 'لا توجد أوقات مسجلة'}</div>
        </div>
        <button class="dent-spotlight-clear-btn" onclick="event.stopPropagation(); toggleSubjectHighlight(null)">إلغاء التحديد ✕</button>
    </div>`;

    if (widgetBar) widgetBar.innerHTML = barHtml;
    if (modalBar) modalBar.innerHTML = barHtml;
}

// Helper: Check if a class belongs to the specified group (inclusive of universal batch classes)
function isClassInGroup(c, targetGroup) {
    if (!c) return false;
    const g = (c.group_name || '').trim();
    if (!g || g === 'الدفعة كاملة' || g === 'الكل' || g === 'كل الدفعة') return true;
    if (!targetGroup) return true;
    return g === targetGroup.trim();
}

function renderClassesWidget() {
    let container = document.getElementById('dynamic-classes-container');
    if (!container) {
        let target = document.getElementById('dent-classes-target');
        if (target) {
            container = document.createElement('div');
            container.id = 'dynamic-classes-container';
            target.appendChild(container);
        } else {
            return; // Only render where the target div is placed!
        }
    }
    
    let rawGroups = [...new Set(currentClassesData.map(c => (c && c.group_name ? String(c.group_name).trim() : '')))].filter(Boolean);
    let specificGroups = rawGroups.filter(g => g !== 'الدفعة كاملة' && g !== 'الكل' && g !== 'كل الدفعة');
    let groups = specificGroups.length > 0 ? specificGroups : (rawGroups.length > 0 ? rawGroups : ["المجموعة A"]);
    
    let savedGroup = localStorage.getItem('dent2025_selected_group') || groups[0];
    if (!groups.includes(savedGroup)) savedGroup = groups[0];
    
    const daysAr = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس"];
    const daysEn = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"];
    
    let todayIndex = new Date().getDay(); 
    if (todayIndex > 4) todayIndex = 0; 
    
    let html = `
    <style>
        .dent-classes-widget {
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 16px; padding: 22px; margin-bottom: 25px;
            direction: rtl; font-family: 'Outfit', 'Noto Kufi Arabic', sans-serif;
            box-shadow: 0 10px 30px rgba(0,0,0,0.25);
        }
        .dent-classes-header {
            display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;
        }
        .dent-classes-title {
            font-size: 1.15rem; font-weight: 700; color: #f8fafc; margin: 0;
        }
        .dent-classes-group-select {
            background: #18181b; border: 1px solid rgba(255,255,255,0.15);
            color: #f8fafc; padding: 6px 12px; border-radius: 8px; font-size: 0.85rem;
            font-family: inherit; outline: none; cursor: pointer; transition: border-color 0.2s;
        }
        .dent-classes-group-select:focus {
            border-color: rgba(255,255,255,0.35);
        }
        .dent-classes-day-title {
            color: #94a3b8; font-size: 0.9rem; font-weight: 600; margin-bottom: 14px;
        }
        .dent-class-item {
            cursor: pointer;
            user-select: none;
            transition: all 0.22s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
        }
        .dent-class-item:hover {
            transform: translateX(-3px);
            border-color: rgba(255, 255, 255, 0.22) !important;
            background: rgba(255, 255, 255, 0.08) !important;
        }
        .dent-class-item.dent-spotlight-active {
            background: rgba(255, 255, 255, 0.12) !important;
            border-color: rgba(255, 255, 255, 0.4) !important;
            box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.3), 0 6px 20px rgba(0, 0, 0, 0.4) !important;
            transform: scale(1.015) !important;
            opacity: 1 !important;
            filter: none !important;
        }
        .dent-class-item.dent-spotlight-active .dent-class-subject,
        .dent-class-item.dent-spotlight-active .dent-week-sub-title span:first-child {
            color: #ffffff !important;
            font-weight: 700 !important;
            text-shadow: 0 0 10px rgba(255,255,255,0.3);
        }
        .dent-class-item.dent-spotlight-dimmed {
            opacity: 0.18 !important;
            filter: grayscale(0.9) !important;
            transform: scale(0.99) !important;
        }
        .dent-class-card {
            display: flex; justify-content: space-between; align-items: center;
            padding: 12px 16px; border-radius: 10px; margin-bottom: 10px;
            background: rgba(0, 0, 0, 0.25);
            border: 1px solid rgba(255,255,255,0.06);
        }
        .dent-class-card.active-now {
            box-shadow: 0 0 0 1px rgba(52, 211, 153, 0.4), 0 4px 20px rgba(52, 211, 153, 0.2);
        }
        .dent-class-info {
            display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
        }
        .dent-class-subject {
            font-size: 0.95rem; font-weight: 600; margin: 0; color: #f8fafc;
        }
        .dent-class-type {
            font-size: 0.72rem; color: #94a3b8; background: rgba(255,255,255,0.06);
            padding: 2px 8px; border-radius: 5px; font-weight: 500;
        }
        .dent-class-now-pill {
            background: #10b981; color: #ffffff; font-size: 0.68rem; font-weight: 700;
            padding: 2px 7px; border-radius: 4px; animation: dentPulse 2s infinite;
        }
        @keyframes dentPulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.6; }
        }
        .dent-class-time {
            font-size: 0.82rem; color: #cbd5e1; direction: ltr; font-weight: 500; font-family: monospace;
        }
        .dent-classes-btn {
            width: 100%; margin-top: 14px; background: rgba(255,255,255,0.05); color: #f8fafc;
            border: 1px solid rgba(255,255,255,0.12); padding: 10px 16px; border-radius: 10px;
            font-size: 0.88rem; font-weight: 600; cursor: pointer; transition: all 0.2s;
            font-family: inherit; text-align: center;
        }
        .dent-classes-btn:hover {
            background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.25);
        }

        /* Spotlight Top Banner / Chip - Neutral Modern Design */
        .dent-spotlight-bar {
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 12px;
            padding: 10px 14px;
            margin-bottom: 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
            animation: dentSlideDown 0.25s ease-out;
        }
        @keyframes dentSlideDown {
            from { opacity: 0; transform: translateY(-8px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .dent-spotlight-bar-info {
            display: flex;
            flex-direction: column;
            gap: 4px;
            text-align: right;
        }
        .dent-spotlight-bar-title {
            font-size: 0.92rem;
            font-weight: 700;
            color: #ffffff;
            display: flex;
            align-items: center;
            gap: 6px;
            flex-wrap: wrap;
        }
        .dent-spotlight-count-badge {
            font-size: 0.75rem;
            font-weight: 500;
            color: #94a3b8;
            background: rgba(255,255,255,0.08);
            padding: 1px 7px;
            border-radius: 6px;
        }
        .dent-spotlight-bar-days {
            font-size: 0.78rem;
            color: #cbd5e1;
            line-height: 1.4;
        }
        .dent-spotlight-clear-btn {
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid rgba(255, 255, 255, 0.15);
            color: #cbd5e1;
            padding: 5px 10px;
            border-radius: 6px;
            font-size: 0.75rem;
            font-weight: 600;
            cursor: pointer;
            white-space: nowrap;
            transition: all 0.2s;
            font-family: inherit;
        }
        .dent-spotlight-clear-btn:hover {
            background: rgba(239, 68, 68, 0.2);
            border-color: rgba(239, 68, 68, 0.4);
            color: #fca5a5;
        }
    </style>
    <div class="dent-classes-widget">
        <div class="dent-classes-header">
            <h2 class="dent-classes-title">الفصول (Classes)</h2>
            <div style="display: flex; align-items: center;">
                ${isAdmin() ? `<button class="dent-admin-btn-small" onclick="openClassesAdminModal()" style="display:block;">إدارة الفصول</button>` : ''}
                ${groups.length > 1 ? `<select class="dent-classes-group-select" onchange="changeClassGroup(this.value)">
                    ${groups.map(g => `<option value="${g}" ${g===savedGroup?'selected':''}>${g}</option>`).join('')}
                </select>` : ''}
            </div>
        </div>
        <div class="dent-classes-day-title">${daysAr[todayIndex]} (${daysEn[todayIndex]})</div>
        <div id="dent-widget-spotlight-container"></div>
    `;
    
    const todaysClasses = currentClassesData.filter(c => c.day === daysAr[todayIndex] && isClassInGroup(c, savedGroup));
    
    if (todaysClasses.length === 0) {
        html += `<div style="color:#94a3b8; font-size:0.85rem; text-align:center; padding: 15px;">لا توجد محاضرات في هذا اليوم. إذا كان هناك نقص، يرجى التواصل مع الليدر.</div>`;
    } else {
        todaysClasses.sort((a,b) => String(a.start_time || '').localeCompare(String(b.start_time || '')));
        const now = new Date();
        const currentMins = now.getHours() * 60 + now.getMinutes();
        
        todaysClasses.forEach(c => {
            let isActive = false;
            if (new Date().getDay() === todayIndex) {
                if (c.start_time && c.end_time && c.start_time.includes(':') && c.end_time.includes(':')) {
                    let [sh, sm] = c.start_time.split(':').map(Number);
                    let [eh, em] = c.end_time.split(':').map(Number);
                    if (!isNaN(sh) && !isNaN(sm) && !isNaN(eh) && !isNaN(em)) {
                        if (currentMins >= (sh*60+sm) && currentMins <= (eh*60+em)) isActive = true;
                    }
                }
            }
            const rawSub = encodeURIComponent(c.subject || '');
            html += `
            <div class="dent-class-card dent-class-item ${isActive ? 'active-now' : ''}" data-subject="${rawSub}" onclick="toggleSubjectHighlight(decodeURIComponent('${rawSub}'))" title="انقر لتحديد هذه المادة وتتبعها خلال الأسبوع">
                <div class="dent-class-info">
                    <h3 class="dent-class-subject">${dentEscapeHtml(c.subject)}</h3>
                    <span class="dent-class-type">${dentEscapeHtml(c.type)}</span>
                    ${isActive ? `<span class="dent-class-now-pill">الآن</span>` : ''}
                </div>
                <div class="dent-class-time">${formatTime(c.start_time)} - ${formatTime(c.end_time)}</div>
            </div>`;
        });
    }
    html += `<button class="dent-classes-btn" onclick="openWeekModal()">عرض جدول الأسبوع كامل</button></div>`;
    container.innerHTML = html;
    buildClassesModals(savedGroup);
    updateClassHighlights();
}

function changeClassGroup(group) {
    localStorage.setItem('dent2025_selected_group', group);
    renderClassesWidget();
}

function buildClassesModals(group) {
    const wasAdminOpen = document.getElementById('classes-admin-modal')?.style.display === 'flex';
    const wasWeekOpen = document.getElementById('week-modal')?.style.display === 'flex';

    if (!document.getElementById('dent-classes-modals-container')) {
        let mc = document.createElement('div');
        mc.id = 'dent-classes-modals-container';
        document.body.appendChild(mc);
    }
    const daysAr = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس"];
    
    // Inclusive filtering: match group or universal (الدفعة كاملة / empty)
    const weekClasses = currentClassesData.filter(c => isClassInGroup(c, group));
    let weekHtml = '';
    daysAr.forEach(day => {
        let dayClasses = weekClasses.filter(c => c.day === day).sort((a,b) => String(a.start_time || '').localeCompare(String(b.start_time || '')));
        if (dayClasses.length > 0) {
            weekHtml += `<div style="margin-bottom: 20px; text-align: right;">
                <div style="color: #cbd5e1; font-size: 0.95rem; font-weight: 700; margin-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 6px; display: flex; justify-content: space-between; align-items: center;">
                    <span>${day}</span>
                    <span style="font-size: 0.75rem; font-weight: 500; color: #94a3b8;">${dayClasses.length} ${dayClasses.length === 1 ? 'محاضرة' : (dayClasses.length === 2 ? 'محاضرتين' : 'محاضرات')}</span>
                </div>`;
            dayClasses.forEach(c => {
                const rawSub = encodeURIComponent(c.subject || '');
                weekHtml += `<div class="dent-class-item" data-subject="${rawSub}" onclick="toggleSubjectHighlight(decodeURIComponent('${rawSub}'))" title="انقر لتحديد هذه المادة وتتبعها خلال الأسبوع" style="background: rgba(0,0,0,0.25); padding: 10px 14px; border-radius: 10px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; border: 1px solid rgba(255,255,255,0.06); cursor: pointer;">
                    <div class="dent-week-sub-title" style="font-size: 0.88rem; color: #f8fafc; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                        <span>${dentEscapeHtml(c.subject)}</span>
                        <span style="font-size: 0.7rem; font-weight: 400; color: #94a3b8; background: rgba(255,255,255,0.06); padding: 2px 7px; border-radius: 4px;">(${dentEscapeHtml(c.type)})</span>
                    </div>
                    <div style="font-size: 0.78rem; color: #cbd5e1; direction: ltr; font-weight: 500; font-family: monospace;">${formatTime(c.start_time)} - ${formatTime(c.end_time)}</div>
                </div>`;
            });
            weekHtml += `</div>`;
        }
    });
    
    if (!weekHtml) {
        if (currentClassesData && currentClassesData.length > 0) {
            weekHtml = `<div style="text-align:center; color:#9ca3af; padding: 25px 10px;">
                <p style="margin-bottom: 10px;">لا توجد محاضرات مسجلة تحت (${group}).</p>
                <p style="font-size: 0.8rem; color: #64748b;">توجد محاضرات مسجلة لمجموعات أخرى، يمكنك تغيير المجموعة من القائمة بالأعلى.</p>
            </div>`;
        } else {
            weekHtml = `<div style="text-align:center; color:#9ca3af; padding: 25px 0;">لا يوجد جدول محاضرات مسجل لهذا الفصل بعد.</div>`;
        }
    }
    
    let adminListHtml = '';
    if (isAdmin()) {
        currentClassesData.forEach(c => {
            adminListHtml += `<div style="background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.05); padding:8px; margin-bottom:5px; border-radius:6px; display:flex; justify-content:space-between; align-items:center;">
                <div style="font-size:0.8rem; color:#fff;">${c.day} - ${c.group_name} - ${c.subject}</div>
                <button onclick="deleteClassEntry('${c.id}')" style="background:rgba(239,68,68,0.2); border:none; color:#f87171; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:0.75rem;">حذف</button>
            </div>`;
        });
    }

    document.getElementById('dent-classes-modals-container').innerHTML = `
        <div class="dent-modal-overlay" id="week-modal" onclick="if(event.target === this) this.style.display='none'" style="display:none; align-items:center; justify-content:center; z-index:999999; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(10,10,15,0.8); backdrop-filter:blur(8px);">
            <div class="dent-modal" style="background:#1e1e1e; border:1px solid rgba(255,255,255,0.1); border-radius:16px; width:90%; max-width:550px; padding:30px; max-height:85vh; overflow-y:auto; box-shadow:0 20px 50px rgba(0,0,0,0.5);">
                <div class="dent-modal-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                    <h2 class="dent-classes-title" style="margin:0; font-size:1.1rem; color:#fff;">الجدول الأسبوعي${group && group !== 'الدفعة كاملة' ? ` (${group})` : ''}</h2>
                    <button class="dent-modal-close" style="background:rgba(255,255,255,0.05); border:none; color:#9ca3af; width:32px; height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:1.2rem; cursor:pointer;" onclick="document.getElementById('week-modal').style.display='none'">×</button>
                </div>
                <div id="dent-week-spotlight-container"></div>
                ${weekHtml}
            </div>
        </div>
        <div class="dent-modal-overlay" id="classes-admin-modal" onclick="if(event.target === this) this.style.display='none'" style="display:none; align-items:center; justify-content:center; z-index:999999; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(10,10,15,0.8); backdrop-filter:blur(8px);">
            <div class="dent-modal" style="background:#1e1e1e; border:1px solid rgba(255,255,255,0.1); border-radius:16px; width:90%; max-width:550px; padding:30px; max-height:85vh; overflow-y:auto; box-shadow:0 20px 50px rgba(0,0,0,0.5);">
                <div class="dent-modal-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:25px;">
                    <div style="display:flex; align-items:center; gap: 10px;">
                        <h2 class="dent-classes-title" style="margin:0; font-size:1.1rem; color:#fff;">إدارة الفصول</h2>
                        <button onclick="logoutClassesAdmin()" style="background:rgba(239,68,68,0.1); color:#ef4444; border:1px solid rgba(239,68,68,0.2); padding:4px 8px; border-radius:6px; font-size:0.75rem; cursor:pointer; font-family:inherit;">تسجيل الخروج (Logout)</button>
                    </div>
                    <button class="dent-modal-close" style="background:rgba(255,255,255,0.05); border:none; color:#9ca3af; width:32px; height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:1.2rem; cursor:pointer;" onclick="document.getElementById('classes-admin-modal').style.display='none'">×</button>
                </div>
                <div style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 12px; margin-bottom: 20px; border: 1px solid rgba(255,255,255,0.05);">
                    <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                        <select id="adm-c-day" class="dent-classes-group-select" style="flex: 1;">
                            ${daysAr.map(d=>`<option value="${d}">${d}</option>`).join('')}
                        </select>
                        <input type="text" id="adm-c-group" placeholder="اسم المجموعة (مثل: المجموعة A)" value="المجموعة A" style="flex:1; background:#121212; border:1px solid rgba(255,255,255,0.1); color:#fff; padding:6px; border-radius:6px; font-family:inherit;">
                    </div>
                    <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; align-items: center;">
                        <span style="font-size: 0.72rem; color: #94a3b8;">اقتراحات سريعة:</span>
                        <button type="button" onclick="document.getElementById('adm-c-group').value='المجموعة A'" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); color: #cbd5e1; padding: 2px 8px; border-radius: 4px; font-size: 0.72rem; cursor: pointer; font-family: inherit;">المجموعة A</button>
                        <button type="button" onclick="document.getElementById('adm-c-group').value='المجموعة B'" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); color: #cbd5e1; padding: 2px 8px; border-radius: 4px; font-size: 0.72rem; cursor: pointer; font-family: inherit;">المجموعة B</button>
                        <button type="button" onclick="document.getElementById('adm-c-group').value='الدفعة كاملة'" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); color: #cbd5e1; padding: 2px 8px; border-radius: 4px; font-size: 0.72rem; cursor: pointer; font-family: inherit;">الدفعة كاملة</button>
                    </div>
                    <input type="text" id="adm-c-sub" placeholder="اسم المادة" style="width: 100%; background: #121212; border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 10px; border-radius: 8px; margin-bottom: 10px; box-sizing: border-box; font-family:inherit;">
                    <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                        <div style="flex: 1;"><label style="font-size:0.75rem; color:#9ca3af;">وقت البدء</label><input type="time" id="adm-c-st" style="width: 100%; background: #121212; font-family: inherit; height: 38px; border: 1px solid rgba(255,255,255,0.1); color: #fff; -webkit-text-fill-color: #fff; padding: 8px; border-radius: 6px; box-sizing: border-box; -webkit-appearance: none; appearance: none;"></div>
                        <div style="flex: 1;"><label style="font-size:0.75rem; color:#9ca3af;">وقت الانتهاء</label><input type="time" id="adm-c-et" style="width: 100%; background: #121212; font-family: inherit; height: 38px; border: 1px solid rgba(255,255,255,0.1); color: #fff; -webkit-text-fill-color: #fff; padding: 8px; border-radius: 6px; box-sizing: border-box; -webkit-appearance: none; appearance: none;"></div>
                    </div>
                    <div style="display: flex; gap: 16px; margin-bottom: 15px; align-items: center;">
                        <label style="color: #cbd5e1; font-size: 0.88rem; cursor: pointer; display: flex; align-items: center; gap: 6px;"><input type="radio" name="adm-c-type" value="نظري (Theory)" checked style="accent-color: #94a3b8 !important; width: 16px; height: 16px; cursor: pointer;"> نظري</label>
                        <label style="color: #cbd5e1; font-size: 0.88rem; cursor: pointer; display: flex; align-items: center; gap: 6px;"><input type="radio" name="adm-c-type" value="عملي (Practical)" style="accent-color: #94a3b8 !important; width: 16px; height: 16px; cursor: pointer;"> عملي</label>
                    </div>
                    <button type="button" class="dent-classes-add-submit-btn" style="margin-top:0; width: 100% !important; background: #27272a !important; color: #f8fafc !important; border: 1px solid rgba(255,255,255,0.15) !important; padding: 10px 16px; border-radius: 10px; font-weight: 600; font-size: 0.9rem; font-family: inherit; cursor: pointer; transition: all 0.2s; box-shadow: none;" onmouseover="this.style.background='#3f3f46'; this.style.borderColor='rgba(255,255,255,0.25)';" onmouseout="this.style.background='#27272a'; this.style.borderColor='rgba(255,255,255,0.15)';" onclick="saveClassEntry()">إضافة الفصل</button>
                </div>
                <div style="font-size: 0.75rem; color: #64748b; text-align: center; margin-bottom: 5px; margin-top: 10px;">(التمرير لأسفل لرؤية كل الفصول - Scroll to see more)</div>
                <div style="max-height:150px; overflow-y:auto; border-top:1px solid rgba(255,255,255,0.05); padding-top:10px; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.2) transparent;">
                    ${adminListHtml}
                </div>
            </div>
        </div>
    `;

    if (wasAdminOpen) {
        const am = document.getElementById('classes-admin-modal');
        if (am) am.style.display = 'flex';
    }
    if (wasWeekOpen) {
        const wm = document.getElementById('week-modal');
        if (wm) wm.style.display = 'flex';
    }
}

function openWeekModal() {
    let m = document.getElementById('week-modal');
    if (m) {
        m.style.display = 'flex';
        updateClassHighlights();
    }
}
function openClassesAdminModal() { let m = document.getElementById('classes-admin-modal'); if (m) m.style.display = 'flex'; }

function logoutClassesAdmin() {
    sessionStorage.removeItem('dent2025_admin_pass');
    sessionStorage.removeItem('dent2025_permissions');
    const modal = document.getElementById('classes-admin-modal');
    if (modal) modal.style.display = 'none';
    const lock = document.querySelector('.dent-secret-lock');
    if (lock) lock.style.display = 'flex';
    renderClassesWidget();
}

function saveClassEntry() {
    const sel = JSON.parse(localStorage.getItem('dent2025_selection') || '{}');
    const pass = sessionStorage.getItem('dent2025_admin_pass');
    
    const payload = {
        password: pass, sub_action: 'add', specialty: sel.specialty, year: sel.year, semester: sel.semester,
        day: document.getElementById('adm-c-day').value, group_name: document.getElementById('adm-c-group').value,
        subject: document.getElementById('adm-c-sub').value, start_time: document.getElementById('adm-c-st').value,
        end_time: document.getElementById('adm-c-et').value, type: document.querySelector('input[name="adm-c-type"]:checked').value
    };
    
    if (!payload.subject || !payload.start_time || !payload.end_time || !payload.group_name) return alert("الرجاء تعبئة جميع الحقول");
    
    fetch(API_BASE + '/dent2025_api.php?action=save_classes', {
        method: 'POST', body: JSON.stringify(payload), headers: {'Content-Type':'application/json'}
    }).then(r=>r.json()).then(res=>{
        if (res.success) { loadClassesData(sel); } else { alert(res.message); }
    }).catch(err => {
        console.error('Save classes error:', err);
        alert('تعذر الاتصال بالخادم لحفظ الفصل.');
    });
}

function deleteClassEntry(id) {
    if (!confirm('هل أنت متأكد من حذف هذا الفصل؟')) return;
    const pass = sessionStorage.getItem('dent2025_admin_pass');
    const sel = JSON.parse(localStorage.getItem('dent2025_selection') || '{}');
    fetch(API_BASE + '/dent2025_api.php?action=save_classes', {
        method: 'POST',
        body: JSON.stringify({
            password: pass,
            sub_action: 'delete',
            class_id: id,
            specialty: sel.specialty,
            year: sel.year,
            semester: sel.semester
        }),
        headers: {'Content-Type':'application/json'}
    }).then(r=>r.json()).then(res=>{
        if (res.success) { loadClassesData(sel); } 
        else { alert(res.message); }
    }).catch(err => {
        console.error('Delete class error:', err);
        alert('تعذر الاتصال بالخادم لحذف الفصل.');
    });
}


// ---------------------------------------------------------

// ---------------------------------------------------------
// Links Management (Materials)
// ---------------------------------------------------------
function generateLinksHtml(links) {
    if (!links || links.length === 0) {
        return '<div style="color: #64748b; font-size: 0.78rem; padding: 4px 0;">لا توجد روابط مساعدة مضافة بعد.</div>';
    }

    // Helper to identify special master reference links
    const isSpecialLink = (l) => {
        const u = (l.url || '').toLowerCase();
        const t = (l.title || '');
        return u.includes('1wnc1sfs4cik9jwyqqok67thsvqcodliu') || t.includes('⭐') || t.includes('الدليل والمراجع الشاملة');
    };

    // Helper to identify Telegram links
    const isTelegramLink = (l) => {
        const u = (l.url || '').toLowerCase();
        const t = (l.title || '').toLowerCase();
        return l.type === 'telegram' || u.includes('t.me') || u.includes('telegram') || t.includes('تيليجرام') || t.includes('telegram');
    };

    // Sort: Special/Master links first, then Telegram / other links
    const sortedLinks = [...links].sort((a, b) => {
        const specialA = isSpecialLink(a) ? 1 : 0;
        const specialB = isSpecialLink(b) ? 1 : 0;
        if (specialA !== specialB) return specialB - specialA;
        return 0;
    });

    let html = '<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr)); gap: 8px;">';
    sortedLinks.forEach(link => {
        let icon = '';
        let color = '#3b82f6';
        let bg = 'rgba(59, 130, 246, 0.1)';
        let cardBg = 'rgba(255, 255, 255, 0.025)';
        let cardBorder = 'rgba(255, 255, 255, 0.06)';
        let cardHoverBg = 'rgba(255, 255, 255, 0.055)';
        let cardHoverBorder = 'rgba(255, 255, 255, 0.12)';
        let cardPadding = '7px 12px';
        let fontSize = '0.8rem';
        let iconSize = '22px';

        const special = isSpecialLink(link);
        const telegram = isTelegramLink(link);

        if (special) {
            // Clean star icon with neutral card styling
            icon = '<svg viewBox="0 0 24 24" fill="currentColor" style="width:13px;height:13px;"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>';
            color = '#e2e8f0';
            bg = 'rgba(255, 255, 255, 0.1)';
        } else if (telegram) {
            // Smaller, sleek Telegram link
            icon = '<svg viewBox="0 0 24 24" fill="currentColor" style="width:12px;height:12px;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.75-.55 2.92-1.27 4.86-2.11 5.83-2.52 2.77-1.18 3.35-1.38 3.73-1.39.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/></svg>';
            color = '#38bdf8';
            bg = 'rgba(56, 189, 248, 0.12)';
            cardPadding = '5px 10px';
            fontSize = '0.76rem';
            iconSize = '20px';
        } else if (link.type === 'youtube') {
            icon = '<svg viewBox="0 0 24 24" fill="currentColor" style="width:13px;height:13px;"><path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z"/></svg>';
            color = '#ef4444';
            bg = 'rgba(239, 68, 68, 0.12)';
        } else if (link.type === 'drive') {
            icon = '<svg viewBox="0 0 24 24" fill="currentColor" style="width:13px;height:13px;"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM19 18H6c-2.21 0-4-1.79-4-4 0-2.05 1.53-3.76 3.56-3.97l1.07-.11.5-.95C8.08 7.14 9.94 6 12 6c2.62 0 4.88 1.86 5.39 4.43l.3 1.5 1.53.11c1.56.1 2.78 1.41 2.78 2.96 0 1.65-1.35 3-3 3z"/></svg>';
            color = '#60a5fa';
            bg = 'rgba(59, 130, 246, 0.12)';
        } else {
            icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>';
            color = '#34d399';
            bg = 'rgba(16, 185, 129, 0.12)';
        }

        const safeUrl = dentSafeUrl(link.url);
        const adminBtn = isAdmin() ? `<button onclick="event.preventDefault(); event.stopPropagation(); deleteLink(${link.id});" style="background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.2); color: #f87171; width: 20px; height: 20px; min-width: 20px; border-radius: 5px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; margin-right: 4px; transition: all 0.2s;" title="حذف الرابط" onmouseover="this.style.background='rgba(239,68,68,0.25)'" onmouseout="this.style.background='rgba(239,68,68,0.12)'">✕</button>` : '';

        // Clean display title (avoid double star and strip English translations in parentheses)
        let displayTitle = (link.title || '');
        if (special) {
            displayTitle = displayTitle.replace(/^⭐\s*/, '');
        }
        displayTitle = displayTitle.replace(/\s*\([A-Za-z0-9\s&,.'\-_/]+\)\s*$/, '').trim();

        html += `
        <div style="background: ${cardBg}; border: 1px solid ${cardBorder}; border-radius: 8px; padding: ${cardPadding}; display: flex; align-items: center; justify-content: space-between; gap: 8px; transition: all 0.2s ease; box-sizing: border-box;" onmouseover="this.style.background='${cardHoverBg}'; this.style.borderColor='${cardHoverBorder}'; this.style.transform='translateY(-1px)';" onmouseout="this.style.background='${cardBg}'; this.style.borderColor='${cardBorder}'; this.style.transform='translateY(0)';">
            <a href="${safeUrl}" target="_blank" rel="noopener" style="text-decoration: none; color: #cbd5e1; display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;" onmouseover="this.style.color='#ffffff';" onmouseout="this.style.color='#cbd5e1';">
                <span style="background: ${bg}; color: ${color}; border-radius: 5px; display: flex; align-items: center; justify-content: center; width: ${iconSize}; height: ${iconSize}; min-width: ${iconSize}; flex-shrink: 0;">${icon}</span>
                <span style="flex: 1; font-size: ${fontSize}; font-weight: ${special ? '600' : '500'}; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word;" title="${dentEscapeHtml(displayTitle)}">${dentEscapeHtml(displayTitle)}</span>
            </a>
            ${adminBtn}
        </div>`;
    });
    html += '</div>';
    return html;
}

function openAddLinkModal(subjectId) {
    let modal = document.getElementById('add-link-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'add-link-modal';
        modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(10,10,15,0.75); backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px); z-index:99999; display:flex; justify-content:center; align-items:center; direction:rtl; font-family:\'Outfit\', \'Noto Kufi Arabic\', sans-serif;';
        modal.innerHTML = `
            <div style="background: #18181b; border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 28px; width: 90%; max-width: 420px; box-shadow: 0 20px 50px rgba(0,0,0,0.6); color: #fff;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 20px;">
                    <h3 style="margin: 0; font-size: 1.15rem; font-weight: 600; color: #f8fafc;">إضافة رابط مساعد</h3>
                    <button type="button" onclick="document.getElementById('add-link-modal').style.display='none'" style="background:rgba(255,255,255,0.06); border:none; color:#9ca3af; width:32px; height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:1.2rem; cursor:pointer; transition:all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.12)'; this.style.color='#fff';" onmouseout="this.style.background='rgba(255,255,255,0.06)'; this.style.color='#9ca3af';">×</button>
                </div>
                <input type="hidden" id="link-sub-id">
                
                <div style="margin-bottom: 16px;">
                    <label style="font-size:0.8rem; color:#9ca3af; font-weight:500; display:block; margin-bottom:6px;">عنوان الرابط</label>
                    <input type="text" id="link-title" placeholder="مثال: شرح شابتر 1" style="width: 100%; padding: 10px 14px; background: #121212; border: 1px solid rgba(255,255,255,0.12); border-radius: 10px; color: #fff; font-size: 0.9rem; font-family: inherit; box-sizing: border-box; outline: none; transition: all 0.2s;" onfocus="this.style.borderColor='rgba(255,255,255,0.4)'; this.style.boxShadow='0 0 0 3px rgba(255,255,255,0.08)';" onblur="this.style.borderColor='rgba(255,255,255,0.12)'; this.style.boxShadow='none';">
                </div>
                
                <div style="margin-bottom: 24px;">
                    <label style="font-size:0.8rem; color:#9ca3af; font-weight:500; display:block; margin-bottom:6px;">رابط المادة</label>
                    <input type="url" id="link-url" placeholder="https://youtube.com/..." style="width: 100%; padding: 10px 14px; background: #121212; border: 1px solid rgba(255,255,255,0.12); border-radius: 10px; color: #fff; font-size: 0.9rem; font-family: inherit; box-sizing: border-box; text-align: left; direction: ltr; outline: none; transition: all 0.2s;" onfocus="this.style.borderColor='rgba(255,255,255,0.4)'; this.style.boxShadow='0 0 0 3px rgba(255,255,255,0.08)';" onblur="this.style.borderColor='rgba(255,255,255,0.12)'; this.style.boxShadow='none';">
                </div>
                
                <div style="display: flex; gap: 12px; justify-content: flex-end;">
                    <button type="button" onclick="document.getElementById('add-link-modal').style.display='none'" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #cbd5e1; padding: 10px 18px; border-radius: 10px; cursor: pointer; font-family: inherit; font-weight: 500; font-size: 0.9rem; transition: all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.1)'; this.style.color='#fff';" onmouseout="this.style.background='rgba(255,255,255,0.05)'; this.style.color='#cbd5e1';">إلغاء</button>
                    <button id="btn-save-link" type="button" onclick="submitAddLink()" style="background: #27272a; color: #f8fafc; border: 1px solid rgba(255,255,255,0.15); padding: 10px 22px; border-radius: 10px; cursor: pointer; font-family: inherit; font-weight: 600; font-size: 0.9rem; transition: all 0.2s;" onmouseover="this.style.background='#3f3f46'; this.style.borderColor='rgba(255,255,255,0.25)';" onmouseout="this.style.background='#27272a'; this.style.borderColor='rgba(255,255,255,0.15)';">حفظ الرابط</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    document.getElementById('link-sub-id').value = subjectId;
    document.getElementById('link-title').value = '';
    document.getElementById('link-url').value = '';
    modal.style.display = 'flex';
}

function submitAddLink() {
    const title = document.getElementById('link-title').value.trim();
    const url = document.getElementById('link-url').value.trim();
    const subjectId = document.getElementById('link-sub-id').value;
    
    if (!title || !url) return alert("الرجاء إدخال العنوان والرابط");
    
    const pass = sessionStorage.getItem('dent2025_admin_pass');
    
    const btn = document.getElementById('btn-save-link');
    btn.innerText = "جاري الحفظ...";
    btn.disabled = true;
    
    fetch(API_BASE + '/backend/api_manage.php?action=add_link', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ password: pass, subject_id: subjectId, title: title, url: url })
    })
    .then(r => r.json())
    .then(res => {
        btn.innerText = "حفظ الرابط";
        btn.disabled = false;
        if (res.success) {
            document.getElementById('add-link-modal').style.display = 'none';
            loadDashboardData(true); // Refresh UI
        } else {
            alert(res.message);
        }
    })
    .catch(err => {
        btn.innerText = "حفظ الرابط";
        btn.disabled = false;
        console.error('Add link error:', err);
        alert('تعذر الاتصال بالخادم لحفظ الرابط.');
    });
}

function deleteLink(linkId) {
    if (!confirm('هل أنت متأكد من حذف هذا الرابط؟')) return;
    const pass = sessionStorage.getItem('dent2025_admin_pass');
    
    fetch(API_BASE + '/backend/api_manage.php?action=delete_link', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ password: pass, link_id: linkId })
    })
    .then(r => r.json())
    .then(res => {
        if (res.success) {
            loadDashboardData(true);
        } else {
            alert(res.message);
        }
    })
    .catch(err => {
        console.error('Delete link error:', err);
        alert('تعذر الاتصال بالخادم لحذف الرابط.');
    });
}



