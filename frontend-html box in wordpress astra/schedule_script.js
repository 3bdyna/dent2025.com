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
                this.adminPassword = sessionStorage.getItem('dent2025_schedule_admin_pass') || null;
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

        const isAdmin = !!(this.adminPassword || sessionStorage.getItem('dent2025_schedule_admin_pass'));

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
                            <button class="event-edit-btn" title="تعديل الحدث" onclick="ScheduleApp.showEditModal('${escapedId}')">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                            </button>
                            <button class="event-delete-btn" title="حذف الحدث" onclick="ScheduleApp.deleteEvent('${escapedId}', ${isGlobal ? 'true' : 'false'}, '${eventSchedId}')">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path></svg>
                            </button>`;
                    }

                    let extraBadgeClass = badgeClass ? `badge-${badgeClass}` : '';
                    const isNationalDay = ev.id === 'evt_hol_national' || (ev.title && ev.title.includes('اليوم الوطني'));
                    const nationalDayCardClass = isNationalDay ? ' event-card-national-day' : '';
                    
                    cardsHtml += `
                        <div class="event-card${nationalDayCardClass}" id="event-${ev.id}">
                            <div class="event-info" style="flex: 1; min-width: 0;">
                                <h3 class="event-title" dir="auto">${dentEscapeHtml(ev.title)}</h3>
                            </div>
                            <div class="event-badges" style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
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
            if (t.includes('واجب') || t.includes('تكليف') || t.includes('مشروع') || t.includes('تقرير') || t.includes('نهائ') || t.includes('فاينل')) {
                return false;
            }
            return t.includes('كويز') || t.includes('quiz') || id.includes('quiz') || t.includes('اختبار قصير') || (ev.type === 'exam' && !t.includes('نهائ') && !t.includes('فاينل'));
        };

        events.forEach(ev => {
            const evDate = this.parseLocalDate(ev.date);
            if (evDate) evDate.setHours(0, 0, 0, 0);
            
            if (ev.type === 'start') startEvent = ev;
            if (ev.type === 'exam') finalsEvent = ev;
            
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
        const typeVal = isEdit ? (existingEvent.type || 'other') : 'other';
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
                        <span style="font-size: 0.75rem; color: #a78bfa; background: rgba(167,139,250,0.12); border: 1px solid rgba(167,139,250,0.25); border-radius: 6px; padding: 2px 8px; display: inline-block;">📌 ${dentEscapeHtml(scopeText)}</span>
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
                    <select id="ev-type" style="width: 100%; height: 44px; padding: 0 14px; background: #121212; border: 1px solid rgba(255,255,255,0.12); border-radius: 10px; color: #fff; font-size: 0.9rem; font-family: inherit; box-sizing: border-box; outline: none; transition: all 0.2s; color-scheme: dark;" onfocus="this.style.borderColor='rgba(255,255,255,0.4)';" onblur="this.style.borderColor='rgba(255,255,255,0.12)';">
                        <option value="start"${typeVal === 'start' ? ' selected' : ''}>بداية دراسة</option>
                        <option value="holiday"${typeVal === 'holiday' ? ' selected' : ''}>إجازة</option>
                        <option value="exam"${typeVal === 'exam' ? ' selected' : ''}>اختبار</option>
                        <option value="payment"${typeVal === 'payment' ? ' selected' : ''}>مكافأة</option>
                        <option value="other"${typeVal === 'other' ? ' selected' : ''}>أخرى</option>
                    </select>
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
        const type = document.getElementById('ev-type')?.value || 'other';
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
            type: type,
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
    }
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ScheduleApp.init());
} else {
    ScheduleApp.init();
}
/* ]]> */


