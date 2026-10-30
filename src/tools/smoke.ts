/** Deploy tier: `npm run smoke -- http://server:3000` checks the health route and the start page. */
const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
const checks: [string, (r: Response) => Promise<boolean>][] = [
  ['/health', async (r) => r.ok && ((await r.json()) as { ok?: boolean }).ok === true],
  ['/', async (r) => r.ok && (await r.text()).includes('SkladPulz')],
  ['/static/js/station.js', async (r) => r.ok],
];
let failed = 0;
for (const [path, ok] of checks) {
  try {
    const res = await fetch(base + path, { signal: AbortSignal.timeout(10_000) });
    const good = await ok(res);
    console.log(`${good ? 'OK  ' : 'FAIL'} ${path} (${res.status})`);
    if (!good) failed++;
  } catch (e) {
    console.log(`FAIL ${path} (${e instanceof Error ? e.message : String(e)})`);
    failed++;
  }
}
process.exit(failed === 0 ? 0 : 1);
