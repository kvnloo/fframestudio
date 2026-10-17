import {MP4Clip,ImgClip,OffscreenSprite,Combinator} from '@webav/av-cliper';
const save=async(name,body)=>{const r=await fetch('/receipt?name='+name,{method:'POST',body});if(!r.ok)throw Error('save failed')};
// Bounded temporal-supersampling extension, not a replacement decoder/compositor.
class SampledClip{
 constructor(width,height,fps,samples=1){this.width=width;this.height=height;this.fps=fps;this.samples=samples;this.meta={width,height,duration:2e6};this.ready=this.init();}
 async init(){const source=new MP4Clip((await fetch('/media/source60.mp4')).body,{audio:false});await source.ready;this.video=new OffscreenSprite(source);await this.video.ready;this.video.rect.w=this.width;this.video.rect.h=this.height;this.video.time.duration=2e6;
 const square=new OffscreenCanvas(160,160);const ctx=square.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,160,160);this.square=new OffscreenSprite(new ImgClip(await createImageBitmap(square)));await this.square.ready;this.square.rect.y=this.height*.3;this.square.setAnimation({'0%':{x:0},'100%':{x:this.width-160}},{duration:2e6,iterCount:1});this.square.time.duration=2e6;
 this.renderCanvas=new OffscreenCanvas(this.width,this.height);this.accum=new OffscreenCanvas(this.width,this.height);return this.meta;}
 async tick(time){const ctx=this.renderCanvas.getContext('2d');const sum=this.accum.getContext('2d');sum.clearRect(0,0,this.width,this.height);for(let i=0;i<this.samples;i++){const t=Math.min(2e6-1,time+i*1e6/(this.fps*this.samples));ctx.fillStyle='#000';ctx.fillRect(0,0,this.width,this.height);await this.video.offscreenRender(ctx,t);await this.square.offscreenRender(ctx,t);sum.globalAlpha=1/(i+1);sum.drawImage(this.renderCanvas,0,0);}sum.globalAlpha=1;return {video:new VideoFrame(this.accum,{timestamp:Math.round(time)}),state:time>=2e6?'done':'success'};}
 async clone(){const c=new SampledClip(this.width,this.height,this.fps,this.samples);await c.ready;return c;}
 destroy(){this.video?.destroy();this.square?.destroy();}
}
let captureClip;
async function exportProbe({width,height,fps,samples=1,name}){const t=performance.now();const clip=new SampledClip(width,height,fps,samples);await clip.ready;const com=new Combinator({width,height,fps,audio:false,bitrate:12e6,videoCodec:'avc1.640034'});const sprite=new OffscreenSprite(clip);await sprite.ready;sprite.time.duration=2e6;await com.addSprite(sprite);const blob=await new Response(com.output({maxTime:2e6})).blob();const elapsedMs=performance.now()-t;await save(name,blob);com.destroy();clip.destroy();return {width,height,fps,samples,duration:2,elapsedMs,framesPerSecond:2*fps/(elapsedMs/1000),realtimeFactor:2/(elapsedMs/1000),bytes:blob.size};}
async function captureInit(){captureClip=new SampledClip(1920,1080,30,1);await captureClip.ready;}
async function captureFrame(index){const {video}=await captureClip.tick(index*1e6/30);const c=new OffscreenCanvas(1920,1080);c.getContext('2d').drawImage(video,0,0);video.close();const b=await c.convertToBlob({type:'image/png'});return new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.readAsDataURL(b)});}
window.perf={exportProbe,captureInit,captureFrame};
