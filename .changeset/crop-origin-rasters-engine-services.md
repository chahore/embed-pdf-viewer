---
'@embedpdf/engine-services': patch
---

On pages whose crop box does not start at (0, 0), `renderAppearances` images and renders of a rect target (the viewer's tiles) were shifted by the box origin and clipped. The shared raster helper mapped PDF user space to PDFium's display space as if the page box started at the origin; it now reads the page box (`FPDF_GetPageBoundingBox`) and places rects relative to its corner.
