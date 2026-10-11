---
'@embedpdf/engine-services': patch
---

Keep the page a job last released loaded for the next job, one page per open document, instead of closing it at once. A viewer renders the tiles of one page in a row, and each tile parsed the page again; on dense drawings that parse cost more than the tile itself. A kept page closes when another page is released, and the worker host closes idle pages around every write to their document and around font changes, so a write never leaves a stale page behind.
