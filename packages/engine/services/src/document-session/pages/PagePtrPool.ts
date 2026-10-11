import type { PageObjectNumber } from '@embedpdf/engine-core/runtime';
import { EngineError, EngineErrorCode } from '@embedpdf/engine-core/runtime';
import type { PdfRuntimeModule, Ptr } from '@embedpdf/engine-runtime';

/**
 * Manages pagePtr lifetime for a single open `DocumentSession`.
 *
 * `acquire(pon)` returns a loaded pagePtr for the given PDF object number,
 * loading it via `EPDFDoc_LoadPageByObjectNumberNormalized` (rotation forced
 * to 0deg so render/text/geometry/annotation coordinates all share one
 * normalized space) if not already in the pool. `release(pon)` decrements the
 * refcount and closes when it reaches
 * zero; `closeAll()` is called by `DocumentSession.close()`.
 *
 * While at least one holder is active the pagePtr is shared (refcounted),
 * so overlapping `acquire(pon)` calls for the same page reuse a single
 * load. Once the refcount reaches zero the page stays loaded until another
 * page is released (an LRU of one): a viewer renders the tiles of one page
 * in a row, and each would otherwise parse the page again. `closeIdle()`
 * closes it early, for writes that change a page under its pagePtr.
 */
export class PagePtrPool {
  private readonly counts = new Map<PageObjectNumber, { ptr: Ptr; refs: number }>();

  constructor(
    private readonly runtime: PdfRuntimeModule,
    private readonly docPtr: Ptr,
  ) {}

  acquire(pageObjectNumber: PageObjectNumber): Ptr {
    const { fn } = this.runtime;
    const existing = this.counts.get(pageObjectNumber);
    if (existing) {
      existing.refs++;
      return existing.ptr;
    }
    const ptr = fn.EPDFDoc_LoadPageByObjectNumberNormalized(this.docPtr, pageObjectNumber);
    if (!ptr) {
      throw new EngineError(
        EngineErrorCode.NotFound,
        `no page with object number ${pageObjectNumber}`,
      );
    }
    this.counts.set(pageObjectNumber, { ptr, refs: 1 });
    return ptr;
  }

  /**
   * True while at least one holder has the page open; the page kept loaded
   * between jobs is not held. Page-STRUCTURE mutations (delete) assert on
   * this: thread confinement means no other job can be mid-flight, so a held
   * pagePtr during a structural mutation is a leaked `acquire` (an internal
   * bug) — the mutator fails loudly instead of mutating under a live handle.
   */
  isHeld(pageObjectNumber: PageObjectNumber): boolean {
    return (this.counts.get(pageObjectNumber)?.refs ?? 0) > 0;
  }

  release(pageObjectNumber: PageObjectNumber): void {
    const entry = this.counts.get(pageObjectNumber);
    if (!entry) return;
    entry.refs--;
    if (entry.refs > 0) return;
    for (const [other, { ptr, refs }] of this.counts) {
      if (other !== pageObjectNumber && refs <= 0) this.close(other, ptr);
    }
  }

  /** Close the pages no holder has open. */
  closeIdle(): void {
    for (const [pageObjectNumber, { ptr, refs }] of this.counts) {
      if (refs <= 0) this.close(pageObjectNumber, ptr);
    }
  }

  closeAll(): void {
    const { fn } = this.runtime;
    for (const { ptr } of this.counts.values()) {
      fn.FPDF_ClosePage(ptr);
    }
    this.counts.clear();
  }

  private close(pageObjectNumber: PageObjectNumber, ptr: Ptr): void {
    this.runtime.fn.FPDF_ClosePage(ptr);
    this.counts.delete(pageObjectNumber);
  }
}
