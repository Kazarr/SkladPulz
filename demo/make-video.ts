/**
 * Turns demo/out/skladpulz-demo.webm into skladpulz-demo.mp4 (H.264 + AAC) and adds the station beeps
 * logged in beeps.json, since a Playwright recording has no sound. Needs ffmpeg on PATH.
 *
 *   node demo/make-video.ts
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const dir = 'demo/out';
const beeps = JSON.parse(readFileSync(`${dir}/beeps.json`, 'utf8')) as { at: number; outcome: string }[];

// Same tones as src/client/station.ts: [frequency Hz, seconds, square wave].
const TONES: Record<string, [number, number, boolean][]> = {
  ok: [[1320, 0.09, false]],
  upozornenie: [[880, 0.12, false], [880, 0.12, false]],
  chyba: [[220, 0.45, true]],
};

const sources: string[] = [];
for (const b of beeps) {
  let offset = b.at / 1000;
  for (const [freq, dur, square] of TONES[b.outcome] ?? TONES['ok'] ?? []) {
    const wave = square ? `0.18*sgn(sin(2*PI*${freq}*t))` : `0.35*sin(2*PI*${freq}*t)`;
    const ms = Math.round(offset * 1000);
    sources.push(`aevalsrc='${wave}*exp(-3*t/${dur})':d=${dur}:s=44100,adelay=${ms}:all=1`);
    offset += dur + 0.06;
  }
}

const inputs = sources.map((s, i) => `${s}[a${i}]`).join(';');
const mix = `${sources.map((_, i) => `[a${i}]`).join('')}amix=inputs=${sources.length}:normalize=0,apad[aout]`;
execFileSync(
  'ffmpeg',
  [
    '-y', '-v', 'error',
    '-i', `${dir}/skladpulz-demo.webm`,
    '-filter_complex', `${inputs};${mix}`,
    '-map', '0:v', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    '-c:a', 'aac', '-b:a', '96k', '-shortest',
    `${dir}/skladpulz-demo.mp4`,
  ],
  { stdio: 'inherit' },
);
console.log(`Video: ${dir}/skladpulz-demo.mp4 (${beeps.length} pípnutí so zvukom)`);
