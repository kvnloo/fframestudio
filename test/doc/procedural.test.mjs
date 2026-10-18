import test from 'node:test';
import assert from 'node:assert/strict';
import {proceduralSource, proceduralShot} from '../../web/src/procedural.js';
import {fromV0} from '../../web/src/doc/project.js';

test('procedural sidecar and selected source fields survive v1 migration unchanged', () => {
  const shot={id:'s01',name:'Source scene',t0:0,t1:0.5,procedural:{source_text:'<script>not executable</script>',palette:'Paper',camera:{zoom:[2,3]},hero:[320,540]}};
  const p={schema:'fframestudio.project/0',id:'fixture',title:'Synthetic source',kind:'procedural-fframes',canvas:{fps:30},shots:[shot],renders:[],media:{},procedural:{family:'ff-tracking',editable:false,total_frames:15,fps:30,palettes:{Paper:['#eeeeee']},credits:['Mustafa Saraç'],source_revision:'fixture-sha',future_write_surface:['text']}};
  const d=fromV0(p);
  assert.deepEqual(d.metadata.procedural,p.procedural);
  assert.deepEqual(d.videos[0].clips[0].metadata.procedural,shot.procedural);
  const source=proceduralSource(d.metadata,d.metadata.shots), selected=proceduralShot(d.videos[0].clips[0]);
  assert.match(source,/Source — read-only/);
  assert.match(source,/Metadata only/);
  assert.match(source,/fixture-sha/);
  assert.match(source,/&lt;script&gt;/);
  assert.doesNotMatch(source,/<(?:input|textarea|select|button|script)\b/);
  assert.match(selected,/editorial proxy/);
  assert.match(selected,/zoom/);
  assert.doesNotMatch(selected,/<script>/);
});

test('source event tracks preserve exact frame identities and omit absent waveform', () => {
  const p={family:'ff-unmute',total_frames:480,fps:30,bpm:120,event_frames:{kick:[120,135],token:[353]},editorial_marker_frames:[0,480],camera_keyframes:[{frame:0,time_s:0,zoom:3},{frame:480,time_s:16,zoom:1}]};
  const html=proceduralSource({procedural:p});
  assert.match(html,/data-source-event="token" data-frame="353"/);
  assert.match(html,/data-source-event="camera" data-frame="480"/);
  assert.match(html,/Waveform unavailable/);
  assert.doesNotMatch(html,/<svg/);
  assert.equal(proceduralSource({}), '');
  assert.equal(proceduralShot({}), '');
});
