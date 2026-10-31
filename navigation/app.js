(function () {
  var cfg = window.PATS_NAV || {};
  var key = cfg.mapsKey || "";
  var map, dest, destName = "", lastPos, routePoints = [], steps = [];
  var navigating = false;
  var lastRerouteAt = 0;
  var lastSpoken = "";
  var mode = "DRIVING";
  var renderer;
  var watchId = null;

  var $ = function (id) { return document.getElementById(id); };
  var searchEl = $("search");
  var instructionEl = $("instruction");
  var etaEl = $("eta");
  var navBtn = $("nav-btn");

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
    for (var i = 0; i < points.length; i++) {
      min = Math.min(min, haversine(here, points[i]));
    }
    return min;
  }

  function loadMaps() {
    if (!key) {
      toast("尚未設定地圖金鑰");
      return;
    }
    var s = document.createElement("script");
    s.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(key) +
      "&libraries=places&language=zh-TW&callback=patsNavInit";
    s.async = true;
    s.defer = true;
    s.onerror = function () { toast("地圖腳本載入失敗，請檢查 Maps JavaScript API"); };
    document.head.appendChild(s);
  }

  window.patsNavInit = function () {
    var taipei = { lat: 25.033, lng: 121.5654 };
    map = new google.maps.Map($("map"), {
      center: taipei,
      zoom: 15,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false
    });
    renderer = new google.maps.DirectionsRenderer({
      map: map,
      suppressMarkers: false,
      polylineOptions: { strokeColor: "#2563eb", strokeWeight: 6 }
    });

    var ac = new google.maps.places.Autocomplete(searchEl, {
      fields: ["geometry", "name", "formatted_address"],
      componentRestrictions: { country: "tw" }
    });
    ac.addListener("place_changed", function () {
      var place = ac.getPlace();
      if (!place.geometry || !place.geometry.location) {
        toast("請從清單選一個終點");
        return;
      }
      dest = { lat: place.geometry.location.lat(), lng: place.geometry.location.lng() };
      destName = place.name || place.formatted_address || "終點";
      searchEl.value = destName;
      map.panTo(dest);
      map.setZoom(15);
      planRoute(true);
    });

    $("mode-drive").onclick = function () { setMode("DRIVING"); };
    $("mode-walk").onclick = function () { setMode("WALKING"); };
    navBtn.onclick = toggleNav;
    locateMe();
  };

  function setMode(next) {
    mode = next;
    $("mode-drive").classList.toggle("on", next === "DRIVING");
    $("mode-walk").classList.toggle("on", next === "WALKING");
    if (dest) planRoute(true);
  }

  function locateMe() {
    if (!navigator.geolocation) {
      toast("這個瀏覽器不支援定位");
      return;
    }
    navigator.geolocation.getCurrentPosition(function (pos) {
      lastPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      map.panTo(lastPos);
      map.setZoom(16);
      new google.maps.Marker({
        map: map,
        position: lastPos,
        title: "目前位置",
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 7,
          fillColor: "#2563eb",
          fillOpacity: 1,
          strokeColor: "#fff",
          strokeWeight: 2
        }
      });
    }, function () {
      toast("請允許定位，才能規劃路線。");
    }, { enableHighAccuracy: true, timeout: 12000 });

    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    watchId = navigator.geolocation.watchPosition(function (pos) {
      lastPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (navigating) {
        map.panTo(lastPos);
        updateGuidance(lastPos);
      }
    }, function () {}, { enableHighAccuracy: true, maximumAge: 800 });
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
    var svc = new google.maps.DirectionsService();
    svc.route({
      origin: lastPos,
      destination: dest,
      travelMode: google.maps.TravelMode[mode],
      language: "zh-TW"
    }, function (res, status) {
      navBtn.disabled = false;
      if (status !== "OK" || !res.routes[0]) {
        toast("找不到路線，請換一個終點再試。" + (status ? " (" + status + ")" : ""));
        return;
      }
      renderer.setDirections(res);
      var leg = res.routes[0].legs[0];
      routePoints = [];
      res.routes[0].overview_path.forEach(function (p) {
        routePoints.push({ lat: p.lat(), lng: p.lng() });
      });
      steps = leg.steps.map(function (s) {
        return {
          instruction: s.instructions.replace(/<[^>]+>/g, ""),
          end: { lat: s.end_location.lat(), lng: s.end_location.lng() }
        };
      });
      etaEl.textContent = (leg.duration && leg.duration.text ? leg.duration.text : "") +
        (leg.distance ? " · " + leg.distance.text : "");
      instructionEl.textContent = (steps[0] && steps[0].instruction) || destName;
      if (fromReroute) speak("已重新規劃路線");
      if (fit) {
        var bounds = new google.maps.LatLngBounds();
        routePoints.forEach(function (p) { bounds.extend(p); });
        bounds.extend(lastPos);
        map.fitBounds(bounds, 80);
      }
    });
  }

  function toggleNav() {
    if (navigating) {
      navigating = false;
      navBtn.textContent = "開始導航";
      instructionEl.textContent = destName || "搜尋終點後即可規劃路線";
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
    navBtn.textContent = "結束導航";
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
    instructionEl.textContent = remain < 30
      ? next.instruction
      : "約 " + Math.round(remain) + " 公尺後 " + next.instruction;
    if (remain < 30 && next.instruction !== lastSpoken) {
      lastSpoken = next.instruction;
      speak(next.instruction);
    }
  }

  loadMaps();
})();
