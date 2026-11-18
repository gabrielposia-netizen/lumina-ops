import { PDFDocument } from '../vendor/pdf-lib.esm.min.js';

const MM = 72 / 25.4;

export const LABEL_SIZES = [
  { id: '100x150', label: '100 × 150 mm', widthMm: 100, heightMm: 150 },
  { id: '100x200', label: '100 × 200 mm', widthMm: 100, heightMm: 200 },
  { id: '105x148', label: '105 × 148 mm (A6)', widthMm: 105, heightMm: 148 },
];

export async function mergeShippingAndPacking(inputBytes, options) {
  const src = await PDFDocument.load(inputBytes);
  const out = await PDFDocument.create();
  const pages = src.getPages();
  const outW = options.widthMm * MM;
  const outH = options.heightMm * MM;
  const gap = Math.max(0, options.gapMm ?? 2) * MM;
  const crop = Math.min(0.7, Math.max(0.25, options.packingCropRatio ?? 0.4));
  const canhotoBand = Math.min(0.45, Math.max(0.22, options.canhotoBandRatio ?? 0.34));
  let orphanTrailing = false;
  let outputLabels = 0;

  for (let index = 0; index < pages.length; index += 2) {
    const shipPage = pages[index];
    const packPage = pages[index + 1];
    const page = out.addPage([outW, outH]);
    const shipSize = shipPage.getSize();
    const shipEmbed = await out.embedPage(shipPage);
    let packEmbed = null;
    if (packPage) {
      const packSize = packPage.getSize();
      const keepH = packSize.height * crop;
      packEmbed = await out.embedPage(packPage, {
        left: 0,
        bottom: packSize.height - keepH,
        right: packSize.width,
        top: packSize.height,
      });
    } else {
      orphanTrailing = true;
    }
    if (packEmbed) {
      const packH = outH * canhotoBand;
      const shipH = outH - packH - gap;
      page.drawPage(packEmbed, { x: 0, y: 0, width: outW, height: packH });
      page.drawPage(shipEmbed, { x: 0, y: packH + gap, width: outW, height: shipH });
    } else {
      page.drawPage(shipEmbed, { x: 0, y: 0, width: outW, height: outH });
    }
    outputLabels += 1;
  }

  return { bytes: await out.save(), inputPages: pages.length, outputLabels, orphanTrailing };
}

export function openUnifiedPdf(bytes, filename) {
  const copy = new Uint8Array(bytes);
  const blob = new Blob([copy], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  const preview = window.open(url);
  if (preview) preview.addEventListener('load', () => preview.print());
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
