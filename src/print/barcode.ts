import bwipjs from 'bwip-js';

/**
 * Printed width of one Code 128 module (the narrowest bar). 0.4 mm is above the 0.33 mm (13 mil)
 * a handheld scanner reads reliably at 10-30 cm and still lets a card code (about 80 modules, 32 mm) fit a 85.6 mm card.
 */
export const DEFAULT_MODULE_MM = 0.4;
export const MIN_MODULE_MM = 0.33;

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Code 128 as an SVG string sized in millimetres, with the text under the bars.
 * bwip-js at scale 1 draws one module per viewBox unit (bars 29 units high, text below), so
 * width and height are the viewBox times the module width. Quiet zones are left to the surrounding layout (at least 10 modules = 4 mm).
 */
export function barcodeSvg(text: string, moduleMm = DEFAULT_MODULE_MM): string {
  if (moduleMm < MIN_MODULE_MM) throw new RangeError(`module width ${moduleMm} mm is below ${MIN_MODULE_MM} mm`);
  const svg = bwipjs.toSVG({ bcid: 'code128', text, scale: 1, height: 10, includetext: true, textxalign: 'center', textsize: 10, paddingwidth: 0, paddingheight: 0 });
  const box = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  if (!box) throw new Error('bwip-js returned an SVG without a viewBox');
  const mm = (units: string) => `${Number((Number(units) * moduleMm).toFixed(2))}mm`;
  return svg.replace('<svg ', `<svg role="img" aria-label="${escapeAttr(text)}" width="${mm(box[1] ?? '0')}" height="${mm(box[2] ?? '0')}" `);
}
