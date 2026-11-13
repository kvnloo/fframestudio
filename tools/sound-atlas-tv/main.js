// The Samsung TV end of the Cast button: keep one room code on this TV, then open the hosted TV view
// in it. The phone launches this app over the LAN (ip + app id ride along so it can pair).
// ES5 only, and it must stay in a file: the widget CSP (script-src 'self') refuses inline scripts.
var SITE = "https://glide-music-picker.vercel.app/";
var room = localStorage.getItem("room");
if (!/^[a-z0-9]{6}$/.test(room || "")) {
  var A = "abcdefghijkmnpqrstuvwxyz23456789", b = crypto.getRandomValues(new Uint8Array(6)); room = "";
  for (var i = 0; i < 6; i++) room += A[b[i] & 31];
  localStorage.setItem("room", room);
}
function get(f) { try { return f(); } catch (e) { return ""; } }
var ip = "", app = get(function () { return tizen.application.getCurrentApplication().appInfo.id; });
var name = get(function () { return webapis.productinfo.getRealModel(); });
try { ["MediaPlayPause", "MediaPlay", "MediaPause", "MediaFastForward", "MediaRewind", "ChannelUp", "ChannelDown"].forEach(function (k) { tizen.tvinputdevice.registerKey(k); }); } catch (e) {}
// Leave once the LAN address is known and the relay heard us (or after 4 s regardless). The tizen.* APIs
// exist only on this local page, so everything the site needs rides along in its URL.
var waiting = 2, gone = false;
function go() {
  if (gone || --waiting > 0) return; gone = true;
  location.replace(SITE + "?tv=samsung&name=" + encodeURIComponent(name ? "Samsung " + name : "Samsung TV") + "&ip=" + encodeURIComponent(ip) + "&app=" + encodeURIComponent(app) + "#room=" + room);
}
setTimeout(function () { waiting = 1; go(); }, 4000);
// webapis.network.getIp() needs a plugin the widget CSP blocks (object-src 'none'); systeminfo has the address.
(function lanIp(kinds) {
  if (!kinds.length) return go();
  try { tizen.systeminfo.getPropertyValue(kinds[0], function (n) { if (n.ipAddress && n.ipAddress !== "0.0.0.0") { ip = n.ipAddress; go(); } else lanIp(kinds.slice(1)); }, function () { lanIp(kinds.slice(1)); }); }
  catch (e) { lanIp(kinds.slice(1)); }
})(["WIFI_NETWORK", "ETHERNET_NETWORK"]);
// Tell the relay the app started (stage "app") before leaving, so a TV that never shows the site is
// diagnosable: no "app" = no network; "app" but no "html" = the navigation is blocked.
try { var x = new XMLHttpRequest(); x.open("POST", SITE + "api/social?op=tvpoll"); // text/plain: a simple request, no CORS preflight (the API 405s OPTIONS)
  x.onloadend = function () { go(); };
  x.send(JSON.stringify({ sid: "tvapp" + Date.now() + "00", room: room, tv: { boot: "app", ua: navigator.userAgent.slice(0, 200) } })); } catch (e) { go(); }
