/**
 * Self-contained MediaPipe Pose Landmarker page, run inside a WebView so real
 * on-device pose works in Expo Go (no native module needed). It opens the front
 * camera via getUserMedia, runs the 33-landmark model, draws the skeleton on a
 * canvas, and posts each frame's landmarks to React Native via postMessage.
 *
 * Loaded with an https baseUrl (see PoseCameraView) so the page is a secure
 * context — getUserMedia is blocked on insecure origins. The embedded script
 * intentionally avoids backticks/${...} so this whole file can be a plain
 * template literal. Skeleton is drawn with raw canvas ops (no DrawingUtils,
 * which isn't exported by every tasks-vision build).
 */
export const POSE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<style>
  html,body{margin:0;height:100%;background:#000;overflow:hidden;font-family:-apple-system,system-ui,sans-serif;}
  #wrap{position:fixed;inset:0;}
  #video,#overlay{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;transform:scaleX(-1);}
  #status{position:absolute;top:0;left:0;right:0;padding:12px;color:#9A9AA1;font-size:13px;text-align:center;z-index:5;pointer-events:none;}
</style>
</head>
<body>
<div id="wrap">
  <video id="video" autoplay playsinline muted></video>
  <canvas id="overlay"></canvas>
  <div id="status">Starting</div>
</div>
<script type="module">
  var statusEl = document.getElementById('status');
  var video = document.getElementById('video');
  var canvas = document.getElementById('overlay');
  var ctx = canvas.getContext('2d');
  var V = '0.10.20';

  var FALLBACK_CONNECTIONS = [[11,12],[11,23],[12,24],[23,24],[11,13],[13,15],[12,14],[14,16],[23,25],[25,27],[27,31],[24,26],[26,28],[28,32]];
  // Leg landmarks (knees, ankles, heels, feet) — skipped when the exercise sets
  // window.__hideLegs (e.g. front push-ups, where the legs glitch behind you).
  var LEG = { 25:1, 26:1, 27:1, 28:1, 29:1, 30:1, 31:1, 32:1 };
  var HIDE_LEGS = !!window.__hideLegs;
  // Side view: draw a single clean line down the more-visible side (handstand),
  // never guessing the hidden far side.
  var SIDE_VIEW = !!window.__sideView;
  var SHOW_BAR = !!window.__showBar;
  var SIDE_LEFT  = { chain: [[0,11],[11,13],[13,15],[11,23],[23,25],[25,27],[27,31]], joints: [0,11,13,15,23,25,27], core: [11,13,15,23,25,27] };
  var SIDE_RIGHT = { chain: [[0,12],[12,14],[14,16],[12,24],[24,26],[26,28],[28,32]], joints: [0,12,14,16,24,26,28], core: [12,14,16,24,26,28] };
  function pickSide(lms){
    function s(ids){ var t=0; for (var i=0;i<ids.length;i++){ var p=lms[ids[i]]; t += (p && p.visibility!=null) ? p.visibility : 0; } return t; }
    return s(SIDE_LEFT.core) >= s(SIDE_RIGHT.core) ? SIDE_LEFT : SIDE_RIGHT;
  }

  function post(msg){ try { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(msg)); } catch(e){} }
  function setStatus(s){ statusEl.textContent = s; post({ type:'status', value:s }); }
  function fail(where, e){ var m = (e && e.message) || String(e); setStatus('Error at ' + where + ': ' + m); post({ type:'error', where:where, message:m }); }
  window.addEventListener('error', function(e){ fail('window', e.error || e.message); });
  window.addEventListener('unhandledrejection', function(e){ fail('promise', e.reason); });

  function connectionsFrom(PoseLandmarker){
    var raw = PoseLandmarker && PoseLandmarker.POSE_CONNECTIONS;
    if (!raw || !raw.length) return FALLBACK_CONNECTIONS;
    return raw.map(function(c){ return (c.start != null) ? [c.start, c.end] : c; });
  }

  function draw(lms, connections){
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    // Pull-up bar: a horizontal line at the higher visible wrist.
    if (SHOW_BAR){
      var lw = lms[15], rw = lms[16], ys = [];
      if (lw && (lw.visibility==null || lw.visibility>=0.4)) ys.push(lw.y);
      if (rw && (rw.visibility==null || rw.visibility>=0.4)) ys.push(rw.y);
      if (ys.length){
        var barY = Math.min.apply(null, ys) * canvas.height;
        ctx.save(); ctx.strokeStyle='rgba(255,255,255,0.55)'; ctx.lineWidth=3;
        ctx.beginPath(); ctx.moveTo(0, barY); ctx.lineTo(canvas.width, barY); ctx.stroke(); ctx.restore();
      }
    }
    var conns = connections, joints = null;
    if (SIDE_VIEW){ var sd = pickSide(lms); conns = sd.chain; joints = sd.joints; }
    for (var i=0;i<conns.length;i++){
      var ia = conns[i][0], ib = conns[i][1];
      if (!SIDE_VIEW && HIDE_LEGS && (LEG[ia] || LEG[ib])) continue;
      var a = lms[ia], b = lms[ib];
      if (!a || !b) continue;
      if ((a.visibility!=null && a.visibility<0.4) || (b.visibility!=null && b.visibility<0.4)) continue;
      ctx.beginPath();
      ctx.moveTo(a.x*canvas.width, a.y*canvas.height);
      ctx.lineTo(b.x*canvas.width, b.y*canvas.height);
      ctx.stroke();
    }
    ctx.fillStyle = '#FFFFFF';
    var list = joints || null;
    if (list){
      for (var k=0;k<list.length;k++){ var pj=lms[list[k]]; if (!pj || (pj.visibility!=null && pj.visibility<0.4)) continue; ctx.beginPath(); ctx.arc(pj.x*canvas.width, pj.y*canvas.height, 4, 0, 6.2832); ctx.fill(); }
    } else {
      for (var j=0;j<lms.length;j++){
        if (HIDE_LEGS && LEG[j]) continue;
        var p = lms[j];
        if (p.visibility!=null && p.visibility<0.4) continue;
        ctx.beginPath();
        ctx.arc(p.x*canvas.width, p.y*canvas.height, 4, 0, 6.2832);
        ctx.fill();
      }
    }
  }

  async function main(){
    var mod, PoseLandmarker, FilesetResolver, landmarker, connections;
    try {
      setStatus('Downloading tracking engine');
      mod = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + V + '/vision_bundle.mjs');
      PoseLandmarker = mod.PoseLandmarker; FilesetResolver = mod.FilesetResolver;
    } catch(e){ return fail('load-lib', e); }

    var fileset;
    try {
      fileset = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + V + '/wasm');
    } catch(e){ return fail('wasm', e); }

    var modelPath = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
    setStatus('Preparing AI body tracker');
    try {
      landmarker = await PoseLandmarker.createFromOptions(fileset, { baseOptions:{ modelAssetPath: modelPath, delegate:'GPU' }, runningMode:'VIDEO', numPoses:1 });
    } catch(e){
      try {
        landmarker = await PoseLandmarker.createFromOptions(fileset, { baseOptions:{ modelAssetPath: modelPath, delegate:'CPU' }, runningMode:'VIDEO', numPoses:1 });
      } catch(e2){ return fail('model', e2); }
    }
    connections = connectionsFrom(PoseLandmarker);

    try {
      setStatus('Requesting camera');
      var facing = window.__facing || 'user';
      var stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode: facing }, audio:false });
      video.srcObject = stream;
      await video.play();
      // Undo any digital zoom the camera applied by default (show true 1x FOV).
      try {
        var vtrack = stream.getVideoTracks()[0];
        var caps = vtrack.getCapabilities ? vtrack.getCapabilities() : null;
        if (caps && caps.zoom) { await vtrack.applyConstraints({ advanced: [{ zoom: caps.zoom.min || 1 }] }); }
      } catch(e){}
    } catch(e){ return fail('camera', e); }

    // Optional recording so the review can replay the real video. Best-effort:
    // if MediaRecorder is unavailable/unsupported the app falls back to the
    // skeleton replay.
    var chunks = [];
    var rec = null;
    try {
      rec = new MediaRecorder(stream);
      rec.ondataavailable = function(e){ if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = function(){
        try {
          var blob = new Blob(chunks, { type: rec.mimeType || 'video/mp4' });
          var reader = new FileReader();
          reader.onloadend = function(){
            var s = String(reader.result || '');
            var comma = s.indexOf(',');
            post({ type:'video', mime: rec.mimeType || 'video/mp4', data: comma >= 0 ? s.slice(comma + 1) : null, w: video.videoWidth, h: video.videoHeight });
          };
          reader.readAsDataURL(blob);
        } catch(e){ post({ type:'video', data:null }); }
      };
      rec.start();
    } catch(e){ rec = null; }
    window.__finish = function(){
      try { if (rec && rec.state !== 'inactive') rec.stop(); else post({ type:'video', data:null }); }
      catch(e){ post({ type:'video', data:null }); }
    };

    setStatus('');
    post({ type:'ready' });

    var start = performance.now();
    var lastTime = -1;
    function loop(){
      requestAnimationFrame(loop);
      if (!landmarker || video.readyState < 2) return;
      if (canvas.width !== video.videoWidth) { canvas.width = video.videoWidth; canvas.height = video.videoHeight; }
      if (video.currentTime === lastTime) return;
      lastTime = video.currentTime;
      var now = performance.now();
      var res;
      try { res = landmarker.detectForVideo(video, now); } catch(e){ return; }
      if (res && res.landmarks && res.landmarks.length){
        var lms = res.landmarks[0];
        draw(lms, connections);
        var out = new Array(lms.length);
        for (var i=0;i<lms.length;i++){ var p=lms[i]; out[i]={ x:p.x, y:p.y, z:p.z||0, visibility:(p.visibility==null?1:p.visibility) }; }
        post({ type:'landmarks', t: Math.round(now - start), landmarks: out });
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
    requestAnimationFrame(loop);
  }
  main();
</script>
</body>
</html>`;
