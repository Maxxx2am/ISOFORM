/**
 * MediaPipe Pose Landmarker page for ANALYZING AN IMPORTED VIDEO (not the live
 * camera) — same model/skeleton drawing as poseHtml.ts, but instead of
 * getUserMedia it plays a video reconstructed from base64 chunks streamed in
 * from React Native (see AnalyzeVideoView), and reports playback progress so
 * the screen can show a progress bar while it processes.
 */
export const ANALYZE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<style>
  html,body{margin:0;height:100%;background:#000;overflow:hidden;font-family:-apple-system,system-ui,sans-serif;}
  #wrap{position:fixed;inset:0;}
  #video,#overlay{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;}
  #status{position:absolute;top:0;left:0;right:0;padding:12px;color:#9A9AA1;font-size:13px;text-align:center;z-index:5;pointer-events:none;}
</style>
</head>
<body>
<div id="wrap">
  <video id="video" playsinline muted></video>
  <canvas id="overlay"></canvas>
  <div id="status">Waiting for video</div>
</div>
<script type="module">
  var statusEl = document.getElementById('status');
  var video = document.getElementById('video');
  var canvas = document.getElementById('overlay');
  var ctx = canvas.getContext('2d');
  var V = '0.10.20';

  var FALLBACK_CONNECTIONS = [[11,12],[11,23],[12,24],[23,24],[11,13],[13,15],[12,14],[14,16],[23,25],[25,27],[27,31],[24,26],[26,28],[28,32]];
  var LEG = { 25:1, 26:1, 27:1, 28:1, 29:1, 30:1, 31:1, 32:1 };
  var HIDE_LEGS = !!window.__hideLegs;
  var SIDE_VIEW = !!window.__sideView;
  var SHOW_BAR = !!window.__showBar;
  var MIRROR = !!window.__mirror;
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
    var mx = MIRROR ? function(x){ return (1 - x) * canvas.width; } : function(x){ return x * canvas.width; };
    var my = function(y){ return y * canvas.height; };
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
      ctx.moveTo(mx(a.x), my(a.y));
      ctx.lineTo(mx(b.x), my(b.y));
      ctx.stroke();
    }
    ctx.fillStyle = '#FFFFFF';
    var list = joints || null;
    if (list){
      for (var k=0;k<list.length;k++){ var pj=lms[list[k]]; if (!pj || (pj.visibility!=null && pj.visibility<0.4)) continue; ctx.beginPath(); ctx.arc(mx(pj.x), my(pj.y), 4, 0, 6.2832); ctx.fill(); }
    } else {
      for (var j=0;j<lms.length;j++){
        if (HIDE_LEGS && LEG[j]) continue;
        var p = lms[j];
        if (p.visibility!=null && p.visibility<0.4) continue;
        ctx.beginPath();
        ctx.arc(mx(p.x), my(p.y), 4, 0, 6.2832);
        ctx.fill();
      }
    }
  }

  var landmarker = null, connections = FALLBACK_CONNECTIONS, chunks = [], ready = false;

  window.__push = function(b64){ chunks.push(b64); return true; };

  window.__run = function(mime){
    try {
      var full = chunks.join('');
      chunks = [];
      var bin = atob(full);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      var blob = new Blob([bytes], { type: mime || 'video/mp4' });
      var url = URL.createObjectURL(blob);
      video.src = url;
      video.load();
      video.play().catch(function(){});
    } catch(e){ fail('run', e); }
    return true;
  };

  video.addEventListener('loadedmetadata', function(){
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    post({ type:'dims', w: video.videoWidth, h: video.videoHeight, duration: video.duration * 1000 });
  });
  video.addEventListener('ended', function(){ post({ type:'done' }); });

  async function loadModel(){
    var mod, PoseLandmarker, FilesetResolver;
    try {
      setStatus('Loading MediaPipe');
      mod = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + V + '/vision_bundle.mjs');
      PoseLandmarker = mod.PoseLandmarker; FilesetResolver = mod.FilesetResolver;
    } catch(e){ return fail('load-lib', e); }
    var fileset;
    try {
      fileset = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + V + '/wasm');
    } catch(e){ return fail('wasm', e); }
    var modelPath = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
    setStatus('Loading model');
    try {
      landmarker = await PoseLandmarker.createFromOptions(fileset, { baseOptions:{ modelAssetPath: modelPath, delegate:'GPU' }, runningMode:'VIDEO', numPoses:1 });
    } catch(e){
      try {
        landmarker = await PoseLandmarker.createFromOptions(fileset, { baseOptions:{ modelAssetPath: modelPath, delegate:'CPU' }, runningMode:'VIDEO', numPoses:1 });
      } catch(e2){ return fail('model', e2); }
    }
    connections = connectionsFrom(PoseLandmarker);
    ready = true;
    setStatus('');
    post({ type:'ready' });
  }
  loadModel();

  var lastTime = -1;
  function loop(){
    requestAnimationFrame(loop);
    if (!ready || !landmarker || video.readyState < 2 || video.paused) return;
    if (video.currentTime === lastTime) return;
    lastTime = video.currentTime;
    var tMs = video.currentTime * 1000;
    var res;
    try { res = landmarker.detectForVideo(video, Math.round(tMs)); } catch(e){ return; }
    if (res && res.landmarks && res.landmarks.length){
      var lms = res.landmarks[0];
      draw(lms, connections);
      var out = new Array(lms.length);
      for (var i=0;i<lms.length;i++){ var p=lms[i]; out[i]={ x:p.x, y:p.y, z:p.z||0, visibility:(p.visibility==null?1:p.visibility) }; }
      post({ type:'landmarks', t: Math.round(tMs), landmarks: out });
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    post({ type:'progress', t: tMs, duration: video.duration * 1000 });
  }
  requestAnimationFrame(loop);
</script>
</body>
</html>`;
