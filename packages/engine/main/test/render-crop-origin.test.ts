import { afterAll, describe, expect, test } from 'vitest';
import { toPageRef, type PageRaster } from '@embedpdf/engine-core/runtime';
import { createLocalEngine } from '../src/index';
import { pdf } from './helpers/miniPdf';

/**
 * Rasters of a PDF user-space rect — an annotation's appearance, a rect
 * render target — land on that rect whatever the page box's origin. The
 * page paints a blue 80×60 square at [200 60 280 120]; a square annotation
 * with a green appearance sits on the same rect.
 */
const AP = 'q 0 0.8 0 rg 0 0 80 60 re f Q';
const CONTENT = '0 0 1 rg 200 60 80 60 re f';
const page = (boxes: string) =>
  pdf({
    1: '<< /Type /Catalog /Pages 2 0 R >>',
    2: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    3: `<< /Type /Page /Parent 2 0 R ${boxes} /Contents 6 0 R /Annots [4 0 R] >>`,
    4: '<< /Type /Annot /Subtype /Square /Rect [200 60 280 120] /F 4 /AP << /N 5 0 R >> >>',
    5: `<< /Type /XObject /Subtype /Form /BBox [0 0 80 60] /Length ${AP.length} >>\nstream\n${AP}\nendstream`,
    6: `<< /Length ${CONTENT.length} >>\nstream\n${CONTENT}\nendstream`,
  });

const count = (raster: PageRaster, rgb: (r: number, g: number, b: number) => boolean) => {
  const d = new Uint8Array(raster.data);
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && rgb(d[i], d[i + 1], d[i + 2])) n++;
  return n;
};
const blue = (r: number, g: number, b: number) => b > 150 && r < 100 && g < 100;
const green = (r: number, g: number, b: number) => g > 150 && r < 100 && b < 100;

const engine = createLocalEngine({ runtime: { prefer: 'wasm' } });
afterAll(() => engine.destroy());

describe.each([
  ['at the origin', '/MediaBox [0 0 300 400]'],
  ['offset media box', '/MediaBox [20 30 320 430]'],
  ['offset crop box', '/MediaBox [0 0 300 400] /CropBox [10 10 290 390]'],
])('page box %s', (_, boxes) => {
  test.each([0, 90] as const)('rotation %i', async (rotation) => {
    const doc = await engine.open({
      kind: 'bytes',
      id: `${boxes}:${rotation}`,
      bytes: page(boxes),
    });
    try {
      const handle = doc.page(toPageRef(3));
      const square = await handle.render.raw({
        target: { kind: 'rect', rect: { left: 200, bottom: 60, right: 280, top: 120 } },
        viewport: { kind: 'scale', scale: 1 },
        rotation,
        includeAnnotations: false,
      });
      expect(count(square, blue)).toBe(80 * 60);

      const { appearances } = await handle.annotations.renderAppearances({ scale: 1, rotation });
      expect(appearances).toHaveLength(1);
      expect(count(appearances[0]!.raster, green)).toBe(80 * 60);
    } finally {
      await doc.close();
    }
  });
});
