// The LG (webOS) end of casting: keep one room code on this TV, then open the hosted TV view in it.
// Same flow as the Samsung app (../sound-atlas-tv/main.js) minus the LAN launch: webOS has no
// phone-reachable launcher, so open the app with the remote and pair by its QR / room code.
// ES5 only: older webOS browsers predate the syntax the site itself uses.
var SITE = "https://glide-music-picker.vercel.app/";
var room = localStorage.getItem("room");
if (!/^[a-z0-9]{6}$/.test(room || "")) {
  var A = "abcdefghijkmnpqrstuvwxyz23456789", b = crypto.getRandomValues(new Uint8Array(6)); room = "";
  for (var i = 0; i < 6; i++) room += A[b[i] & 31];
  localStorage.setItem("room", room);
}
var gone = false;
function go() {
  if (gone) return; gone = true;
  location.replace(SITE + "?tv=lg&name=" + encodeURIComponent("LG TV") + "#room=" + room);
}
setTimeout(go, 4000);
// Tell the relay the app started (stage "app") before leaving: no "app" = no network; "app" but no
// "html" = the navigation is blocked.
try { var x = new XMLHttpRequest(); x.open("POST", SITE + "api/social?op=tvpoll"); // text/plain: no CORS preflight
  x.onloadend = go;
  x.send(JSON.stringify({ sid: "tvapp" + Date.now() + "00", room: room, tv: { boot: "app", ua: navigator.userAgent.slice(0, 200) } })); } catch (e) { go(); }
