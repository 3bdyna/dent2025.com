// admin_analytics.js — Simplified analytics embedded into the Admin Dashboard tab
// Fetches from the shared analytics_api.php using the admin dashboard's already-authenticated
// master passkey (shared RBAC). No separate login is required.
(function () {
    'use strict';
    var API = window.location.origin + '/analytics_api.php';
    var state = { days: 7, period: 'day', custom: false };

    function el(id) { return document.getElementById(id); }
    function fmtNum(n) { if (typeof n !== 'number') n = parseInt(n, 10) || 0; return n.toLocaleString('en-US'); }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function fmtTime(sec) { sec = parseInt(sec, 10) || 0; if (sec <= 0) return '—'; var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60); return h > 0 ? h + 'س ' + m + 'د' : m + 'د'; }
    function toCfgDate(off) { var d = new Date(); d.setDate(d.getDate() - off); return d.toISOString().slice(0, 10); }

    function pass() {
        if (window.AdminApp && AdminApp.pass) return AdminApp.pass;
        try { return sessionStorage.getItem('dent2025_admin_pass') || ''; } catch (e) { return ''; }
    }

    function api(action, params) {
        return fetch(API + '?action=' + action + '&password=' + encodeURIComponent(pass()) + '&' + (params || ''))
            .then(function (r) { if (r.status === 403) throw new Error('Unauthorized'); return r.json(); });
    }

    function rangeQuery() {
        if (state.custom && el('ana-from') && el('ana-from').value && el('ana-to') && el('ana-to').value) {
            return 'from=' + el('ana-from').value + '&to=' + el('ana-to').value;
        }
        return 'from=' + toCfgDate(state.days) + '&to=' + toCfgDate(0);
    }

    function syncUI() {
        document.querySelectorAll('#ana-range-btns .ana-range-btn').forEach(function (b) {
            b.classList.toggle('on', String(b.dataset.days) === String(state.days));
        });
        if (!state.custom) {
            var fromD = new Date(); fromD.setDate(fromD.getDate() - state.days);
            if (el('ana-from')) el('ana-from').value = fromD.toISOString().slice(0, 10);
            if (el('ana-to')) el('ana-to').value = toCfgDate(0);
        }
        if (el('ana-period')) el('ana-period').value = state.period;
    }

    function render() {
        if (!pass()) { return; }
        syncUI();
        var spinEl = el('ana-spin');
        if (spinEl) spinEl.classList.remove('hidden');
        var common = rangeQuery();
        Promise.all([
            api('overview', common),
            api('ctx_heatmap', common),
            api('funnel', common),
            api('trend', common + '&period=' + state.period),
            api('subjects', common),
            api('retention', common)
        ]).then(function (results) {
            renderStats(results[0].data || {});
            renderCtx(results[1].data || []);
            renderFunnel(results[2].data || []);
            renderTrend(results[3].data || {});
            renderSubjects(results[4].data || []);
            renderRetention(results[5].data || {});
            if (spinEl) spinEl.classList.add('hidden');
        }).catch(function (e) {
            if (spinEl) spinEl.classList.add('hidden');
            var box = el('ana-stats');
            if (box) box.innerHTML = '<div class="ana-no-data">تعذر تحميل البيانات: ' + esc(e.message || 'خطأ') + '</div>';
        });
    }

    function renderStats(d) {
        var box = el('ana-stats'); if (!box) return;
        var today = d.today || {}, acts = d.active || {}, study = d.study || {}, quiz = d.quiz || {};
        var a24 = acts['24h'] || {}, a7 = acts['7d'] || {}, a30 = acts['30d'] || {};
        var cards = [
            { lbl: 'أحداث اليوم', num: fmtNum(today.all), note: 'مُعرّف ' + fmtNum(today.established) + ' • جديد ' + fmtNum(today.new) + ' • مجهول ' + fmtNum(today.anon) },
            { lbl: 'نشطون 24 ساعة', num: fmtNum(a24.total), note: 'مُعرّف ' + fmtNum(a24.est) + ' • مجهول ' + fmtNum(a24.anon) },
            { lbl: 'نشطون 7 أيام', num: fmtNum(a7.total), note: 'مُعرّف ' + fmtNum(a7.est) },
            { lbl: 'نشطون 30 يوم', num: fmtNum(a30.total), note: 'مُعرّف ' + fmtNum(a30.est) },
            { lbl: 'ساعات مذاكرة', num: fmtNum(study.hours), note: 'متوسط ' + fmtTime(study.avg_session_s) + ' • جلسات ' + fmtNum(study.sessions) },
            { lbl: 'اختبارات', num: fmtNum(quiz.attempts), note: 'نجاح ' + quiz.pass_rate + '% • أخطاء ' + fmtNum(quiz.wrong) },
            { lbl: 'مشاهدات الصفحات', num: fmtNum(d.page_views_range), note: 'خلال المدة' },
            { lbl: 'حصة المجهولين اليوم', num: (d.anon_share_pct || 0) + '%', note: 'من إجمالي أحداث اليوم' }
        ];
        box.innerHTML = cards.map(function (c) {
            return '<div class="ana-stat"><div class="lbl">' + esc(c.lbl) + '</div><div class="num">' + c.num + '</div><div class="note">' + c.note + '</div></div>';
        }).join('');
    }

    function renderCtx(list) {
        var box = el('ana-ctx'); if (!box) return;
        if (!list.length) { box.innerHTML = '<div class="ana-no-data">لا توجد سياقات في هذه الفترة</div>'; return; }
        var specLabel = function (s) { return s === 'dentistry' ? 'طب الأسنان' : s === 'medicine' ? 'الطب البشري' : 'التحضيري'; };
        box.innerHTML = '<div style="display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:8px;">' +
            list.slice(0, 16).map(function (c) {
                var yr = c.specialty === 'pre-med' ? 'تحضيري' : 'سنة ' + c.year;
                return '<div class="ana-cell"><div class="t">' + esc(specLabel(c.specialty)) + '</div><div class="n">' + fmtNum(c.selected) + '</div><div class="c">' + esc(yr + ' — فصل ' + c.semester) + '</div></div>';
            }).join('') + '</div>';
    }

    function renderFunnel(steps) {
        var box = el('ana-funnel'); if (!box) return;
        if (!steps || !steps.length) { box.innerHTML = '<div class="ana-no-data">لا توجد بيانات بعد</div>'; return; }
        var max = Math.max.apply(null, steps.map(function (s) { return s.count; }).concat([1]));
        box.innerHTML = steps.map(function (s, i) {
            var w = Math.round(s.count / max * 100);
            return '<div class="ana-fstep"><span class="fnum">' + (i + 1) + '</span>' +
                '<span class="finfo"><span class="fname">' + esc(s.label) + '</span>' +
                '<div class="fmeta">' + fmtNum(s.count) + (s.dropoff != null ? ' • -' + s.dropoff + '% هبوط' : '') + '</div></span>' +
                '<span class="b-trk"><span class="b-fill" style="width:' + w + '%;"></span></span>' +
                '<span class="b-val">' + fmtNum(s.count) + '</span></div>';
        }).join('') +
        '<p style="font-size:0.63rem;color:#71717a;margin-top:8px;">زيارة ← اختيار السياق ← فتح مادة ← فتح مصادر ← إنهاء اختبار.</p>';
    }

    function renderTrend(d) {
        var box = el('ana-trend'); if (!box) return;
        var labels = d.labels || [], series = d.series || {};
        if (!labels.length) { box.innerHTML = '<div class="ana-no-data">لا توجد بيانات في هذه الفترة</div>'; return; }
        var vals = series.all || [];
        var max = Math.max.apply(null, vals.concat([1]));
        var colors = { established: '#4ade80', new: '#fbbf24', anon: '#a1a1aa' };
        var names = { established: 'مُعرّف', new: 'جديد', anon: 'مجهول' };
        var w = Math.max(120, labels.length * (state.period === 'hour' ? 12 : 34));
        var html = '<div style="overflow-x:auto;"><div style="width:' + w + 'px; display:flex; align-items:flex-end; gap:6px; height:170px; padding-top:8px;">';
        for (var i = 0; i < labels.length; i++) {
            var parts = [];
            ['established', 'new', 'anon'].forEach(function (a) {
                var v = (series[a] || [])[i] || 0;
                if (v > 0) parts.push('<span style="height:' + Math.round(v / max * 150) + 'px; width:100%; background:' + colors[a] + 'cc; display:block;"></span>');
            });
            var fill = parts.length ? parts.join('') : '<span style="height:2px; width:100%; background:rgba(255,255,255,0.08); display:block;"></span>';
            var showLbl = state.period === 'hour' ? (i % 3 === 0) : true;
            html += '<div style="flex:1; display:flex; flex-direction:column; align-items:center; gap:4px; min-width:0;">' +
                '<div style="display:flex; flex-direction:column; justify-content:flex-end; height:150px; width:100%; gap:0;">' + fill + '</div>' +
                (showLbl ? '<span style="font-size:0.6rem; color:#71717a; white-space:nowrap;">' + esc(String(labels[i])) + '</span>' : '') + '</div>';
        }
        html += '</div></div>' +
            '<div style="display:flex; gap:14px; flex-wrap:wrap; font-size:0.7rem; color:#a1a1aa; margin-top:8px;">' +
            Object.keys(names).map(function (k) { return '<span style="display:inline-flex; align-items:center; gap:5px;"><span style="width:9px;height:9px;border-radius:2px;background:' + colors[k] + ';"></span>' + names[k] + '</span>'; }).join('') +
            '</div>';
        box.innerHTML = html;
    }

    function renderSubjects(list) {
        var tb = el('ana-subjects'); if (!tb) return;
        if (!list.length) { tb.innerHTML = '<tr><td colspan="6" class="ana-no-data" style="padding:20px 0;">لا توجد بيانات مادة في هذه الفترة</td></tr>'; return; }
        tb.innerHTML = list.slice(0, 30).map(function (s) {
            return '<tr class="border-b border-white/5">' +
                '<td class="py-2 px-2 text-gray-200">' + esc(s.name) + '</td>' +
                '<td class="py-2 px-2 text-center text-gray-300">' + fmtNum(s.opens) + '</td>' +
                '<td class="py-2 px-2 text-center text-gray-300">' + fmtNum(s.materials) + '</td>' +
                '<td class="py-2 px-2 text-center text-gray-300">' + fmtNum(s.quizzes) + '</td>' +
                '<td class="py-2 px-2 text-center text-gray-300">' + s.hours + '</td>' +
                '<td class="py-2 px-2 text-center text-amber-400">' + s.abandon_rate + '%</td></tr>';
        }).join('');
    }

    function renderRetention(d) {
        var box = el('ana-retention'); if (!box) return;
        box.innerHTML =
            '<div class="ana-ret-chip mb-3"><div class="lbl">عودة بعد يوم (D1)</div><div class="num">' + d.d1 + '%</div></div>' +
            '<div class="ana-ret-chip mb-3"><div class="lbl">عودة خلال 7 أيام (D7)</div><div class="num">' + d.d7 + '%</div></div>' +
            '<div class="ana-ret-chip"><div class="lbl">ملفات المراقبة</div><div class="num" style="color:#60a5fa;">' + fmtNum(d.profiles_seen) + '</div></div>' +
            '<p style="font-size:0.62rem;color:#71717a;margin-top:10px;">نسبة المستخدمين الذين عادوا بعد زيارتهم الأولى ضمن الفترة.</p>';
    }

    function setRange(days) {
        state.custom = false;
        state.days = days;
        render();
    }
    function customRange() {
        var f = el('ana-from'), t = el('ana-to');
        if (f && t && f.value && t.value) {
            state.custom = true;
            var diff = Math.round((new Date(t.value + 'T23:59:59') - new Date(f.value + 'T00:00:00')) / 86400000);
            state.days = Math.max(1, diff + 1);
            render();
        }
    }
    function periodChanged() {
        state.period = el('ana-period').value;
        render();
    }

    window.AdminAnalytics = {
        render: render,
        setRange: setRange,
        customRange: customRange,
        periodChanged: periodChanged
    };
})();