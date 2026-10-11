---
'@embedpdf/engine-services': patch
---

Updating a stamp with a new `source` shows the new image. The writer emptied the old appearance and drew the image into it, but that appearance was already wrapped by the fit step, so the image landed outside its box and the stamp rendered blank. The writer now removes the old appearance and builds a new one as on create, from an annotation handle that has not parsed the old one.
