export const TRIM_EXPORT_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:#000;overflow:hidden;}</style></head>
<body>
<video id="v" playsinline muted style="width:100%;height:100%"></video>
<script>
var video=document.getElementById('v');
var buf='';
function post(m){try{window.ReactNativeWebView.postMessage(JSON.stringify(m));}catch(e){}}
window.__push=function(chunk){buf+=chunk;return true;};
window.__run=function(cfg){
  var c;try{c=JSON.parse(cfg);}catch(e){return post({type:'error',message:'config:'+String(e)});}
  try{
    var bin=atob(buf);buf='';
    var arr=new Uint8Array(bin.length);
    for(var i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
    var blob=new Blob([arr],{type:c.mime||'video/mp4'});
    var url=URL.createObjectURL(blob);
    video.src=url;video.muted=true;
    video.onloadedmetadata=function(){video.currentTime=c.startMs/1000;};
    video.onseeked=function(){
      if(typeof video.captureStream!=='function')return post({type:'error',message:'captureStream not supported'});
      try{
        var stream=video.captureStream(30);
        var rec;
        try{rec=new MediaRecorder(stream,{mimeType:'video/mp4'});}catch(e){
          try{rec=new MediaRecorder(stream,{mimeType:'video/webm'});}catch(e2){return post({type:'error',message:'MediaRecorder not supported'});}
        }
        var rc=[];
        rec.ondataavailable=function(e){if(e.data&&e.data.size)rc.push(e.data);};
        rec.onstop=function(){
          var ob=new Blob(rc,{type:rec.mimeType||'video/mp4'});
          var r=new FileReader();
          r.onloadend=function(){var s=r.result||'';var ci=s.indexOf(',');post({type:'done',data:ci>=0?s.slice(ci+1):null,mime:rec.mimeType||'video/mp4'});};
          r.readAsDataURL(ob);
        };
        rec.start();video.play();
        var iv=setInterval(function(){
          if(video.currentTime>=c.endMs/1000||video.paused){clearInterval(iv);video.pause();rec.stop();}
        },100);
      }catch(e){post({type:'error',message:String(e)});}
    };
    video.onerror=function(){post({type:'error',message:'video load failed'});};
  }catch(e){post({type:'error',message:String(e)});}
};
</script>
</body>
</html>`;
