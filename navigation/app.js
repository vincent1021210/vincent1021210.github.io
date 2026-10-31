(function () {
  var map, dest, destName = "", lastPos, routePoints = [], steps = [];
  var navigating = false;
  var lastRerouteAt = 0;
  var lastSpoken = "";
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
    applyUiState();
    searchEl.addEventListener("input", function () {
      clearTimeout(searchTimer);
      var q = searchEl.value.trim();
      if (q.length < 2) {
        hideSuggest();
        return;
      }
      searchTimer = setTimeout(function () { searchPlaces(q); }, 350);
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
      destMarker = L.marker([dest.lat, dest.lng]).addTo(map).bindPopup(destName);
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
      lastPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      showHere();
    }, function () {
      toast("請允許定位，才能規劃路線。");
    }, { enableHighAccuracy: true, timeout: 12000 });

    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    watchId = navigator.geolocation.watchPosition(function (pos) {
      lastPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      showHere();
      if (navigating) updateGuidance(lastPos);
    }, function () {}, { enableHighAccuracy: true, maximumAge: 800 });
  }

  function showHere() {
    if (!map || !lastPos) return;
    if (hereMarker) {
      hereMarker.setLatLng([lastPos.lat, lastPos.lng]);
    } else {
      hereMarker = L.circleMarker([lastPos.lat, lastPos.lng], {
        radius: 8,
        color: "#fff",
        weight: 2,
        fillColor: "#1a73e8",
        fillOpacity: 1
      }).addTo(map);
      map.setView([lastPos.lat, lastPos.lng], 16);
    }
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
    var next = steps[0];
    var best = Infinity;
    steps.forEach(function (s) {
      var d = haversine(here, s.end);
      if (d < best) { best = d; next = s; }
    });
    var remain = haversine(here, next.end);
    var text = remain < 30 ? next.instruction : "約 " + Math.round(remain) + " 公尺後 " + next.instruction;
    if (instructionEl) instructionEl.textContent = text;
    if (turnDistEl) turnDistEl.textContent = "約 " + Math.round(remain) + " 公尺後";
    if (turnInstEl) turnInstEl.textContent = next.instruction;
    if (destTitleEl) destTitleEl.textContent = destName;
    if (etaEl) etaEl.textContent = fmtDur(lastDuration) + " · " + fmtDist(lastDistance);
    if (etaClockEl) etaClockEl.textContent = arrivalClock(lastDuration);
    if (remain < 30 && next.instruction !== lastSpoken) {
      lastSpoken = next.instruction;
      speak(next.instruction);
    }
  }

  initMap();
})();
