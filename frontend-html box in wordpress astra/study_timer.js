/* --------------------------------------------------
   GLOBAL MODAL & TIMER CONTROL FUNCTIONS
   -------------------------------------------------- */
window.openDentTimerModal = function() {
  if (typeof window.dentRefreshTimerUI === 'function') {
    window.dentRefreshTimerUI();
  }
  var modal = document.getElementById('dent-timer-modal');
  if (modal) {
    if (modal.parentNode !== document.body) {
      document.body.appendChild(modal);
    }
    modal.style.setProperty('display', 'flex', 'important');
    void modal.offsetWidth; // Force CSS reflow
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
};

window.closeDentTimerModal = function() {
  var modal = document.getElementById('dent-timer-modal');
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
    setTimeout(function() {
      if (!modal.classList.contains('active')) {
        modal.style.setProperty('display', 'none', 'important');
      }
    }, 250);
  }
};

window.closeDentTimerModalOnBgClick = function(e) {
  if (e) {
    if (e.target) {
      if (e.target.id === 'dent-timer-modal') {
        window.closeDentTimerModal();
      }
    }
  }
};

// Global Event Delegation Backup for Banner Click
document.addEventListener('click', function(e) {
  if (!e) return;
  if (!e.target) return;
  var trigger = e.target.closest('#dent-timer-banner-trigger');
  if (!trigger) {
    trigger = e.target.closest('.dent-timer-banner-override');
  }
  if (trigger) {
    if (e.preventDefault) e.preventDefault();
    window.openDentTimerModal();
  }
});

;(function() {
  'use strict';
  if (window.dentTimerScriptLoaded) return;
  window.dentTimerScriptLoaded = true;
  
  var API_URL = (window.location.origin || '') + '/dent2025_api.php';
  var KEY_PIN = 'dent2025_timer_pin';
  var KEY_LOGS = 'dent2025_timer_logs';
  var KEY_POS = 'dent2025_timer_badge_pos';
  var KEY_ACTIVE_SESSION = 'dent2025_timer_active_session';
  
  // Multi-layer persistence helpers for PIN (localStorage + sessionStorage + cookie backup)
  function setPinCookie(name, value, days) {
    try {
      var expires = "";
      if (days) {
        var date = new Date();
        date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
        expires = "; expires=" + date.toUTCString();
      }
      document.cookie = name + "=" + encodeURIComponent(value || "") + expires + "; path=/; SameSite=Lax";
    } catch(e) {}
  }

  function getPinCookie(name) {
    try {
      var nameEQ = name + "=";
      var ca = document.cookie.split(';');
      for (var i = 0; i < ca.length; i++) {
        var c = ca[i];
        while (c.charAt(0) === ' ') c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) === 0) return decodeURIComponent(c.substring(nameEQ.length, c.length));
      }
    } catch(e) {}
    return null;
  }

  function getPersistedPin() {
    var pin = null;
    try { pin = localStorage.getItem(KEY_PIN); } catch(e) {}
    if (!pin || !/^\d{4}$/.test(String(pin).trim())) {
      try { pin = sessionStorage.getItem(KEY_PIN); } catch(e) {}
    }
    if (!pin || !/^\d{4}$/.test(String(pin).trim())) {
      pin = getPinCookie(KEY_PIN);
    }
    if (pin) {
      pin = String(pin).trim();
      if (/^\d{4}$/.test(pin)) {
        try { localStorage.setItem(KEY_PIN, pin); } catch(e) {}
        try { sessionStorage.setItem(KEY_PIN, pin); } catch(e) {}
        setPinCookie(KEY_PIN, pin, 365);
        return pin;
      }
    }
    return '';
  }

  function persistPin(val) {
    if (!val) return;
    val = String(val).trim();
    try { localStorage.setItem(KEY_PIN, val); } catch(e) {}
    try { sessionStorage.setItem(KEY_PIN, val); } catch(e) {}
    setPinCookie(KEY_PIN, val, 365);
  }

  function updatePinDisplay(customPin) {
    var pin = (customPin !== undefined && customPin !== null) ? String(customPin).trim() : (state.pin || getPersistedPin());
    if (pin && /^\d{4}$/.test(pin)) {
      state.pin = pin;
    }
    var pinText = state.pin ? state.pin : '----';

    // Update all matching elements across the DOM in case of cloned/duplicate containers
    var displays = document.querySelectorAll('#dent-pin-display, .dent-pin-display-text');
    for (var i = 0; i < displays.length; i++) {
      if (displays[i]) {
        displays[i].textContent = pinText;
      }
    }

    var badge = $('dent-pin-badge') || document.querySelector('.dent-study-pin-badge');
    if (badge) {
      if (state.pin) {
        badge.setAttribute('title', 'رمز السجل الحالي: ' + state.pin + ' (انقر للإدارة أو التغيير)');
      } else {
        badge.setAttribute('title', 'انقر لتعيين رمز السجل أو المزامنة من جهاز آخر');
      }
    }

    var manageCurrent = $('dent-manage-current-pin') || document.getElementById('dent-manage-current-pin');
    if (manageCurrent) {
      manageCurrent.textContent = pinText;
    }
  }
  
  var state = { 
    pin: '', 
    interval: null, 
    seconds: 0, 
    running: false, 
    logs: [], 
    targetHours: 2.0,
    segmentStartTime: 0,
    secondsAtSegmentStart: 0
  };
  var els = {};
  
  var isInitialized = false;
  var isSyncMode = false;
  var manageMode = 'change';

  function $(id) { return document.getElementById(id); }


  function cleanupDuplicates() {
    try {
      var isHome = window.location.pathname === '/' || document.body.classList.contains('home') || document.body.classList.contains('front-page');
      var banners = document.querySelectorAll('.dent-timer-banner-override');
      if (!isHome) {
        // Hide large banner on inner subpages since only floating draggable badge is meant for subpages
        for (var h = 0; h < banners.length; h++) {
          if (banners[h]) banners[h].style.setProperty('display', 'none', 'important');
        }
      } else if (banners.length > 1) {
        for (var k = 1; k < banners.length; k++) {
          if (banners[k] && banners[k].parentNode) {
            banners[k].parentNode.removeChild(banners[k]);
          }
        }
      }
      var badges = document.querySelectorAll('.dent-timer-draggable-badge');
      if (badges.length > 1) {
        for (var i = 1; i < badges.length; i++) {
          if (badges[i] && badges[i].parentNode) {
            badges[i].parentNode.removeChild(badges[i]);
          }
        }
      }
      var modals = document.querySelectorAll('.dent-timer-modal-overlay');
      if (modals.length > 1) {
        for (var j = 1; j < modals.length; j++) {
          if (modals[j] && modals[j].parentNode) {
            modals[j].parentNode.removeChild(modals[j]);
          }
        }
      }
    } catch(e) {}
  }

  function getEls() {
    if (!els.clockDigits || !document.body.contains(els.clockDigits)) {
      els = {
        modalOverlay: $('dent-timer-modal'), 
        pulseHome: $('dent-banner-pulse-homepage'), 
        pulseBadge: $('dent-banner-pulse-badge'), 
        bannerSubtitle: $('dent-banner-subtitle'),
        dragBadge: $('dent-draggable-badge'), 
        miniClock: $('dent-mini-clock'), 
        miniSubject: $('dent-mini-subject'),
        pinDisplay: $('dent-pin-display'), 
        btnStart: $('dent-btn-start'), 
        pinBadge: $('dent-pin-badge'),
        clockDigits: $('dent-clock-digits'), 
        btnFinish: $('dent-btn-finish'), 
        btnReset: $('dent-btn-reset'),
        subjectInput: $('dent-subject-input'),
        goalCurrent: $('dent-goal-current'), 
        goalTarget: $('dent-goal-target'), 
        goalPct: $('dent-goal-pct'),
        goalFill: $('dent-goal-fill'), 
        statToday: $('dent-stat-today'), 
        statYesterday: $('dent-stat-yesterday'),
        statAllTime: $('dent-stat-all-time'),
        statStreak: $('dent-stat-streak'), 
        settingGoal: $('dent-setting-goal'), 
        logsContainer: $('dent-logs-container'),
        manSubject: $('dent-man-subject'), 
        manDate: $('dent-man-date'), 
        manHours: $('dent-man-hours'),
        manMins: $('dent-man-mins'), 
        btnManualSave: $('dent-btn-manual-save'), 
        tabsBar: $('dent-study-tabs-bar'),
        setupCard: $('dent-pin-setup-card'), 
        setupInput: $('dent-setup-pin-input'),
        btnSavePin: $('dent-btn-save-pin'), 
        setupError: $('dent-setup-pin-error'), 
        linkSync: $('dent-link-sync-existing'),
        setupSubtitle: $('dent-setup-pin-subtitle'), 
        manageCard: $('dent-pin-manage-card'), 
        manageInput: $('dent-manage-pin-input'),
        btnConfirmManage: $('dent-btn-confirm-manage'), 
        btnCancelManage: $('dent-btn-cancel-manage'),
        btnModeChange: $('dent-btn-mode-change'), 
        btnModeDitch: $('dent-btn-mode-ditch'),
        manageCurrentPin: $('dent-manage-current-pin'), 
        manageError: $('dent-manage-pin-error'), 
        manageSubtext: $('dent-manage-subtext'),
        pinInfoBar: $('dent-study-pin-info-bar')
      };
    }
    return els;
  }

  function convertEasternToWesternDigits(str) {
    if (!str) return '';
    var easternDigits = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
    var westernDigits = ['0','1','2','3','4','5','6','7','8','9'];
    var res = String(str);
    for (var i = 0; i < 10; i++) {
      res = res.replace(new RegExp(easternDigits[i], 'g'), westernDigits[i]);
    }
    return res;
  }

  function getLocalDateStr(d) {
    var dateObj = d || new Date();
    var y = dateObj.getFullYear();
    var m = String(dateObj.getMonth() + 1).padStart(2, '0');
    var day = String(dateObj.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function saveActiveSessionState() {
    try {
      var elements = getEls();
      var sub = elements.subjectInput ? elements.subjectInput.value : '';
      localStorage.setItem(KEY_ACTIVE_SESSION, JSON.stringify({
        running: state.running,
        startTime: state.segmentStartTime || Date.now(),
        accumulatedSeconds: state.secondsAtSegmentStart || 0,
        seconds: state.seconds,
        subject: sub
      }));
    } catch(e) {}
  }

  function setPulseDisplay(show) {
    var elements = getEls();
    var val = show ? 'inline-block' : 'none';
    if (elements.pulseHome) { elements.pulseHome.style.setProperty('display', val, 'important'); }
    if (elements.pulseBadge) { elements.pulseBadge.style.setProperty('display', val, 'important'); }
    if (elements.dragBadge) {
      var isTimerActive = false;
      if (show) {
        isTimerActive = true;
      } else if (state.seconds > 0) {
        isTimerActive = true;
      }

      if (isTimerActive) {
        elements.dragBadge.style.setProperty('display', 'flex', 'important');
        if (show) {
          elements.dragBadge.classList.add('active-timer');
        } else {
          elements.dragBadge.classList.remove('active-timer');
        }
      } else {
        elements.dragBadge.style.setProperty('display', 'none', 'important');
        elements.dragBadge.classList.remove('active-timer');
      }
    }
  }

  function stopTimerEngine() {
    var elements = getEls();
    state.running = false;
    if (state.interval) {
      clearInterval(state.interval);
      state.interval = null;
    }
    var btn = elements.btnStart || $('dent-btn-start');
    if (btn) {
      if (state.seconds > 0) {
        btn.textContent = 'متابعة';
      } else {
        btn.textContent = 'بدء';
      }
    }
    setPulseDisplay(false);
    if (state.seconds === 0) {
      try { localStorage.removeItem(KEY_ACTIVE_SESSION); } catch(e) {}
    } else {
      saveActiveSessionState();
    }
    updateClock();
  }

  function startTimerEngine(isAutoResume) {
    var elements = getEls();
    state.running = true;
    if (!isAutoResume) {
      state.segmentStartTime = Date.now();
      state.secondsAtSegmentStart = state.seconds;
    }
    if (state.interval) { clearInterval(state.interval); }
    state.interval = setInterval(function() { 
      var now = Date.now();
      var elapsed = Math.floor((now - state.segmentStartTime) / 1000);
      state.seconds = state.secondsAtSegmentStart + Math.max(0, elapsed);
      updateClock(); 
    }, 1000);

    var btn = elements.btnStart || $('dent-btn-start');
    if (btn) btn.textContent = 'إيقاف مؤقت';
    setPulseDisplay(true);
    updateMiniBadgeSubject();
    updateClock();
    saveActiveSessionState();
  }

  var isRestoringSession = false;
  function restoreActiveSessionState() {
    if (isRestoringSession) return;
    isRestoringSession = true;
    try {
      var elements = getEls();
      var raw = localStorage.getItem(KEY_ACTIVE_SESSION);
      if (!raw) {
        state.running = false;
        if (state.interval) { clearInterval(state.interval); state.interval = null; }
        state.seconds = 0;
        state.segmentStartTime = 0;
        state.secondsAtSegmentStart = 0;
        var btn = elements.btnStart || $('dent-btn-start');
        if (btn) btn.textContent = 'بدء';
        setPulseDisplay(false);
        updateClock();
        return;
      }
      var parsed = JSON.parse(raw);
      if (parsed) {
        if (parsed.subject && elements.subjectInput) {
          elements.subjectInput.value = parsed.subject;
        }
        if (parsed.running) {
          var now = Date.now();
          var elapsed = Math.floor((now - parsed.startTime) / 1000);
          state.seconds = (parsed.accumulatedSeconds || 0) + Math.max(0, elapsed);
          state.segmentStartTime = parsed.startTime;
          state.secondsAtSegmentStart = parsed.accumulatedSeconds || 0;
          startTimerEngine(true);
        } else {
          state.seconds = parsed.seconds || 0;
          stopTimerEngine();
        }
      }
    } catch(e) {} finally {
      isRestoringSession = false;
    }
  }

  function toggleTimer() {
    init(); // Guarantee init() has completed
    if (state.running) {
      stopTimerEngine();
    } else {
      startTimerEngine(false);
    }
  }

  function finishTimer() {
    init();
    var elements = getEls();
    var sub = 'مذاكرة';
    if (elements.subjectInput && elements.subjectInput.value) {
      sub = elements.subjectInput.value;
    }
    if (state.seconds > 0) {
      addLog(sub, state.seconds, 'stopwatch');
    }
    state.seconds = 0; 
    state.segmentStartTime = 0;
    state.secondsAtSegmentStart = 0;
    stopTimerEngine();
    try { localStorage.removeItem(KEY_ACTIVE_SESSION); } catch(e) {}
    if (elements.subjectInput) { elements.subjectInput.value = ''; }
    updateClock();
    setPulseDisplay(false);
  }

  function resetTimer() {
    init();
    state.seconds = 0; 
    state.segmentStartTime = 0;
    state.secondsAtSegmentStart = 0;
    stopTimerEngine();
    try { localStorage.removeItem(KEY_ACTIVE_SESSION); } catch(e) {}
    var elements = getEls();
    if (elements.subjectInput) { elements.subjectInput.value = ''; }
    updateClock();
    setPulseDisplay(false);
  }

  // Expose global button triggers
  window.dentToggleTimer = toggleTimer;
  window.dentFinishTimer = finishTimer;
  window.dentResetTimer = resetTimer;
  window.dentRefreshTimerUI = function() {
    cleanupDuplicates();
    init();
    var pin = getPersistedPin();
    if (pin) {
      state.pin = pin;
      updatePinDisplay(pin);
      hidePinSetupCard();
    } else {
      state.pin = '';
      updatePinDisplay('');
      showPinSetupCard();
    }
    render();
  };

  function init() {
    cleanupDuplicates();
    if (isInitialized) return;
    isInitialized = true;
    
    // Lazy cache DOM elements
    getEls();

    function attachTimerBanner() {
      var timerBanner = $('dent-timer-banner-trigger');
      if (!timerBanner) return;

      var gpaBanner = document.querySelector('.gpa-banner:not(.dent-timer-banner-override)');
      if (!gpaBanner) {
        gpaBanner = document.getElementById('gpa-banner-trigger');
      }

      if (gpaBanner) {
        timerBanner.style.setProperty('display', 'flex', 'important');
        if (timerBanner.nextElementSibling !== gpaBanner) {
          if (gpaBanner.parentNode) {
            gpaBanner.parentNode.insertBefore(timerBanner, gpaBanner);
          }
        }
      } else {
        timerBanner.style.setProperty('display', 'none', 'important');
      }
    }

    attachTimerBanner();
    setTimeout(attachTimerBanner, 100);
    setTimeout(attachTimerBanner, 500);
    setTimeout(attachTimerBanner, 1500);

    // Always move floating elements to document.body so theme layout containers never clip them
    if (els.dragBadge) {
      if (els.dragBadge.parentNode !== document.body) {
        document.body.appendChild(els.dragBadge);
      }
    }
    if (els.modalOverlay) {
      if (els.modalOverlay.parentNode !== document.body) {
        document.body.appendChild(els.modalOverlay);
      }
    }

    // Draggable Badge Setup
    initDraggableBadge();

    loadLocal();
    if (els.manDate) { els.manDate.value = getLocalDateStr(); }

    if (els.btnStart) { els.btnStart.onclick = toggleTimer; }
    if (els.btnFinish) { els.btnFinish.onclick = finishTimer; }
    if (els.btnReset) { els.btnReset.onclick = resetTimer; }
    if (els.pinBadge) { els.pinBadge.onclick = openPinManageCard; }
    if (els.btnManualSave) { els.btnManualSave.onclick = saveManual; }
    if (els.btnSavePin) { els.btnSavePin.onclick = handlePinSubmit; }

    var inputsToListen = [els.setupInput, els.manageInput];
    inputsToListen.forEach(function(el) {
      if (!el) return;
      el.addEventListener('input', function() { this.value = convertEasternToWesternDigits(this.value); });
      el.addEventListener('keydown', function(e) { 
        if (e.key === 'Enter') {
          if (el === els.setupInput) { handlePinSubmit(); } else { handleManageSubmit(); }
        }
      });
    });

    if (els.btnConfirmManage) { els.btnConfirmManage.onclick = handleManageSubmit; }
    if (els.btnCancelManage) { els.btnCancelManage.onclick = closePinManageCard; }
    
    if (els.btnModeChange) { els.btnModeChange.onclick = function() { manageMode = 'change'; toggleManageUI(true); }; }
    if (els.btnModeDitch) { els.btnModeDitch.onclick = function() { manageMode = 'ditch'; toggleManageUI(false); }; }
    
    if (els.linkSync) {
      els.linkSync.onclick = function(e) {
        if (e) e.preventDefault();
        if (isSyncMode) {
          isSyncMode = false;
        } else {
          isSyncMode = true;
        }
        if (isSyncMode) {
          if (els.setupSubtitle) { els.setupSubtitle.textContent = 'أدخل الرمز المكون من 4 أرقام الخاص بك للمزامنة:'; }
          this.textContent = 'إنشاء رمز جديد من 4 أرقام';
        } else {
          if (els.setupSubtitle) { els.setupSubtitle.textContent = 'أدخل 4 أرقام لحفظ ومزامنة سجل مذاكرتك:'; }
          this.textContent = 'لديك رمز من 4 أرقام من جهاز آخر؟ اضغط للمزامنة';
        }
        if (els.setupError) { els.setupError.style.display = 'none'; }
      };
    }

    if (els.settingGoal) { els.settingGoal.onchange = function() { state.targetHours = parseFloat(this.value) || 2.0; syncPush(); render(); }; }
    
    if (els.tabsBar) {
      els.tabsBar.onclick = function(e) { 
        var tab = e.target.closest('.dent-study-tab'); 
        if (tab) { switchTab(tab.getAttribute('data-tab')); } 
      };
    }
    
    if (els.logsContainer) {
      els.logsContainer.onclick = function(e) { 
        var btn = e.target.closest('.dent-study-delete-btn'); 
        if (btn) { deleteLog(btn.getAttribute('data-log-id')); } 
      };
    }

    if (els.subjectInput) {
      els.subjectInput.oninput = function() {
        updateMiniBadgeSubject();
        saveActiveSessionState();
      };
    }

    render();
    if (setupPIN()) {
      syncGet();
    }

    // Always restore active session regardless of PIN status
    restoreActiveSessionState();
  }

  /* --------------------------------------------------
     DRAGGABLE & ADJUSTABLE FLOATING BADGE ENGINE
     -------------------------------------------------- */
  function initDraggableBadge() {
    var elements = getEls();
    var badge = elements.dragBadge || $('dent-draggable-badge');
    if (!badge) return;

    // Restore saved position
    try {
      var pos = localStorage.getItem(KEY_POS);
      if (pos) {
        var parsed = JSON.parse(pos);
        if (parsed.top !== undefined && parsed.left !== undefined) {
          var maxL = Math.max(10, window.innerWidth - 65);
          var maxT = Math.max(10, window.innerHeight - 65);
          var safeL = Math.min(Math.max(10, parsed.left), maxL);
          var safeT = Math.min(Math.max(10, parsed.top), maxT);
          badge.style.top = safeT + 'px';
          badge.style.left = safeL + 'px';
          badge.style.bottom = 'auto';
          badge.style.right = 'auto';
        }
      } else {
        // Default position: bottom-left
        badge.style.bottom = '20px';
        badge.style.left = '20px';
      }
    } catch(e) {}

    var isDragging = false;
    var startX = 0, startY = 0;
    var initialLeft = 0, initialTop = 0;
    var hasMoved = false;

    function onStart(e) {
      var clientX = e.touches ? e.touches[0].clientX : e.clientX;
      var clientY = e.touches ? e.touches[0].clientY : e.clientY;

      isDragging = true;
      hasMoved = false;
      startX = clientX;
      startY = clientY;

      var rect = badge.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;

      document.addEventListener('mousemove', onMove, { passive: false });
      document.addEventListener('mouseup', onEnd);
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onEnd);
    }

    function onMove(e) {
      if (!isDragging) return;
      var clientX = e.touches ? e.touches[0].clientX : e.clientX;
      var clientY = e.touches ? e.touches[0].clientY : e.clientY;

      var deltaX = clientX - startX;
      var deltaY = clientY - startY;

      if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) {
        hasMoved = true;
      }

      if (hasMoved) {
        if (e.cancelable) e.preventDefault();
        var newLeft = Math.max(10, Math.min(window.innerWidth - badge.offsetWidth - 10, initialLeft + deltaX));
        var newTop = Math.max(10, Math.min(window.innerHeight - badge.offsetHeight - 10, initialTop + deltaY));

        badge.style.left = newLeft + 'px';
        badge.style.top = newTop + 'px';
        badge.style.bottom = 'auto';
        badge.style.right = 'auto';
      }
    }

    function onEnd() {
      if (!isDragging) return;
      isDragging = false;

      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onEnd);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);

      if (hasMoved) {
        var rect = badge.getBoundingClientRect();
        try {
          localStorage.setItem(KEY_POS, JSON.stringify({ top: Math.round(rect.top), left: Math.round(rect.left) }));
        } catch(e) {}
      } else {
        // Click action: open popup modal
        window.openDentTimerModal();
      }
    }

    badge.addEventListener('mousedown', onStart);
    badge.addEventListener('touchstart', onStart, { passive: true });
  }

  function updateMiniBadgeSubject() {
    var elements = getEls();
    var miniSubject = elements.miniSubject || $('dent-mini-subject');
    var subjectInput = elements.subjectInput || $('dent-subject-input');
    if (!miniSubject) return;
    var val = '';
    if (subjectInput) {
      val = (subjectInput.value || '').trim();
    }
    if (val) {
      miniSubject.textContent = '• ' + val;
      miniSubject.style.display = 'inline';
    } else {
      miniSubject.style.display = 'none';
    }
  }

  function toggleManageUI(isChange) {
    var elements = getEls();
    if (isChange) {
      if (elements.btnModeChange) { elements.btnModeChange.classList.add('dent-tab-active'); }
      if (elements.btnModeDitch) { elements.btnModeDitch.classList.remove('dent-tab-active'); }
      if (elements.manageSubtext) { elements.manageSubtext.textContent = 'أدخل 4 أرقام جديدة لرمزك:'; }
    } else {
      if (elements.btnModeChange) { elements.btnModeChange.classList.remove('dent-tab-active'); }
      if (elements.btnModeDitch) { elements.btnModeDitch.classList.add('dent-tab-active'); }
      if (elements.manageSubtext) { elements.manageSubtext.textContent = 'أدخل الرمز المكون من 4 أرقام من جهازك الآخر للدخول به:'; }
    }
    if (elements.manageError) elements.manageError.style.display = 'none';
  }

  function setupPIN() {
    var pin = getPersistedPin();
    var isValid = Boolean(pin && pin.length === 4 && /^\d{4}$/.test(pin));
    
    if (!isValid) { 
      state.pin = '';
      updatePinDisplay('');
      showPinSetupCard(); 
      return false; 
    }
    state.pin = pin;
    updatePinDisplay(pin);
    hidePinSetupCard();
    return true;
  }

  function showPinSetupCard() {
    var elements = getEls();
    if (elements.setupCard) { elements.setupCard.style.display = 'block'; }
    if (elements.tabsBar) { elements.tabsBar.style.display = 'none'; }
    if (elements.pinInfoBar) { elements.pinInfoBar.style.display = 'none'; }
    var content = document.querySelector('.dent-study-content');
    if (content) { content.style.display = 'none'; }
    updatePinDisplay('');
  }

  function hidePinSetupCard() {
    var elements = getEls();
    if (elements.setupCard) { elements.setupCard.style.display = 'none'; }
    if (elements.tabsBar) { elements.tabsBar.style.display = 'flex'; }
    if (elements.pinInfoBar) { elements.pinInfoBar.style.display = 'flex'; }
    var content = document.querySelector('.dent-study-content');
    if (content) { content.style.display = 'block'; }
    updatePinDisplay();
  }

  function openPinManageCard() {
    init();
    updatePinDisplay();
    var elements = getEls();
    if (!state.pin) { showPinSetupCard(); return; }
    var manageCurrent = $('dent-manage-current-pin') || document.getElementById('dent-manage-current-pin');
    if (manageCurrent) manageCurrent.textContent = state.pin;
    if (elements.manageCard) { elements.manageCard.style.display = 'block'; }
    if (elements.tabsBar) { elements.tabsBar.style.display = 'none'; }
    if (elements.pinInfoBar) { elements.pinInfoBar.style.display = 'none'; }
    var content = document.querySelector('.dent-study-content');
    if (content) { content.style.display = 'none'; }
  }

  function closePinManageCard() {
    var elements = getEls();
    if (elements.manageCard) { elements.manageCard.style.display = 'none'; }
    if (elements.tabsBar) { elements.tabsBar.style.display = 'flex'; }
    if (elements.pinInfoBar) { elements.pinInfoBar.style.display = 'flex'; }
    var content = document.querySelector('.dent-study-content');
    if (content) { content.style.display = 'block'; }
    updatePinDisplay();
  }

  function handlePinSubmit() {
    var elements = getEls();
    var val = convertEasternToWesternDigits(elements.setupInput.value).replace(/[^0-9]/g, '');
    if (val.length !== 4) {
      if (elements.setupError) {
        elements.setupError.textContent = 'يرجى إدخال 4 أرقام';
        elements.setupError.style.display = 'block';
      }
      return;
    }
    var m = 'create';
    if (isSyncMode) { m = 'sync'; }
    fetch(API_URL + '?action=study_check_pin', { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: val, mode: m }) 
    })
    .then(function(r) { return r.json(); })
    .then(function(res) {
      if (!res.success) {
        if (elements.setupError) {
          elements.setupError.textContent = res.message;
          elements.setupError.style.display = 'block';
        }
        return;
      }
      state.pin = val; 
      persistPin(val);
      updatePinDisplay(val);
      if (res.data) {
        if (res.data.logs) {
          state.logs = res.data.logs;
        }
        if (res.data.target_minutes) {
          state.targetHours = res.data.target_minutes / 60;
        }
      }
      hidePinSetupCard(); 
      render(); 
      syncPush();
    })
    .catch(function(err) {
      if (elements.setupError) {
        elements.setupError.textContent = 'تعذر الاتصال بالخادم. يرجى المحاولة لاحقاً.';
        elements.setupError.style.display = 'block';
      }
    });
  }

  function handleManageSubmit() {
    var elements = getEls();
    var val = convertEasternToWesternDigits(elements.manageInput.value).replace(/[^0-9]/g, '');
    if (val.length !== 4) {
      if (elements.manageError) {
        elements.manageError.textContent = 'يرجى إدخال 4 أرقام';
        elements.manageError.style.display = 'block';
      }
      return;
    }
    
    var amp = String.fromCharCode(38);
    
    if (manageMode === 'ditch') {
      fetch(API_URL + '?action=study_get_data' + amp + 'pin=' + encodeURIComponent(val))
      .then(function(r) { return r.json(); })
      .then(function(res) {
        if (res.success) { 
          state.pin = val; 
          persistPin(val);
          updatePinDisplay(val);
          if (res.data) {
            if (res.data.logs) {
              state.logs = res.data.logs;
            } else {
              state.logs = [];
            }
          }
          saveLocal(); 
          closePinManageCard(); 
          render(); 
        } else {
          if (elements.manageError) {
            elements.manageError.textContent = res.message || 'فشل في استرداد بيانات الرمز';
            elements.manageError.style.display = 'block';
          }
        }
      })
      .catch(function(err) {
        if (elements.manageError) {
          elements.manageError.textContent = 'تعذر الاتصال بالخادم';
          elements.manageError.style.display = 'block';
        }
      });
    } else {
      fetch(API_URL + '?action=study_change_pin', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_pin: state.pin, new_pin: val, logs: state.logs, mode: manageMode }) 
      })
      .then(function(r) { return r.json(); })
      .then(function(res) { 
        if (res.success) { 
          state.pin = val; 
          persistPin(val);
          updatePinDisplay(val);
          saveLocal(); 
          closePinManageCard(); 
          render(); 
        } else {
          if (elements.manageError) {
            elements.manageError.textContent = res.message || 'الرمز مستخدم بالفعل';
            elements.manageError.style.display = 'block';
          }
        }
      })
      .catch(function(err) {
        if (elements.manageError) {
          elements.manageError.textContent = 'تعذر الاتصال بالخادم';
          elements.manageError.style.display = 'block';
        }
      });
    }
  }

  function syncGet() {
    var pin = state.pin || getPersistedPin();
    if (!pin) return;
    state.pin = pin;
    updatePinDisplay(pin);
    var amp = String.fromCharCode(38);
    fetch(API_URL + '?action=study_get_data' + amp + 'pin=' + encodeURIComponent(state.pin))
    .then(function(r) { return r.json(); })
    .then(function(res) {
      if (res.success) {
        if (res.data) { 
          if (res.data.logs) {
            state.logs = res.data.logs; 
          } else {
            state.logs = [];
          }
          if (res.data.target_minutes) {
            state.targetHours = res.data.target_minutes / 60; 
          } else {
            state.targetHours = 2;
          }
          saveLocal(); 
          render(); 
        }
      }
    })
    .catch(function(e) {});
  }

  function syncPush() {
    if (!state.pin) return;
    fetch(API_URL + '?action=study_sync_data', { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: state.pin, target_minutes: Math.round(state.targetHours * 60), logs: state.logs }) 
    }).catch(function(e) {});
  }

  function saveLocal() {
    try {
      localStorage.setItem(KEY_LOGS, JSON.stringify(state.logs));
      if (state.pin) {
        persistPin(state.pin);
      }
    } catch(e) {}
  }
  function loadLocal() {
    try {
      var l = localStorage.getItem(KEY_LOGS);
      if (l) { state.logs = JSON.parse(l); }
      var p = getPersistedPin();
      if (p) {
        state.pin = p;
        updatePinDisplay(p);
        hidePinSetupCard();
      }
    } catch(e) {}
  }

    function formatDuration(totalSeconds) {
    var s = Math.max(0, parseInt(totalSeconds, 10) || 0);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
  }

    function formatDuration(totalSeconds) {
    var s = Math.max(0, parseInt(totalSeconds, 10) || 0);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  function updateClock() {
    var elements = getEls();
    var timeFormatted = formatDuration(state.seconds);

    var clockDigits = elements.clockDigits || $('dent-clock-digits');
    var miniClock = elements.miniClock || $('dent-mini-clock');
    var bannerSubtitle = elements.bannerSubtitle || $('dent-banner-subtitle');
    var subjectInput = elements.subjectInput || $('dent-subject-input');

    if (clockDigits) clockDigits.textContent = timeFormatted;
    if (miniClock) miniClock.textContent = timeFormatted;
    if (bannerSubtitle) {
      if (state.running) {
        var subVal = (subjectInput ? subjectInput.value : '') || 'مذاكرة';
        bannerSubtitle.textContent = 'جاري تسجيل الجلسة كـ ' + subVal + ' (' + timeFormatted + ')';
      } else {
        bannerSubtitle.textContent = 'تتبع ساعات الدراسة، إحصائيات التركيز، والمزامنة عبر الأجهزة (رمز السجل)';
      }
    }
  }

  function saveManual() {
    var elements = getEls();
    var sub = 'يدوي';
    if (elements.manSubject) {
      if (elements.manSubject.value) {
        sub = elements.manSubject.value;
      }
    }
    var dStr = '';
    if (elements.manDate) { dStr = elements.manDate.value; }
    
    var h = 0;
    if (elements.manHours) { h = parseInt(elements.manHours.value) || 0; }
    
    var ms = 0;
    if (elements.manMins) { ms = parseInt(elements.manMins.value) || 0; }
    
    var secs = (h * 3600) + (ms * 60);
    if (secs <= 0) { alert('أدخل مدة صحيحة'); return; }
    
    addLog(sub, secs, 'manual', dStr);
    
    if (elements.manSubject) { elements.manSubject.value = ''; }
    if (elements.manHours) { elements.manHours.value = '1'; }
    if (elements.manMins) { elements.manMins.value = '0'; }
    switchTab('history');
  }

  function switchTab(t) {
    var tabs = document.querySelectorAll('.dent-study-tab');
    for (var i = 0; i < tabs.length; i++) { tabs[i].classList.remove('dent-tab-active'); }
    var panes = document.querySelectorAll('.dent-study-tab-pane');
    for (var j = 0; j < panes.length; j++) { panes[j].classList.remove('dent-tab-active'); }
    
    var tNode = document.querySelector('.dent-study-tab[data-tab="' + t + '"]');
    if (tNode) { tNode.classList.add('dent-tab-active'); }
    var pNode = $('dent-tab-' + t);
    if (pNode) { pNode.classList.add('dent-tab-active'); }
  }

  function escapeHTML(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str || ''));
    return div.innerHTML;
  }

  function addLog(sub, secs, type, dateStr) {
    var dStr = dateStr;
    if (!dStr) { dStr = getLocalDateStr(); }
    state.logs.unshift({ id: 'l_' + Date.now(), subject: sub, durationSeconds: secs, timestamp: Date.now(), dateStr: dStr, type: type });
    saveLocal(); 
    syncPush(); 
    render();
  }

  function deleteLog(id) { 
    if (confirm('حذف الجلسة؟')) { 
      var newLogs = [];
      for (var i = 0; i < state.logs.length; i++) {
        if (state.logs[i].id !== id) {
          newLogs.push(state.logs[i]);
        }
      }
      state.logs = newLogs;
      saveLocal(); 
      syncPush(); 
      render(); 
    } 
  }

  function render() {
    updatePinDisplay();
    var elements = getEls();
    var today = getLocalDateStr();
    var yestD = new Date();
    yestD.setDate(yestD.getDate() - 1);
    var yest = getLocalDateStr(yestD);

    var tSec = 0, ySec = 0, allSec = 0;
    for (var j = 0; j < state.logs.length; j++) {
      allSec += state.logs[j].durationSeconds;
      if (state.logs[j].dateStr === today) { tSec += state.logs[j].durationSeconds; }
      if (state.logs[j].dateStr === yest) { ySec += state.logs[j].durationSeconds; }
    }

    var tHr = tSec / 3600;
    if (elements.statToday) { elements.statToday.textContent = tHr.toFixed(1) + ' س'; }
    if (elements.statYesterday) { elements.statYesterday.textContent = (ySec / 3600).toFixed(1) + ' س'; }
    if (elements.statAllTime) { elements.statAllTime.textContent = (allSec / 3600).toFixed(1) + ' س'; }

    if (elements.goalCurrent) { elements.goalCurrent.textContent = tHr.toFixed(1); }
    if (elements.goalTarget) { elements.goalTarget.textContent = state.targetHours; }
    if (elements.settingGoal) { elements.settingGoal.value = state.targetHours; }

    var pct = 0;
    if (state.targetHours > 0) {
      pct = Math.min(100, (tHr / state.targetHours) * 100);
    }
    if (elements.goalPct) { elements.goalPct.textContent = Math.round(pct) + '%'; }
    if (elements.goalFill) { elements.goalFill.style.width = pct + '%'; }

    var streak = 0;
    var chk = new Date();
    var dateSet = {};
    for (var k = 0; k < state.logs.length; k++) {
      dateSet[state.logs[k].dateStr] = true;
    }
    for (var i = 0; i < 365; i++) {
      var ds = getLocalDateStr(chk);
      if (dateSet[ds]) { 
        streak++; 
        chk.setDate(chk.getDate() - 1); 
      } else {
        if (i === 0) {
          if (ds === today) {
            chk.setDate(chk.getDate() - 1);
          } else {
            break;
          }
        } else {
          break;
        }
      }
    }
    if (elements.statStreak) { elements.statStreak.textContent = streak; }

    if (elements.logsContainer) {
      if (state.logs.length === 0) {
        elements.logsContainer.innerHTML = '<div style="color:var(--dent-timer-text-secondary); font-size:0.85rem; text-align:center; padding: 20px;">لا يوجد سجل</div>';
      } else {
        var html = '';
        for (var x = 0; x < state.logs.length; x++) {
          var l = state.logs[x];
          
          var sh = Math.floor(l.durationSeconds / 3600);
          var sm = Math.floor((l.durationSeconds % 3600) / 60);
          var ssec = l.durationSeconds % 60;
          var shStr = sh < 10 ? '0' + sh : '' + sh;
          var smStr = sm < 10 ? '0' + sm : '' + sm;
          var ssecStr = ssec < 10 ? '0' + ssec : '' + ssec;
          var dFormat = shStr + ':' + smStr + ':' + ssecStr;

          html += '<div class="dent-study-log-item">' +
            '<div class="dent-study-log-info">' +
              '<span class="dent-study-log-title">' + escapeHTML(l.subject) + '</span>' +
              '<span class="dent-study-log-meta">' + escapeHTML(l.dateStr) + '</span>' +
            '</div>' +
            '<div style="display:flex; align-items:center; gap:12px;">' +
              '<span class="dent-study-log-duration">' + dFormat + '</span>' +
              '<button class="dent-study-delete-btn" data-log-id="' + escapeHTML(l.id) + '">' +
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>' +
              '</button>' +
            '</div>' +
          '</div>';
        }
        elements.logsContainer.innerHTML = html;
      }
    }
  }

  // Synchronize pause/stop/logs/pin across tabs
  window.addEventListener('storage', function(e) {
    if (e) {
      if (e.key === KEY_ACTIVE_SESSION) {
        restoreActiveSessionState();
      } else if (e.key === KEY_LOGS || e.key === KEY_PIN) {
        loadLocal();
        updatePinDisplay();
        render();
      }
    }
  });

  // --- BULLETPROOF INITIALIZATION ---
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  window.addEventListener('load', init);

})();
