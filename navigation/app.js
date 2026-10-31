(function () {
  var map, dest, destName = "", lastPos, routePoints = [], steps = [];
  var navigating = false;
  var lastRerouteAt = 0;
  var lastSpoken = "";
  var stepIndex = 0;
  var lastRemainShown = -1;
  var mode = "driving";
  var line, destMarker, hereMarker;
  var watchId = null;
  var searchTimer = 0;
  var watchMode = document.body.classList.contains("watch");

  var $ = function (id) { return document.getElementById(id); };
  var searchEl = $("search");
  var suggestEl = $("suggest");
  var instructionEl = $("instruction");
  var etaEl = $("eta");
  var navBtn = $("nav-btn");
  var destTitleEl = $("dest-title");
  var etaClockEl = $("eta-clock");
  var turnCard = $("turn-card");
  var turnDistEl = $("turn-distance");
  var turnInstEl = $("turn-instruction");
  var lastDuration = 0;
  var lastDistance = 0;
  var lastHeading = 0;
  var sensorHeading = null;

  function toast(msg) {
    var el = $("toast");
    el.hidden = false;
    el.textContent = msg;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.hidden = true; }, 2800);
  }

  function speak(text) {
    if (!window.speechSynthesis) return;
    var u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-TW";
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  function haversine(a, b) {
    var R = 6371000;
    var dLat = (b.lat - a.lat) * Math.PI / 180;
    var dLng = (b.lng - a.lng) * Math.PI / 180;
    var s = Math.sin(dLat / 2) ** 2 +
      Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) *
      Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  function distToPolyline(here, points) {
    if (!points.length) return Infinity;
    var min = Infinity;
    for (var i = 0; i < points.length; i++) min = Math.min(min, haversine(here, points[i]));
    return min;
  }

  function zhStep(step) {
    var m = step.maneuver || {};
    var type = m.type || "";
    var mod = m.modifier || "";
    var name = step.name || "";
    var table = {
      "turn|right": "右轉",
      "turn|left": "左轉",
      "turn|sharp right": "靠右急轉",
      "turn|sharp left": "靠左急轉",
      "turn|slight right": "靠右",
      "turn|slight left": "靠左",
      "turn|straight": "直行",
      "new name|": "繼續前行",
      "depart|": "出發",
      "arrive|": "抵達終點",
      "merge|": "匯入車道",
      "on ramp|": "上交流道",
      "off ramp|": "下交流道",
      "fork|right": "靠右岔路",
      "fork|left": "靠左岔路",
      "roundabout|": "進入圓環",
      "rotary|": "進入圓環",
      "end of road|": "路口盡頭",
      "continue|": "繼續前行"
    };
    var text = table[type + "|" + mod] || table[type + "|"] || "繼續前行";
    return name ? text + "，沿 " + name : text;
  }

  function fmtDur(sec) {
    var m = Math.round(sec / 60);
    if (m < 60) return "約 " + m + " 分鐘";
    return "約 " + Math.floor(m / 60) + " 小時 " + (m % 60) + " 分";
  }

  function fmtDist(m) {
    return m >= 1000 ? (m / 1000).toFixed(1) + " 公里" : Math.round(m) + " 公尺";
  }

  function initMap() {
    if (watchMode || !window.L) {
      startHeadingSensor();
      locateMe();
      bindUi();
      return;
    }
    map = L.map("map", { zoomControl: false }).setView([25.033, 121.5654], 14);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap"
    }).addTo(map);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    startHeadingSensor();
    locateMe();
    bindUi();
  }

  function applyUiState() {
    if (watchMode) return;
    document.body.classList.toggle("navigating", navigating);
    document.body.classList.toggle("preview", !navigating && !!dest);
    document.body.classList.toggle("explore", !navigating && !dest);
    if (turnCard) turnCard.hidden = !navigating;
    if (etaClockEl) etaClockEl.hidden = !navigating;
    if (navBtn) {
      navBtn.textContent = navigating ? "結束" : "開始";
    }
    if (!dest && destTitleEl) destTitleEl.textContent = "搜尋終點後即可規劃路線";
  }

  function arrivalClock(sec) {
    var d = new Date(Date.now() + sec * 1000);
    var h = d.getHours();
    var m = d.getMinutes();
    var ap = h >= 12 ? "下午" : "上午";
    var hh = h % 12 || 12;
    return ap + " " + hh + ":" + (m < 10 ? "0" : "") + m;
  }

  function bindUi() {
    $("mode-drive").onclick = function () { setMode("driving"); };
    $("mode-walk").onclick = function () { setMode("foot"); };
    navBtn.onclick = toggleNav;
    var voice = $("voice");
    if (voice) {
      voice.onclick = function () {
        var Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!Rec) {
          searchEl.focus();
          return;
        }
        var rec = new Rec();
        rec.lang = "zh-TW";
        rec.onresult = function (e) {
          var q = e.results[0][0].transcript;
          searchEl.value = q;
          searchPlaces(q, true);
        };
        rec.start();
      };
    }
    var locate = $("locate");
    if (locate) {
      locate.onclick = function () {
        if (!lastPos) {
          toast("請允許定位，才能規劃路線。");
          return;
        }
        if (map) map.setView([lastPos.lat, lastPos.lng], 17);
        showHere();
      };
    }
    applyUiState();
    searchEl.addEventListener("input", function () {
      clearTimeout(searchTimer);
      var q = searchEl.value.trim();
      if (q.length < 3) {
        hideSuggest();
        return;
      }
      searchTimer = setTimeout(function () { searchPlaces(q); }, 550);
    });
    searchEl.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        var first = suggestEl.querySelector("button");
        if (first) first.click();
        else searchPlaces(searchEl.value.trim(), true);
      }
    });
  }

  function hideSuggest() {
    if (!suggestEl) return;
    suggestEl.hidden = true;
    suggestEl.innerHTML = "";
  }

  function searchPlaces(q, pickFirst) {
    if (!q) return;
    fetch("https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=tw&accept-language=zh-TW&q=" + encodeURIComponent(q), {
      headers: { Accept: "application/json" }
    }).then(function (r) { return r.json(); }).then(function (rows) {
      if (!rows || !rows.length) {
        hideSuggest();
        toast("找不到這個地點");
        return;
      }
      if (pickFirst || watchMode) {
        pickPlace(rows[0]);
        return;
      }
      suggestEl.innerHTML = "";
      rows.forEach(function (row) {
        var li = document.createElement("li");
        var btn = document.createElement("button");
        btn.type = "button";
        var name = row.name || (row.display_name || "").split(",")[0];
        btn.innerHTML = "<span class=\"name\"></span><span class=\"addr\"></span>";
        btn.querySelector(".name").textContent = name;
        btn.querySelector(".addr").textContent = row.display_name || "";
        btn.onclick = function () { pickPlace(row); };
        li.appendChild(btn);
        suggestEl.appendChild(li);
      });
      suggestEl.hidden = false;
    }).catch(function () {
      toast("搜尋失敗，請再試一次");
    });
  }

  function pickPlace(row) {
    dest = { lat: parseFloat(row.lat), lng: parseFloat(row.lon) };
    destName = row.name || (row.display_name || "").split(",")[0] || "終點";
    searchEl.value = destName;
    hideSuggest();
    if (map) {
      if (destMarker) destMarker.remove();
      destMarker = L.marker([dest.lat, dest.lng], { icon: destIcon() }).addTo(map).bindPopup(destName);
      map.setView([dest.lat, dest.lng], 16);
    }
    planRoute(true);
  }

  function setMode(next) {
    mode = next;
    $("mode-drive").classList.toggle("on", next === "driving");
    $("mode-walk").classList.toggle("on", next === "foot");
    $("mode-drive").classList.toggle("chip", !watchMode);
    $("mode-walk").classList.toggle("chip", !watchMode);
    if (dest) planRoute(true);
  }

  function locateMe() {
    if (!navigator.geolocation) {
      toast("這個瀏覽器不支援定位");
      return;
    }
    navigator.geolocation.getCurrentPosition(function (pos) {
      lastHeading = readHeading(pos, lastPos);
      lastPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      showHere();
    }, function () {
      toast("請允許定位，才能規劃路線。");
    }, { enableHighAccuracy: true, timeout: 12000 });

    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    watchId = navigator.geolocation.watchPosition(function (pos) {
      lastHeading = readHeading(pos, lastPos);
      lastPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      showHere();
      if (navigating) updateGuidance(lastPos);
    }, function () {}, { enableHighAccuracy: true, maximumAge: 800 });
  }

  function youIcon() {
    return L.divIcon({
      className: "",
      html: "<div class=\"loc-you\"><span class=\"halo\"></span><span class=\"core\"></span><span class=\"arrow\"></span></div>",
      iconSize: [56, 56],
      iconAnchor: [28, 28]
    });
  }

  function destIcon() {
    return L.divIcon({
      className: "",
      html: "<div class=\"loc-dest\"><svg viewBox=\"0 0 40 52\" width=\"32\" height=\"42\"><path fill=\"#1A73E8\" d=\"M20 48 L16.5 36.5 C8.5 35 5 28 5 21 A15 15 0 1 1 35 21 C35 28 31.5 35 23.5 36.5 Z\"/><circle cx=\"20\" cy=\"21\" r=\"8\" fill=\"#fff\"/><path fill=\"#1A73E8\" d=\"M20 13 L25 27 L20 24 L15 27 Z\"/></svg></div>",
      iconSize: [32, 42],
      iconAnchor: [16, 42]
    });
  }

  function bearingDeg(from, to) {
    var lat1 = from.lat * Math.PI / 180;
    var lat2 = to.lat * Math.PI / 180;
    var dLng = (to.lng - from.lng) * Math.PI / 180;
    var y = Math.sin(dLng) * Math.cos(lat2);
    var x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  function readHeading(pos, prev) {
    if (sensorHeading != null) return sensorHeading;
    var h = pos.coords.heading;
    var speed = pos.coords.speed;
    if (h != null && !isNaN(h) && speed != null && speed >= 0.6) return h;
    if (prev) {
      var next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (haversine(prev, next) >= 3) return bearingDeg(prev, next);
    }
    return lastHeading;
  }

  function applyHeading() {
    var arrow = $("heading-arrow");
    if (arrow) arrow.style.transform = "rotate(" + lastHeading + "deg)";
    if (!hereMarker) return;
    var el = hereMarker.getElement();
    if (!el) return;
    var node = el.querySelector(".loc-you");
    if (node) node.style.transform = "rotate(" + lastHeading + "deg)";
  }

  function startHeadingSensor() {
    var status = $("heading-status");
    var hasApi = !!(window.DeviceOrientationEvent || window.Gyroscope || window.Accelerometer);
    function markOk(label) {
      if (status && !status.dataset.ok) {
        status.dataset.ok = "1";
        status.textContent = label;
      }
    }
    function onOrient(e) {
      var h = null;
      if (e.webkitCompassHeading != null && !isNaN(e.webkitCompassHeading)) {
        h = e.webkitCompassHeading;
      } else if (e.alpha != null && !isNaN(e.alpha)) {
        h = (360 - e.alpha) % 360;
      }
      if (h == null) return;
      sensorHeading = h;
      lastHeading = h;
      applyHeading();
      markOk("三軸加速度計方向");
    }
    function listen() {
      window.addEventListener("deviceorientationabsolute", onOrient, true);
      window.addEventListener("deviceorientation", onOrient, true);
    }
    if (window.Accelerometer) {
      try {
        var acc = new Accelerometer({ frequency: 20 });
        acc.addEventListener("reading", function () { markOk("三軸加速度計方向"); });
        acc.start();
      } catch (e) { /* 瀏覽器可能拒絕 */ }
    }
    if (!hasApi) {
      if (status) status.textContent = "此錶無方向感測器，改用移動方向";
      return;
    }
    if (status) status.textContent = "讀取三軸加速度計…";
    if (typeof DeviceOrientationEvent !== "undefined" &&
        typeof DeviceOrientationEvent.requestPermission === "function") {
      DeviceOrientationEvent.requestPermission().then(function (state) {
        if (state === "granted") listen();
        else if (status) status.textContent = "此錶無方向感測器，改用移動方向";
      }).catch(function () {
        if (status) status.textContent = "此錶無方向感測器，改用移動方向";
      });
    } else {
      listen();
    }
  }

  function showHere() {
    if (!map || !lastPos) return;
    if (hereMarker) {
      hereMarker.setLatLng([lastPos.lat, lastPos.lng]);
    } else {
      hereMarker = L.marker([lastPos.lat, lastPos.lng], { icon: youIcon(), zIndexOffset: 600 }).addTo(map);
      map.setView([lastPos.lat, lastPos.lng], 16);
    }
    applyHeading();
    if (navigating) map.panTo([lastPos.lat, lastPos.lng]);
  }

  function planRoute(fit, fromReroute) {
    if (!lastPos) {
      toast("請允許定位，才能規劃路線。");
      return;
    }
    if (!dest) {
      toast("請先搜尋終點。");
      return;
    }
    navBtn.disabled = true;
    var url = "https://router.project-osrm.org/route/v1/" + mode + "/" +
      lastPos.lng + "," + lastPos.lat + ";" + dest.lng + "," + dest.lat +
      "?overview=full&geometries=geojson&steps=true";
    fetch(url).then(function (r) { return r.json(); }).then(function (data) {
      navBtn.disabled = false;
      if (!data.routes || !data.routes[0]) {
        toast("找不到路線，請換一個終點再試。");
        return;
      }
      var route = data.routes[0];
      if (!fromReroute) stepIndex = 0;
      lastDuration = route.duration || 0;
      lastDistance = route.distance || 0;
      routePoints = route.geometry.coordinates.map(function (c) {
        return { lat: c[1], lng: c[0] };
      });
      steps = [];
      (route.legs || []).forEach(function (leg) {
        (leg.steps || []).forEach(function (s) {
          var loc = s.maneuver && s.maneuver.location ? s.maneuver.location : null;
          steps.push({
            instruction: zhStep(s),
            end: loc ? { lat: loc[1], lng: loc[0] } : dest
          });
        });
      });
      etaEl.textContent = fmtDur(route.duration) + " · " + fmtDist(route.distance);
      if (instructionEl) instructionEl.textContent = (steps[0] && steps[0].instruction) || destName;
      if (destTitleEl) destTitleEl.textContent = destName || "終點";
      if (etaClockEl) etaClockEl.textContent = arrivalClock(route.duration);
      drawLine(fit);
      applyUiState();
      if (fromReroute) speak("已重新規劃路線");
    }).catch(function () {
      navBtn.disabled = false;
      toast("規劃路線失敗，請檢查網路後再試。");
    });
  }

  function drawLine(fit) {
    if (!map || !routePoints.length) return;
    if (line) line.remove();
    line = L.polyline(routePoints.map(function (p) { return [p.lat, p.lng]; }), {
      color: "#1a73e8",
      weight: 6
    }).addTo(map);
    if (fit) map.fitBounds(line.getBounds(), { padding: [80, 80] });
  }

  function toggleNav() {
    if (navigating) {
      navigating = false;
      if (watchMode) {
        navBtn.textContent = "開始";
        if (instructionEl) instructionEl.textContent = destName || "說出或輸入終點";
      }
      applyUiState();
      return;
    }
    if (!lastPos) {
      toast("請允許定位，才能規劃路線。");
      return;
    }
    if (!dest) {
      toast("請先搜尋終點。");
      return;
    }
    if (!steps.length) planRoute(true);
    navigating = true;
    if (watchMode) navBtn.textContent = "結束";
    applyUiState();
    updateGuidance(lastPos);
  }

  function updateGuidance(here) {
    if (!steps.length) return;
    var off = distToPolyline(here, routePoints);
    var now = Date.now();
    if (off > 40 && now - lastRerouteAt > 12000) {
      lastRerouteAt = now;
      planRoute(false, true);
      return;
    }
    while (stepIndex < steps.length - 1 && haversine(here, steps[stepIndex].end) < 28) {
      stepIndex += 1;
    }
    var next = steps[stepIndex];
    var remain = Math.round(haversine(here, next.end));
    var rounded = Math.floor(remain / 10) * 10;
    if (turnInstEl && turnInstEl.textContent !== next.instruction) {
      turnInstEl.textContent = next.instruction;
    }
    if (instructionEl && !turnInstEl) {
      instructionEl.textContent = remain < 30 ? next.instruction : "約 " + remain + " 公尺後 " + next.instruction;
    }
    if (rounded !== lastRemainShown) {
      lastRemainShown = rounded;
      if (turnDistEl) turnDistEl.textContent = remain < 30 ? "即將" : "約 " + Math.max(10, rounded) + " 公尺後";
    }
    if (next.instruction !== lastSpoken && remain < 35) {
      lastSpoken = next.instruction;
      speak(next.instruction);
    }
  }

  initMap();
})();
