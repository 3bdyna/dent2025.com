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
            
            if (!groupedEvents[weekKey].hijriLabel && ev.hijri) {
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
                        groupedEvents[weekKey].hijriLabel = `${this.hijriMonths[mIndex]} ${hYear}`;
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
                monthHeader.innerHTML = `<span dir="ltr">${groupData.headerLabel}</span> - <span>${groupData.hijriLabel}</span>`;
            } else {
                monthHeader.innerHTML = `<span dir="ltr">${groupData.headerLabel}</span>`;
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

        // Start prefetching announcements immediately in background
        this._prefetchedAnnouncements = null;
        this.prefetchPrintAnnouncements();

        modal = document.createElement('div');
        modal.id = 'dent-print-schedule-modal';
        modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(10, 10, 15, 0.85); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); z-index: 9999999; display: flex; justify-content: center; align-items: center; direction: rtl; font-family: \'Outfit\', \'Noto Kufi Arabic\', sans-serif; padding: 16px; box-sizing: border-box;';
        modal.innerHTML = `
            <div style="background: #18181b; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 18px; padding: 24px; width: 100%; max-width: 460px; box-shadow: 0 25px 60px rgba(0,0,0,0.8); color: #fff; box-sizing: border-box;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 18px; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 12px;">
                    <h3 style="margin: 0; font-size: 1.1rem; font-weight: 700; color: #f8fafc;">طباعة تقويم الأسبوعين القادمين (A4 PDF)</h3>
                    <button type="button" onclick="document.getElementById('dent-print-schedule-modal').remove()" style="background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.12); color:#e2e8f0; width:34px; height:34px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:1.2rem; cursor:pointer; transition:all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.18)'; this.style.color='#fff';" onmouseout="this.style.background='rgba(255,255,255,0.08)'; this.style.color='#e2e8f0';">×</button>
                </div>

                <button type="button" id="dent-exec-print-btn" onclick="ScheduleApp.executePrint()" style="width: 100%; height: 46px; background: #27272a; color: #ffffff; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 10px; cursor: pointer; font-family: inherit; font-weight: 700; font-size: 0.95rem; transition: all 0.2s; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);" onmouseover="this.style.background='#3f3f46'; this.style.borderColor='rgba(255, 255, 255, 0.35)'; this.style.transform='translateY(-1px)';" onmouseout="this.style.background='#27272a'; this.style.borderColor='rgba(255, 255, 255, 0.2)'; this.style.transform='none';">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
                    <span>طباعة الآن (A4 PDF)</span>
                </button>

                <label style="display: flex; align-items: flex-start; gap: 10px; margin-top: 16px; padding: 10px 12px; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; font-size: 0.80rem; color: #cbd5e1; cursor: pointer; user-select: none;">
                    <input type="checkbox" id="dent-print-inc-announcements" checked style="accent-color: #52525b; width: 16px; height: 16px; margin-top: 2px; cursor: pointer;">
                    <span>تضمين إعلانات الدفعة (الإعلان بالصفحة الرئيسية) في أسفل الورقة</span>
                </label>

                <div style="margin-top: 14px;">
                    <label style="font-size: 0.78rem; color: #a1a1aa; font-weight: 600; display: block; margin-bottom: 6px;">ملاحظات أو تذكيرات إضافية (اختياري):</label>
                    <textarea id="dent-print-custom-notes" placeholder="اكتب أي ملاحظات أو تذكيرات ترغب في ظهورها أسفل الورقة (اختياري - ستختفي هذه المساحة تلقائياً عند الطباعة إذا تركتها فارغة)..." style="width: 100%; height: 80px; padding: 10px 12px; background: #121212; border: 1px solid rgba(255,255,255,0.12); border-radius: 10px; color: #fff; font-size: 0.82rem; font-family: inherit; box-sizing: border-box; outline: none; resize: vertical; line-height: 1.5;"></textarea>
                </div>

                <div style="margin-top: 18px; display: flex; justify-content: flex-end;">
                    <button type="button" onclick="document.getElementById('dent-print-schedule-modal').remove()" style="padding: 8px 18px; background: #27272a; border: 1px solid rgba(255,255,255,0.1); color: #a1a1aa; border-radius: 8px; cursor: pointer; font-family: inherit; font-size: 0.85rem; font-weight: 500; transition: all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.12)'; this.style.color='#fff';" onmouseout="this.style.background='rgba(255,255,255,0.08)'; this.style.color='#a1a1aa';">إلغاء</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    },

    executePrint: async function() {
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
                         (window.matchMedia && window.matchMedia('(max-width: 768px)').matches && 'ontouchstart' in window);

        // On mobile browsers (iOS Safari / Android Chrome), iframe printing delegates to the full webpage.
        // Opening a blank tab synchronously inside the user touch handler guarantees no popup-blocking.
        let mobileWindow = null;
        if (isMobile) {
            try {
                mobileWindow = window.open('', '_blank');
                if (mobileWindow) {
                    mobileWindow.document.write('<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Dent2025 • تقويم الأسبوعين</title><style>body{background:#0b0f17;color:#f8fafc;font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:90vh;margin:0;text-align:center;direction:rtl;}.card{background:#18181b;padding:26px 20px;border-radius:14px;border:1px solid rgba(255,255,255,0.12);max-width:320px;box-shadow:0 10px 30px rgba(0,0,0,0.4);}.spinner{width:38px;height:38px;border:3px solid rgba(255,255,255,0.15);border-top-color:#38bdf8;border-radius:50%;animation:dentSpin 0.8s linear infinite;margin:0 auto 16px auto;}@keyframes dentSpin{to{transform:rotate(360deg);}}</style></head><body><div class="card"><div class="spinner"></div><div style="font-weight:700;font-size:1.05rem;margin-bottom:6px;">جاري تجهيز تقويم الأسبوعين للطباعة...</div><div style="font-size:0.8rem;color:#94a3b8;">يرجى الانتظار ثانية واحدة</div></div></body></html>');
                    mobileWindow.document.close();
                }
            } catch(e) {
                console.warn('Could not open mobile window synchronously:', e);
            }
        }

        const printBtn = document.getElementById('dent-exec-print-btn');
        if (printBtn) {
            printBtn.disabled = true;
            printBtn.innerHTML = 'جاري التجهيز...';
        }

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

        const printHtml = this.generateTwoWeeksPrintHtml(notes, announcementText, isMobile);

        const modal = document.getElementById('dent-print-schedule-modal');
        if (modal) modal.remove();

        if (isMobile && mobileWindow) {
            try {
                mobileWindow.document.open();
                mobileWindow.document.write(printHtml);
                mobileWindow.document.close();
                return;
            } catch(err) {
                console.error('Error writing to mobile print window, falling back to iframe:', err);
            }
        }

        // Desktop / PC workflow: use seamless hidden iframe
        let iframe = document.getElementById('dent-schedule-print-iframe');
        if (iframe) iframe.remove();

        iframe = document.createElement('iframe');
        iframe.id = 'dent-schedule-print-iframe';
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = '0';
        document.body.appendChild(iframe);

        const doc = iframe.contentWindow.document;
        doc.open();
        doc.write(printHtml);
        doc.close();

        const doPrint = () => {
            try {
                iframe.contentWindow.focus();
                iframe.contentWindow.print();
            } catch(err) {
                console.error('Print iframe error:', err);
            }
        };

        if (doc.fonts && doc.fonts.ready) {
            doc.fonts.ready.then(() => setTimeout(doPrint, 250)).catch(() => setTimeout(doPrint, 400));
        } else {
            setTimeout(doPrint, 400);
        }
    },

    generateTwoWeeksPrintHtml: function(customNotes, announcementText, isMobile = false) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const twoWeeksLater = new Date(today);
        twoWeeksLater.setDate(twoWeeksLater.getDate() + 14);
        twoWeeksLater.setHours(23, 59, 59, 999);

        const rawEvents = Array.isArray(this.eventsData) ? this.eventsData : [];
        const events = rawEvents.filter(ev => {
            const s = this.parseLocalDate(ev.date);
            if (!s) return false;
            s.setHours(0, 0, 0, 0);
            if (ev.end_date) {
                const e = this.parseLocalDate(ev.end_date);
                if (e) {
                    e.setHours(23, 59, 59, 999);
                    return (e >= today && s <= twoWeeksLater);
                }
            }
            return (s >= today && s <= twoWeeksLater);
        });

        // Derive subtitles from saved student selection
        let sel = {};
        try { sel = JSON.parse(localStorage.getItem('dent2025_selection') || '{}'); } catch(e) {}
        const specNames = { 'dentistry': 'كلية طب الأسنان', 'medicine': 'كلية الطب البشري', 'pre-med': 'السنة التحضيرية' };
        const specTitle = specNames[sel.specialty] || 'البرنامج الأكاديمي';
        const yearText = (sel.specialty === 'pre-med' || !sel.year) ? '' : ` — السنة ${sel.year}`;
        const semText = sel.semester ? ` (الفصل الدراسي ${sel.semester === 1 || sel.semester === '1' ? 'الأول' : 'الثاني'})` : '';
        const subTitle = `${specTitle}${yearText}${semText}`;

        // Date range string (BiDi safe)
        const startDay = today.getDate();
        const startMonth = this.gregorianMonthsEN[today.getMonth()].substring(0, 3);
        const startYear = today.getFullYear();
        const endD = new Date(today);
        endD.setDate(endD.getDate() + 14);
        const endDay = endD.getDate();
        const endMonth = this.gregorianMonthsEN[endD.getMonth()].substring(0, 3);
        const endYear = endD.getFullYear();
        const rangeStr = `${startDay} ${startMonth} ${startYear} — ${endDay} ${endMonth} ${endYear}`;

        // Anchor semester start to Sunday 2026-08-30 (Week 1), ensuring consistent week numbering
        let startSunday = new Date(2026, 7, 30);
        startSunday.setHours(0, 0, 0, 0);

        // Calculate dynamic week numbers for badge
        const todaySunday = new Date(today);
        todaySunday.setDate(today.getDate() - today.getDay());
        todaySunday.setHours(0, 0, 0, 0);
        const startWeekNum = Math.floor((todaySunday - startSunday) / (1000 * 60 * 60 * 24 * 7)) + 1;

        const endSunday = new Date(twoWeeksLater);
        endSunday.setDate(twoWeeksLater.getDate() - endSunday.getDay());
        endSunday.setHours(0, 0, 0, 0);
        const endWeekNum = Math.floor((endSunday - startSunday) / (1000 * 60 * 60 * 24 * 7)) + 1;

        let weeksBadgeText = '';
        if (startWeekNum > 0 && endWeekNum > 0) {
            if (startWeekNum === endWeekNum) {
                weeksBadgeText = `الأسبوع ${startWeekNum} • تقويم أم القرى`;
            } else {
                weeksBadgeText = `الأسبوع ${startWeekNum} والأسبوع ${endWeekNum} • تقويم أم القرى`;
            }
        } else {
            weeksBadgeText = 'تقويم أم القرى';
        }

        const groupedWeeks = {};
        events.forEach(ev => {
            const dateObj = this.parseLocalDate(ev.date) || new Date();
            const dayOfWeek = dateObj.getDay();
            const sundayDate = new Date(dateObj);
            sundayDate.setDate(dateObj.getDate() - dayOfWeek);
            sundayDate.setHours(0, 0, 0, 0);

            const weekNum = Math.floor((sundayDate - startSunday) / (1000 * 60 * 60 * 24 * 7)) + 1;
            const sunMonth = this.gregorianMonthsAR[sundayDate.getMonth()];
            const sunDay = sundayDate.getDate();
            const sunYear = sundayDate.getFullYear();
            const weekKey = `${sunYear}-${String(sundayDate.getMonth()).padStart(2, '0')}-${String(sunDay).padStart(2, '0')}`;
            const weekName = `الأسبوع ${weekNum} — ${sunMonth}`;

            if (!groupedWeeks[weekKey]) {
                groupedWeeks[weekKey] = {
                    weekName,
                    hijriLabel: '',
                    events: []
                };
            }
            groupedWeeks[weekKey].events.push(ev);

            if (!groupedWeeks[weekKey].hijriLabel && ev.hijri) {
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
                        groupedWeeks[weekKey].hijriLabel = `${this.hijriMonths[mIndex]} ${hYear}هـ`;
                    }
                }
            }
        });

        let weeksHtml = '';
        const sortedWeeks = Object.keys(groupedWeeks).sort();

        if (sortedWeeks.length === 0) {
            weeksHtml = '<div style="text-align: center; padding: 24px; color: #64748b; font-size: 0.85rem; border: 1px dashed #cbd5e1; border-radius: 6px;">لا توجد أحداث مجدولة خلال الـ 14 يوماً القادمة.</div>';
        } else {
            sortedWeeks.forEach(weekKey => {
                const groupData = groupedWeeks[weekKey];
                let rowsHtml = '';
                groupData.events.forEach(ev => {
                    const dDate = this.parseLocalDate(ev.date) || new Date();
                    const dayName = dDate.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { weekday: 'long' });
                    const monthShort = this.gregorianMonthsEN[dDate.getMonth()].substring(0, 3);
                    let gregDateStr = `${dDate.getDate()} ${monthShort} ${dDate.getFullYear()}`;
                    if (ev.end_date) {
                        const eDate = this.parseLocalDate(ev.end_date);
                        if (eDate) {
                            const eMonthShort = this.gregorianMonthsEN[eDate.getMonth()].substring(0, 3);
                            gregDateStr = `${dDate.getDate()} – ${eDate.getDate()} ${eMonthShort} ${eDate.getFullYear()}`;
                        }
                    }

                    const rawHijri = ev.hijri ? this.formatHijriDate(ev.hijri) : this.hijriFromGregorian(ev.date);
                    const hijriStr = rawHijri || '—';

                    // Countdown
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
                    } else {
                        countdownText = 'جارٍ / منتهٍ';
                    }

                    const typeMeta = this.getEventTypeMeta(ev);
                    const typeLabel = typeMeta.label;
                    const badgeClass = typeMeta.printClass;

                    rowsHtml += `
                        <tr>
                            <td class="m1-day-col">${dentEscapeHtml(dayName)}</td>
                            <td class="m1-date-col">
                                <span class="m1-date-greg" dir="ltr">${dentEscapeHtml(gregDateStr)}</span>
                                <span class="m1-date-hijri">${dentEscapeHtml(hijriStr)}</span>
                            </td>
                            <td class="m1-title-col">
                                <strong>${dentEscapeHtml(ev.title)}</strong>
                            </td>
                            <td class="m1-status-col"><span class="m1-type-badge ${badgeClass}">${dentEscapeHtml(typeLabel)}</span></td>
                            <td class="m1-status-col ${countdownClass}">${dentEscapeHtml(countdownText)}</td>
                        </tr>
                    `;
                });

                weeksHtml += `
                    <div class="m1-week-block">
                        <div class="m1-week-header">
                            <span>${dentEscapeHtml(groupData.weekName)}</span>
                            <span>${dentEscapeHtml(groupData.hijriLabel || '')}</span>
                        </div>
                        <table class="m1-table">
                            <thead>
                                <tr>
                                    <th>اليوم</th>
                                    <th>التاريخ</th>
                                    <th>تفاصيل الحدث والمقرر</th>
                                    <th style="text-align: center;">النوع</th>
                                    <th style="text-align: center;">العد التنازلي</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rowsHtml}
                            </tbody>
                        </table>
                    </div>
                `;
            });
        }

        // Announcement section (if provided)
        let announcementHtml = '';
        if (announcementText) {
            announcementHtml = `
                <div style="margin-top: 12px; border: 1px solid #cbd5e1; border-right: 3px solid #334155; border-radius: 6px; padding: 8px 12px; background: #f8fafc; page-break-inside: avoid;">
                    <div class="print-ann-body" style="font-size: 0.70rem; color: #1e293b; line-height: 1.5;">${announcementText}</div>
                </div>
            `;
        }

        // Notes section (omitted if empty)
        let notesHtml = '';
        if (customNotes) {
            notesHtml = `
                <div style="margin-top: 12px; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 12px; background: #fafafa; page-break-inside: avoid;">
                    <strong style="font-size: 0.72rem; color: #334155; display: block; margin-bottom: 4px;">ملاحظات وتذكيرات شخصية:</strong>
                    <div style="font-size: 0.72rem; color: #1e293b; line-height: 1.5; white-space: pre-wrap;">${dentEscapeHtml(customNotes)}</div>
                </div>
            `;
        }

        const todayFormatted = today.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { year: 'numeric', month: 'long', day: 'numeric' });

        return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Dent2025 • تقويم الأسبوعين القادمين</title>
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800&family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: 'Cairo', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #ffffff;
            color: #0f172a;
            direction: rtl;
            font-size: 12px;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
        }

        @media screen {
            body {
                background: ${isMobile ? '#0b0f17' : '#ffffff'};
                padding: ${isMobile ? '12px 12px 40px 12px' : '10mm 12mm'};
                max-width: 840px;
                margin: 0 auto;
            }
            .dent-mobile-toolbar {
                position: sticky;
                top: 8px;
                z-index: 999999;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
                background: rgba(24, 24, 27, 0.95);
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
                border: 1px solid rgba(255, 255, 255, 0.15);
                padding: 10px 14px;
                border-radius: 12px;
                margin-bottom: 14px;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
            }
            .dent-mobile-toolbar button {
                font-family: inherit;
                cursor: pointer;
                border-radius: 8px;
                font-weight: 700;
                transition: all 0.2s;
            }
            .dent-mobile-btn-print {
                flex: 1;
                height: 42px;
                background: #2563eb;
                color: #ffffff;
                border: none;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                font-size: 0.90rem;
                box-shadow: 0 3px 10px rgba(37, 99, 235, 0.35);
            }
            .dent-mobile-btn-close {
                height: 42px;
                padding: 0 16px;
                background: rgba(255, 255, 255, 0.1);
                color: #e2e8f0;
                border: 1px solid rgba(255, 255, 255, 0.15);
                font-size: 0.85rem;
            }
            .a4-print-sheet {
                background: #ffffff;
                ${isMobile ? 'padding: 18px 14px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.25);' : ''}
            }
        }

        @media print {
            @page {
                size: A4 portrait;
                margin: 8mm 10mm;
            }
            body {
                background: #ffffff !important;
                padding: 0 !important;
                margin: 0 !important;
            }
            .no-print, .dent-mobile-toolbar {
                display: none !important;
            }
            .a4-print-sheet {
                padding: 0 !important;
                box-shadow: none !important;
                border: none !important;
                border-radius: 0 !important;
            }
        }

        .doc-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding-bottom: 10px;
            border-bottom: 2px solid #0f172a;
            margin-bottom: 12px;
        }
        .doc-titles h1 {
            font-size: 1.20rem;
            font-weight: 800;
            color: #0f172a;
            line-height: 1.2;
        }
        .doc-titles p {
            font-size: 0.76rem;
            color: #64748b;
            font-weight: 500;
            margin-top: 2px;
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
            font-size: 0.68rem;
            color: #64748b;
            margin-top: 3px;
            text-align: right;
            direction: rtl;
        }
        .m1-week-block {
            margin-bottom: 10px;
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            overflow: hidden;
            page-break-inside: avoid;
            break-inside: avoid;
        }
        .m1-week-header {
            background: #1e293b;
            color: #f8fafc;
            padding: 5px 12px;
            font-size: 0.76rem;
            font-weight: 700;
            display: flex;
            justify-content: space-between;
            align-items: center;
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
            padding: 5px 8px;
            border-bottom: 1px solid #cbd5e1;
            font-size: 0.68rem;
            white-space: nowrap;
        }
        .m1-table td {
            padding: 5px 8px;
            border-bottom: 1px solid #e2e8f0;
            vertical-align: middle;
            color: #1e293b;
        }
        .m1-table tr:last-child td { border-bottom: none; }
        .m1-table tr:nth-child(even) { background-color: #fafafa; }
        .m1-type-badge {
            display: inline-block;
            font-size: 0.64rem;
            font-weight: 600;
            padding: 2px 7px;
            border-radius: 4px;
            white-space: nowrap;
        }
        .m1-badge-exam { background: #f8fafc; color: #881337; border: 1px solid #fecdd3; }
        .m1-badge-holiday { background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }
        .m1-badge-payment { background: #fefce8; color: #854d0e; border: 1px solid #fef08a; }
        .m1-day-col {
            font-weight: 700;
            color: #0f172a;
            width: 75px;
            font-size: 0.72rem;
        }
        .m1-date-col {
            width: 120px;
            vertical-align: middle;
            line-height: 1.35;
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
            margin-top: 1px;
            unicode-bidi: isolate;
        }
        .m1-title-col { font-weight: 600; line-height: 1.35; }
        .m1-status-col { width: 75px; text-align: center; }
        .m1-countdown-urgent { color: #991b1b; font-weight: 700; }
        .m1-countdown-soon { color: #c2410c; font-weight: 700; }
        .m1-countdown-normal { color: #475569; font-weight: 600; }
        .print-ann-body p { margin: 0 0 3px 0; }
        .print-ann-body p:last-child { margin-bottom: 0; }
        .doc-footer {
            margin-top: 12px;
            padding-top: 8px;
            border-top: 1px solid #e2e8f0;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 0.68rem;
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
    ${isMobile ? `
        <div class="dent-mobile-toolbar no-print">
            <button type="button" class="dent-mobile-btn-print" onclick="window.print()">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
                <span>طباعة / حفظ PDF</span>
            </button>
            <button type="button" class="dent-mobile-btn-close" onclick="window.close()">✕ إغلاق</button>
        </div>
    ` : ''}

    <div class="a4-print-sheet">
        <div class="doc-header">
            <div class="doc-titles">
                <h1>Dent2025 • جدول الأسبوعين القادمين</h1>
                <p>${dentEscapeHtml(subTitle)}</p>
            </div>
            <div class="doc-meta-badge">
                <span class="period" dir="ltr">${dentEscapeHtml(rangeStr)}</span>
                <span class="subperiod">${dentEscapeHtml(weeksBadgeText)}</span>
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

    ${isMobile ? `
    <script>
        (function() {
            function autoPrint() {
                try {
                    window.focus();
                    window.print();
                } catch(e) {
                    console.error('Auto print error:', e);
                }
            }
            if (document.fonts && document.fonts.ready) {
                document.fonts.ready.then(function() {
                    setTimeout(autoPrint, 250);
                }).catch(function() {
                    setTimeout(autoPrint, 400);
                });
            } else {
                window.addEventListener('load', function() {
                    setTimeout(autoPrint, 400);
                });
            }
        })();
    <\/script>
    ` : ''}
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


