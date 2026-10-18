import { spawn } from 'node:child_process';
let raw = ''; for await (const c of process.stdin) raw += c;
const s = JSON.parse(raw);
const watch = setInterval(() => { if (process.ppid !== s.parentPid) process.exit(1); }, 500); watch.unref();
for (let i = 1; i <= 5; i++) {
  await new Promise(r => setTimeout(r, 180));
  console.log(JSON.stringify({ progress: i / 10 }));
}
// Only available behind a bridge CLI test flag. Never called an AI result.
if (s.prompt === '[test:fail]') { console.error(process.env.FFS_TEST_SECRET || 'test failure'); process.exit(1); }
if (s.prompt === '[test:invalid]') { const fs = await import('node:fs'); fs.writeFileSync(s.output, 'not a video'); process.exit(0); }
const child = spawn('ffmpeg', ['-v', 'error', '-nostdin', '-f', 'lavfi', '-i', `testsrc2=size=${s.width}x${s.height}:rate=${s.fps}`, '-t', String(s.duration), '-an', '-c:v', 'libx264', '-threads', '2', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-n', s.output], { stdio: 'ignore' });
process.on('SIGTERM', () => child.kill('SIGTERM'));
child.on('error', () => process.exit(1)); child.on('close', c => process.exit(c ?? 1));
