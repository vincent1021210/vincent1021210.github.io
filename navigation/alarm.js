(function () {
  var KEY = "pats.watch.alarms";
  var items = [];
  var nextId = 1;
  var editing = null;
  var pickHour = 7;
  var pickMinute = 0;
  var pickHourMode = true;
  var timer = null;
  var vibeTimer = null;
  var wakeLock = null;
  var ringingId = -1;

  var cards = document.getElementById("cards");
  var daysEl = document.getElementById("days");
  var dial = document.getElementById("dial");
  var ring = document.getElementById("ring");
  var dayNames = ["日", "一", "二", "三", "四", "五", "六"];
  var dayFull = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) {
        var old = localStorage.getItem("pats.watch.alarm");
        if (old) {
          var o = JSON.parse(old);
          items = [{ id: 1, hour: o.hour % 24, minute: o.minute % 60, on: !!o.on, days: [] }];
          nextId = 2;
          return;
        }
        return;
      }
      var data = JSON.parse(raw);
      items = data.items || [];
      nextId = data.nextId || 1;
    } catch (e) { items = []; }
  }

  function save() {
    localStorage.setItem(KEY, JSON.stringify({ items: items, nextId: nextId }));
    arm();
  }

  function labelOf(item) {
    var days = (item.days || []).slice().sort(function (a, b) { return a - b; });
    if (!days.length) return "未指定";
    if (days.join() === "1,2,3,4,5") return "週一到週五";
    if (days.join() === "0,6") return "週日週六";
    return days.map(function (d) { return dayFull[d]; }).join("、");
  }

  function timeText(item) {
    var h12 = item.hour % 12;
    if (h12 === 0) h12 = 12;
    return (item.hour < 12 ? "上午 " : "下午 ") + h12 + ":" + pad(item.minute);
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  function hour12(h) {
    var n = h % 12;
    return n === 0 ? 12 : n;
  }

  function nextAt(item) {
    var now = Date.now();
    for (var add = 0; add <= 7; add++) {
      var d = new Date();
      d.setSeconds(0, 0);
      d.setHours(item.hour, item.minute, 0, 0);
      d.setDate(d.getDate() + add);
      if (d.getTime() <= now) continue;
      var dow = d.getDay();
      if (!item.days.length || item.days.indexOf(dow) >= 0) return d.getTime() - now;
    }
    return 24 * 60 * 60 * 1000;
  }

  function show(id) {
    document.getElementById("panel-list").hidden = id !== "list";
    document.getElementById("panel-edit").hidden = id !== "edit";
    document.getElementById("panel-pick").hidden = id !== "pick";
  }

  function renderList() {
    cards.innerHTML = "";
    items.slice().sort(function (a, b) { return a.hour * 60 + a.minute - (b.hour * 60 + b.minute); }).forEach(function (item) {
      var card = document.createElement("div");
      card.className = "card";
      card.innerHTML = "<div><p class='lbl'>" + labelOf(item) + "</p><p class='tm'>" + timeText(item) + "</p></div>";
      var sw = document.createElement("label");
      sw.className = "switch";
      sw.innerHTML = "<input type='checkbox'" + (item.on ? " checked" : "") + "><span></span>";
      sw.querySelector("input").onchange = function (e) {
        e.stopPropagation();
        item.on = this.checked;
        save();
      };
      card.appendChild(sw);
      card.onclick = function (e) {
        if (e.target.closest(".switch")) return;
        editing = item;
        renderEdit();
        show("edit");
      };
      cards.appendChild(card);
    });
    show("list");
  }

  function renderEdit() {
    if (!editing) return;
    document.getElementById("edit-label").textContent = labelOf(editing);
    document.getElementById("edit-time").textContent = timeText(editing);
    document.getElementById("edit-on").checked = editing.on;
    document.getElementById("edit-status").textContent = editing.on ? "鬧鐘已開啟" : "鬧鐘已關閉";
    daysEl.innerHTML = "";
    dayNames.forEach(function (name, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = name;
      b.className = "day" + (editing.days.indexOf(i) >= 0 ? " on" : "");
      b.onclick = function () {
        var p = editing.days.indexOf(i);
        if (p >= 0) editing.days.splice(p, 1); else editing.days.push(i);
        save();
        renderEdit();
      };
      daysEl.appendChild(b);
    });
  }

  function renderPick() {
    var h = hour12(pickHour);
    document.getElementById("pick-hour").textContent = pad(h);
    document.getElementById("pick-min").textContent = pad(pickMinute);
    document.getElementById("pick-hour").classList.toggle("on", pickHourMode);
    document.getElementById("pick-min").classList.toggle("on", !pickHourMode);
    document.getElementById("pick-am").classList.toggle("on", pickHour < 12);
    document.getElementById("pick-pm").classList.toggle("on", pickHour >= 12);
    drawDial();
  }

  function drawDial() {
    var selected = pickHourMode ? hour12(pickHour) % 12 : Math.round(pickMinute / 5);
    var marks = "";
    for (var i = 0; i < 12; i++) {
      var ang = (i * 30 - 90) * Math.PI / 180;
      var x = 80 + Math.cos(ang) * 58;
      var y = 80 + Math.sin(ang) * 58;
      var t = pickHourMode ? (i === 0 ? "12" : String(i)) : pad(i * 5);
      marks += "<text x='" + x + "' y='" + (y + 4) + "' text-anchor='middle'>" + t + "</text>";
    }
    var sang = ((pickHourMode ? (hour12(pickHour) % 12) : (pickMinute / 5)) * 30 - 90) * Math.PI / 180;
    var hx = 80 + Math.cos(sang) * 42;
    var hy = 80 + Math.sin(sang) * 42;
    dial.innerHTML = "<svg viewBox='0 0 160 160'><circle cx='80' cy='80' r='76' fill='#2c2c2e'/>" +
      marks + "<line x1='80' y1='80' x2='" + hx + "' y2='" + hy + "' stroke='#fff' stroke-width='3'/>" +
      "<circle cx='" + hx + "' cy='" + hy + "' r='8' fill='#fff'/><circle cx='80' cy='80' r='3' fill='#fff'/></svg>";
  }

  function applyDial(ev) {
    var box = dial.getBoundingClientRect();
    var cx = box.left + box.width / 2;
    var cy = box.top + box.height / 2;
    var x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - cx;
    var y = (ev.touches ? ev.touches[0].clientY : ev.clientY) - cy;
    var deg = Math.atan2(x, -y) * 180 / Math.PI;
    if (deg < 0) deg += 360;
    if (pickHourMode) {
      var h = Math.round(deg / 30);
      if (h === 0) h = 12;
      var am = pickHour < 12;
      pickHour = am ? (h === 12 ? 0 : h) : (h === 12 ? 12 : h + 12);
    } else {
      pickMinute = (Math.round(deg / 6 / 5) * 5) % 60;
    }
    renderPick();
  }

  function toast(msg) {
    var el = document.getElementById("toast");
    el.hidden = false;
    el.textContent = msg;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.hidden = true; }, 1600);
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
    vibeTimer = setInterval(function () { navigator.vibrate([400, 200, 400, 200, 600]); }, 1800);
  }

  function fire(id) {
    ringingId = id;
    ring.hidden = false;
    if (window.speechSynthesis) {
      var u = new SpeechSynthesisUtterance("鬧鐘時間到");
      u.lang = "zh-TW";
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    }
    startVibe();
    if (window.Notification && Notification.permission === "granted") {
      new Notification("PATS 鬧鐘", { body: "鬧鐘時間到", requireInteraction: true });
    }
    var item = items.filter(function (a) { return a.id === id; })[0];
    if (item && !item.days.length) item.on = false;
    save();
  }

  function keepAwake() {
    if (!navigator.wakeLock || !navigator.wakeLock.request) return;
    navigator.wakeLock.request("screen").then(function (lock) {
      wakeLock = lock;
    }).catch(function () {});
  }

  function arm() {
    if (timer) clearTimeout(timer);
    timer = null;
    var next = null;
    items.forEach(function (item) {
      if (!item.on) return;
      var wait = nextAt(item);
      if (!next || wait < next.wait) next = { id: item.id, wait: wait };
    });
    if (!next) return;
    timer = setTimeout(function () { fire(next.id); }, next.wait);
    if (window.Notification && Notification.permission === "default") Notification.requestPermission();
    keepAwake();
  }

  function hideRing() {
    ring.hidden = true;
    stopVibe();
  }

  document.getElementById("add").onclick = function () {
    editing = { id: nextId++, hour: 7, minute: 0, on: false, days: [] };
    items.push(editing);
    save();
    renderEdit();
    show("edit");
  };
  document.getElementById("edit-back").onclick = function () { renderList(); };
  document.getElementById("edit-on").onchange = function () {
    if (!editing) return;
    editing.on = this.checked;
    save();
    renderEdit();
    if (editing.on) toast("已設定鬧鐘");
  };
  document.getElementById("edit-time-btn").onclick = function () {
    pickHour = editing.hour;
    pickMinute = editing.minute;
    pickHourMode = true;
    renderPick();
    show("pick");
  };
  document.getElementById("pick-hour").onclick = function () { pickHourMode = true; renderPick(); };
  document.getElementById("pick-min").onclick = function () { pickHourMode = false; renderPick(); };
  document.getElementById("pick-am").onclick = function () {
    var h = hour12(pickHour);
    pickHour = h === 12 ? 0 : h;
    renderPick();
  };
  document.getElementById("pick-pm").onclick = function () {
    var h = hour12(pickHour);
    pickHour = h === 12 ? 12 : h + 12;
    renderPick();
  };
  document.getElementById("pick-done").onclick = function () {
    editing.hour = pickHour;
    editing.minute = pickMinute;
    save();
    renderEdit();
    show("edit");
  };
  dial.addEventListener("pointerdown", function (e) { applyDial(e); });
  dial.addEventListener("pointermove", function (e) { if (e.buttons) applyDial(e); });
  document.getElementById("dismiss").onclick = hideRing;
  document.getElementById("snooze").onclick = function () {
    hideRing();
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () { fire(ringingId); }, 5 * 60 * 1000);
    toast("5 分鐘後再響");
    keepAwake();
  };

  load();
  renderList();
  arm();
})();
