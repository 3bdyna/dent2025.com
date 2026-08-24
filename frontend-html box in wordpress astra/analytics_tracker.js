// analytics_tracker.js — Dent2025 First-Party Analytics Tracker
// Loaded sitewide via dent2025-loader.php wp_footer. Fully non-blocking:
// never throws, never blocks the UI, never touches student locals beyond dent2025_* keys.
(function () {
    if (window.dentAnalyticsLoaded) return;
    window.dentAnalyticsLoaded = true;

    var API_URL = window.location.origin + '/analytics_api.php';
    var MAX_QUEUE = 50;
    var FLUSH_MS = 30000;
    var BUFFER_KEY = 'dent2025_analytics_buffer';
    var ID_KEY = 'dent2025_anon_id';
    var ID_COOKIE = 'dent2025_anon';
    var SID_KEY = 'dent2025_sid';
    var FP_KEY = 'dent2025_fp';

    function safeGet(key, store) {
        try { return (store || window.localStorage).getItem(key); } catch (e) { return null; }
    }
    function safeSet(key, val, store) {
        try { (store || window.localStorage).setItem(key, val); } catch (e) {}
    }

    function cookieGet(name) {
        try {
            var m = document.cookie.match(new RegExp('(^|; )' + name + '=([^;]*)'));
            return m ? decodeURIComponent(m[2]) : null;
        } catch (e) { return null; }
    }
    function cookieSet(name, val, days) {
        try {
            var d = new Date();
            d.setTime(d.getTime() + days * 86400000);
            document.cookie = name + '=' + encodeURIComponent(val) + '; expires=' + d.toUTCString() + '; path=/; SameSite=Lax';
        } catch (e) {}
    }

    function makeId() {
        try {
            if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
        } catch (e) {}
        var s = '';
        for (var i = 0; i < 8; i++) s += Math.floor(Math.random() * 16).toString(16);
        return 'dent_' + Date.now().toString(36) + '_' + s;
    }

    function anonId() {
        var id = safeGet(ID_KEY);
        var cookieId = cookieGet(ID_COOKIE);
        if (id && id !== cookieId) { cookieSet(ID_COOKIE, id, 365); return id; }
        if (cookieId && !id) { safeSet(ID_KEY, cookieId); return cookieId; }
        if (!id) { id = makeId(); safeSet(ID_KEY, id); cookieSet(ID_COOKIE, id, 365); }
        return id;
    }

    function fingerprint() {
        var existing = safeGet(FP_KEY);
        if (existing) return existing;
        var parts = [
            window.screen ? window.screen.width : 0,
            window.screen ? window.screen.height : 0,
            window.screen ? window.screen.colorDepth : 0,
            new Date().getTimezoneOffset(),
            navigator.language || '',
            navigator.platform || '',
            navigator.hardwareConcurrency || 0,
            (navigator.deviceMemory || 0)
        ];
        // Trim user-agent to brand+version only (less brand-churn than full UA string)
        try {
            var ua = (navigator.userAgent || '').match(/(Chrome|Firefox|Safari|Edge|Opera|SamsungBrowser)[\/ ]([\d.]+)/);
            parts.push(ua ? ua[1] + ua[2] : 'other');
        } catch (e) {}
        var h = 2166136261;
        var str = parts.join('|');
        for (var i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        var fp = ((h >>> 0).toString(16));
        safeSet(FP_KEY, fp);
        return fp;
    }

    function sessionId() {
        var sid = safeGet(SID_KEY, window.sessionStorage);
        if (!sid) { sid = makeId(); safeSet(SID_KEY, sid, window.sessionStorage); }
        return sid;
    }

    function context() {
        try {
            var raw = localStorage.getItem('dent2025_selection');
            if (!raw) return null;
            var sel = JSON.parse(raw);
            if (sel && sel.specialty && sel.year !== undefined && sel.semester !== undefined) {
                return { specialty: sel.specialty, year: parseInt(sel.year, 10), semester: parseInt(sel.semester, 10) };
            }
        } catch (e) {}
        return null;
    }

    var queue = [];

    // Offline / failed-flush buffer
    function drainBuffer() {
        var raw = safeGet(BUFFER_KEY);
        if (!raw) return;
        try {
            var buffered = JSON.parse(raw);
            if (buffered && buffered.length) { queue = buffered.concat(queue.slice(0, 25)); }
        } catch (e) {}
        try { window.localStorage.removeItem(BUFFER_KEY); } catch (e) {}
        flush(true);
    }
    if (window.addEventListener) {
        window.addEventListener('online', function () { setTimeout(drainBuffer, 500); });
    }

    function track(type, data) {
        data = data || {};
        var ev = { ts: Date.now(), type: type, path: window.location.pathname || '' };
        var ctx = context();
        if (ctx) ev.ctx = ctx;
        if (data.subject) ev.subject = String(data.subject).slice(0, 120);
        if (typeof data.value === 'number' && isFinite(data.value)) ev.value = data.value;
        queue.push(ev);
        if (queue.length >= MAX_QUEUE) flush();
        return ev;
    }

    function flush(skipBuffer) {
        if (queue.length === 0) return;
        var payload = { id: anonId(), sid: sessionId(), fp: fingerprint(), events: queue };
        queue = [];
        var blob;
        try { blob = new Blob([JSON.stringify(payload)], { type: 'application/json' }); } catch (e) { return; }
        try {
            if (navigator.sendBeacon) {
                var sent = navigator.sendBeacon(API_URL + '?action=track', blob);
                if (sent) return;
            }
        } catch (e) {}
        try {
            fetch(API_URL + '?action=track', {
                method: 'POST',
                credentials: 'omit',
                keepalive: true,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }).catch(function () { buffer(payload); });
        } catch (e) { buffer(payload); }
    }

    function buffer(payload) {
        try {
            var raw = safeGet(BUFFER_KEY);
            var arr = raw ? (JSON.parse(raw) || []) : [];
            arr = arr.concat(payload.events || []);
            if (arr.length > 500) arr = arr.slice(-500);
            window.localStorage.setItem(BUFFER_KEY, JSON.stringify(arr));
        } catch (e) {}
    }

    // Periodic flush while page open
    var timerHandles = setInterval(function () {
        if (navigator.onLine === false) return;
        flush();
    }, FLUSH_MS);

    // Flush on hide/unload
    function pageHide() {
        flush();
    }
    if (document.visibilityState !== undefined && document.addEventListener) {
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'hidden') pageHide();
        });
    }
    if (window.addEventListener) {
        window.addEventListener('pagehide', pageHide);
        window.addEventListener('beforeunload', pageHide);
    }

    // Auto page_view on first paint
    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', function () { track('page_view'); });
    } else {
        track('page_view');
    }

    window.dentAnalytics = {
        track: track,
        flush: function () { flush(); },
        getId: anonId,
        getFingerprint: fingerprint,
        getSessionId: sessionId,
        _handles: timerHandles
    };
})();