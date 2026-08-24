// analytics_dashboard.js — Dent2025 Admin Analytics Dashboard
(function () {
    'use strict';
    var API = window.location.origin + '/analytics_api.php';
    var FILTER_KEY = 'dent2025_analytics_filters';
    var ADMIN_SESSION = 'dent2025_analytics_admin';

    function qs(sel) { return document.querySelector(sel); }
    function el(id) { return document.getElementById(id); }

    var state = {
        password: sessionStorage.getItem(ADMIN_SESSION) || '',
        days: 7,
        period: 'day',
        ident: { established: true, new: true, anon: true },
        separate: false,
        lastData: null,
        raw: { page: 1, total: 0, events: [] }
    };

    function fmtNum(n) {
        if (typeof n !== 'number') n = parseInt(n, 10) || 0;
        return n.toLocaleString('en-US');
    }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    var TYPE_LABELS = {
        page_view: 'صفحة', context_select: 'اختيار سياق', subject_open: 'فتح مادة',
        materials_open: 'فتح مصادر', quiz_start: 'بدء اختبار', quiz_finish: 'إنهاء اختبار',
        quiz_wrong: 'إجابة خاطئة', timer_start: 'بدء مذاكرة', timer_pause: 'إيقاف مؤقت',
        timer_finish: 'إنهاء مذاكرة', timer_reset: 'تصفير مؤقت', schedule_view: 'مشاهدة التقويم'
    };
    var ASSET = { established: 'est', new: 'new', anon: 'anon' };
    var ASSET_COLOR = { established: '#4ade80', new: '#fbbf24', anon: '#a1a1aa' };
    var ASSET_LABEL = { established: 'مُعرّف', new: 'جديد', anon: 'مجهول' };

    function identQuery() {
        return '&incl_est=' + (state.ident.established ? 1 : 0) +
               '&incl_new=' + (state.ident.new ? 1 : 0) +
               '&incl_anon=' + (state.ident.anon ? 1 : 0) +
               '&anon_separate=' + (state.separate ? 1 : 0);
    }
    function rangeQuery() {
        var from = toCfgDate(state.days), to = toCfgDate(0);
        return '&from=' + from + '&to=' + to;
    }
    function toCfgDate(daysFromToday) {
        var d = new Date();
        d.setDate(d.getDate() - daysFromToday);
        return d.toISOString().slice(0, 10);
    }

    function api(action, params, isPost) {
        var url = API + '?action=' + action;
        var opts = { method: isPost ? 'POST' : 'GET' };
        if (isPost) {
            opts.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
            opts.body = 'password=' + encodeURIComponent(state.password) + '&' + (params || '');
        } else {
            url += '&password=' + encodeURIComponent(state.password) + '&' + (params || '');
        }
        return fetch(url, opts).then(function (r) {
            if (r.status === 403) { AnalyticsApp.logout(); throw new Error('Unauthorized'); }
            return r.json();
        });
    }

    function saveFilters() {
        try {
            localStorage.setItem(FILTER_KEY, JSON.stringify({ ident: state.ident, separate: state.separate, days: state.days, period: state.period }));
        } catch (e) {}
    }
    function loadFilters() {
        try {
            var raw = localStorage.getItem(FILTER_KEY);
            if (raw) {
                var f = JSON.parse(raw);
                if (f.ident) state.ident = f.ident;
                if (typeof f.separate === 'boolean') state.separate = f.separate;
                if (f.days) state.days = f.days;
                if (f.period) state.period = f.period;
            }
        } catch (e) {}
    }

    function spinner(on) {
        el('loading-spin').classList.toggle('hidden', !on);
    }
    function errBanner(msg) {
        var b = el('err-banner');
        if (msg) b.innerHTML = '<div class="err-banner">' + esc(msg) + '</div>';
        else b.innerHTML = '';
    }
    function hdRange() {
        var from = toCfgDate(state.days), to = toCfgDate(0);
        el('hd-range').textContent = from + ' → ' + to + ' | فترة الفترة: ' +
            ({ day: 'يومي', week: 'أسبوعي', month: 'شهري', hour: 'ساعي' })[state.period];
    }

    function refreshChips() {
        ['established', 'new', 'anon'].forEach(function (k) {
            el('chip-' + k).classList.toggle('on', state.ident[k]);
        });
        var allOn = state.ident.established && state.ident.new && state.ident.anon;
        el('chip-all').classList.toggle('on', allOn);
        el('chk-sep').checked = state.separate;
        document.querySelectorAll('.range-btn').forEach(function (b) {
            b.classList.toggle('on', String(b.dataset.days) === String(state.days === 'custom' ? (state.customDays || 7) : state.days) || (state.days === 'custom' && b.id === 'rb-custom'));
        });
        el('sel-period').value = state.period;
        var fromD = new Date(); fromD.setDate(fromD.getDate() - (state.days === 'custom' ? 7 : state.days));
        el('dt-from').value = fromD.toISOString().slice(0, 10);
        el('dt-to').value = toCfgDate(0);
    }

    // ---------------- Login ----------------
    function login() {
        var pass = el('login-pass').value.trim();
        if (!pass) { el('login-err').textContent = 'يرجى إدخال كلمة المرور'; return; }
        el('login-btn').disabled = true;
        fetch(API + '?action=overview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'password=' + encodeURIComponent(pass)
        }).then(function (r) {
            if (r.status === 403) { throw new Error('كلمة المرور غير صحيحة'); }
            return r.json();
        }).then(function (res) {
            if (res && res.success) {
                state.password = pass;
                sessionStorage.setItem(ADMIN_SESSION, pass);
                el('login-ov').style.display = 'none';
                el('app').style.display = 'block';
                el('login-err').textContent = '';
                AnalyticsApp.refresh();
            } else { throw new Error(res.message || 'خطأ في الدخول'); }
        }).catch(function (e) {
            el('login-err').textContent = e.message || 'خطأ في الاتصال';
            el('login-btn').disabled = false;
        });
    }

    // ---------------- Refresh all ----------------
    function refresh() {
        el('login-btn').disabled = false;
        if (!state.password) {
            el('login-ov').style.display = 'flex';
            el('app').style.display = 'none';
            return;
        }
        spinner(true);
        errBanner('');
        hdRange();
        var common = identQuery() + rangeQuery();
        Promise.all([
            api('overview', common),
            api('ctx_heatmap', common),
            api('subjects', common),
            api('trend', common + '&period=' + state.period),
            api('timer_patterns', common),
            api('funnel', common),
            api('retention', common),
            api('identity', common)
        ]).then(function (results) {
            var keys = ['overview', 'ctx', 'subjects', 'trend', 'timer', 'funnel', 'retention', 'identity'];
            state.lastData = {};
            results.forEach(function (r, i) { state.lastData[keys[i]] = r.data || {}; });
            renderAll();
            AnalyticsApp.loadRaw(1);
            spinner(false);
        }).catch(function (e) {
            spinner(false);
            if (e.message !== 'Unauthorized') errBanner('تعذر تحميل البيانات: ' + e.message);
        });
    }

    // ---------------- Renderers ----------------
    function renderAll() {
        renderOverview();
        renderIdentity();
        renderFunnel();
        renderCtxHeat();
        renderTrend();
        renderTimer();
        renderSubjects();
        renderRetention();
        renderStreak();
    }

    function renderOverview() {
        var d = state.lastData.overview || {};
        var today = d.today || {};
        var acts = d.active || {};
        var study = d.study || {};
        var quiz = d.quiz || {};
        var a24 = acts['24h'] || {}, a7 = acts['7d'] || {}, a30 = acts['30d'] || {};
        var cards = [
            { lbl: 'أحداث اليوم', num: fmtNum(today.all), note: 'مُعرّف ' + fmtNum(today.established) + ' • جديد ' + fmtNum(today.new) + ' • مجهول ' + fmtNum(today.anon) },
            { lbl: 'نشطون 24 ساعة', num: fmtNum(a24.total), note: 'مُعرّف ' + fmtNum(a24.est) + ' • جديد ' + fmtNum(a24.new) + ' • مجهول ' + fmtNum(a24.anon) },
            { lbl: 'نشطون 7 أيام', num: fmtNum(a7.total), note: 'مُعرّف ' + fmtNum(a7.est) + ' • جديد ' + fmtNum(a7.new) + ' • مجهول ' + fmtNum(a7.anon) },
            { lbl: 'نشطون 30 يوم', num: fmtNum(a30.total), note: 'مُعرّف ' + fmtNum(a30.est) + ' • جديد ' + fmtNum(a30.new) + ' • مجهول ' + fmtNum(a30.anon) },
            { lbl: 'ساعات مذاكرة', num: fmtNum(study.hours), note: 'جلسة متوسط ' + fmtTime(study.avg_session_s) + ' (جلسات ' + fmtNum(study.sessions) + ')' },
            { lbl: 'اختبارات', num: fmtNum(quiz.attempts), note: 'معدل نجاح ' + quiz.pass_rate + '% (خطأ ' + fmtNum(quiz.wrong) + ')' },
            { lbl: 'مشاهدات الصفحات', num: fmtNum(d.page_views_range), note: 'خلال المدة' },
            { lbl: 'حصة المجهولين اليوم', num: (d.anon_share_pct ?? 0) + '%', note: 'من إجمالي أحداث اليوم' }
        ];
        el('ov-grid').innerHTML = cards.map(function (c) {
            return '<div class="stat"><div class="lbl">' + esc(c.lbl) + '</div><div class="num">' + c.num + '</div><div class="note">' + c.note + '</div></div>';
        }).join('');
    }

    function fmtTime(sec) {
        sec = parseInt(sec, 10) || 0;
        if (sec <= 0) return '—';
        var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
        return h > 0 ? h + 'س ' + m + 'د' : m + 'د';
    }

    function renderIdentity() {
        var d = state.lastData.identity || {};
        var total = (d.total_profiles || 0) + (d.anon_devices_estim || 0);
        var rows = [
            { name: 'مُعرّف (Established)', val: d.established || 0, cls: 'est' },
            { name: 'جديد (New)', val: d.new || 0, cls: 'new' },
            { name: 'أجهزة مجهولة (تقديري)', val: d.anon_devices_estim || 0, cls: 'anon' }
        ];
        el('identity-panel').innerHTML = rows.map(function (r) {
            var pct = total > 0 ? Math.round(r.val / total * 100) : 0;
            return '<div class="bar-row"><span class="b-label">' + esc(r.name) + ' <span class="pill ' + r.cls + '">' + pct + '%</span></span>' +
                '<span class="b-track"><span class="b-fill" style="width:' + Math.max(pct, 1) + '%; background:linear-gradient(90deg,' + ASSET_COLOR[r.cls] + '88,' + ASSET_COLOR[r.cls] + '44);"></span></span>' +
                '<span class="b-val">' + fmtNum(r.val) + '</span></div>';
        }).join('') +
        '<p class="muted-hint">أجهزة مجهولة = بصمات فريدة بدون معرّف ثابت (وضع التصفح الخاص/حذف الكوكيز).</p>' +
        '<p class="muted-hint">أحداث اليوم: مجموع ' + fmtNum(d.anon_events_today || 0) + ' أحداث مجهولة '+ ' • معرّفات مدمجة: ' + fmtNum(d.anon_aliases_merged || 0) + '</p>';
    }

    function renderFunnel() {
        var steps = (state.lastData.funnel || []).slice();
        if (!steps.length) { el('funnel-panel').innerHTML = '<div class="no-data">لا توجد بيانات بعد</div>'; return; }
        var max = Math.max.apply(null, steps.map(function (s) { return s.count; }).concat([1]));
        el('funnel-panel').innerHTML = steps.map(function (s, i) {
            var w = Math.round(s.count / max * 100);
            return '<div class="funnel-step">' +
                '<span class="f-num">' + (i + 1) + '</span>' +
                '<span class="f-info"><span class="f-name">' + esc(s.label) + '</span>' +
                '<div class="f-meta">' + fmtNum(s.count) + ' • ' + (s.dropoff == null ? 'بداية المسار' : '-' + s.dropoff + '% هبوط من الخطوة السابقة') + '</div></span>' +
                '<span class="b-track" style="flex:0 0 40%; height:10px;"><span class="b-fill" style="width:' + w + '%;"></span></span>' +
                '<span class="b-val">' + fmtNum(s.count) + '</span></div>';
        }).join('') +
        '<p class="muted-hint">المسار: زيارة ← اختيار السياق ← فتح مادة ← فتح مصادر ← إنهاء اختبار. يعكس التصفية الحالية للهوية.</p>';
    }

    function renderCtxHeat() {
        var list = state.lastData.ctx || [];
        if (!list.length) { el('ctx-heat').innerHTML = '<div class="no-data">لا توجد سياقات في هذه الفترة</div>'; return; }
        el('ctx-heat').innerHTML = '<div class="heat-grid">' + list.slice(0, 20).map(function (c) {
            var specAR = c.specialty === 'dentistry' ? 'طب الأسنان' : c.specialty === 'medicine' ? 'الطب البشري' : 'التحضيري';
            var yr = c.specialty === 'pre-med' ? 'تحضيري' : 'سنة ' + c.year;
            return '<div class="heat-cell"><div class="hc-spec">' + esc(specAR) + '</div>' +
                '<div class="hc-num">' + fmtNum(c.selected) + '</div>' +
                '<div class="hc-ctx">' + esc(yr) + ' — فصل ' + c.semester + '</div></div>';
        }).join('') + '</div>';
    }

    function renderTrend() {
        var d = state.lastData.trend || {};
        var labels = d.labels || [], series = d.series || {};
        var node = el('trend-chart');
        if (!labels.length) { node.innerHTML = '<div class="no-data">لا توجد بيانات في هذه الفترة</div>'; el('trend-legend').innerHTML = ''; return; }
        var vals = series.all || [];
        var max = Math.max.apply(null, vals.concat([1]));
        var w = Math.max(120, labels.length * (state.period === 'hour' ? 12 : 34));
        node.style.overflowX = 'auto';
        var html = '<div style="width:' + w + 'px; display:flex; align-items:flex-end; gap:' + (state.period === 'hour' ? 2 : 8) + 'px; height:200px; padding-top:10px;">';
        for (var i = 0; i < labels.length; i++) {
            var h = Math.max(1, Math.round(vals[i] / max * 190));
            var parts = []; var j = 0;
            ['established', 'new', 'anon'].forEach(function (a) {
                var v = (series[a] || [])[i] || 0;
                if (v > 0) { parts.push('<span style="height:' + Math.round(v / max * 190) + 'px; width:100%; background:' + ASSET_COLOR[a] + 'cc; display:block;"></span>'); j++; }
            });
            var fill = parts.length ? parts.join('') : '<span style="height:2px; width:100%; background:rgba(255,255,255,0.08); display:block;"></span>';
            var showLbl = state.period === 'hour' ? (i % 3 === 0) : true;
            html += '<div style="flex:1; display:flex; flex-direction:column; align-items:center; gap:4px; min-width:0;">' +
                '<div style="display:flex; flex-direction:column; justify-content:flex-end; height:190px; width:100%; gap:0;">' + fill + '</div>' +
                '<span style="font-size:0.62rem; color:#71717a; transform:rotate(-40deg); white-space:nowrap;">' + esc(String(labels[i])) + (state.period === 'day' ? '' : '') + '</span></div>';
        }
        html += '</div>';
        node.innerHTML = html;
        el('trend-legend').innerHTML = ['established', 'new', 'anon'].map(function (a) {
            return '<span><span class="sw" style="background:' + ASSET_COLOR[a] + ';"></span>' + ASSET_LABEL[a] + '</span>';
        }).join('') + (state.separate ? '<span><span class="sw dashed"></span>مجهول منفصل (خط متقطع)</span>' : '');
    }

    function renderTimer() {
        var d = state.lastData.timer || {};
        // 24h bars
        var h24 = d.hours_24 || {};
        var keys = Object.keys(h24).sort();
        var maxH = Math.max.apply(null, keys.map(function (k) { return h24[k].seconds || 0; }).concat([1]));
        el('hours24-chart').innerHTML = '<div style="display:flex; align-items:flex-end; gap:3px; height:150px;">' +
            keys.map(function (k, i) {
                var v = h24[k].seconds || 0;
                var hgt = Math.max(v > 0 ? 2 : 1, Math.round(v / maxH * 140));
                return '<div style="flex:1; display:flex; flex-direction:column; align-items:center; gap:3px; min-width:0;"><div style="width:100%; height:140px; display:flex; align-items:flex-end;"><div title="' + v + ' ثانية" style="width:100%; height:' + hgt + 'px; background:linear-gradient(180deg, #60a5fa, rgba(96,165,250,0.25)); border-radius:4px 4px 0 0;"></div></div><span style="font-size:0.6rem; color:#71717a;">' + (i % 2 === 0 ? k.replace('hour_', '') : '') + '</span></div>';
            }).join('') + '</div>';
        // weekday
        var wd = d.weekday || {};
        var wdNames = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
        var maxW = Math.max.apply(null, Object.keys(wd).map(function (k) { return wd[k].seconds || 0; }).concat([1]));
        el('weekday-chart').innerHTML = '<div style="display:flex; align-items:flex-end; gap:8px; height:150px;">' +
            Object.keys(wd).sort().map(function (k, i) {
                var v = wd[k].seconds || 0;
                var hgt = Math.max(v > 0 ? 2 : 1, Math.round(v / maxW * 140));
                return '<div style="flex:1; display:flex; flex-direction:column; align-items:center; gap:3px;"><div style="width:100%; height:140px; display:flex; align-items:flex-end;"><div title="' + v + ' ثانية" style="width:100%; height:' + hgt + 'px; background:linear-gradient(180deg, #a78bfa, rgba(167,139,250,0.2)); border-radius:4px 4px 0 0;"></div></div><span style="font-size:0.62rem; color:#71717a;">' + wdNames[i] + '</span></div>';
            }).join('') + '</div>';
        // monthly
        var mo = d.monthly || {};
        var moKeys = Object.keys(mo).sort();
        var maxM = Math.max.apply(null, moKeys.map(function (k) { return mo[k]; }).concat([1]));
        el('monthly-chart').innerHTML = moKeys.length ? ('<div style="display:flex; align-items:flex-end; gap:10px; height:170px;">' +
            moKeys.map(function (k) {
                var hrs = (mo[k] / 3600);
                var hgt = Math.max(hrs > 0 ? 2 : 1, Math.round(hrs / (maxM / 3600) * 160));
                return '<div style="flex:1; display:flex; flex-direction:column; align-items:center; gap:4px;"><div style="width:70%; height:160px; display:flex; align-items:flex-end;"><div title="' + hrs.toFixed(1) + ' ساعات" style="width:100%; height:' + hgt + 'px; background:linear-gradient(180deg, #4ade80, rgba(74,222,128,0.2)); border-radius:6px 6px 0 0;"></div></div><span style="font-size:0.66rem; color:#71717a;">' + esc(k) + '</span><span style="font-size:0.6rem; color:#a1a1aa; direction:ltr;">' + hrs.toFixed(1) + 'س</span></div>';
            }).join('') + '</div>') : '<div class="no-data">لا توجد بيانات مذاكرة في هذه الفترة</div>';
        var footer = '<p class="muted-hint">إجمالي: ' + (d.total_hours || 0) + ' ساعة • متوسط الجلسة: ' + fmtTime(d.avg_session_s) + ' (مع احترام فلاتر الهوية)</p>';
        el('monthly-chart').insertAdjacentHTML('afterend', footer);
    }

    function renderSubjects() {
        var list = state.lastData.subjects || [];
        if (!list.length) { el('subjects-tbody').innerHTML = '<tr><td colspan="6" class="no-data">لا توجد بيانات مادة في هذه الفترة</td></tr>'; return; }
        el('subjects-tbody').innerHTML = list.slice(0, 30).map(function (s) {
            return '<tr><td>' + esc(s.name) + '</td><td class="num-r">' + fmtNum(s.opens) + '</td><td class="num-r">' + fmtNum(s.materials) + '</td>' +
                '<td class="num-r">' + fmtNum(s.quizzes) + '</td><td class="num-r">' + s.hours + '</td>' +
                '<td class="num-r">' + s.abandon_rate + '%</td></tr>';
        }).join('');
    }

    function renderRetention() {
        var d = state.lastData.retention || {};
        var cohorts = d.cohorts || [];
        el('retention-panel').innerHTML =
            '<div style="display:flex; gap:16px; margin-bottom:14px; flex-wrap:wrap;">' +
            '<div class="stat" style="flex:1; min-width:110px;"><div class="lbl">عودة بعد يوم (D1)</div><div class="num" style="font-size:1.4rem;">' + d.d1 + '%</div></div>' +
            '<div class="stat" style="flex:1; min-width:110px;"><div class="lbl">عودة خلال 7 أيام (D7)</div><div class="num" style="font-size:1.4rem;">' + d.d7 + '%</div></div>' +
            '<div class="stat" style="flex:1; min-width:110px;"><div class="lbl">ملفات مُرصودة</div><div class="num" style="font-size:1.4rem;">' + fmtNum(d.profiles_seen) + '</div></div>' +
            '</div>' +
            (cohorts.length ? '<div style="overflow-x:auto;"><table><thead><tr><th>أسبوع الانضمام</th><th class="num-r">الحجم</th><th class="num-r">عودة أسبوع 1</th><th class="num-r">عودة أسبوع 3</th></tr></thead><tbody>' +
            cohorts.map(function (c) {
                return '<tr><td dir="ltr">' + esc(c.week) + '</td><td class="num-r">' + c.size + '</td><td class="num-r">' + c.ret_week1_pct + '%</td><td class="num-r">' + c.ret_week3_pct + '%</td></tr>';
            }).join('') + '</tbody></table></div>'
             : '<div class="no-data">لا تكفي البيانات بعد لحساب الجداول</div>');
    }

    function renderStreak() {
        var dist = state.lastData.retention && state.lastData.retention.streak_distribution || {};
        var keys = Object.keys(dist).sort(function (a, b) { return a - b; });
        if (!keys.length) { el('streak-panel').innerHTML = '<div class="no-data">لا توجد بيانات متتالية بعد</div>'; return; }
        var max = Math.max.apply(null, keys.map(function (k) { return dist[k]; }));
        el('streak-panel').innerHTML = keys.map(function (k) {
            var w = Math.round(dist[k] / max * 100);
            return '<div class="bar-row"><span class="b-label">' + k + ' يوم</span><span class="b-track"><span class="b-fill" style="width:' + w + '%; background:linear-gradient(90deg, rgba(251,191,36,0.7), rgba(251,191,36,0.3));"></span></span><span class="b-val">' + fmtNum(dist[k]) + '</span></div>';
        }).join('');
    }

    // ---------------- Raw events ----------------
    function loadRaw(page) {
        state.raw.page = page;
        var type = el('raw-type').value;
        var idf = el('raw-ident').value;
        var q = 'page=' + page + '&type=' + encodeURIComponent(type) + '&ident=' + encodeURIComponent(idf);
        api('raw', q).then(function (res) {
            state.raw.total = res.data.total;
            state.raw.events = res.data.events;
            el('raw-count').textContent = 'إجمالي ' + fmtNum(res.data.total) + ' حدثًا';
            var tb = el('raw-tbody');
            if (!state.raw.events.length) { tb.innerHTML = '<tr><td colspan="7" class="no-data">لا توجد أحداث تطابق الفلترة</td></tr>'; }
            else {
                tb.innerHTML = state.raw.events.map(function (e) {
                    var ctx = e.ctx ? (e.ctx.specialty + ' ' + e.ctx.year + '/' + e.ctx.semester) : '—';
                    var pil = '<span class="pill ' + (e.ident === 'established' ? 'est' : e.ident === 'new' ? 'new' : 'anon') + '">' + esc(ASSET_LABEL[e.ident] || e.ident) + '</span>';
                    var t = new Date((e.ts || 0) * 1000);
                    var timeStr = t.toLocaleString('ar-SA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
                    var val = e.value != null ? fmtNum(e.value) + (e.type === 'quiz_finish' ? '%' : e.type === 'timer_finish' ? 'ث' : '') : '';
                    return '<tr><td dir="ltr" style="text-align:right;">' + timeStr + '</td><td>' + esc(TYPE_LABELS[e.type] || e.type) + '</td><td>' + pil + '</td><td dir="ltr">' + esc(ctx) + '</td><td>' + esc(e.subject || '—') + '</td><td class="num-r">' + val + '</td><td dir="ltr">' + esc(e.path || '') + '</td></tr>';
                }).join('');
            }
            var pages = Math.max(1, Math.ceil(state.raw.total / 50));
            var pager = '';
            if (pages > 1) {
                pager += '<button class="btn" ' + (page <= 1 ? 'disabled' : '') + ' onclick="AnalyticsApp.loadRaw(' + (page - 1) + ')">السابق</button>';
                pager += '<span style="align-self:center; color:#a1a1aa; font-size:0.8rem;">صفحة ' + page + ' / ' + pages + '</span>';
                pager += '<button class="btn" ' + (page >= pages ? 'disabled' : '') + ' onclick="AnalyticsApp.loadRaw(' + (page + 1) + ')">التالي</button>';
            }
            el('raw-pager').innerHTML = pager;
        }).catch(function () {});
    }

    function exportCSV() {
        var rows = [['ts', 'ident', 'type', 'subject', 'value', 'ctx', 'path']];
        (state.raw.events || []).forEach(function (e) {
            rows.push([e.ts, e.ident, e.type, e.subject || '', e.value != null ? e.value : '', e.ctx ? (e.ctx.specialty + '_' + e.ctx.year + '_' + e.ctx.semester) : '', e.path || '']);
        });
        var csv = rows.map(function (r) { return r.map(function (c) { return '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
        var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'dent2025_analytics_' + toCfgDate(0) + '.csv';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }

    // ---------------- Filter interactions ----------------
    function toggleIdent(k) {
        state.ident[k] = !state.ident[k];
        saveFilters(); refreshChips(); refresh();
    }
    function filterAll() {
        var allOn = state.ident.established && state.ident.new && state.ident.anon;
        state.ident = { established: !allOn, new: !allOn, anon: !allOn };
        saveFilters(); refreshChips(); refresh();
    }
    function setSeparate(v) { state.separate = v; saveFilters(); refreshChips(); refresh(); }
    function setRange(days) {
        if (days === 'custom') {
            var f = el('dt-from').value, t = el('dt-to').value;
            if (f && t) {
                state.days = Math.max(1, Math.round((new Date(t) - new Date(f)) / 86400000));
                state.customDays = state.days;
            } else { state.days = 7; }
        } else {
            state.days = days;
            var from = new Date(); from.setDate(from.getDate() - state.days);
            el('dt-from').value = from.toISOString().slice(0, 10);
            el('dt-to').value = toCfgDate(0);
        }
        saveFilters(); refreshChips(); refresh();
    }
    function periodChanged() { state.period = el('sel-period').value; saveFilters(); refreshChips(); refresh(); }
    function logout() {
        sessionStorage.removeItem(ADMIN_SESSION);
        state.password = '';
        el('app').style.display = 'none';
        el('login-ov').style.display = 'flex';
    }

    window.AnalyticsApp = {
        refresh: refresh, login: login, logout: logout,
        toggleIdent: toggleIdent, filterAll: filterAll, setSeparate: setSeparate,
        setRange: setRange, periodChanged: periodChanged, exportCSV: exportCSV,
        loadRaw: loadRaw
    };

    // Init
    document.addEventListener('DOMContentLoaded', function () {
        loadFilters();
        refreshChips();
        var passInput = el('login-pass');
        if (passInput) passInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') login(); });
        var btn = el('login-btn');
        if (btn) btn.addEventListener('click', login);
        var from = el('dt-from'), to = el('dt-to');
        if (from) from.addEventListener('change', function () { if (el('dt-to').value) setRange('custom'); });
        if (to) to.addEventListener('change', function () { if (el('dt-from').value) setRange('custom'); });

        if (state.password) {
            // verify session still valid
            api('overview', '').then(function (res) {
                if (res.success) {
                    el('login-ov').style.display = 'none';
                    el('app').style.display = 'block';
                    refresh();
                } else { logout(); }
            }).catch(function () { logout(); });
        } else {
            el('login-ov').style.display = 'flex';
            el('app').style.display = 'none';
        }
    });
})();