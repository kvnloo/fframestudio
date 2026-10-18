import { fromV0, validate } from './doc/project.js';
export function recreateReference(analysis, { id, source = 'Local file', file = 'source.mp4', title = 'Reference approximation' }) {
  if (analysis.schema !== 'fframestudio.reference/1' || !analysis.shots?.length) throw Error('Analyze the reference before recreating.');
  const fps = analysis.media.fps.num / analysis.media.fps.den;
  const doc = fromV0({ schema:'fframestudio.project/0', id, title, kind:'reference approximation', canvas:{...analysis.media,fps}, media:{proxy:file},
    renders:[{file,duration_s:analysis.media.frames/fps}],
    shots:analysis.shots.map((s,i) => ({id:`${id}:shot:${i+1}`,name:`Detected shot ${i+1}`,t0:s.startFrame/fps,t1:s.endFrame/fps,text:{},type:'reference',reference:{startFrame:s.startFrame,endFrame:s.endFrame,confidence:s.confidence}})),
    source:{kind:'reference',label:source,contentHash:analysis.contentHash}, notes:['Approximation: editable source-linked shots, durations and palette look tokens only. Typography, motion, transitions and effects have not been reconstructed.'],
  });
  doc.fps = {...analysis.media.fps};
  doc.videos[0].clips.forEach((c,i) => {
    c.start=analysis.shots[i].startFrame;c.sourceIn=c.start;c.duration=analysis.shots[i].endFrame-c.start;c.styleId=`reference-look-${i+1}`;
    const dominant=analysis.shots[i].palette[0]?.color || '#111111';
    const [r,g,b]=[1,3,5].map(n=>parseInt(dominant.slice(n,n+2),16)/255).map(n=>n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4);
    const luminance=0.2126*r+0.7152*g+0.0722*b;
    // Palette is a look token, not illegible same-colour title ink over source footage.
    doc.videos[0].styles[c.styleId]={color:luminance>0.179?'#111111':'#ffffff',referenceColor:dominant,palette:analysis.shots[i].palette.map(p=>p.color)};
  });
  doc.metadata.reference={approximation:true,contentHash:analysis.contentHash,source,limitations:analysis.limitations,settings:analysis.settings};
  return validate(doc);
}
export function unanalysedReference(info, options) {
  return recreateReference({schema:'fframestudio.reference/1',media:info,contentHash:options.contentHash,settings:null,limitations:['Not analyzed: one editable source clip. Connect the bridge for detected shots.'],shots:[{startFrame:0,endFrame:info.frames,palette:[],confidence:null}]},options);
}
