/**
 * Records the demo video: a guided tour of SkladPulz with Slovak captions.
 *
 *   node --disable-warning=ExperimentalWarning demo/server.ts 3300 &   (wait until it prints the URL)
 *   node demo/record-video.ts http://localhost:3300
 *
 * Writes demo/out/skladpulz-demo.webm and beeps.json; demo/make-video.ts turns them into an MP4 with the station sounds.
 */
import { chromium, type Locator, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:3300';
const OUT = 'demo/out';
const SIZE = { width: 1280, height: 720 };
const raw = await fetch(`${BASE}/health`).catch(() => null);
if (!raw?.ok) throw new Error(`Demo server is not running at ${BASE}`);

mkdirSync(OUT, { recursive: true });
const videoDir = join(OUT, 'raw');
rmSync(videoDir, { recursive: true, force: true });

// LANG makes date inputs show Slovak dates (28. 10. 2026); --lang alone does not in headless Chromium.
const browser = await chromium.launch({ args: ['--lang=sk-SK'], env: { ...process.env, LANG: 'sk_SK.UTF-8', LANGUAGE: 'sk' } });
const context = await browser.newContext({
  viewport: SIZE,
  locale: 'sk-SK',
  timezoneId: 'Europe/Bratislava',
  recordVideo: { dir: videoDir, size: SIZE },
  acceptDownloads: true,
});

// Caption bar and a visible mouse pointer, on every page the tour opens.
await context.addInitScript(() => {
  const install = (): void => {
    if (document.getElementById('__cap')) return;
    const style = document.createElement('style');
    style.textContent = `
      #__cap { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); max-width: 1120px; z-index: 2147483647;
        background: rgba(10, 14, 20, 0.88); color: #fff; font: 600 21px/1.35 system-ui, sans-serif; padding: 12px 22px;
        border-radius: 12px; box-shadow: 0 6px 24px rgba(0,0,0,.35); text-align: center; transition: opacity .25s; pointer-events: none; }
      #__cap small { display: block; font-weight: 400; font-size: 16px; opacity: .85; margin-top: 3px; }
      #__cap.hide { opacity: 0; }
      #__ptr { position: fixed; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%; z-index: 2147483646;
        background: rgba(255, 200, 0, .55); border: 2px solid rgba(180, 120, 0, .9); pointer-events: none; left: -50px; top: -50px;
        transition: transform .12s; }
      #__ptr.down { transform: scale(.7); }
      #__scan { position: fixed; right: 18px; top: 64px; z-index: 2147483647; background: #ffd23f; color: #111; font: 700 20px/1 ui-monospace, monospace;
        padding: 10px 16px; border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,.4); opacity: 0; transition: opacity .2s; pointer-events: none; }
      #__scan.show { opacity: 1; }`;
    document.head.append(style);
    const cap = document.createElement('div');
    cap.id = '__cap';
    cap.className = 'hide';
    const ptr = document.createElement('div');
    ptr.id = '__ptr';
    const scan = document.createElement('div');
    scan.id = '__scan';
    document.body.append(cap, ptr, scan);
    document.addEventListener('mousemove', (e) => {
      ptr.style.left = `${e.clientX}px`;
      ptr.style.top = `${e.clientY}px`;
    });
    document.addEventListener('mousedown', () => ptr.classList.add('down'));
    document.addEventListener('mouseup', () => ptr.classList.remove('down'));
    const saved = sessionStorage.getItem('__cap');
    if (saved) {
      cap.innerHTML = saved;
      cap.className = '';
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
});

const page = await context.newPage();
/** Video time of every station beep, so make-video.ts can add the sounds the recording cannot capture. */
const t0 = Date.now();
const beeps: { at: number; outcome: string }[] = [];
const wait = (ms: number): Promise<void> => page.waitForTimeout(ms);

async function caption(title: string, detail = ''): Promise<void> {
  const htmlText = `${title}${detail ? `<small>${detail}</small>` : ''}`;
  await page.evaluate((h) => {
    sessionStorage.setItem('__cap', h);
    const cap = document.getElementById('__cap');
    if (cap) {
      cap.innerHTML = h;
      cap.className = '';
    }
  }, htmlText);
}

async function hideCaption(): Promise<void> {
  await page.evaluate(() => {
    sessionStorage.removeItem('__cap');
    document.getElementById('__cap')?.classList.add('hide');
  });
}

let mouse = { x: SIZE.width / 2, y: SIZE.height / 2 };
async function pointAt(target: Locator): Promise<{ x: number; y: number }> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error('element not visible');
  const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(mouse.x, mouse.y);
  await page.mouse.move(to.x, to.y, { steps: 18 });
  mouse = to;
  return to;
}

async function click(target: Locator, pause = 500): Promise<void> {
  await pointAt(target);
  await wait(250);
  await target.click();
  await wait(pause);
}

async function scrollTo(y: number, ms = 1200): Promise<void> {
  await page.evaluate((top) => window.scrollTo({ top, behavior: 'smooth' }), y);
  await wait(ms);
}

/** A scanner types the code and Enter; the yellow chip shows what was scanned. */
async function scan(code: string, what: string, after = 2200): Promise<void> {
  await page.evaluate(
    ([c, w]) => {
      const el = document.getElementById('__scan');
      if (el) {
        el.textContent = `pípnutie: ${c}${w ? ` (${w})` : ''}`;
        el.classList.add('show');
      }
    },
    [code, what] as const,
  );
  await wait(500);
  await page.keyboard.type(code, { delay: 18 });
  await page.keyboard.press('Enter');
  const pressed = Date.now() - t0;
  await wait(after);
  const cls = (await page.locator('#status').getAttribute('class')) ?? '';
  const outcome = ['chyba', 'upozornenie', 'ok'].find((o) => cls.split(' ').includes(o)) ?? 'ok';
  beeps.push({ at: pressed + 80, outcome });
  await page.evaluate(() => document.getElementById('__scan')?.classList.remove('show'));
}

async function card(title: string, lines: string[], ms: number): Promise<void> {
  await page.setContent(`<!doctype html><html lang="sk"><body style="margin:0;height:100vh;display:flex;flex-direction:column;justify-content:center;
    align-items:center;background:#11161c;color:#f4f6f8;font-family:system-ui,sans-serif;text-align:center">
    <div style="font-size:64px;font-weight:800;letter-spacing:.01em">${title}</div>
    ${lines.map((l, i) => `<div style="font-size:${i === 0 ? 30 : 24}px;margin-top:${i === 0 ? 26 : 12}px;max-width:1000px;opacity:${i === 0 ? 1 : 0.8}">${l}</div>`).join('')}
    </body></html>`);
  await wait(ms);
}

async function go(path: string): Promise<void> {
  await page.goto(BASE + path);
  await page.waitForLoadState('networkidle');
}

const SKLAD = 'Sklad<span style="color:#6ea8ff">Pulz</span>';

// 1. Intro ------------------------------------------------------------------
await card(SKLAD, ['Meranie výkonu skladníkov pri vychystávaní a balení', 'napojené na KROS ONIX · ukážka s vymyslenými dátami'], 4500);
await card('Na čo to je', [
  'Sklad dnes nevie, kto vychystáva a balí rýchlejšie a kto pomalšie.',
  'Skladník pípne svoju kartu a dodací list – SkladPulz zmeria čas,',
  'z ONIXu doplní počet položiek a hmotnosť a vedúci vidí výkon po ľuďoch.',
], 7000);

// 2. Manager signs in --------------------------------------------------------
await go('/');
await caption('Vedúci skladu sa prihlási', 'Stanice pri skeneroch fungujú bez prihlásenia');
await wait(1500);
await click(page.locator('input[name=name]'));
await page.keyboard.type('veduci', { delay: 60 });
await click(page.locator('input[name=password]'));
await page.keyboard.type('demo', { delay: 80 });
await click(page.locator('main button[type=submit]'), 1200);
await caption('Prehľad staníc', 'Riadok hore: kedy sa naposledy načítali dodacie listy z ONIXu (iba čítanie, do ONIXu sa nič nezapisuje)');
await wait(5000);

// 3. Workers, cards, control codes -------------------------------------------
await click(page.locator('.topbar nav a', { hasText: 'Zamestnanci' }), 1000);
await caption('Evidencia skladníkov', 'Každý dostane kód Z + číslo – vygeneruje sa sám');
await wait(3500);
await click(page.getByRole('link', { name: 'Tlač kariet' }), 1200);
await caption('Karty skladníkov na tlač', 'Čiarový kód Code 128, 10 kariet na A4');
await wait(4000);
await go('/tlac/kody');
await caption('Tabuľka riadiacich kódov na stôl', 'Vychystanie, Balenie, Koniec DL, Pauza, Pokračovať, Odhlásiť');
await wait(3000);
await scrollTo(300, 2500);

// 4. Picking station ---------------------------------------------------------
await hideCaption();
await go('/stanica/1');
await caption('Stanica pri vychystávaní – PC alebo terminál so skenerom', 'Skladník nič nepíše ani neklikne, všetko je pípnutie');
await wait(3500);
await scan('Z0001', 'karta Jána Kováča', 2500);
await caption('Pípne kartu, potom činnosť z tabuľky');
await scan('C-VYCH', 'Vychystanie', 2000);
await caption('Pípne dodací list – začne bežať čas', 'Odberateľ, počet položiek a hmotnosť prišli z ONIXu');
await scan('DL202690001', 'dodací list', 6500);
await caption('Ďalší dodací list = predchádzajúci sa sám ukončí');
await scan('DL202690002', 'ďalší DL', 5000);
await caption('Obed alebo iná práca: PAUZA', 'Čas pauzy sa do DL nezapočíta');
await scan('C-PAUZA', 'Pauza', 4000);
await scan('C-POKRAC', 'Pokračovať', 3000);
await caption('Neznámy kód = červená obrazovka a chybový tón', 'Nič sa nezaznamená');
await scan('DL999999', 'neznámy DL', 3500);
await caption('Hotovo: KONIEC');
await scan('C-KONIEC', 'Koniec DL', 3000);

// 5. Packing station ---------------------------------------------------------
await go('/stanica/3');
await caption('Baliaci stôl má balenie predvolené', 'Stačí pípnuť kartu a dodací list');
await wait(2500);
await scan('Z0003', 'karta Márie Horváthovej', 2000);
await scan('DL202690001', 'DL, ktorý vychystal Ján', 5000);
await caption('Pri stole sa ľudia striedajú', 'Kolegyňa pípne svoju kartu – Máriin čas beží ďalej');
await scan('Z0007', 'karta Evy Nagyovej', 2500);
await caption('Ten istý DL s tou istou činnosťou = upozornenie na duplicitu', 'Oranžová obrazovka, záznam sa uloží a vedúci ho uvidí na kontrolu');
await scan('DL202690001', 'rovnaký DL', 5500);
await scan('C-ODHLAS', 'Odhlásiť', 2500);
await caption('Mária sa vráti a dokončí balenie');
await scan('Z0003', 'karta Márie', 2000);
await scan('C-KONIEC', 'Koniec DL', 3000);

// 6. Reports -----------------------------------------------------------------
await go('/');
await caption('Vedúci vidí, kto práve na čom pracuje');
await wait(3500);
await click(page.locator('.topbar nav a', { hasText: 'Denný prehľad' }), 1200);
await caption('Denný prehľad po skladníkoch', 'DL, položky, kg, čistý čas, rýchlosť za hodinu a výkonový index');
await wait(5000);
await scrollTo(420, 3000);
await caption('Všetky záznamy dňa s filtrom', 'Neukončené a podozrivé záznamy sú zvýraznené a do súhrnu nevstupujú');
await scrollTo(1100, 4000);
await go('/dl/DL202690001');
await caption('Detail dodacieho listu: kto vychystal, kto zabalil, kedy a ako dlho', 'Pri reklamácii „chýba tovar“ je hneď jasné, kto ho mal v rukách');
await wait(6500);

// Excel export, shown as the sheet it produces.
await go('/prehlad');
const exportLink = page.getByRole('link', { name: 'Export do Excelu' });
await caption('Export do Excelu – súhrn aj všetky záznamy');
await pointAt(exportLink);
const [download] = await Promise.all([page.waitForEvent('download'), exportLink.click()]);
const xlsxPath = join(OUT, 'export.xlsx');
await download.saveAs(xlsxPath);
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(xlsxPath);
const sheet = wb.worksheets[0];
const rows: string[] = [];
sheet?.eachRow((row, n) => {
  if (n > 14) return;
  const cells = (row.values as unknown[]).slice(1).map((v) => {
    if (v instanceof Date) return v.toISOString().slice(11, 19);
    if (typeof v === 'number') return v.toLocaleString('sk-SK', { maximumFractionDigits: 1 });
    return v === null || v === undefined ? '' : String(v);
  });
  rows.push(`<tr>${cells.map((c) => `<${n === 1 ? 'th' : 'td'}>${c}</${n === 1 ? 'th' : 'td'}>`).join('')}</tr>`);
});
await page.setContent(`<!doctype html><html><body style="margin:0;background:#e9ecef;font-family:Calibri,Carlito,system-ui,sans-serif">
  <div style="background:#217346;color:#fff;padding:10px 18px;font-size:18px">${download.suggestedFilename()} – hárok „${sheet?.name ?? ''}“</div>
  <table style="border-collapse:collapse;margin:14px;background:#fff;font-size:15px">${rows.join('')}</table>
  <style>td,th{border:1px solid #d0d7de;padding:4px 10px;text-align:right;white-space:nowrap} th{background:#f3f3f3} td:first-child,th:first-child,td:nth-child(2){text-align:left}</style>
  <div style="position:fixed;left:50%;bottom:18px;transform:translateX(-50%);background:rgba(10,14,20,.88);color:#fff;font:600 21px/1.35 system-ui,sans-serif;padding:12px 22px;border-radius:12px;text-align:center">
    Export do Excelu – súhrn aj všetky záznamy<small style="display:block;font-weight:400;font-size:16px;opacity:.85;margin-top:3px">Hárky „Súhrn“ a „Záznamy“, čísla a časy ako skutočné hodnoty Excelu</small></div>
  </body></html>`);
await wait(5500);

// Comparison and index.
await go('/porovnanie?obdobie=tyzden&cinnost=VYCH');
await caption('Porovnanie za týždeň alebo mesiac', 'Odchýlka od priemeru tímu a trend oproti minulému obdobiu');
await wait(6000);
await go('/porovnanie?obdobie=mesiac&cinnost=VYCH&zobrazenie=pasma');
await caption('Namiesto presného poradia sa dajú ukázať pásma', 'Horných 30 % / stred 40 % / dolných 30 %');
await wait(5000);
await go('/index');
await caption('Výkonový index: spravodlivé porovnanie malých a veľkých DL', 'Norma času = pevný čas + čas na položku + príplatok za kg; tím = 100 %');
await wait(4000);
await click(page.getByRole('button', { name: 'Vypočítať z dát' }), 1500);
await caption('Váhy normy sa po 2–4 týždňoch vypočítajú z nameraných dát', 'Vedúci návrh prevezme alebo upraví ručne');
await wait(5500);
const explain = page.getByRole('heading', { name: 'Ako sa počíta výkonový index' });
await explain.scrollIntoViewIfNeeded();
await caption('Zrozumiteľný popis výpočtu pre zákazníka', 'Ak bude index podkladom pre prémie');
await wait(5000);

// Corrections.
await go('/kontrola');
await caption('Záznamy na kontrolu', 'Neukončené (zabudnutý KONIEC), podozrivo krátke alebo dlhé, duplicity');
await wait(4000);
const fixRow = page.locator('tbody tr', { hasText: 'Neukončený' }).first();
await click(fixRow.getByRole('link', { name: 'Opraviť' }), 1200);
const startValue = await page.locator('input[name=start]').inputValue();
const end = new Date(`${startValue.length === 16 ? `${startValue}:00` : startValue}Z`);
end.setUTCMinutes(end.getUTCMinutes() + 9);
await caption('Vedúci doplní skutočný koniec a dôvod');
await click(page.locator('input[name=end]'));
await page.locator('input[name=end]').fill(end.toISOString().slice(0, 19));
await click(page.locator('textarea[name=reason]'));
await page.keyboard.type('Zabudol pípnuť KONIEC, podľa skladníka hotové o 9 minút.', { delay: 22 });
await wait(600);
await click(page.getByRole('button', { name: 'Uložiť opravu' }), 1500);
await caption('Každá oprava sa zapíše: kto, kedy, pôvodná a nová hodnota, dôvod', 'Opravený záznam sa vráti do hodnotenia');
await page.mouse.wheel(0, 500);
await wait(6000);

// Daily e-mail.
await go('/email/nahlad');
await caption('Po poslednej zmene príde vedúcemu súhrn dňa e-mailom', 'S počtom záznamov na kontrolu a voliteľne s Excelom v prílohe');
await wait(6000);
await hideCaption();

// 7. Outro -------------------------------------------------------------------
await card(SKLAD, [
  'Etapa 1 aj 2 sú naprogramované',
  'stanice · napojenie na ONIX · karty a kódy · denný prehľad · Excel',
  'porovnanie · výkonový index · opravy vedúcim · denný e-mail',
  'Ďalej: overenie na ONIX databáze zákazníka, čiarový kód v tlači DL (KROS), test so skenermi v sklade',
], 9000);

await context.close();
await browser.close();
const recorded = readdirSync(videoDir).find((f) => f.endsWith('.webm'));
if (!recorded) throw new Error('no video recorded');
renameSync(join(videoDir, recorded), join(OUT, 'skladpulz-demo.webm'));
writeFileSync(join(OUT, 'beeps.json'), JSON.stringify(beeps));
rmSync(videoDir, { recursive: true, force: true });
console.log(`Video: ${join(OUT, 'skladpulz-demo.webm')}`);
