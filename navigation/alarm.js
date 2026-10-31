(function () {
  var KEY = "pats.watch.alarm";
  var hour = 7;
  var minute = 0;
  var on = false;
  var timer = null;
  var vibeTimer = null;
  var wakeLock = null;

  var nowEl = document.getElementById("now");
  var setEl = document.getElementById("set");
  var hourEl = document.getElementById("hour");
  var minEl = document.getElementById("minute");
  var remainEl = document.getElementById("remain");
  var toggle = document.getElementById("toggle");
  var ring = document.getElementById("ring");

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      hour = data.hour % 24;
      minute = data.minute % 60;
      on = !!data.on;
    } catch (e) { /* 忽略舊資料 */ }
  }

  function save() {
    localStorage.setItem(KEY, JSON.stringify({ hour: hour, minute: minute, on: on }));
    arm();
    render();
  }

  function nextAt(delayMs) {
    if (delayMs) return delayMs;
    var d = new Date();
    d.setSeconds(0, 0);
    d.setHours(hour, minute, 0, 0);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
    return d.getTime() - Date.now();
  }

  function remainLabel() {
    if (!on) return "未設定";
    var ms = nextAt();
    var totalMin = Math.floor(ms / 60000);
    if (totalMin < 1) return "不到 1 分";
    if (totalMin < 60) return "還有 " + totalMin + " 分";
    return "還有 " + Math.floor(totalMin / 60) + " 小時 " + (totalMin % 60) + " 分";
  }

  function render() {
    setEl.textContent = pad(hour) + ":" + pad(minute);
    hourEl.textContent = pad(hour);
    minEl.textContent = pad(minute);
    toggle.textContent = on ? "關閉" : "啟用";
    toggle.classList.toggle("alarm-off", on);
    remainEl.textContent = remainLabel();
  }

  function speak() {
    if (!window.speechSynthesis) return;
    var u = new SpeechSynthesisUtterance("鬧鐘時間到");
    u.lang = "zh-TW";
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  function stopVibe() {
    if (vibeTimer) clearInterval(vibeTimer);
    vibeTimer = null;
    if (navigator.vibrate) navigator.vibrate(0);
  }

  function startVibe() {
    stopVibe();
    if (!navigator.vibrate) return;
    navigator.vibrate([400, 200, 400, 200, 600]);
    vibeTimer = setInterval(function () {
      navigator.vibrate([400, 200, 400, 200, 600]);
    }, 1800);
  }

  function fire() {
    ring.hidden = false;
    speak();
    startVibe();
    if (window.Notification && Notification.permission === "granted") {
      new Notification("PATS 鬧鐘", { body: "鬧鐘時間到", requireInteraction: true });
    }
    if (on) timer = setTimeout(fire, 24 * 60 * 60 * 1000);
  }

  function requestNotify() {
    if (window.Notification && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }

  function keepAwake() {
    if (!on || !navigator.wakeLock || !navigator.wakeLock.request) return;
    navigator.wakeLock.request("screen").then(function (lock) {
      wakeLock = lock;
      lock.addEventListener("release", function () { wakeLock = null; });
    }).catch(function () { /* 瀏覽器可能拒絕 */ });
  }

  function dropAwake() {
    if (wakeLock) {
      wakeLock.release();
      wakeLock = null;
    }
  }

  function arm(delayMs) {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!on) {
      dropAwake();
      return;
    }
    timer = setTimeout(fire, nextAt(delayMs));
    requestNotify();
    keepAwake();
  }

  function toast(msg) {
    var el = document.getElementById("toast");
    el.hidden = false;
    el.textContent = msg;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.hidden = true; }, 2000);
  }

  function hideRing() {
    ring.hidden = true;
    stopVibe();
  }

  document.getElementById("h-minus").onclick = function () { hour = (hour + 23) % 24; save(); };
  document.getElementById("h-plus").onclick = function () { hour = (hour + 1) % 24; save(); };
  document.getElementById("m-minus").onclick = function () { minute = (minute + 59) % 60; save(); };
  document.getElementById("m-plus").onclick = function () { minute = (minute + 1) % 60; save(); };
  toggle.onclick = function () {
    on = !on;
    save();
    if (on) toast("已設定鬧鐘");
  };
  document.getElementById("dismiss").onclick = function () { hideRing(); };
  document.getElementById("snooze").onclick = function () {
    hideRing();
    on = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(fire, 5 * 60 * 1000);
    remainEl.textContent = "還有 5 分";
    toast("5 分鐘後再響");
    keepAwake();
  };

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && on) keepAwake();
  });

  setInterval(function () {
    var d = new Date();
    nowEl.textContent = "現在 " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
    if (ring.hidden) remainEl.textContent = remainLabel();
  }, 1000);

  load();
  render();
  arm();
})();
