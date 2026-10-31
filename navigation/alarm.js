(function () {
  var KEY = "pats.watch.alarm";
  var hour = 7;
  var minute = 0;
  var on = false;
  var timer = null;

  var nowEl = document.getElementById("now");
  var setEl = document.getElementById("set");
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

  function render() {
    setEl.textContent = pad(hour) + ":" + pad(minute);
    toggle.textContent = on ? "關閉" : "啟用";
    toggle.classList.toggle("alarm-off", on);
  }

  function nextAt() {
    var d = new Date();
    d.setSeconds(0, 0);
    d.setHours(hour, minute, 0, 0);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
    return d.getTime() - Date.now();
  }

  function speak() {
    if (!window.speechSynthesis) return;
    var u = new SpeechSynthesisUtterance("鬧鐘時間到");
    u.lang = "zh-TW";
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  function fire() {
    ring.hidden = false;
    speak();
    if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 600]);
    if (window.Notification && Notification.permission === "granted") {
      new Notification("PATS 鬧鐘", { body: "鬧鐘時間到" });
    }
    if (on) timer = setTimeout(fire, 24 * 60 * 60 * 1000);
  }

  function arm() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!on) return;
    timer = setTimeout(fire, nextAt());
    if (window.Notification && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }

  function toast(msg) {
    var el = document.getElementById("toast");
    el.hidden = false;
    el.textContent = msg;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.hidden = true; }, 2000);
  }

  document.getElementById("h-minus").onclick = function () { hour = (hour + 23) % 24; save(); };
  document.getElementById("h-plus").onclick = function () { hour = (hour + 1) % 24; save(); };
  document.getElementById("m-minus").onclick = function () { minute = (minute + 55) % 60; save(); };
  document.getElementById("m-plus").onclick = function () { minute = (minute + 5) % 60; save(); };
  toggle.onclick = function () {
    on = !on;
    save();
    if (on) toast("已設定鬧鐘");
  };
  document.getElementById("dismiss").onclick = function () { ring.hidden = true; };

  setInterval(function () {
    var d = new Date();
    nowEl.textContent = "現在 " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  }, 1000);

  load();
  render();
  arm();
})();
