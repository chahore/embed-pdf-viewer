import { describe, expect, test } from 'vitest';
import { toPageRef, type PageRaster } from '@embedpdf/engine-core/runtime';
import type { PdfRuntimeModule, Ptr } from '@embedpdf/engine-runtime';
import { PagePtrPool } from '../../services/src/document-session/pages/PagePtrPool';
import { createLocalEngine } from '../src/index';
import { pdf } from './helpers/miniPdf';

function fakeRuntime() {
  const loads: number[] = [];
  const closes: number[] = [];
  const runtime = {
    fn: {
      EPDFDoc_LoadPageByObjectNumberNormalized: (_doc: Ptr, pon: number) => {
        loads.push(pon);
        return BigInt(pon) as Ptr;
      },
      FPDF_ClosePage: (ptr: Ptr) => closes.push(Number(ptr)),
    },
  } as unknown as PdfRuntimeModule;
  return { runtime, loads, closes };
}

describe('PagePtrPool', () => {
  test('keeps the last released page loaded for the next job', () => {
    const { runtime, loads, closes } = fakeRuntime();
    const pool = new PagePtrPool(runtime, 1n as Ptr);
    pool.acquire(10);
    pool.release(10);
    pool.acquire(10);
    pool.release(10);
    expect(loads).toEqual([10]);
    expect(closes).toEqual([]);
    expect(pool.isHeld(10)).toBe(false);

    // Releasing another page closes the one kept before it.
    pool.acquire(20);
    expect(closes).toEqual([]);
    pool.release(20);
    expect(closes).toEqual([10]);
    expect(loads).toEqual([10, 20]);
  });

  test('closeIdle closes the kept page and never a held one', () => {
    const { runtime, closes } = fakeRuntime();
    const pool = new PagePtrPool(runtime, 1n as Ptr);
    pool.acquire(10);
    pool.release(10);
    pool.acquire(20);
    pool.closeIdle();
    expect(closes).toEqual([10]);
    expect(pool.isHeld(20)).toBe(true);
    pool.release(20);
    pool.closeAll();
    expect(closes).toEqual([10, 20]);
  });
});

// A page whose content stream paints nothing, with one green square annotation.
const AP = 'q 0 0.8 0 rg 0 0 80 60 re f Q';
const squarePage = pdf({
  1: '<< /Type /Catalog /Pages 2 0 R >>',
  2: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  3: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Annots [4 0 R] >>',
  4: '<< /Type /Annot /Subtype /Square /Rect [200 60 280 120] /F 4 /AP << /N 5 0 R >> >>',
  5: `<< /Type /XObject /Subtype /Form /BBox [0 0 80 60] /Length ${AP.length} >>\nstream\n${AP}\nendstream`,
});

const greenPixels = (raster: PageRaster): number => {
  const d = new Uint8Array(raster.data);
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 1] > 150 && d[i] < 100) n++;
  return n;
};

test('a write to a page kept loaded between jobs shows in the next render', async () => {
  const engine = createLocalEngine({ runtime: { prefer: 'wasm' } });
  const doc = await engine.open({ kind: 'bytes', id: 'kept', bytes: squarePage }, { scope: ['*'] });
  try {
    const page = doc.page(toPageRef(3));
    const content = () =>
      page.render.raw({ viewport: { kind: 'scale', scale: 1 }, includeAnnotations: false });
    expect(greenPixels(await content())).toBe(0);

    // The render above kept the page loaded; flattening rewrites its content
    // stream in the document, not in the loaded page.
    await doc.pages.flatten([toPageRef(3)]);
    expect(greenPixels(await content())).toBe(80 * 60);
  } finally {
    await doc.close();
    await engine.destroy();
  }
});
