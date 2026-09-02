// API_BASE is declared by dashboard.js (site-wide). Do NOT redeclare it here.
/* <![CDATA[ */
function dentEscapeHtml(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const ScheduleApp = {
    scheduleId: (function() {
        if (window.dentScheduleId) return window.dentScheduleId;
        try {
            const data = localStorage.getItem('dent2025_selection');
            if (data) {
                const sel = JSON.parse(data);
                return `${sel.specialty}_y${sel.year}_s${sel.semester}`;
            }
        } catch(e) {}
        return 'global';
    })(),
    apiUrl: window.location.origin + '/schedule_backend.php',
    containerId: 'schedule-content',
    typeColors: {
        'start': 'var(--color-start)',
        'holiday': 'var(--color-holiday)',
        'payment': 'var(--color-payment)',
        'exam': 'var(--color-exam)',
        'other': 'var(--color-other)'
    },
    hijriMonths: [
        "محرم", "صفر", "ربيع الأول", "ربيع الآخر", "جمادى الأولى", "جمادى الآخرة",
        "رجب", "شعبان", "رمضان", "شوال", "ذو القعدة", "ذو الحجة"
    ],
    formatHijriDate: function(hijriString) {
        if (!hijriString) return '';
        const parts = hijriString.split(' - ');
        const formattedParts = parts.map(part => {
            const dateParts = part.trim().split('/');
            if (dateParts.length === 3) {
                const year = dateParts[0];
                const monthIndex = parseInt(dateParts[1], 10) - 1;
                const day = parseInt(dateParts[2], 10);
                if (monthIndex >= 0 && monthIndex < 12) {
                    return `${day} ${this.hijriMonths[monthIndex]}`;
                }
            }
            return part;
        });
        return formattedParts.join(' - ');
    },
    parseLocalDate: function(dateString) {
        if (!dateString) return null;
        const str = dateString.includes('T') ? dateString : dateString + 'T00:00:00';
        const d = new Date(str);
        return isNaN(d.getTime()) ? null : d;
    },
    hijriFromGregorian: function(dateString) {
        if (!dateString) return '';
        const dateObj = this.parseLocalDate(dateString);
        if (!dateObj || isNaN(dateObj.getTime())) return '';
        try {
            const parts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(dateObj);
            const val = {};
            parts.forEach(p => { val[p.type] = p.value; });
            return val.year + '/' + val.month + '/' + val.day;
        } catch(e) { return ''; }
    },
    updateHijriPreview: function() {
        const dateInput = document.getElementById('ev-date');
        const preview = document.getElementById('ev-hijri-preview');
        if (!preview) return;
        if (!dateInput || !dateInput.value) { preview.textContent = '—'; return; }
        preview.textContent = this.hijriFromGregorian(dateInput.value) || '—';
    },
    formatDate: function(dateString, endDateString = null) {
        if (!dateString) return '';
        const options = { weekday: 'long', month: 'long', day: 'numeric' };
        const dateObj = this.parseLocalDate(dateString);
        if (!dateObj) return dateString;
        let formatted = dateObj.toLocaleDateString('ar-SA-u-ca-gregory', options);
        if (endDateString) {
            const endDateObj = this.parseLocalDate(endDateString);
            if (endDateObj) {
                formatted += ' - ' + endDateObj.toLocaleDateString('ar-SA-u-ca-gregory', options);
            }
        }
        return formatted;
    },
    gregorianMonthsAR: ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"],
    gregorianMonthsEN: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    getMonthName: function(dateString) {
        const dateObj = this.parseLocalDate(dateString);
        if (!dateObj) return '';
        const m = dateObj.getMonth();
        const y = dateObj.getFullYear();
        return `${this.gregorianMonthsEN[m]} ${y}`; // Just the English, Hijri will be appended in render
    },
    init: async function() {
        try {
            if (!this.adminPassword) {
                this.adminPassword = sessionStorage.getItem('dent2025_schedule_admin_pass') || null;
            }
            try {
                if (window.dentAnalytics && typeof window.dentAnalytics.track === 'function') {
                    window.dentAnalytics.track('schedule_view', { subject: this.scheduleId });
                }
            } catch(e) {}
            const cacheKey = 'dent2025_schedule_' + this.scheduleId;
            const cachedData = sessionStorage.getItem(cacheKey);
            const cacheBuster = '&nocache=1&_t=' + Date.now();
            
            if (cachedData) {
                this.eventsData = JSON.parse(cachedData);
                this.render(this.eventsData);
                // Background fetch to keep cache updated silently
                fetch(this.apiUrl + '?schedule_id=' + this.scheduleId + cacheBuster)
                    .then(r => r.json())
                    .then(res => { if(res.success && res.data) sessionStorage.setItem(cacheKey, JSON.stringify(res.data)); })
                    .catch(e => {});
                return;
            }

            const response = await fetch(this.apiUrl + '?schedule_id=' + this.scheduleId + cacheBuster);
            if (!response.ok) {
                throw new Error('Network response was not ok, status: ' + response.status);
            }
            const result = await response.json();
            if (result.success && result.data) {
                this.eventsData = result.data; // Store events
                sessionStorage.setItem(cacheKey, JSON.stringify(this.eventsData));
                this.render(this.eventsData);
            } else {
                this.showError('لا توجد بيانات متاحة. (' + (result.message || 'Unknown error') + ')');
            }
        } catch (error) {
            this.showError('حدث خطأ: ' + error.message + '<br><small>يرجى التأكد من مسار الملف في السيرفر.</small>');
        }
    },
    render: function(events) {
        const container = document.getElementById(this.containerId);
        if (!container) return;
        container.innerHTML = '';
        if (events.length === 0) {
            this.showError('التقويم فارغ حالياً.');
            return;
        }
        this.calculateStats(events);

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const isAdmin = !!(this.adminPassword || sessionStorage.getItem('dent2025_schedule_admin_pass'));

        const groupedEvents = {};
        let totalVisibleEvents = 0;

        events.forEach(ev => {
            // Determine if event ended more than 3 days ago
            let isEndedPast3Days = false;
            const endStr = ev.end_date || ev.date;
            const endDate = this.parseLocalDate(endStr);
            if (endDate) {
                endDate.setHours(0, 0, 0, 0);
                if (today > endDate) {
                    const diffDays = Math.floor((today.getTime() - endDate.getTime()) / (1000 * 60 * 60 * 24));
                    if (diffDays > 3) {
                        isEndedPast3Days = true;
                    }
                }
            }

            // Hide from regular users if ended more than 3 days ago
            if (!isAdmin && isEndedPast3Days) {
                return;
            }

            totalVisibleEvents++;

            const monthName = this.getMonthName(ev.date);
            if (!groupedEvents[monthName]) {
                groupedEvents[monthName] = { events: [], hijriLabel: '' };
            }

            ev._isEndedPast3Days = isEndedPast3Days;
            groupedEvents[monthName].events.push(ev);
            
            if (!groupedEvents[monthName].hijriLabel && ev.hijri) {
                const rawParts = ev.hijri.split(/[\/\-]/);
                if (rawParts.length >= 2) {
                    let hYear = rawParts[0];
                    let mStr = rawParts[1];
                    if (parseInt(rawParts[0], 10) < 100 && parseInt(rawParts[2] || '0', 10) > 1000) {
                        hYear = rawParts[2];
                        mStr = rawParts[1];
                    }
                    const mIndex = parseInt(mStr, 10) - 1;
                    if (mIndex >= 0 && mIndex < 12) {
                        groupedEvents[monthName].hijriLabel = `${this.hijriMonths[mIndex]} ${hYear}`;
                    }
                }
            }
        });

        if (totalVisibleEvents === 0) {
            container.innerHTML = '<div class="schedule-loading">لا توجد أحداث قادمة حالياً.</div>';
            return;
        }

        for (const [month, groupData] of Object.entries(groupedEvents)) {
            if (!groupData.events || groupData.events.length === 0) continue;
            const monthSection = document.createElement('div');
            monthSection.className = 'timeline-month';
            const monthHeader = document.createElement('div');
            monthHeader.className = 'month-header';
            monthHeader.innerText = groupData.hijriLabel ? `${month} - ${groupData.hijriLabel}` : month;
            monthSection.appendChild(monthHeader);
            const timelineEvents = document.createElement('div');
            timelineEvents.className = 'timeline-events';
            groupData.events.forEach(ev => {
                const card = document.createElement('div');
                card.className = 'event-card';
                const color = this.typeColors[ev.type] || this.typeColors['other'];
                card.style.setProperty('--event-color', color);
                const dateDisplay = this.formatDate(ev.date, ev.end_date);
                const formattedHijri = this.formatHijriDate(ev.hijri);
                
                // Calculate countdown badge
                let badgeHtml = '';
                let badgeClass = '';
                const evDate = this.parseLocalDate(ev.date);
                if (evDate) evDate.setHours(0,0,0,0);
                
                if (evDate && evDate > today) {
                    const diffTime = Math.abs(evDate - today);
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    badgeHtml = `بعد ${diffDays} يوم`;
                    badgeClass = 'future';
                } else if (evDate && evDate < today) {
                    let isCurrent = false;
                    if (ev.end_date) {
                        const endDate = this.parseLocalDate(ev.end_date);
                        if (endDate) {
                            endDate.setHours(0,0,0,0);
                            if (today <= endDate) {
                                isCurrent = true;
                            }
                        }
                    }
                    if (isCurrent) {
                        badgeHtml = 'جارية الآن';
                        badgeClass = 'today';
                    } else {
                        badgeHtml = 'انتهى';
                        badgeClass = 'passed';
                    }
                } else {
                    badgeHtml = 'اليوم';
                    badgeClass = 'today';
                }

                let adminNoticeBadge = '';
                if (this.adminPassword && ev._isEndedPast3Days) {
                    adminNoticeBadge = '<span style="font-size: 0.75em; color: #ef4444; background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); padding: 2px 6px; border-radius: 4px; margin-right: 4px;">مخفي عن الطلاب</span>';
                }

                let deleteBtn = '';
                if (this.adminPassword) {
                    if (!ev.is_global || this.scheduleId === 'global') {
                        deleteBtn = `<button onclick="ScheduleApp.deleteEvent('${dentEscapeHtml(ev.id)}')" style="position: absolute; left: 15px; top: 15px; background: rgba(239, 68, 68, 0.1); border: 1px solid #ef4444; color: #ef4444; width: 26px; height: 26px; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 16px; padding: 0; line-height: 1; transition: background 0.2s;" title="حذف الحدث">&times;</button>`;
                    }
                }

                card.innerHTML = `
                    ${deleteBtn}
                    <div class="event-date">
                        <span>${dateDisplay}</span>
                        ${formattedHijri ? `<span style="opacity: 0.8;">- ${formattedHijri}</span>` : ''}
                        <span style="font-size: 0.85em; color: var(--event-color); font-weight: bold; background: rgba(255,255,255,0.05); padding: 2px 6px; border-radius: 4px; margin-right: 4px;">${badgeHtml}</span>
                        ${adminNoticeBadge}
                    </div>
                    <h3 class="event-title">${dentEscapeHtml(ev.title)}</h3>
                `;
                timelineEvents.appendChild(card);
            });
            monthSection.appendChild(timelineEvents);
            container.appendChild(monthSection);
        }
    },
    calculateStats: function(events) {
        const statsEl = document.getElementById('schedule-stats');
        if (statsEl) statsEl.style.display = 'grid';
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let closestExam = null;
        let nextVacation = null;
        let currentVacation = null;
        let finalsEvent = null;
        let startEvent = null;
        
        events.forEach(ev => {
            const evDate = this.parseLocalDate(ev.date);
            if (evDate) evDate.setHours(0, 0, 0, 0);
            
            if (ev.type === 'start') startEvent = ev;
            if (ev.type === 'exam') finalsEvent = ev;
            
            if (evDate && evDate >= today) {
                if (ev.type === 'exam' && !closestExam) closestExam = ev;
                if (ev.type === 'holiday' && !nextVacation) nextVacation = ev;
            }
            
            if (ev.type === 'holiday' && ev.end_date) {
                const s = this.parseLocalDate(ev.date); if (s) s.setHours(0,0,0,0);
                const e = this.parseLocalDate(ev.end_date); if (e) e.setHours(0,0,0,0);
                if (s && e && today >= s && today <= e) currentVacation = ev;
            }
        });

        if (closestExam) {
            const cDate = this.parseLocalDate(closestExam.date);
            const diffTime = cDate ? Math.abs(cDate - today) : 0;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            if (document.getElementById('val-exam')) {
                document.getElementById('val-exam').innerText = 'بعد ' + diffDays + ' يوم';
                document.getElementById('val-exam').style.color = 'var(--color-exam)';
            }
        } else {
            if (document.getElementById('val-exam')) {
                document.getElementById('val-exam').innerText = 'لا يوجد / None';
                document.getElementById('val-exam').style.color = '';
            }
        }

        const elDays = document.getElementById('val-days');
        const elDaysSub = document.querySelector('#val-days + .stat-subvalue');
        
        let lastEvent = events.length > 0 ? events[events.length - 1] : null;
        let semesterEndDate = null;
        if (finalsEvent) {
            semesterEndDate = this.parseLocalDate(finalsEvent.end_date || finalsEvent.date);
        } else if (lastEvent) {
            semesterEndDate = this.parseLocalDate(lastEvent.end_date || lastEvent.date);
        }
        if (semesterEndDate) semesterEndDate.setHours(0, 0, 0, 0);

        const startDate = startEvent ? this.parseLocalDate(startEvent.date) : null;

        if (currentVacation) {
            if (semesterEndDate) {
                if (today <= semesterEndDate) {
                    const diffTime = Math.abs(semesterEndDate - today);
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    if (elDays) elDays.innerText = diffDays;
                } else {
                    if (elDays) elDays.innerText = '0';
                }
            }
        } else if (startDate && today < startDate) {
            if (elDays) elDays.innerText = 'لم يبدأ';
            if (elDaysSub) elDaysSub.innerText = 'في الفصل الدراسي / in semester';
        } else if (semesterEndDate && today > semesterEndDate) {
            if (elDays) elDays.innerText = '0';
        } else {
            if (semesterEndDate) {
                const diffTime = Math.abs(semesterEndDate - today);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                if (elDays) elDays.innerText = diffDays;
                if (elDaysSub) elDaysSub.innerText = 'في الترم / in semester';
            }
        }

        const elVacation = document.getElementById('val-vacation');
        const elVacationTitle = elVacation && elVacation.previousElementSibling && elVacation.previousElementSibling.previousElementSibling 
            ? elVacation.previousElementSibling.previousElementSibling 
            : (elVacation ? elVacation.closest('.stat-card')?.querySelector('.stat-title') : null);
        const elVacationName = document.getElementById('val-vacation-name');
        
        if (currentVacation && currentVacation.end_date) {
            if (elVacationTitle) elVacationTitle.innerText = 'نهاية الإجازة';
            const eDate = this.parseLocalDate(currentVacation.end_date);
            if (eDate) {
                eDate.setHours(0,0,0,0);
                const diffTime = Math.abs(eDate - today);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                if (elVacation) elVacation.innerText = diffDays + ' يوم / days';
            }
            if (elVacationName) elVacationName.innerText = currentVacation.title;
        } else if (nextVacation) {
            if (elVacationTitle) elVacationTitle.innerText = 'الإجازة القادمة';
            const nDate = this.parseLocalDate(nextVacation.date);
            if (nDate) {
                nDate.setHours(0,0,0,0);
                const diffTime = Math.abs(nDate - today);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                if (elVacation) elVacation.innerText = diffDays + ' يوم / days';
            }
            if (elVacationName) elVacationName.innerText = '(' + nextVacation.title + ')';
        } else {
            if (elVacationTitle) elVacationTitle.innerText = 'الإجازة القادمة';
            if (elVacation) elVacation.innerText = 'انتهت / Passed';
            if (elVacationName) elVacationName.innerText = '';
        }
    },
    showError: function(message) {
        const container = document.getElementById(this.containerId);
        if (container) {
            container.innerHTML = '<div class="schedule-error">' + message + '</div>';
        }
    },
    // ADMIN FUNCTIONS
    adminPassword: null,
    enableAdminMode: function(password) {
        this.adminPassword = password;
        if (this.eventsData) {
            this.render(this.eventsData);
            this.renderAdminControls();
        }
    },
    renderAdminControls: function() {
        let app = document.getElementById('dent-schedule-app');
        let existingBtn = document.getElementById('dent-add-event-btn');
        let existingLogoutBtn = document.getElementById('dent-logout-btn');
        if (existingBtn) existingBtn.remove();
        if (existingLogoutBtn) existingLogoutBtn.remove();

        let addBtn = document.createElement('button');
        addBtn.id = 'dent-add-event-btn';
        addBtn.innerHTML = '+ إضافة حدث جديد';
        addBtn.style.cssText = 'width: 100%; padding: 12px 20px; background: #27272a; color: #f8fafc; border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 12px; font-size: 0.95rem; cursor: pointer; margin-bottom: 12px; font-family: inherit; font-weight: 600; transition: all 0.2s; display: flex; align-items: center; justify-content: center; gap: 8px;';
        addBtn.onmouseover = () => { addBtn.style.background = '#3f3f46'; addBtn.style.borderColor = 'rgba(255, 255, 255, 0.25)'; addBtn.style.transform = 'translateY(-1px)'; };
        addBtn.onmouseout = () => { addBtn.style.background = '#27272a'; addBtn.style.borderColor = 'rgba(255, 255, 255, 0.15)'; addBtn.style.transform = 'none'; };
        addBtn.onclick = () => this.showAddModal();
        
        let logoutBtn = document.createElement('button');
        logoutBtn.id = 'dent-logout-btn';
        logoutBtn.innerHTML = 'تسجيل الخروج من الإدارة';
        logoutBtn.style.cssText = 'width: 100%; padding: 10px; background: rgba(185, 28, 28, 0.15); color: #ef4444; border: 1px solid rgba(185, 28, 28, 0.25); border-radius: 10px; font-size: 0.85rem; cursor: pointer; margin-bottom: 20px; font-family: inherit; font-weight: 500; transition: all 0.2s;';
        logoutBtn.onmouseover = () => logoutBtn.style.background = 'rgba(185, 28, 28, 0.28)';
        logoutBtn.onmouseout = () => logoutBtn.style.background = 'rgba(185, 28, 28, 0.15)';
        logoutBtn.onclick = () => {
            this.adminPassword = null;
            sessionStorage.removeItem('dent2025_schedule_admin_pass');
            let lock = document.querySelector('.dent-schedule-secret-lock');
            if(lock) { lock.style.display = 'flex'; }
            this.render(this.eventsData);
            document.getElementById('dent-add-event-btn')?.remove();
            logoutBtn.remove();
        };

        // Insert right after the stats bar
        let stats = document.getElementById('schedule-stats');
        stats.parentNode.insertBefore(logoutBtn, stats.nextSibling);
        stats.parentNode.insertBefore(addBtn, stats.nextSibling);
    },
    showAddModal: function() {
        let modal = document.createElement('div');
        modal.id = 'dent-admin-modal';
        modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(10, 10, 15, 0.85); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); z-index: 9999999; display: flex; justify-content: center; align-items: center; direction: rtl; font-family: \'Outfit\', \'Noto Kufi Arabic\', sans-serif; padding: 16px; box-sizing: border-box;';
        modal.innerHTML = `
            <style>
                #dent-admin-modal input[type="date"] {
                    -webkit-appearance: none !important;
                    appearance: none !important;
                    color-scheme: dark !important;
                    color: #ffffff !important;
                    background-color: #121212 !important;
                    border: 1px solid rgba(255, 255, 255, 0.12) !important;
                    border-radius: 10px !important;
                    height: 44px !important;
                    min-height: 44px !important;
                    padding: 0 8px !important;
                    font-size: 0.82rem !important;
                    font-family: inherit !important;
                    box-sizing: border-box !important;
                    direction: rtl !important;
                    text-align: right !important;
                }
                #dent-admin-modal input[type="date"]::-webkit-date-and-time-value {
                    text-align: right !important;
                    min-height: 44px !important;
                    line-height: 44px !important;
                    margin: 0 !important;
                    color: #ffffff !important;
                }
                #dent-admin-modal input[type="date"]::-webkit-calendar-picker-indicator {
                    filter: invert(1) !important;
                    opacity: 0.75 !important;
                    cursor: pointer !important;
                }
            </style>
            <div style="background: #18181b; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 18px; padding: 24px; width: 100%; max-width: 440px; box-shadow: 0 25px 60px rgba(0,0,0,0.8); color: #fff; box-sizing: border-box;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 16px; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 12px; gap: 8px;">
                    <div style="flex:1;">
                        <h3 style="margin: 0 0 4px; font-size: 1.1rem; font-weight: 700; color: #f8fafc;">إضافة حدث جديد للتقويم</h3>
                        <span style="font-size: 0.75rem; color: #a78bfa; background: rgba(167,139,250,0.12); border: 1px solid rgba(167,139,250,0.25); border-radius: 6px; padding: 2px 8px; display: inline-block;">📌 ${this.scheduleId}</span>
                    </div>
                    <button type="button" onclick="document.getElementById('dent-admin-modal').remove()" style="background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.12); color:#e2e8f0; width:34px; height:34px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:1.2rem; cursor:pointer; flex-shrink:0; transition:all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.18)'; this.style.color='#fff';" onmouseout="this.style.background='rgba(255,255,255,0.08)'; this.style.color='#e2e8f0';">×</button>
                </div>
                
                <div style="margin-bottom: 14px;">
                    <label style="font-size:0.8rem; color:#a1a1aa; font-weight:600; display:block; margin-bottom:5px;">عنوان الحدث</label>
                    <input type="text" id="ev-title" placeholder="عنوان الحدث (مثال: بداية الاختبارات)" style="width: 100%; height: 44px; padding: 0 14px; background: #121212; border: 1px solid rgba(255,255,255,0.12); border-radius: 10px; color: #fff; font-size: 0.9rem; font-family: inherit; box-sizing: border-box; outline: none; transition: all 0.2s;" onfocus="this.style.borderColor='rgba(255,255,255,0.4)';" onblur="this.style.borderColor='rgba(255,255,255,0.12)';">
                </div>
                
                <div style="margin-bottom: 14px;">
                    <label style="font-size:0.8rem; color:#a1a1aa; font-weight:600; display:block; margin-bottom:5px;">نوع الحدث</label>
                    <select id="ev-type" style="width: 100%; height: 44px; padding: 0 14px; background: #121212; border: 1px solid rgba(255,255,255,0.12); border-radius: 10px; color: #fff; font-size: 0.9rem; font-family: inherit; box-sizing: border-box; outline: none; transition: all 0.2s; color-scheme: dark;" onfocus="this.style.borderColor='rgba(255,255,255,0.4)';" onblur="this.style.borderColor='rgba(255,255,255,0.12)';">
                        <option value="start">بداية دراسة (Start)</option>
                        <option value="holiday">إجازة (Holiday)</option>
                        <option value="exam">اختبار (Exam)</option>
                        <option value="payment">مكافأة (Payment)</option>
                        <option value="other">أخرى (Other)</option>
                    </select>
                </div>

                <div style="display: flex; gap: 10px; margin-bottom: 14px; width: 100%;">
                    <div style="flex:1; min-width: 0;">
                        <label style="font-size:0.78rem; color:#a1a1aa; font-weight:600; display:block; margin-bottom:5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">تاريخ البداية (ميلادي)</label>
                        <input type="date" id="ev-date" style="width: 100%;" onchange="ScheduleApp.updateHijriPreview()" onfocus="this.style.borderColor='rgba(255,255,255,0.4)';" onblur="this.style.borderColor='rgba(255,255,255,0.12)';">
                    </div>
                    <div style="flex:1; min-width: 0;">
                        <label style="font-size:0.78rem; color:#a1a1aa; font-weight:600; display:block; margin-bottom:5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">تاريخ النهاية (اختياري)</label>
                        <input type="date" id="ev-end" style="width: 100%;" onfocus="this.style.borderColor='rgba(255,255,255,0.4)';" onblur="this.style.borderColor='rgba(255,255,255,0.12)';">
                    </div>
                </div>
                
                <div style="margin-bottom: 20px;">
                    <label style="font-size:0.78rem; color:#a1a1aa; font-weight:600; display:block; margin-bottom:5px;">التاريخ الهجري (يُحسب تلقائياً)</label>
                    <div id="ev-hijri-preview" style="width: 100%; height: 44px; display: flex; align-items: center; padding: 0 14px; background: rgba(167,139,250,0.08); border: 1px solid rgba(167,139,250,0.25); border-radius: 10px; color: #c4b5fd; font-size: 0.9rem; font-family: inherit; box-sizing: border-box;">—</div>
                </div>
                
                <div style="display: flex; gap: 10px;">
                    <button type="button" onclick="ScheduleApp.submitAddEvent()" style="flex: 2; height: 44px; background: #3f3f46; color: #ffffff; border: 1px solid #52525b; border-radius: 10px; cursor: pointer; font-family: inherit; font-weight: 600; font-size: 0.92rem; transition: all 0.2s; display:flex; align-items:center; justify-content:center;" onmouseover="this.style.background='#52525b';" onmouseout="this.style.background='#3f3f46';">حفظ الحدث</button>
                    <button type="button" onclick="document.getElementById('dent-admin-modal').remove()" style="flex: 1; height: 44px; background: #27272a; border: 1px solid rgba(255,255,255,0.1); color: #a1a1aa; border-radius: 10px; cursor: pointer; font-family: inherit; font-weight: 500; font-size: 0.88rem; transition: all 0.2s; display:flex; align-items:center; justify-content:center;" onmouseover="this.style.background='rgba(255,255,255,0.12)'; this.style.color='#fff';" onmouseout="this.style.background='#27272a'; this.style.color='#a1a1aa';">إلغاء</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    },
    submitAddEvent: function() {
        const title = document.getElementById('ev-title').value;
        const type = document.getElementById('ev-type').value;
        const date = document.getElementById('ev-date').value;
        const end_date = document.getElementById('ev-end').value;
        const hijri = (document.getElementById('ev-hijri')?.value || '').trim() || this.hijriFromGregorian(date);

        if (!title || !date) { alert('العنوان وتاريخ البداية مطلوبان!'); return; }

        fetch(this.apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                action: 'add',
                password: this.adminPassword,
                schedule_id: this.scheduleId,
                is_global: false,
                title, type, date, end_date, hijri
            })
        }).then(r => r.json()).then(res => {
            if(res.success) {
                sessionStorage.removeItem('dent2025_schedule_' + this.scheduleId);
                document.getElementById('dent-admin-modal').remove();
                this.init(); // Reload from server
            } else {
                alert('فشل الحفظ: ' + res.message);
            }
        }).catch(err => {
            console.error('Schedule add error:', err);
            alert('تعذر الاتصال بالخادم لحفظ الحدث.');
        });
    },
    deleteEvent: function(id) {
        if(!confirm('هل أنت متأكد من حذف هذا الحدث؟')) return;
        fetch(this.apiUrl, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                password: this.adminPassword,
                schedule_id: this.scheduleId,
                id: id
            })
        }).then(r => r.json()).then(res => {
            if(res.success) {
                sessionStorage.removeItem('dent2025_schedule_' + this.scheduleId);
                this.init(); // Reload
            } else {
                alert('فشل الحذف: ' + res.message);
            }
        }).catch(err => {
            console.error('Schedule delete error:', err);
            alert('تعذر الاتصال بالخادم لحذف الحدث.');
        });
    }
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ScheduleApp.init());
} else {
    ScheduleApp.init();
}
/* ]]> */


