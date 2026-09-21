// API_BASE is declared by dashboard.js (site-wide). Do NOT redeclare it here.
/* <![CDATA[ */
function dentEscapeHtml(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const ScheduleApp = {
    getScheduleId: function() {
        if (window.dentScheduleId && window.dentScheduleId !== 'global') {
            return window.dentScheduleId;
        }
        try {
            const raw = localStorage.getItem('dent2025_selection');
            if (raw) {
                const sel = JSON.parse(raw);
                if (sel && sel.specialty && sel.semester !== undefined) {
                    const yr = (sel.year !== undefined && sel.year !== null && sel.year !== '') ? sel.year : (sel.specialty === 'pre-med' ? 1 : 3);
                    return `${sel.specialty}_y${yr}_s${sel.semester}`;
                }
            }
        } catch(e) {}

        // Fallback default: Dentistry, Year 3, Semester 1 (Primary portal cohort)
        const defaultSel = { specialty: 'dentistry', year: 3, semester: 1 };
        try {
            localStorage.setItem('dent2025_selection', JSON.stringify(defaultSel));
        } catch(e) {}
        return 'dentistry_y3_s1';
    },
    scheduleId: 'dentistry_y3_s1',
    apiUrl: window.location.origin + '/schedule_backend.php',
    containerId: 'schedule-content',
    typeColors: {
        'start': 'var(--color-start)',
        'holiday': 'var(--color-holiday)',
        'payment': 'var(--color-payment)',
        'exam': 'var(--color-exam)',
        'other': 'var(--color-other)'
    },
    getEventTypeMeta: function(ev) {
        if (!ev) return { label: 'حدث', badgeClass: 'badge-type-other', printClass: 'm1-badge-exam' };
        
        const map = {
            'quiz': { label: 'كويز', badgeClass: 'badge-type-quiz', printClass: 'm1-badge-exam' },
            'assessment': { label: 'اسسمنت', badgeClass: 'badge-type-assessment', printClass: 'm1-badge-exam' },
            'research': { label: 'بحث / مشروع', badgeClass: 'badge-type-research', printClass: 'm1-badge-exam' },
            'homework': { label: 'واجب', badgeClass: 'badge-type-homework', printClass: 'm1-badge-exam' },
            'exam': { label: 'اختبار', badgeClass: 'badge-type-exam', printClass: 'm1-badge-exam' },
            'midterm': { label: 'اختبار نصفي', badgeClass: 'badge-type-midterm', printClass: 'm1-badge-exam' },
            'final': { label: 'اختبار نهائي', badgeClass: 'badge-type-final', printClass: 'm1-badge-exam' },
            'deadline': { label: 'موعد نهائي', badgeClass: 'badge-type-deadline', printClass: 'm1-badge-exam' },
            'holiday': { label: 'إجازة رسمية', badgeClass: 'badge-type-holiday', printClass: 'm1-badge-holiday' },
            'payment': { label: 'مكافأة', badgeClass: 'badge-type-payment', printClass: 'm1-badge-payment' },
            'start': { label: 'بداية دراسة', badgeClass: 'badge-type-start', printClass: 'm1-badge-holiday' },
            'other': { label: 'أخرى', badgeClass: 'badge-type-other', printClass: 'm1-badge-exam' }
        };

        const typeKey = (ev.type || '').toLowerCase();

        if (ev.type_label && String(ev.type_label).trim()) {
            const customBadgeClass = map[typeKey] ? map[typeKey].badgeClass : 'badge-type-custom';
            const customPrintClass = map[typeKey] ? map[typeKey].printClass : 'm1-badge-exam';
            return {
                label: String(ev.type_label).trim(),
                badgeClass: customBadgeClass,
                printClass: customPrintClass
            };
        }

        if (map[typeKey]) {
            return map[typeKey];
        }

        const title = (ev.title || '').toLowerCase();
        if (title.includes('كويز') || title.includes('quiz')) {
            return map['quiz'];
        }
        if (title.includes('واجب') || title.includes('رسم') || title.includes('homework')) {
            return map['homework'];
        }
        if (title.includes('اسسمنت') || title.includes('تقييم') || title.includes('assessment')) {
            return map['assessment'];
        }
        if (title.includes('بحث') || title.includes('مشروع') || title.includes('research')) {
            return map['research'];
        }
        if (title.includes('نهائ') || title.includes('فاينل') || title.includes('final')) {
            return map['final'];
        }
        if (title.includes('نصفي') || title.includes('ميد') || title.includes('midterm')) {
            return map['midterm'];
        }

        if (typeKey && typeKey !== 'other') {
            return { label: ev.type, badgeClass: 'badge-type-custom', printClass: 'm1-badge-exam' };
        }

        return { label: 'حدث', badgeClass: 'badge-type-other', printClass: 'm1-badge-exam' };
    },
    toggleCustomTypeInput: function(val) {
        const wrap = document.getElementById('ev-custom-type-wrap');
        const input = document.getElementById('ev-custom-type');
        if (wrap) {
            if (val === 'custom') {
                wrap.style.display = 'block';
                if (input) input.focus();
            } else {
                wrap.style.display = 'none';
            }
        }
    },
    hijriMonths: [
        "محرم", "صفر", "ربيع الأول", "ربيع الآخر", "جمادى الأولى", "جمادى الآخرة",
        "رجب", "شعبان", "رمضان", "شوال", "ذو القعدة", "ذو الحجة"
    ],
    formatHijriDate: function(hijriString) {
        if (!hijriString) return '';
        const parts = hijriString.split(' - ');
        
        let parsedDates = [];
        parts.forEach(part => {
            const dateParts = part.trim().split(/[\/\-]/);
            if (dateParts.length >= 2) {
                let monthIndex = parseInt(dateParts[1], 10) - 1;
                let day = parseInt(dateParts[2], 10) || parseInt(dateParts[0], 10);
                // Sometimes format is YYYY/MM/DD, sometimes DD/MM/YYYY
                if (dateParts.length === 3) {
                    if (parseInt(dateParts[0], 10) > 1000) {
                        day = parseInt(dateParts[2], 10);
                    } else {
                        day = parseInt(dateParts[0], 10);
                    }
                }
                
                if (monthIndex >= 0 && monthIndex < 12) {
                    parsedDates.push({ day, monthStr: this.hijriMonths[monthIndex] });
                }
            }
        });
        
        if (parsedDates.length === 2 && parsedDates[0].monthStr === parsedDates[1].monthStr) {
            return `${parsedDates[0].day} - ${parsedDates[1].day} ${parsedDates[0].monthStr}`;
        }
        
        return parsedDates.map(d => `${d.day} ${d.monthStr}`).join(' - ');
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
        let formatted = dateObj.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', options);
        if (endDateString) {
            const endDateObj = this.parseLocalDate(endDateString);
            if (endDateObj) {
                formatted += ' - ' + endDateObj.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', options);
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
            this.scheduleId = this.getScheduleId();

            // Clear any legacy stale global cache so user is never stuck on 2 events
            try {
                localStorage.removeItem('dent2025_schedule_global');
                localStorage.removeItem('dent2025_schedule_undefined_yundefined_sundefined');
            } catch(e) {}

            if (!this.adminPassword) {
                this.adminPassword = sessionStorage.getItem('dent2025_schedule_admin_pass') || sessionStorage.getItem('dent2025_admin_pass') || null;
            }
            try {
                if (window.dentAnalytics && typeof window.dentAnalytics.track === 'function') {
                    window.dentAnalytics.track('schedule_view', { subject: this.scheduleId });
                }
            } catch(e) {}
            const cacheKey = 'dent2025_schedule_' + this.scheduleId;
            const cachedData = localStorage.getItem(cacheKey); // Persist across closed tabs
            const cacheBuster = '&nocache=1&_t=' + Date.now();

            // Idle preload export engines (html-to-image and jsPDF) so user export is instant
            setTimeout(() => {
                try {
                    if (typeof this.loadHtmlToImage === 'function') this.loadHtmlToImage().catch(() => {});
                    if (typeof this.loadJsPdf === 'function') this.loadJsPdf().catch(() => {});
                } catch(e) {}
            }, 1500);
            
            if (cachedData) {
                this.eventsData = JSON.parse(cachedData);
                this.render(this.eventsData);
                // Background fetch to keep cache updated silently
                fetch(this.apiUrl + '?schedule_id=' + this.scheduleId + cacheBuster)
                    .then(r => r.json())
                    .then(res => { 
                        if(res.success && res.data) {
                            const freshJson = JSON.stringify(res.data);
                            if (freshJson !== cachedData) {
                                localStorage.setItem(cacheKey, freshJson);
                                this.eventsData = res.data;
                                this.render(this.eventsData); // Re-render if data changed
                            }
                        }
                    })
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
                localStorage.setItem(cacheKey, JSON.stringify(this.eventsData));
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

        const isAdmin = !!(this.adminPassword || sessionStorage.getItem('dent2025_schedule_admin_pass') || sessionStorage.getItem('dent2025_admin_pass'));

        const groupedEvents = {};
        let totalVisibleEvents = 0;
        
        // Anchor semester start to Sunday 2026-08-30 (Week 1), ensuring consistent week numbering
        // across all views regardless of past events expiration (Week 4 begins Sunday 2026-09-20).
        let startSunday = new Date(2026, 7, 30);
        startSunday.setHours(0, 0, 0, 0);

        events.forEach(ev => {
            let isVisible = true;
            let isEndedPast3Days = false;
            
            if (ev.end_date) {
                const ed = this.parseLocalDate(ev.end_date);
                if (ed) {
                    ed.setHours(23, 59, 59, 999);
                    const daysSinceEnd = (today - ed) / (1000 * 60 * 60 * 24);
                    if (daysSinceEnd > 3) {
                        isEndedPast3Days = true;
                        if (!this.adminPassword) {
                            isVisible = false;
                        }
                    }
                }
            } else {
                const d = this.parseLocalDate(ev.date);
                if (d) {
                    d.setHours(23, 59, 59, 999);
                    const daysSince = (today - d) / (1000 * 60 * 60 * 24);
                    if (daysSince > 3) {
                        isEndedPast3Days = true;
                        if (!this.adminPassword) {
                            isVisible = false;
                        }
                    }
                }
            }

            if (isVisible) totalVisibleEvents++;
            
            if (!this.adminPassword && isEndedPast3Days) return;

            const dateObj = this.parseLocalDate(ev.date) || new Date();
            
            const dayOfWeek = dateObj.getDay();
            const sundayDate = new Date(dateObj);
            sundayDate.setDate(dateObj.getDate() - dayOfWeek);
            sundayDate.setHours(0,0,0,0);
            
            const weekNum = Math.floor((sundayDate - startSunday) / (1000 * 60 * 60 * 24 * 7)) + 1;
            
            const sunDay = sundayDate.getDate();
            const sunMonth = this.gregorianMonthsAR[sundayDate.getMonth()];
            const sunYear = sundayDate.getFullYear();
            
            const weekKey = `${sunYear}-${String(sundayDate.getMonth()).padStart(2, '0')}-${String(sunDay).padStart(2, '0')}`;
            const weekName = `الأسبوع ${weekNum} — ${sunMonth}`;
            
            if (!groupedEvents[weekKey]) {
                groupedEvents[weekKey] = {
                    events: [],
                    headerLabel: weekName,
                    hijriLabel: ''
                };
            }

            ev._isEndedPast3Days = isEndedPast3Days;
            groupedEvents[weekKey].events.push(ev);
            
            if (!groupedEvents[weekKey].hijriLabel) {
                if (ev.hijri) {
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
                            groupedEvents[weekKey].hijriLabel = `${this.hijriMonths[mIndex]} ${hYear}هـ`;
                        }
                    }
                }
                if (!groupedEvents[weekKey].hijriLabel) {
                    const hDateStr = this.hijriFromGregorian(sundayDate.toISOString().substring(0, 10));
                    if (hDateStr) {
                        const parts = hDateStr.split('/');
                        if (parts.length >= 2) {
                            const mIndex = parseInt(parts[1], 10) - 1;
                            if (mIndex >= 0 && mIndex < 12) {
                                groupedEvents[weekKey].hijriLabel = `${this.hijriMonths[mIndex]} ${parts[0]}هـ`;
                            }
                        }
                    }
                }
            }
        });

        if (totalVisibleEvents === 0) {
            container.innerHTML = '<div class="schedule-loading">لا توجد أحداث قادمة حالياً.</div>';
            return;
        }

        // Object.keys(groupedEvents) is naturally sorted if we use YYYY-MM-DD string format
        const sortedWeeks = Object.keys(groupedEvents).sort();

        sortedWeeks.forEach(weekKey => {
            const groupData = groupedEvents[weekKey];
            if (!groupData.events || groupData.events.length === 0) return;
            const monthSection = document.createElement('div');
            monthSection.className = 'timeline-month';
            const monthHeader = document.createElement('div');
            monthHeader.className = 'month-header';
            if (groupData.hijriLabel) {
                monthHeader.innerHTML = `<div class="month-header-content" dir="rtl"><span class="month-header-title">${dentEscapeHtml(groupData.headerLabel)}</span><span class="month-header-sep">•</span><span class="month-header-hijri">${dentEscapeHtml(groupData.hijriLabel)}</span></div>`;
            } else {
                monthHeader.innerHTML = `<div class="month-header-content" dir="rtl"><span class="month-header-title">${dentEscapeHtml(groupData.headerLabel)}</span></div>`;
            }
            monthSection.appendChild(monthHeader);
            const timelineEvents = document.createElement('div');
            timelineEvents.className = 'timeline-events';
            const daysInWeek = {};
            groupData.events.forEach(ev => {
                const dDate = this.parseLocalDate(ev.date) || new Date();
                const dayName = dDate.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { weekday: 'long' });
                
                const monthShort = this.gregorianMonthsEN[dDate.getMonth()].substring(0,3);
                let gregDateStr = `${dDate.getDate()} ${monthShort}`;
                
                if (ev.end_date) {
                    const eDate = this.parseLocalDate(ev.end_date);
                    if (eDate) {
                        const eMonthShort = this.gregorianMonthsEN[eDate.getMonth()].substring(0,3);
                        if (monthShort === eMonthShort) {
                            gregDateStr = `${dDate.getDate()} - ${eDate.getDate()} ${monthShort}`;
                        } else {
                            gregDateStr += ` - ${eDate.getDate()} ${eMonthShort}`;
                        }
                    }
                }
                
                const formattedHijri = this.formatHijriDate(ev.hijri);
                
                const dayKey = `${gregDateStr}|${dayName}`;
                if (!daysInWeek[dayKey]) {
                    daysInWeek[dayKey] = {
                        dayName, gregDateStr, formattedHijri,
                        events: []
                    };
                }
                daysInWeek[dayKey].events.push(ev);
            });
            
            Object.values(daysInWeek).forEach(dayData => {
                const eventWrapper = document.createElement('div');
                eventWrapper.className = 'event';
                
                let cardsHtml = '';
                let allPassed = true;
                let hasHighlight = false;
                
                dayData.events.forEach((ev, index) => {
                    // Calculate countdown badge
                    let badgeHtml = '';
                    let badgeClass = '';
                    
                    const sDate = this.parseLocalDate(ev.date);
                    if (sDate) sDate.setHours(0, 0, 0, 0);
                    const eDate = ev.end_date ? this.parseLocalDate(ev.end_date) : null;
                    if (eDate) eDate.setHours(0, 0, 0, 0);

                    if (sDate) {
                        if (eDate && eDate > sDate) {
                            // Multi-day event
                            if (today > eDate) {
                                badgeHtml = 'انتهى';
                            } else if (today >= sDate && today <= eDate) {
                                badgeHtml = 'جارية الآن';
                                badgeClass = 'urgent';
                                hasHighlight = true;
                            } else {
                                const daysLeft = Math.round((sDate - today) / (1000 * 60 * 60 * 24));
                                if (daysLeft === 1) {
                                    badgeHtml = 'غداً';
                                    badgeClass = 'warning';
                                } else if (daysLeft === 2) {
                                    badgeHtml = 'بعد يومين';
                                    badgeClass = 'warning';
                                } else if (daysLeft >= 3 && daysLeft <= 10) {
                                    badgeHtml = `بعد ${daysLeft} أيام`;
                                } else {
                                    badgeHtml = `بعد ${daysLeft} يوماً`;
                                }
                            }
                        } else {
                            // Single-day event
                            const daysLeft = Math.round((sDate - today) / (1000 * 60 * 60 * 24));
                            if (daysLeft < 0) {
                                badgeHtml = 'انتهى';
                            } else if (daysLeft === 0) {
                                badgeHtml = 'اليوم';
                                badgeClass = 'urgent';
                                hasHighlight = true;
                            } else if (daysLeft === 1) {
                                badgeHtml = 'غداً';
                                badgeClass = 'warning';
                            } else if (daysLeft === 2) {
                                badgeHtml = 'بعد يومين';
                                badgeClass = 'warning';
                            } else if (daysLeft >= 3 && daysLeft <= 10) {
                                badgeHtml = `بعد ${daysLeft} أيام`;
                            } else {
                                badgeHtml = `بعد ${daysLeft} يوماً`;
                            }
                        }
                    }
                    
                    if (badgeHtml !== 'انتهى') {
                        allPassed = false;
                    }

                    let adminNoticeBadge = '';
                    if (ev._isEndedPast3Days && this.adminPassword) {
                        adminNoticeBadge = `<span class="badge" style="background:rgba(239,68,64,0.15); color:var(--color-exam);">مخفي للطلاب</span>`;
                    }

                    let adminButtons = '';
                    if (this.adminPassword) {
                        const isGlobal = !!ev.is_global;
                        const eventSchedId = ev.schedule_id || (isGlobal ? 'global' : this.scheduleId);
                        const escapedId = dentEscapeHtml(ev.id);
                        adminButtons = `
                            <div class="event-admin-actions">
                                <button class="event-edit-btn" title="تعديل الحدث" onclick="ScheduleApp.showEditModal('${escapedId}')">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                                </button>
                                <button class="event-delete-btn" title="حذف الحدث" onclick="ScheduleApp.deleteEvent('${escapedId}', ${isGlobal ? 'true' : 'false'}, '${eventSchedId}')">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path></svg>
                                </button>
                            </div>`;
                    }

                    let extraBadgeClass = badgeClass ? `badge-${badgeClass}` : '';
                    const isNationalDay = ev.id === 'evt_hol_national' || (ev.title && ev.title.includes('اليوم الوطني'));
                    const nationalDayCardClass = isNationalDay ? ' event-card-national-day' : '';
                    
                    const typeMeta = this.getEventTypeMeta(ev);
                    let typeBadgeHtml = '';
                    if (typeMeta && typeMeta.label && typeMeta.label !== 'أخرى' && typeMeta.label !== 'حدث') {
                        typeBadgeHtml = `<span class="badge ${typeMeta.badgeClass}">${dentEscapeHtml(typeMeta.label)}</span>`;
                    }

                    cardsHtml += `
                        <div class="event-card${nationalDayCardClass}" id="event-${ev.id}">
                            <div class="event-info" style="flex: 1; min-width: 0;">
                                <h3 class="event-title" dir="auto">${dentEscapeHtml(ev.title)}</h3>
                            </div>
                            <div class="event-badges">
                                ${typeBadgeHtml}
                                <span class="badge ${extraBadgeClass}">${badgeHtml}</span>
                                ${adminNoticeBadge}
                                ${adminButtons}
                            </div>
                        </div>
                    `;
                });
                
                if (allPassed) eventWrapper.classList.add('passed');
                if (hasHighlight) eventWrapper.classList.add('highlight');
                const isDayNationalDay = dayData.events.some(e => e.id === 'evt_hol_national' || (e.title && e.title.includes('اليوم الوطني')));
                if (isDayNationalDay) eventWrapper.classList.add('event-national-day');
                
                eventWrapper.innerHTML = `
                    <div class="event-date">
                        <div class="date-main">
                            <span class="day-name">${dayData.dayName}</span>
                            <span class="gregorian" dir="ltr">${dayData.gregDateStr}</span>
                        </div>
                        ${dayData.formattedHijri ? `<span class="hijri">${dayData.formattedHijri}</span>` : ''}
                    </div>
                    <div class="event-dot"></div>
                    <div class="event-cards-group" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; width: 100%;">
                        ${cardsHtml}
                    </div>
                `;
                timelineEvents.appendChild(eventWrapper);
            });
            monthSection.appendChild(timelineEvents);
            container.appendChild(monthSection);
        });
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
        
        const isQuiz = (ev) => {
            if (!ev || !ev.title) return false;
            const t = ev.title.toLowerCase();
            const id = (ev.id || '').toLowerCase();
            const type = (ev.type || '').toLowerCase();
            const typeLabel = (ev.type_label || '').toLowerCase();
            if (t.includes('واجب') || t.includes('تكليف') || t.includes('مشروع') || t.includes('تقرير') || t.includes('نهائ') || t.includes('فاينل') || type === 'homework' || type === 'research' || type === 'final' || type === 'deadline') {
                return false;
            }
            return t.includes('كويز') || t.includes('quiz') || id.includes('quiz') || t.includes('اختبار قصير') || type === 'quiz' || type === 'assessment' || typeLabel.includes('كويز') || typeLabel.includes('اسسمنت') || (type === 'exam' && !t.includes('نهائ') && !t.includes('فاينل'));
        };

        events.forEach(ev => {
            const evDate = this.parseLocalDate(ev.date);
            if (evDate) evDate.setHours(0, 0, 0, 0);
            
            if (ev.type === 'start') startEvent = ev;
            if (ev.id === 'evt_exam_final' || ev.type === 'final' || (ev.title && (ev.title.includes('نهائ') || ev.title.includes('فاينل')))) finalsEvent = ev;
            else if (!finalsEvent && ev.type === 'exam') finalsEvent = ev;
            
            if (evDate && evDate >= today) {
                if (isQuiz(ev) && !closestExam) closestExam = ev;
                if (ev.type === 'holiday' && !nextVacation) nextVacation = ev;
            }
            
            if (ev.type === 'holiday' && ev.end_date) {
                const s = this.parseLocalDate(ev.date); if (s) s.setHours(0,0,0,0);
                const e = this.parseLocalDate(ev.end_date); if (e) e.setHours(0,0,0,0);
                if (s && e && today >= s && today <= e) currentVacation = ev;
            }
        });

        const elExam = document.getElementById('val-exam');
        const elExamName = document.getElementById('val-exam-name');
        const statExamCard = document.getElementById('stat-exam');
        const elExamTitle = statExamCard ? statExamCard.querySelector('.stat-title') : null;
        if (elExamTitle) elExamTitle.innerText = 'أقرب كويز';

        if (closestExam) {
            const cDate = this.parseLocalDate(closestExam.date);
            if (cDate) cDate.setHours(0, 0, 0, 0);
            const diffTime = cDate ? Math.abs(cDate - today) : 0;
            const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
            if (elExam) {
                let diffDaysText = '';
                if (diffDays === 0) diffDaysText = 'اليوم';
                else if (diffDays === 1) diffDaysText = 'غداً';
                else if (diffDays === 2) diffDaysText = 'بعد يومين';
                else if (diffDays >= 3 && diffDays <= 10) diffDaysText = `بعد ${diffDays} أيام`;
                else diffDaysText = `بعد ${diffDays} يوماً`;
                elExam.innerText = diffDaysText;
                elExam.style.color = '';
            }
            if (elExamName) {
                elExamName.innerText = `(${closestExam.title})`;
                elExamName.title = closestExam.title;
            }
            if (statExamCard) {
                statExamCard.style.cursor = 'pointer';
                statExamCard.title = `انقر للانتقال إلى: ${closestExam.title}`;
                statExamCard.onclick = () => {
                    const targetCard = document.getElementById(`event-${closestExam.id}`);
                    if (targetCard) {
                        targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        targetCard.classList.add('highlight');
                        setTimeout(() => targetCard.classList.remove('highlight'), 2500);
                    }
                };
            }
        } else {
            if (elExam) {
                elExam.innerText = 'لا يوجد';
                elExam.style.color = '';
            }
            if (elExamName) {
                elExamName.innerText = 'لا توجد كويزات قادمة';
                elExamName.title = '';
            }
            if (statExamCard) {
                statExamCard.onclick = null;
                statExamCard.style.cursor = 'default';
                statExamCard.title = '';
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
                    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
                    if (elDays) elDays.innerText = diffDays;
                } else {
                    if (elDays) elDays.innerText = '0';
                }
            }
        } else if (startDate && today < startDate) {
            if (elDays) elDays.innerText = 'لم يبدأ';
            if (elDaysSub) elDaysSub.innerText = 'في الفصل الدراسي';
        } else if (semesterEndDate && today > semesterEndDate) {
            if (elDays) elDays.innerText = '0';
        } else {
            if (semesterEndDate) {
                const diffTime = Math.abs(semesterEndDate - today);
                const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
                if (elDays) elDays.innerText = diffDays;
                if (elDaysSub) elDaysSub.innerText = 'في الفصل الدراسي';
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
                const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
                if (elVacation) elVacation.innerText = diffDays + ' يوم';
            }
            if (elVacationName) elVacationName.innerText = currentVacation.title;
        } else if (nextVacation) {
            if (elVacationTitle) elVacationTitle.innerText = 'الإجازة القادمة';
            const nDate = this.parseLocalDate(nextVacation.date);
            if (nDate) {
                nDate.setHours(0,0,0,0);
                const diffTime = Math.abs(nDate - today);
                const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
                if (elVacation) elVacation.innerText = diffDays + ' يوم';
            }
            if (elVacationName) elVacationName.innerText = '(' + nextVacation.title + ')';
        } else {
            if (elVacationTitle) elVacationTitle.innerText = 'الإجازة القادمة';
            if (elVacation) elVacation.innerText = 'انتهت';
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
            sessionStorage.removeItem('dent2025_admin_pass');
            sessionStorage.removeItem('dent2025_permissions');
            sessionStorage.removeItem('dent2025_passkey_info');
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
    showEventModal: function(existingEvent = null) {
        const isEdit = !!(existingEvent && existingEvent.id);
        const eventId = isEdit ? existingEvent.id : '';
        const modalTitle = isEdit ? 'تعديل الحدث في التقويم' : 'إضافة حدث جديد للتقويم';
        const submitBtnText = isEdit ? 'حفظ التعديلات' : 'حفظ الحدث';
        
        const titleVal = isEdit ? dentEscapeHtml(existingEvent.title || '') : '';
        const standardTypes = ['quiz', 'assessment', 'research', 'homework', 'exam', 'midterm', 'final', 'deadline', 'holiday', 'payment', 'start', 'other'];
        const isCustomType = isEdit && (existingEvent.type === 'custom' || (!standardTypes.includes(existingEvent.type) && existingEvent.type) || !!existingEvent.type_label);
        const effectiveType = isCustomType ? 'custom' : (isEdit ? (existingEvent.type || 'other') : 'quiz');
        const customTypeVal = isCustomType ? (existingEvent.type_label || existingEvent.type || '') : '';

        const dateVal = isEdit ? (existingEvent.date || '') : '';
        const endDateVal = isEdit ? (existingEvent.end_date || '') : '';
        const isGlobal = isEdit ? !!existingEvent.is_global : (this.scheduleId === 'global');
        const schedIdVal = isEdit ? (existingEvent.schedule_id || (isGlobal ? 'global' : this.scheduleId)) : this.scheduleId;
        const scopeText = isGlobal ? 'عام' : schedIdVal;

        const initialHijri = isEdit && existingEvent.hijri ? existingEvent.hijri : (dateVal ? this.hijriFromGregorian(dateVal) : '—');

        let modal = document.getElementById('dent-admin-modal');
        if (modal) modal.remove();

        modal = document.createElement('div');
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
                        <h3 style="margin: 0 0 4px; font-size: 1.1rem; font-weight: 700; color: #f8fafc;">${modalTitle}</h3>
                        <span style="font-size: 0.75rem; color: #a78bfa; background: rgba(167,139,250,0.12); border: 1px solid rgba(167,139,250,0.25); border-radius: 6px; padding: 2px 8px; display: inline-block;">نطاق: ${dentEscapeHtml(scopeText)}</span>
                    </div>
                    <button type="button" onclick="document.getElementById('dent-admin-modal').remove()" style="background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.12); color:#e2e8f0; width:34px; height:34px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:1.2rem; cursor:pointer; flex-shrink:0; transition:all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.18)'; this.style.color='#fff';" onmouseout="this.style.background='rgba(255,255,255,0.08)'; this.style.color='#e2e8f0';">×</button>
                </div>
                
                <input type="hidden" id="ev-id" value="${dentEscapeHtml(eventId)}">

                <div style="margin-bottom: 14px;">
                    <label style="font-size:0.8rem; color:#a1a1aa; font-weight:600; display:block; margin-bottom:5px;">عنوان الحدث</label>
                    <input type="text" id="ev-title" value="${titleVal}" placeholder="عنوان الحدث (مثال: بداية الاختبارات)" style="width: 100%; height: 44px; padding: 0 14px; background: #121212; border: 1px solid rgba(255,255,255,0.12); border-radius: 10px; color: #fff; font-size: 0.9rem; font-family: inherit; box-sizing: border-box; outline: none; transition: all 0.2s;" onfocus="this.style.borderColor='rgba(255,255,255,0.4)';" onblur="this.style.borderColor='rgba(255,255,255,0.12)';">
                </div>
                
                <div style="margin-bottom: 14px;">
                    <label style="font-size:0.8rem; color:#a1a1aa; font-weight:600; display:block; margin-bottom:5px;">نوع الحدث</label>
                    <select id="ev-type" onchange="ScheduleApp.toggleCustomTypeInput(this.value)" style="width: 100%; height: 44px; padding: 0 14px; background: #121212; border: 1px solid rgba(255,255,255,0.12); border-radius: 10px; color: #fff; font-size: 0.9rem; font-family: inherit; box-sizing: border-box; outline: none; transition: all 0.2s; color-scheme: dark;" onfocus="this.style.borderColor='rgba(255,255,255,0.4)';" onblur="this.style.borderColor='rgba(255,255,255,0.12)';">
                        <option value="quiz"${effectiveType === 'quiz' ? ' selected' : ''}>كويز</option>
                        <option value="assessment"${effectiveType === 'assessment' ? ' selected' : ''}>اسسمنت / تقييم</option>
                        <option value="research"${effectiveType === 'research' ? ' selected' : ''}>بحث / مشروع</option>
                        <option value="homework"${effectiveType === 'homework' ? ' selected' : ''}>واجب / تكليف</option>
                        <option value="exam"${effectiveType === 'exam' ? ' selected' : ''}>اختبار</option>
                        <option value="midterm"${effectiveType === 'midterm' ? ' selected' : ''}>اختبار نصفي</option>
                        <option value="final"${effectiveType === 'final' ? ' selected' : ''}>اختبار نهائي</option>
                        <option value="deadline"${effectiveType === 'deadline' ? ' selected' : ''}>موعد نهائي</option>
                        <option value="holiday"${effectiveType === 'holiday' ? ' selected' : ''}>إجازة</option>
                        <option value="payment"${effectiveType === 'payment' ? ' selected' : ''}>مكافأة</option>
                        <option value="start"${effectiveType === 'start' ? ' selected' : ''}>بداية دراسة</option>
                        <option value="other"${effectiveType === 'other' ? ' selected' : ''}>أخرى</option>
                        <option value="custom"${effectiveType === 'custom' ? ' selected' : ''}>نوع مخصص (كتابة يدوية)...</option>
                    </select>
                    <div id="ev-custom-type-wrap" style="display: ${effectiveType === 'custom' ? 'block' : 'none'}; margin-top: 8px;">
                        <input type="text" id="ev-custom-type" value="${dentEscapeHtml(customTypeVal)}" placeholder="اكتب نوع الحدث المخصص (مثال: بريزنتيشن، معمل، تسليم حالة...)" style="width: 100%; height: 40px; padding: 0 12px; background: rgba(255,255,255,0.04); border: 1px dashed rgba(255,255,255,0.22); border-radius: 8px; color: #fff; font-size: 0.85rem; font-family: inherit; box-sizing: border-box; outline: none; transition: all 0.2s;" onfocus="this.style.borderColor='rgba(255,255,255,0.4)';" onblur="this.style.borderColor='rgba(255,255,255,0.22)';">
                    </div>
                </div>

                <div style="display: flex; gap: 10px; margin-bottom: 14px; width: 100%;">
                    <div style="flex:1; min-width: 0;">
                        <label style="font-size:0.78rem; color:#a1a1aa; font-weight:600; display:block; margin-bottom:5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">تاريخ البداية (ميلادي)</label>
                        <input type="date" id="ev-date" value="${dateVal}" style="width: 100%;" onchange="ScheduleApp.updateHijriPreview()" onfocus="this.style.borderColor='rgba(255,255,255,0.4)';" onblur="this.style.borderColor='rgba(255,255,255,0.12)';">
                    </div>
                    <div style="flex:1; min-width: 0;">
                        <label style="font-size:0.78rem; color:#a1a1aa; font-weight:600; display:block; margin-bottom:5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">تاريخ النهاية (اختياري)</label>
                        <input type="date" id="ev-end" value="${endDateVal}" style="width: 100%;" onfocus="this.style.borderColor='rgba(255,255,255,0.4)';" onblur="this.style.borderColor='rgba(255,255,255,0.12)';">
                    </div>
                </div>
                
                <div style="margin-bottom: 20px;">
                    <label style="font-size:0.78rem; color:#a1a1aa; font-weight:600; display:block; margin-bottom:5px;">التاريخ الهجري (يُحسب تلقائياً)</label>
                    <div id="ev-hijri-preview" style="width: 100%; height: 44px; display: flex; align-items: center; padding: 0 14px; background: rgba(167,139,250,0.08); border: 1px solid rgba(167,139,250,0.25); border-radius: 10px; color: #c4b5fd; font-size: 0.9rem; font-family: inherit; box-sizing: border-box;">${initialHijri}</div>
                </div>
                
                <div style="display: flex; gap: 10px;">
                    <button type="button" id="dent-submit-event-btn" onclick="ScheduleApp.submitSaveEvent()" style="flex: 2; height: 44px; background: #3f3f46; color: #ffffff; border: 1px solid #52525b; border-radius: 10px; cursor: pointer; font-family: inherit; font-weight: 600; font-size: 0.92rem; transition: all 0.2s; display:flex; align-items:center; justify-content:center;" onmouseover="this.style.background='#52525b';" onmouseout="this.style.background='#3f3f46';">${submitBtnText}</button>
                    <button type="button" onclick="document.getElementById('dent-admin-modal').remove()" style="flex: 1; height: 44px; background: #27272a; border: 1px solid rgba(255,255,255,0.1); color: #a1a1aa; border-radius: 10px; cursor: pointer; font-family: inherit; font-weight: 500; font-size: 0.88rem; transition: all 0.2s; display:flex; align-items:center; justify-content:center;" onmouseover="this.style.background='rgba(255,255,255,0.12)'; this.style.color='#fff';" onmouseout="this.style.background='#27272a'; this.style.color='#a1a1aa';">إلغاء</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    },
    showAddModal: function() {
        this.showEventModal(null);
    },
    showEditModal: function(id) {
        if (!this.eventsData || !this.eventsData.length) {
            alert('بيانات الأحداث غير متوفرة حالياً.');
            return;
        }
        const ev = this.eventsData.find(e => String(e.id) === String(id));
        if (!ev) {
            alert('الحدث المطلوب غير موجود.');
            return;
        }
        this.showEventModal(ev);
    },
    submitSaveEvent: function() {
        const idInput = document.getElementById('ev-id');
        const id = idInput ? idInput.value.trim() : '';
        const isEdit = !!id;

        const title = (document.getElementById('ev-title')?.value || '').trim();
        const typeSelect = document.getElementById('ev-type');
        let selectedType = typeSelect ? typeSelect.value : 'other';
        let typeLabel = null;

        if (selectedType === 'custom') {
            const customInput = document.getElementById('ev-custom-type');
            const customVal = (customInput ? customInput.value : '').trim();
            if (customVal) {
                selectedType = 'custom';
                typeLabel = customVal;
            } else {
                selectedType = 'other';
                typeLabel = 'أخرى';
            }
        } else {
            const selectedOpt = typeSelect ? typeSelect.options[typeSelect.selectedIndex] : null;
            if (selectedOpt) {
                typeLabel = selectedOpt.text.trim();
            }
        }

        const date = (document.getElementById('ev-date')?.value || '').trim();
        const end_date = (document.getElementById('ev-end')?.value || '').trim();
        const previewEl = document.getElementById('ev-hijri-preview');
        const previewText = previewEl ? previewEl.textContent.trim() : '';
        const hijri = (previewText && previewText !== '—') ? previewText : this.hijriFromGregorian(date);

        if (!title || !date) {
            alert('العنوان وتاريخ البداية مطلوبان!');
            return;
        }

        let isGlobal = false;
        let targetSchedId = this.scheduleId;
        if (isEdit) {
            const origEv = (this.eventsData || []).find(e => String(e.id) === String(id));
            if (origEv) {
                isGlobal = !!origEv.is_global;
                targetSchedId = origEv.schedule_id || (isGlobal ? 'global' : this.scheduleId);
            }
        } else {
            isGlobal = (this.scheduleId === 'global');
        }

        const payload = {
            action: isEdit ? 'edit' : 'add',
            password: this.adminPassword,
            schedule_id: targetSchedId,
            is_global: isGlobal,
            title: title,
            type: selectedType,
            type_label: typeLabel,
            date: date,
            end_date: end_date || null,
            hijri: hijri
        };
        if (isEdit) {
            payload.id = id;
        }

        const submitBtn = document.getElementById('dent-submit-event-btn');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerText = 'جاري الحفظ...';
        }

        fetch(this.apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        }).then(r => r.json()).then(res => {
            if (res.success) {
                localStorage.removeItem('dent2025_schedule_' + this.scheduleId);
                sessionStorage.removeItem('dent2025_schedule_global');
                const m = document.getElementById('dent-admin-modal');
                if (m) m.remove();
                this.init(); // Reload from server
            } else {
                alert('فشل الحفظ: ' + (res.message || 'Unknown error'));
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerText = isEdit ? 'حفظ التعديلات' : 'حفظ الحدث';
                }
            }
        }).catch(err => {
            console.error('Schedule save error:', err);
            alert('تعذر الاتصال بالخادم لحفظ الحدث.');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerText = isEdit ? 'حفظ التعديلات' : 'حفظ الحدث';
            }
        });
    },
    submitAddEvent: function() {
        this.submitSaveEvent();
    },
    deleteEvent: function(id, isGlobal, targetScheduleId) {
        if(!confirm('هل أنت متأكد من حذف هذا الحدث؟')) return;
        const schedId = (isGlobal || targetScheduleId === 'global') ? 'global' : (targetScheduleId || this.scheduleId);
        fetch(this.apiUrl, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                password: this.adminPassword,
                schedule_id: schedId,
                is_global: !!isGlobal,
                id: id
            })
        }).then(r => r.json()).then(res => {
            if(res.success) {
                localStorage.removeItem('dent2025_schedule_' + this.scheduleId);
                sessionStorage.removeItem('dent2025_schedule_global');
                this.init(); // Reload
            } else {
                alert('فشل الحذف: ' + (res.message || 'Unknown error'));
            }
        }).catch(err => {
            console.error('Schedule delete error:', err);
            alert('تعذر الاتصال بالخادم لحذف الحدث.');
        });
    },

    // 2-WEEK PRINT FEATURE
    _prefetchedAnnouncements: null,

    prefetchPrintAnnouncements: async function() {
        try {
            let sel = {};
            try { sel = JSON.parse(localStorage.getItem('dent2025_selection') || '{}'); } catch(e) {}
            let spec = sel.specialty;
            let yr = sel.year;
            let sem = sel.semester;
            if (!spec && this.scheduleId && this.scheduleId !== 'global') {
                const parts = this.scheduleId.match(/^([a-z\-]+)_y(\d+)_s(\d+)$/);
                if (parts) {
                    spec = parts[1];
                    yr = parts[2];
                    sem = parts[3];
                }
            }
            if (!spec) {
                spec = 'dentistry'; yr = 3; sem = 1;
            }
            const apiBase = (typeof API_BASE !== 'undefined' ? API_BASE : window.location.origin);
            const res = await fetch(`${apiBase}/announcements_api.php?specialty=${encodeURIComponent(spec)}&year=${encodeURIComponent(yr)}&semester=${encodeURIComponent(sem)}&_t=${Date.now()}`);
            const data = await res.json();
            if (data && data.success && data.data && data.data.content) {
                const raw = String(data.data.content).trim();
                if (raw && raw !== 'لا يوجد إعلانات حالياً.' && raw !== '<p></p>' && raw !== '<br>') {
                    this._prefetchedAnnouncements = raw;
                    return raw;
                }
            }
            this._prefetchedAnnouncements = '';
        } catch(e) {
            this._prefetchedAnnouncements = '';
        }
        return '';
    },

    openPrintModal: function() {
        let modal = document.getElementById('dent-print-schedule-modal');
        if (modal) modal.remove();

        // Start prefetching announcements and scripts immediately in background for ultra-fast export
        this._prefetchedAnnouncements = null;
        this.prefetchPrintAnnouncements();
        this.loadHtmlToImage().catch(() => {});
        this.loadJsPdf().catch(() => {});

        modal = document.createElement('div');
        modal.id = 'dent-print-schedule-modal';
        modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(10, 10, 15, 0.85); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); z-index: 9999999; display: flex; justify-content: center; align-items: center; direction: rtl; font-family: \'Outfit\', \'Noto Kufi Arabic\', sans-serif; padding: 16px; box-sizing: border-box;';
        modal.innerHTML = `
            <style>@keyframes dentSpin { to { transform: rotate(360deg); } }</style>
            <div style="background: #18181b; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 18px; padding: 24px; width: 100%; max-width: 460px; box-shadow: 0 25px 60px rgba(0,0,0,0.8); color: #fff; box-sizing: border-box;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 18px; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 12px;">
                    <h3 style="margin: 0; font-size: 1.05rem; font-weight: 700; color: #f8fafc;">تصدير وإرسال تقويم الأسابيع الـ 3 القادمة</h3>
                    <button type="button" onclick="document.getElementById('dent-print-schedule-modal').remove()" style="background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.12); color:#e2e8f0; width:34px; height:34px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:1.2rem; cursor:pointer; transition:all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.18)'; this.style.color='#fff';" onmouseout="this.style.background='rgba(255,255,255,0.08)'; this.style.color='#e2e8f0';">×</button>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 4px;">
                    <button type="button" id="dent-exec-print-btn" onclick="ScheduleApp.executeSaveAsPdf()" style="width: 100%; height: 48px; background: #27272a; color: #ffffff; border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 12px; cursor: pointer; font-family: inherit; font-weight: 700; font-size: 0.90rem; transition: all 0.2s; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);" onmouseover="this.style.background='#ef4444'; this.style.borderColor='#ef4444';" onmouseout="this.style.background='#27272a'; this.style.borderColor='rgba(239, 68, 68, 0.4)';">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
                        <span>ملف PDF</span>
                    </button>

                    <button type="button" id="dent-exec-image-btn" onclick="ScheduleApp.executeSaveAsImage()" style="width: 100%; height: 48px; background: #27272a; color: #ffffff; border: 1px solid rgba(59, 130, 246, 0.4); border-radius: 12px; cursor: pointer; font-family: inherit; font-weight: 700; font-size: 0.90rem; transition: all 0.2s; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);" onmouseover="this.style.background='#2563eb'; this.style.borderColor='#2563eb';" onmouseout="this.style.background='#27272a'; this.style.borderColor='rgba(59, 130, 246, 0.4)';">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                        <span>صورة PNG</span>
                    </button>
                </div>

                <div style="font-size: 0.74rem; color: #94a3b8; text-align: center; margin: 8px 0 14px 0;">اختر الصيغة للمشاركة الفورية عبر واتساب أو الحفظ بجهازك</div>

                <label style="display: flex; align-items: flex-start; gap: 10px; margin-top: 16px; padding: 10px 12px; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; font-size: 0.80rem; color: #cbd5e1; cursor: pointer; user-select: none;">
                    <input type="checkbox" id="dent-print-inc-announcements" checked style="accent-color: #52525b; width: 16px; height: 16px; margin-top: 2px; cursor: pointer;">
                    <span>تضمين إعلانات الدفعة (الإعلان بالصفحة الرئيسية) في أسفل الورقة</span>
                </label>

                <div style="margin-top: 14px;">
                    <label style="font-size: 0.78rem; color: #a1a1aa; font-weight: 600; display: block; margin-bottom: 6px;">ملاحظات أو تذكيرات إضافية (اختياري):</label>
                    <textarea id="dent-print-custom-notes" placeholder="اكتب أي ملاحظات أو تذكيرات ترغب في ظهورها أسفل الورقة (اختياري - ستختفي هذه المساحة تلقائياً عند التصدير إذا تركتها فارغة)..." style="width: 100%; height: 80px; padding: 10px 12px; background: #121212; border: 1px solid rgba(255,255,255,0.12); border-radius: 10px; color: #fff; font-size: 0.82rem; font-family: inherit; box-sizing: border-box; outline: none; resize: vertical; line-height: 1.5;"></textarea>
                </div>

                <div style="margin-top: 18px; display: flex; justify-content: flex-end;">
                    <button type="button" onclick="document.getElementById('dent-print-schedule-modal').remove()" style="padding: 8px 18px; background: #27272a; border: 1px solid rgba(255,255,255,0.1); color: #a1a1aa; border-radius: 8px; cursor: pointer; font-family: inherit; font-size: 0.85rem; font-weight: 500; transition: all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.12)'; this.style.color='#fff';" onmouseout="this.style.background='rgba(255,255,255,0.08)'; this.style.color='#a1a1aa';">إلغاء</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    },

    loadJsPdf: function() {
        if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
        if (this._jsPdfPromise) return this._jsPdfPromise;
        this._jsPdfPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
            script.crossOrigin = 'anonymous';
            script.onload = () => {
                if (window.jspdf && window.jspdf.jsPDF) resolve(window.jspdf.jsPDF);
                else reject(new Error('فشل تهيئة مكتبة الـ PDF.'));
            };
            script.onerror = () => {
                this._jsPdfPromise = null;
                reject(new Error('تعذر تحميل مكتبة إنشاء الـ PDF، يرجى التحقق من الاتصال.'));
            };
            document.head.appendChild(script);
        });
        return this._jsPdfPromise;
    },

    executeSaveAsPdf: async function() {
        const btn = document.getElementById('dent-exec-print-btn');
        const imgBtn = document.getElementById('dent-exec-image-btn');
        const origHtml = btn ? btn.innerHTML : '';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: dentSpin 0.8s linear infinite;"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle><path d="M12 2a10 10 0 0 1 10 10"></path></svg>
                <span>جاري إنشاء PDF...</span>
            `;
        }
        if (imgBtn) imgBtn.disabled = true;

        try {
            const notes = (document.getElementById('dent-print-custom-notes')?.value || '').trim();
            const incAnnouncements = !!document.getElementById('dent-print-inc-announcements')?.checked;

            let announcementText = '';
            if (incAnnouncements) {
                if (this._prefetchedAnnouncements !== null && this._prefetchedAnnouncements !== undefined) {
                    announcementText = this._prefetchedAnnouncements;
                } else {
                    announcementText = await this.prefetchPrintAnnouncements();
                }
            }

            const printHtml = this.generateThreeWeeksPrintHtml(notes, announcementText, false);

            // Parallel load jspdf while creating DOM
            const jsPdfPromise = this.loadJsPdf();

            let iframe = document.getElementById('dent-image-render-iframe');
            if (iframe) iframe.remove();

            iframe = document.createElement('iframe');
            iframe.id = 'dent-image-render-iframe';
            iframe.setAttribute('width', '860');
            iframe.setAttribute('height', '1400');
            iframe.style.cssText = 'position:fixed; left:-9999px; top:0; width:860px !important; min-width:860px !important; max-width:860px !important; height:1400px !important; border:0; z-index:-99999;';
            document.body.appendChild(iframe);

            const doc = iframe.contentWindow.document;
            doc.open();
            doc.write(printHtml);
            doc.close();

            if (doc.documentElement) {
                doc.documentElement.style.width = '860px';
                doc.documentElement.style.minWidth = '860px';
            }
            if (doc.body) {
                doc.body.style.width = '860px';
                doc.body.style.minWidth = '860px';
            }

            if (doc.fonts && doc.fonts.ready) {
                await doc.fonts.ready.catch(() => {});
            }
            await new Promise(resolve => setTimeout(resolve, 120));

            const targetEl = doc.querySelector('.a4-print-sheet');
            if (!targetEl) throw new Error('تعذر العثور على محتوى الجدول للتصدير.');

            targetEl.style.width = '860px';
            targetEl.style.minWidth = '860px';
            targetEl.style.maxWidth = '860px';
            targetEl.style.boxSizing = 'border-box';

            const targetWidth = 860;
            const targetHeight = targetEl.offsetHeight || targetEl.scrollHeight || 1200;

            const htmlToImage = await this.loadHtmlToImage();
            const pngDataUrl = await htmlToImage.toPng(targetEl, {
                pixelRatio: 2.0,
                width: targetWidth,
                height: targetHeight,
                canvasWidth: Math.round(targetWidth * 2.0),
                canvasHeight: Math.round(targetHeight * 2.0),
                backgroundColor: '#ffffff'
            });

            if (iframe) iframe.remove();

            const jsPdfClass = await jsPdfPromise;
            const pdf = new jsPdfClass({
                orientation: 'p',
                unit: 'mm',
                format: 'a4',
                compress: true
            });

            const pdfPageWidth = 210;
            const pdfPageHeight = 297;
            const imgHeightMm = (targetHeight / targetWidth) * pdfPageWidth;

            if (imgHeightMm <= pdfPageHeight) {
                pdf.addImage(pngDataUrl, 'PNG', 0, 0, pdfPageWidth, imgHeightMm, undefined, 'FAST');
            } else {
                let heightLeft = imgHeightMm;
                let position = 0;
                pdf.addImage(pngDataUrl, 'PNG', 0, position, pdfPageWidth, imgHeightMm, undefined, 'FAST');
                heightLeft -= pdfPageHeight;
                while (heightLeft > 0) {
                    position = heightLeft - imgHeightMm;
                    pdf.addPage();
                    pdf.addImage(pngDataUrl, 'PNG', 0, position, pdfPageWidth, imgHeightMm, undefined, 'FAST');
                    heightLeft -= pdfPageHeight;
                }
            }

            const pdfBlob = pdf.output('blob');
            const fileName = this.getDynamicScheduleFileName('pdf');
            const file = new File([pdfBlob], fileName, { type: 'application/pdf' });

            const modal = document.getElementById('dent-print-schedule-modal');
            if (modal) modal.remove();

            await this.deliverExportedFile(file, pdfBlob, fileName, 'pdf');

        } catch(err) {
            console.error('Save as PDF error:', err);
            alert('حدث خطأ أثناء إنشاء ملف الـ PDF: ' + (err.message || err));
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = origHtml;
            }
            if (imgBtn) imgBtn.disabled = false;
        }
    },

    executePrint: async function() {
        return this.executeSaveAsPdf();
    },

    getDynamicScheduleFileName: function(ext = 'png') {
        let sel = {};
        try { sel = JSON.parse(localStorage.getItem('dent2025_selection') || '{}'); } catch(e) {}
        if (!sel || !sel.specialty) {
            sel = { specialty: 'dentistry', year: 3, semester: 1 };
        }

        let specPart = 'Schedule';
        if (sel.specialty === 'dentistry') specPart = 'Dentistry';
        else if (sel.specialty === 'medicine') specPart = 'Medicine';
        else if (sel.specialty === 'pre-med') specPart = 'PreMed';

        const yrPart = (sel.specialty === 'pre-med' || !sel.year) ? '' : `_Y${sel.year}`;
        const semPart = sel.semester ? `_S${sel.semester}` : '';

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const currentSunday = new Date(today);
        currentSunday.setDate(today.getDate() - today.getDay());
        const startSunday = new Date(2026, 7, 30);
        const startWeekNum = Math.floor((currentSunday - startSunday) / (1000 * 60 * 60 * 24 * 7)) + 1;
        const endWeekNum = startWeekNum + 2;

        let weekPart = '';
        if (startWeekNum > 0) {
            weekPart = `_Weeks${startWeekNum}-${endWeekNum}`;
        }

        const cleanExt = ext ? (ext.startsWith('.') ? ext.slice(1) : ext) : '';
        const baseName = `Dent2025_${specPart}${yrPart}${semPart}${weekPart}`;
        return cleanExt ? `${baseName}.${cleanExt}` : baseName;
    },

    loadHtmlToImage: function() {
        if (window.htmlToImage) return Promise.resolve(window.htmlToImage);
        if (this._htmlToImagePromise) return this._htmlToImagePromise;
        this._htmlToImagePromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html-to-image/1.11.11/html-to-image.min.js';
            script.crossOrigin = 'anonymous';
            script.onload = () => resolve(window.htmlToImage);
            script.onerror = () => {
                this._htmlToImagePromise = null;
                reject(new Error('تعذر تحميل مكتبة معالجة الصور عالية الدقة.'));
            };
            document.head.appendChild(script);
        });
        return this._htmlToImagePromise;
    },

    loadHtml2Canvas: function() {
        if (window.html2canvas) return Promise.resolve(window.html2canvas);
        if (this._html2canvasPromise) return this._html2canvasPromise;
        this._html2canvasPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
            script.crossOrigin = 'anonymous';
            script.onload = () => resolve(window.html2canvas);
            script.onerror = () => {
                this._html2canvasPromise = null;
                reject(new Error('تعذر تحميل مكتبة معالجة الصور، يرجى التحقق من اتصال الإنترنت.'));
            };
            document.head.appendChild(script);
        });
        return this._html2canvasPromise;
    },

    executeSaveAsImage: async function() {
        const btn = document.getElementById('dent-exec-image-btn');
        const pdfBtn = document.getElementById('dent-exec-print-btn');
        const origHtml = btn ? btn.innerHTML : '';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: dentSpin 0.8s linear infinite;"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle><path d="M12 2a10 10 0 0 1 10 10"></path></svg>
                <span>جاري إنشاء الصورة...</span>
            `;
        }
        if (pdfBtn) pdfBtn.disabled = true;

        try {
            const notes = (document.getElementById('dent-print-custom-notes')?.value || '').trim();
            const incAnnouncements = !!document.getElementById('dent-print-inc-announcements')?.checked;

            let announcementText = '';
            if (incAnnouncements) {
                if (this._prefetchedAnnouncements !== null && this._prefetchedAnnouncements !== undefined) {
                    announcementText = this._prefetchedAnnouncements;
                } else {
                    announcementText = await this.prefetchPrintAnnouncements();
                }
            }

            const printHtml = this.generateThreeWeeksPrintHtml(notes, announcementText, false);

            let iframe = document.getElementById('dent-image-render-iframe');
            if (iframe) iframe.remove();

            iframe = document.createElement('iframe');
            iframe.id = 'dent-image-render-iframe';
            iframe.setAttribute('width', '860');
            iframe.setAttribute('height', '1400');
            iframe.style.cssText = 'position:fixed; left:-9999px; top:0; width:860px !important; min-width:860px !important; max-width:860px !important; height:1400px !important; border:0; z-index:-99999;';
            document.body.appendChild(iframe);

            const doc = iframe.contentWindow.document;
            doc.open();
            doc.write(printHtml);
            doc.close();

            if (doc.documentElement) {
                doc.documentElement.style.width = '860px';
                doc.documentElement.style.minWidth = '860px';
            }
            if (doc.body) {
                doc.body.style.width = '860px';
                doc.body.style.minWidth = '860px';
            }

            if (doc.fonts && doc.fonts.ready) {
                await doc.fonts.ready.catch(() => {});
            }
            await new Promise(resolve => setTimeout(resolve, 120));

            const targetEl = doc.querySelector('.a4-print-sheet');
            if (!targetEl) throw new Error('تعذر العثور على محتوى الجدول للتصدير.');

            targetEl.style.width = '860px';
            targetEl.style.minWidth = '860px';
            targetEl.style.maxWidth = '860px';
            targetEl.style.boxSizing = 'border-box';

            const targetWidth = 860;
            const targetHeight = targetEl.offsetHeight || targetEl.scrollHeight || 1200;

            let blob = null;
            // Primary high-fidelity rasterizer: html-to-image (SVG foreignObject preserves Arabic ligatures, word-spacing, BiDi)
            try {
                const htmlToImage = await this.loadHtmlToImage();
                blob = await htmlToImage.toBlob(targetEl, {
                    pixelRatio: 2.0,
                    width: targetWidth,
                    height: targetHeight,
                    canvasWidth: Math.round(targetWidth * 2.0),
                    canvasHeight: Math.round(targetHeight * 2.0),
                    backgroundColor: '#ffffff'
                });
            } catch(imgErr) {
                console.warn('html-to-image failed or blocked, falling back to html2canvas:', imgErr);
                await this.loadHtml2Canvas();
                const canvas = await window.html2canvas(targetEl, {
                    scale: 2.0,
                    width: targetWidth,
                    height: targetHeight,
                    windowWidth: targetWidth,
                    windowHeight: targetHeight,
                    useCORS: true,
                    allowTaint: true,
                    backgroundColor: '#ffffff',
                    logging: false,
                    scrollX: 0,
                    scrollY: 0
                });
                blob = await new Promise((resolve, reject) => {
                    canvas.toBlob(b => {
                        if (b) resolve(b);
                        else reject(new Error('فشل استخراج ملف الصورة.'));
                    }, 'image/png');
                });
            }

            if (iframe) iframe.remove();

            if (!blob) throw new Error('فشل إنشاء ملف الصورة.');

            const fileName = this.getDynamicScheduleFileName('png');
            const file = new File([blob], fileName, { type: 'image/png' });

            const modal = document.getElementById('dent-print-schedule-modal');
            if (modal) modal.remove();

            await this.deliverExportedFile(file, blob, fileName, 'png');

        } catch(err) {
            console.error('Save as image error:', err);
            alert('حدث خطأ أثناء إنشاء الصورة: ' + (err.message || err));
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = origHtml;
            }
            if (pdfBtn) pdfBtn.disabled = false;
        }
    },

    deliverExportedFile: async function(file, blob, fileName, fileType) {
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
                         (window.matchMedia && window.matchMedia('(max-width: 768px)').matches && 'ontouchstart' in window);

        const blobUrl = URL.createObjectURL(blob);

        // 1. On mobile devices, try native Web Share API immediately
        if (isMobile && navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({
                    files: [file],
                    title: fileName.replace(/\.[^.]+$/, ''),
                    text: 'جدول الأسابيع القادمة • منصة Dent2025'
                });
                setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
                return;
            } catch(shareErr) {
                if (shareErr.name === 'AbortError') {
                    // User dismissed share sheet, continue to download/toast so file is not lost
                } else {
                    console.warn('Native share failed or gesture expired:', shareErr);
                }
            }
        }

        // 2. Direct automatic browser download
        try {
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => document.body.removeChild(a), 500);
        } catch(dlErr) {
            console.warn('Download failed:', dlErr);
        }

        // 3. Show sleek toast prompting to send, copy, or view
        this.showExportToast(file, blob, fileName, fileType, blobUrl);
    },

    showExportToast: function(file, blob, fileName, fileType, blobUrl) {
        let old = document.getElementById('dent-export-toast');
        if (old) old.remove();

        const toast = document.createElement('div');
        toast.id = 'dent-export-toast';
        toast.style.cssText = 'position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); z-index: 9999999; background: #18181b; border: 1px solid rgba(255,255,255,0.18); border-radius: 16px; padding: 14px 18px; box-shadow: 0 20px 50px rgba(0,0,0,0.7); color: #fff; font-family: "Outfit", "Noto Kufi Arabic", sans-serif; direction: rtl; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; max-width: 94vw; width: 560px; box-sizing: border-box;';
        
        const canShareNative = !!(navigator.canShare && navigator.canShare({ files: [file] }));
        const canCopyImage = (fileType === 'png' && navigator.clipboard && window.ClipboardItem);
        const typeLabel = (fileType === 'pdf' ? 'ملف الـ PDF' : 'ملف الصورة');

        toast.innerHTML = `
            <div style="display: flex; align-items: center; gap: 12px; min-width: 220px; flex: 1;">
                <div style="width: 36px; height: 36px; border-radius: 50%; background: rgba(34, 197, 94, 0.15); border: 1px solid rgba(34, 197, 94, 0.3); display: flex; align-items: center; justify-content: center; color: #4ade80; flex-shrink: 0;">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
                </div>
                <div style="min-width: 0;">
                    <div style="font-weight: 700; font-size: 0.90rem; color: #f8fafc;">تم تجهيز ${typeLabel} بنجاح!</div>
                    <div style="font-size: 0.72rem; color: #94a3b8; margin-top: 2px;">تم التنزيل وهو جاهز للإرسال الآن (${dentEscapeHtml(fileName)})</div>
                </div>
            </div>
            <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 8px; flex-shrink: 0;">
                ${canShareNative ? `
                    <button id="dent-toast-share-btn" type="button" style="padding: 7px 13px; background: #059669; color: #fff; border: none; border-radius: 8px; font-family: inherit; font-size: 0.78rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: all 0.2s;" onmouseover="this.style.background='#047857';" onmouseout="this.style.background='#059669';">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
                        <span>مشاركة / إرسال</span>
                    </button>
                ` : ''}
                ${canCopyImage ? `
                    <button id="dent-toast-copy-btn" type="button" style="padding: 7px 13px; background: #2563eb; color: #fff; border: none; border-radius: 8px; font-family: inherit; font-size: 0.78rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: all 0.2s;" onmouseover="this.style.background='#1d4ed8';" onmouseout="this.style.background='#2563eb';">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                        <span>نسخ للصق في واتساب</span>
                    </button>
                ` : ''}
                <a href="${blobUrl}" target="_blank" rel="noopener noreferrer" style="padding: 7px 12px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: #e2e8f0; text-decoration: none; border-radius: 8px; font-family: inherit; font-size: 0.78rem; font-weight: 600; display: flex; align-items: center; gap: 5px; transition: all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.15)';" onmouseout="this.style.background='rgba(255,255,255,0.08)';">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                    <span>عرض الملف</span>
                </a>
                <button type="button" onclick="document.getElementById('dent-export-toast')?.remove()" style="background: transparent; border: none; color: #94a3b8; font-size: 1.2rem; cursor: pointer; padding: 4px 6px; line-height: 1;">✕</button>
            </div>
        `;

        document.body.appendChild(toast);

        if (canShareNative) {
            const shareBtn = document.getElementById('dent-toast-share-btn');
            if (shareBtn) {
                shareBtn.onclick = async () => {
                    try {
                        await navigator.share({
                            files: [file],
                            title: fileName.replace(/\.[^.]+$/, ''),
                            text: 'جدول الأسابيع القادمة • منصة Dent2025'
                        });
                    } catch(err) {
                        if (err.name !== 'AbortError') console.warn('Toast share failed:', err);
                    }
                };
            }
        }

        if (canCopyImage) {
            const copyBtn = document.getElementById('dent-toast-copy-btn');
            if (copyBtn) {
                copyBtn.onclick = async () => {
                    try {
                        await navigator.clipboard.write([
                            new ClipboardItem({ 'image/png': blob })
                        ]);
                        copyBtn.innerHTML = '✓ تم النسخ!';
                        copyBtn.style.background = '#16a34a';
                        setTimeout(() => {
                            if (toast.parentElement) toast.remove();
                        }, 2500);
                    } catch(err) {
                        console.warn('Clipboard write failed:', err);
                        copyBtn.innerHTML = 'تعذر النسخ التلقائي';
                    }
                };
            }
        }

        setTimeout(() => {
            if (toast && toast.parentElement) {
                toast.style.opacity = '0';
                toast.style.transition = 'opacity 0.4s';
                setTimeout(() => {
                    if (toast.parentElement) toast.remove();
                    URL.revokeObjectURL(blobUrl);
                }, 400);
            }
        }, 12000);
    },

    formatEventTitleHtml: function(rawTitle) {
        if (!rawTitle) return '';
        const escaped = dentEscapeHtml(rawTitle);
        // Wrap English phrase runs (3+ letters) in an isolated inline LTR bdi element
        // while preserving HTML entities (&amp;, &quot;, &#39;, &hellip;, etc.) intact
        // so mixed BiDi Arabic-English titles never scramble parentheses or hyphens,
        // while avoiding display:inline-block which causes wide empty gaps before closing parentheses on WebKit/iOS.
        return escaped.replace(/(&[a-zA-Z0-9#]+;)|([A-Za-z][A-Za-z0-9\s\-_:\/,\.]{3,}[A-Za-z0-9])/g, function(match, entity, english) {
            if (entity) return entity;
            return '<bdi dir="ltr" style="display:inline; unicode-bidi:isolate;">' + english + '</bdi>';
        });
    },

    generateTwoWeeksPrintHtml: function(customNotes, announcementText, isMobile = false) {
        return this.generateThreeWeeksPrintHtml(customNotes, announcementText, isMobile);
    },

    generateThreeWeeksPrintHtml: function(customNotes, announcementText, isMobile = false) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // 1. Calculate the Sunday that started the CURRENT week
        const currentSunday = new Date(today);
        currentSunday.setDate(today.getDate() - today.getDay());
        currentSunday.setHours(0, 0, 0, 0);

        // 2. Exactly 3 full academic weeks (21 days): from current Sunday through the Saturday of the 3rd week
        const threeWeeksEnd = new Date(currentSunday);
        threeWeeksEnd.setDate(currentSunday.getDate() + 20); // 21st day of the span (Saturday night)
        threeWeeksEnd.setHours(23, 59, 59, 999);

        // 3. Anchor semester start to Sunday 2026-08-30 (Week 1), ensuring consistent week numbering
        const startSunday = new Date(2026, 7, 30);
        startSunday.setHours(0, 0, 0, 0);

        // Calculate dynamic week numbers for badge
        const startWeekNum = Math.floor((currentSunday - startSunday) / (1000 * 60 * 60 * 24 * 7)) + 1;
        const midWeekNum = startWeekNum + 1;
        const endWeekNum = startWeekNum + 2;

        let weeksBadgeText = '';
        if (startWeekNum > 0) {
            weeksBadgeText = `الأسابيع (${startWeekNum}، ${midWeekNum}، ${endWeekNum}) • تقويم أم القرى`;
        } else {
            weeksBadgeText = 'تقويم أم القرى';
        }

        // Filter events strictly across the 3 full academic weeks
        const rawEvents = Array.isArray(this.eventsData) ? this.eventsData : [];
        const events = rawEvents.filter(ev => {
            const s = this.parseLocalDate(ev.date);
            if (!s) return false;
            s.setHours(0, 0, 0, 0);
            if (ev.end_date) {
                const e = this.parseLocalDate(ev.end_date);
                if (e) {
                    e.setHours(23, 59, 59, 999);
                    return (e >= currentSunday && s <= threeWeeksEnd);
                }
            }
            return (s >= currentSunday && s <= threeWeeksEnd);
        });

        // Derive subtitles from saved student selection
        let sel = {};
        try { sel = JSON.parse(localStorage.getItem('dent2025_selection') || '{}'); } catch(e) {}
        if (!sel || !sel.specialty) {
            sel = { specialty: 'dentistry', year: 3, semester: 1 };
            try { localStorage.setItem('dent2025_selection', JSON.stringify(sel)); } catch(e) {}
        }
        const specNames = { 'dentistry': 'كلية طب الأسنان', 'medicine': 'كلية الطب البشري', 'pre-med': 'السنة التحضيرية' };
        const specTitle = specNames[sel.specialty] || 'كلية طب الأسنان';
        const yearText = (sel.specialty === 'pre-med' || !sel.year) ? '' : ` — السنة ${sel.year}`;
        const semText = sel.semester ? ` (الفصل الدراسي ${sel.semester === 1 || sel.semester === '1' ? 'الأول' : 'الثاني'})` : '';
        const subTitle = `${specTitle}${yearText}${semText}`;

        // Date range string (BiDi safe) - spans Sunday of Week 1 through Saturday of Week 3
        const startDay = currentSunday.getDate();
        const startMonth = this.gregorianMonthsEN[currentSunday.getMonth()].substring(0, 3);
        const startYear = currentSunday.getFullYear();
        const endDay = threeWeeksEnd.getDate();
        const endMonth = this.gregorianMonthsEN[threeWeeksEnd.getMonth()].substring(0, 3);
        const endYear = threeWeeksEnd.getFullYear();
        const rangeStr = `${startDay} ${startMonth} ${startYear} — ${endDay} ${endMonth} ${endYear}`;

        const groupedWeeks = {};

        // Pre-initialize the 3 exact consecutive weeks in order so they all appear
        for (let i = 0; i < 3; i++) {
            const wSunday = new Date(currentSunday);
            wSunday.setDate(currentSunday.getDate() + (i * 7));
            const wNum = startWeekNum + i;
            const sunMonth = this.gregorianMonthsAR[wSunday.getMonth()];
            const sunDay = wSunday.getDate();
            const sunYear = wSunday.getFullYear();
            const weekKey = `${sunYear}-${String(wSunday.getMonth() + 1).padStart(2, '0')}-${String(sunDay).padStart(2, '0')}`;
            const weekName = `الأسبوع ${wNum} — ${sunMonth}`;

            // Derive Hijri label for week header
            const hDateStr = this.hijriFromGregorian(`${sunYear}-${String(wSunday.getMonth() + 1).padStart(2, '0')}-${String(sunDay).padStart(2, '0')}`);
            let hijriLabel = '';
            if (hDateStr) {
                const parts = hDateStr.split('/');
                if (parts.length >= 2) {
                    const mIndex = parseInt(parts[1], 10) - 1;
                    if (mIndex >= 0 && mIndex < 12) {
                        const cleanYear = String(parts[0]).replace(/[.\s]+$/, '');
                        hijriLabel = `${this.hijriMonths[mIndex]} ${cleanYear} هـ`;
                    }
                }
            }

            groupedWeeks[weekKey] = {
                weekNum: wNum,
                weekName: weekName,
                hijriLabel: hijriLabel,
                events: []
            };
        }

        events.forEach(ev => {
            const dateObj = this.parseLocalDate(ev.date) || new Date();
            const dayOfWeek = dateObj.getDay();
            const sundayDate = new Date(dateObj);
            sundayDate.setDate(dateObj.getDate() - dayOfWeek);
            sundayDate.setHours(0, 0, 0, 0);

            const sunMonth = this.gregorianMonthsAR[sundayDate.getMonth()];
            const sunDay = sundayDate.getDate();
            const sunYear = sundayDate.getFullYear();
            const weekKey = `${sunYear}-${String(sundayDate.getMonth() + 1).padStart(2, '0')}-${String(sunDay).padStart(2, '0')}`;

            if (!groupedWeeks[weekKey]) {
                const weekNum = Math.floor((sundayDate - startSunday) / (1000 * 60 * 60 * 24 * 7)) + 1;
                groupedWeeks[weekKey] = {
                    weekNum: weekNum,
                    weekName: `الأسبوع ${weekNum} — ${sunMonth}`,
                    hijriLabel: '',
                    events: []
                };
            }
            groupedWeeks[weekKey].events.push(ev);

            if (ev.hijri && !groupedWeeks[weekKey].hijriLabel) {
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
                        const cleanYear = String(hYear).replace(/[.\s]+$/, '');
                        groupedWeeks[weekKey].hijriLabel = `${this.hijriMonths[mIndex]} ${cleanYear} هـ`;
                    }
                }
            }
        });

        let weeksHtml = '';
        const sortedWeeks = Object.keys(groupedWeeks).sort();

        sortedWeeks.forEach(weekKey => {
            const groupData = groupedWeeks[weekKey];
            let rowsHtml = '';

            if (groupData.events.length === 0) {
                rowsHtml = `
                    <tr>
                        <td colspan="3" style="text-align: center; color: #94a3b8; padding: 8px 10px; font-size: 0.68rem; font-style: italic;">
                            لا توجد اختبارات أو أحداث مجدولة لهذا الأسبوع
                        </td>
                    </tr>
                `;
            } else {
                groupData.events.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

                const daysInWeek = {};
                groupData.events.forEach(ev => {
                    const dayKey = ev.date + (ev.end_date ? '_' + ev.end_date : '');
                    if (!daysInWeek[dayKey]) {
                        daysInWeek[dayKey] = {
                            date: ev.date,
                            end_date: ev.end_date,
                            events: []
                        };
                    }
                    daysInWeek[dayKey].events.push(ev);
                });

                Object.values(daysInWeek).forEach(dayData => {
                    const firstEv = dayData.events[0];
                    const dDate = this.parseLocalDate(firstEv.date) || new Date();
                    const dayName = dDate.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { weekday: 'long' });
                    const monthShort = this.gregorianMonthsEN[dDate.getMonth()].substring(0, 3);
                    let gregDateStr = `${dDate.getDate()} ${monthShort} ${dDate.getFullYear()}`;
                    if (firstEv.end_date) {
                        const eDate = this.parseLocalDate(firstEv.end_date);
                        if (eDate) {
                            const eMonthShort = this.gregorianMonthsEN[eDate.getMonth()].substring(0, 3);
                            gregDateStr = `${dDate.getDate()} – ${eDate.getDate()} ${eMonthShort} ${eDate.getFullYear()}`;
                        }
                    }

                    const rawHijri = firstEv.hijri ? this.formatHijriDate(firstEv.hijri) : this.hijriFromGregorian(firstEv.date);
                    const hijriStr = rawHijri || '—';

                    let cardsHtml = '';
                    dayData.events.forEach(ev => {
                        const targetDate = this.parseLocalDate(ev.date) || new Date();
                        targetDate.setHours(0,0,0,0);
                        const diffDays = Math.ceil((targetDate - today) / (1000 * 60 * 60 * 24));
                        let countdownText = '';
                        let countdownClass = 'm1-countdown-normal';
                        if (diffDays === 0) {
                            countdownText = 'اليوم';
                            countdownClass = 'm1-countdown-urgent';
                        } else if (diffDays === 1) {
                            countdownText = 'غداً';
                            countdownClass = 'm1-countdown-urgent';
                        } else if (diffDays === 2) {
                            countdownText = 'بعد يومين';
                            countdownClass = 'm1-countdown-soon';
                        } else if (diffDays >= 3 && diffDays <= 10) {
                            countdownText = `بعد ${diffDays} أيام`;
                        } else if (diffDays > 10) {
                            countdownText = `بعد ${diffDays} يوماً`;
                        } else if (diffDays < 0) {
                            countdownText = 'انتهى';
                            countdownClass = 'm1-countdown-normal';
                        } else {
                            countdownText = 'اليوم';
                        }

                        const typeMeta = this.getEventTypeMeta(ev);
                        const typeLabel = typeMeta.label;
                        const badgeClass = typeMeta.printClass;

                        if (dayData.events.length === 1) {
                            // Single event on this day: clean row without redundant boxed card border
                            cardsHtml += `
                                <div class="m1-single-event">
                                    <div class="m1-single-title"><bdi dir="auto">${this.formatEventTitleHtml(ev.title)}</bdi></div>
                                    <div class="m1-single-badges">
                                        <span class="m1-type-badge ${badgeClass}">${dentEscapeHtml(typeLabel)}</span>
                                        <span class="m1-countdown-badge ${countdownClass}">${dentEscapeHtml(countdownText)}</span>
                                    </div>
                                </div>
                            `;
                        } else {
                            // Multi-event day (2+): compact single-row card with title and badges side-by-side
                            cardsHtml += `
                                <div class="m1-multi-card">
                                    <div class="m1-card-title"><bdi dir="auto">${this.formatEventTitleHtml(ev.title)}</bdi></div>
                                    <div class="m1-card-badges">
                                        <span class="m1-type-badge ${badgeClass}">${dentEscapeHtml(typeLabel)}</span>
                                        <span class="m1-countdown-badge ${countdownClass}">${dentEscapeHtml(countdownText)}</span>
                                    </div>
                                </div>
                            `;
                        }
                    });

                    const cellContentHtml = dayData.events.length >= 2
                        ? `<div class="m1-events-grid">${cardsHtml}</div>`
                        : cardsHtml;

                    rowsHtml += `
                        <tr>
                            <td class="m1-day-col">${dentEscapeHtml(dayName)}</td>
                            <td class="m1-date-col">
                                <span class="m1-date-greg" dir="ltr">${dentEscapeHtml(gregDateStr)}</span>
                                <span class="m1-date-hijri">${dentEscapeHtml(hijriStr)}</span>
                            </td>
                            <td class="m1-events-cell">
                                ${cellContentHtml}
                            </td>
                        </tr>
                    `;
                });
            }

            weeksHtml += `
                <div class="m1-week-block">
                    <div class="m1-week-header">
                        <span>${dentEscapeHtml(groupData.weekName)}</span>
                        <span>${dentEscapeHtml(groupData.hijriLabel || '')}</span>
                    </div>
                    <table class="m1-table">
                        <thead>
                            <tr>
                                <th class="m1-th-day">اليوم</th>
                                <th class="m1-th-date">التاريخ</th>
                                <th class="m1-th-events">الأحداث والمقررات المجدولة</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rowsHtml}
                        </tbody>
                    </table>
                </div>
            `;
        });

        // Announcement section (if provided)
        let announcementHtml = '';
        if (announcementText) {
            announcementHtml = `
                <div style="margin-top: 14px; border: 1px solid #cbd5e1; border-right: 4px solid #334155; border-radius: 8px; padding: 10px 14px; background: #f8fafc; page-break-inside: avoid;">
                    <div class="print-ann-body" style="font-size: 0.72rem; color: #1e293b; line-height: 1.55;">${announcementText}</div>
                </div>
            `;
        }

        // Notes section (omitted if empty)
        let notesHtml = '';
        if (customNotes) {
            notesHtml = `
                <div style="margin-top: 14px; border: 1px solid #cbd5e1; border-right: 4px solid #334155; border-radius: 8px; padding: 10px 14px; background: #fafafa; page-break-inside: avoid;">
                    <strong style="font-size: 0.74rem; color: #334155; display: block; margin-bottom: 4px;">ملاحظات وتذكيرات شخصية:</strong>
                    <div style="font-size: 0.72rem; color: #1e293b; line-height: 1.55; white-space: pre-wrap;">${dentEscapeHtml(customNotes)}</div>
                </div>
            `;
        }

        const todayFormatted = today.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { year: 'numeric', month: 'long', day: 'numeric' });
        const dynamicFileBase = this.getDynamicScheduleFileName('');

        return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=860, initial-scale=0.45, minimum-scale=0.2, maximum-scale=2.0">
    <title>${dentEscapeHtml(dynamicFileBase)}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800&family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet" crossorigin="anonymous">
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            letter-spacing: normal !important;
            word-spacing: normal !important;
        }
        html, body {
            font-family: 'Cairo', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #ffffff;
            color: #0f172a;
            direction: rtl;
            font-size: 12px;
            width: 860px !important;
            min-width: 860px !important;
            -webkit-text-size-adjust: 100% !important;
            text-size-adjust: 100% !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
        }

        @media screen {
            body {
                background: #f8fafc;
                padding: 24px 0;
                margin: 0 auto;
                width: 860px !important;
                min-width: 860px !important;
            }
            .a4-print-sheet {
                background: #ffffff;
                box-sizing: border-box !important;
                width: 860px !important;
                min-width: 860px !important;
                max-width: 860px !important;
                padding: 16mm 20mm !important;
                margin: 0 auto !important;
                border-radius: 0;
                box-shadow: 0 4px 25px rgba(0, 0, 0, 0.08);
                border: none;
            }
        }

        @media print {
            @page {
                size: A4 portrait;
                margin: 0;
            }
            html, body {
                background: #ffffff !important;
                padding: 0 !important;
                margin: 0 !important;
                width: 100% !important;
                min-width: 100% !important;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
            }
            .no-print {
                display: none !important;
            }
            .a4-print-sheet {
                box-sizing: border-box !important;
                width: 100% !important;
                min-width: 100% !important;
                max-width: 100% !important;
                padding: 16mm 20mm !important;
                margin: 0 auto !important;
                box-shadow: none !important;
                border: none !important;
                border-radius: 0 !important;
                background: #ffffff !important;
            }
        }

        .doc-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding-bottom: 10px;
            border-bottom: 2px solid #0f172a;
            margin-bottom: 16px;
        }
        .doc-titles h1 {
            font-size: 1.25rem;
            font-weight: 800;
            color: #0f172a;
            line-height: 1.25;
            text-align: right;
            letter-spacing: normal !important;
            word-spacing: normal !important;
        }
        .doc-titles p {
            font-size: 0.78rem;
            color: #64748b;
            font-weight: 600;
            margin-top: 3px;
            text-align: right;
            letter-spacing: normal !important;
            word-spacing: normal !important;
        }
        .doc-meta-badge {
            text-align: left;
            direction: ltr;
        }
        .doc-meta-badge .period {
            display: inline-block;
            background: #f1f5f9;
            border: 1px solid #cbd5e1;
            padding: 4px 10px;
            border-radius: 6px;
            font-size: 0.74rem;
            font-weight: 700;
            color: #1e293b;
            font-family: 'Outfit', sans-serif;
        }
        .doc-meta-badge .subperiod {
            display: block;
            font-size: 0.70rem;
            color: #64748b;
            margin-top: 3px;
            text-align: right;
            direction: rtl;
        }
        .m1-week-block {
            margin-bottom: 14px;
            border: 1px solid #cbd5e1;
            border-radius: 8px;
            overflow: hidden;
            page-break-inside: avoid;
            break-inside: avoid;
        }
        .m1-week-header {
            background: #1e293b;
            color: #f8fafc;
            padding: 6px 14px;
            font-size: 0.78rem;
            font-weight: 700;
            display: flex;
            justify-content: space-between;
            align-items: center;
            letter-spacing: normal !important;
            word-spacing: normal !important;
        }
        .m1-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.72rem;
        }
        .m1-table tr {
            page-break-inside: avoid;
            break-inside: avoid;
        }
        .m1-table th {
            background: #f8fafc;
            color: #475569;
            font-weight: 700;
            text-align: right;
            padding: 6px 10px;
            border-bottom: 1px solid #cbd5e1;
            font-size: 0.70rem;
            white-space: nowrap;
            letter-spacing: normal !important;
            word-spacing: normal !important;
        }
        .m1-th-day { width: 58px; }
        .m1-th-date { width: 95px; }
        .m1-th-events { text-align: right; }
        .m1-table td {
            padding: 7px 10px;
            border-bottom: 1px solid #e2e8f0;
            vertical-align: middle;
            color: #1e293b;
            letter-spacing: normal !important;
            word-spacing: normal !important;
        }
        .m1-table tr:last-child td { border-bottom: none; }
        .m1-table tr:nth-child(even) { background-color: #fafafa; }
        .m1-day-col {
            font-weight: 700;
            color: #0f172a;
            width: 58px;
            font-size: 0.72rem;
            vertical-align: middle;
            text-align: right;
            letter-spacing: normal !important;
            word-spacing: normal !important;
        }
        .m1-date-col {
            width: 95px;
            vertical-align: middle;
            line-height: 1.3;
            text-align: right;
        }
        .m1-date-greg {
            display: block;
            font-family: 'Outfit', sans-serif;
            font-size: 0.68rem;
            font-weight: 700;
            color: #1e293b;
            direction: ltr;
            text-align: right;
            unicode-bidi: isolate;
        }
        .m1-date-hijri {
            display: block;
            font-size: 0.62rem;
            color: #64748b;
            direction: rtl;
            text-align: right;
            margin-top: 2px;
            unicode-bidi: isolate;
        }
        .m1-events-cell {
            vertical-align: middle;
            padding: 4px 8px;
        }
        .m1-events-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 6px;
            width: 100%;
            align-items: center;
        }
        .m1-single-event {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            width: 100%;
            box-sizing: border-box;
            padding: 2px 4px;
        }
        .m1-single-title {
            font-size: 0.72rem;
            font-weight: 700;
            color: #0f172a;
            line-height: 1.35;
            flex: 1;
            min-width: 0;
            text-align: right;
            letter-spacing: normal !important;
            word-spacing: normal !important;
        }
        .m1-single-badges {
            display: flex;
            align-items: center;
            gap: 4px;
            flex-shrink: 0;
        }
        .m1-multi-card {
            background: #ffffff;
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            padding: 3px 6px;
            display: flex;
            flex-direction: row;
            align-items: center;
            justify-content: space-between;
            gap: 6px;
            box-sizing: border-box;
            min-height: 26px;
        }
        .m1-multi-card .m1-card-title {
            font-size: 0.67rem;
            font-weight: 700;
            color: #0f172a;
            line-height: 1.25;
            flex: 1;
            min-width: 0;
            text-align: right;
            letter-spacing: normal !important;
            word-spacing: normal !important;
        }
        .m1-multi-card .m1-card-badges {
            display: flex;
            align-items: center;
            gap: 3px;
            flex-shrink: 0;
        }
        .m1-type-badge {
            display: inline-block;
            font-size: 0.58rem;
            font-weight: 700;
            padding: 1px 5px;
            border-radius: 4px;
            white-space: nowrap;
        }
        .m1-countdown-badge {
            display: inline-block;
            font-size: 0.58rem;
            font-weight: 700;
            padding: 1px 5px;
            border-radius: 4px;
            white-space: nowrap;
            border: 1px solid #e2e8f0;
            background: #f8fafc;
        }
        .m1-badge-exam { background: #f8fafc; color: #881337; border: 1px solid #fecdd3; }
        .m1-badge-holiday { background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }
        .m1-badge-payment { background: #fefce8; color: #854d0e; border: 1px solid #fef08a; }
        .m1-countdown-urgent { background: #fef2f2; color: #991b1b; border-color: #fecaca; }
        .m1-countdown-soon { background: #fff7ed; color: #c2410c; border-color: #ffedd5; }
        .m1-countdown-normal { background: #f1f5f9; color: #475569; border-color: #e2e8f0; }
        .print-ann-body p { margin: 0 0 3px 0; }
        .print-ann-body p:last-child { margin-bottom: 0; }
        .doc-footer {
            margin-top: 18px;
            padding-top: 10px;
            border-top: 1px solid #e2e8f0;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 0.70rem;
            color: #64748b;
            page-break-inside: avoid;
            break-inside: avoid;
        }
        .doc-footer-right {
            font-family: 'Outfit', sans-serif;
            font-weight: 600;
            color: #475569;
            direction: ltr;
        }
        .doc-footer-left {
            font-family: 'Outfit', 'Cairo', sans-serif;
            color: #64748b;
            direction: rtl;
        }
        * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
        }
    </style>
</head>
<body>
    <div class="a4-print-sheet">
        <div class="doc-header">
            <div class="doc-titles">
                <h1>Dent2025 • جدول الأسابيع الثلاثة القادمة</h1>
                <p>${dentEscapeHtml(subTitle)}</p>
            </div>
            <div class="doc-meta-badge">
                <span class="period" dir="ltr">${dentEscapeHtml(rangeStr)}</span>
                <span class="subperiod" dir="rtl"><bdi>${dentEscapeHtml(weeksBadgeText)}</bdi></span>
            </div>
        </div>

        ${weeksHtml}

        ${announcementHtml}

        ${notesHtml}

        <div class="doc-footer">
            <span class="doc-footer-right">dent2025.com</span>
            <span class="doc-footer-left">${dentEscapeHtml(todayFormatted)}</span>
        </div>
    </div>
</body>
</html>`;
    }
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ScheduleApp.init());
} else {
    ScheduleApp.init();
}
/* ]]> */


