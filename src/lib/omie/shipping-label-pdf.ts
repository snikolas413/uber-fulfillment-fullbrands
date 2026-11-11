import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import bwipjs from "bwip-js/node";
import { validNfeKey, type LabelInvoice } from "./shipping-invoice";

const mm = (value: number) => value * 72 / 25.4;

/** Keeps the original carrier page intact, with an independent NF-e footer on each volume. */
export async function composeShippingLabel(sources: Uint8Array[], invoice: LabelInvoice, expectedVolumes: number) {
  if (!validNfeKey(invoice.key) || !sources.length || sources.length > 20) throw new Error("Dados inválidos para montar a etiqueta e a chave da NF-e.");
  const output = await PDFDocument.create();
  output.setTitle("Etiqueta Correios - Pedido " + invoice.orderNumber);
  output.setCreator("Fullbrands Fulfillment");
  const normal = await output.embedFont(StandardFonts.Helvetica);
  const bold = await output.embedFont(StandardFonts.HelveticaBold);
  const barcode = await output.embedPng(await bwipjs.toBuffer({
    bcid: "code128", text: invoice.key, scale: 3, height: 9, includetext: false,
    paddingwidth: 10, paddingheight: 1, backgroundcolor: "FFFFFF",
  }));
  let count = 0;
  for (const bytes of sources) {
    const source = await PDFDocument.load(bytes);
    if (source.isEncrypted || source.getPageCount() > 20) throw new Error("PDF de etiqueta protegido ou com páginas em excesso.");
    for (const original of source.getPages()) {
      if (++count > 20) throw new Error("Quantidade de etiquetas excede 20 volumes.");
      const box = original.getCropBox();
      const rotation = ((original.getRotation().angle % 360) + 360) % 360;
      if (![0, 90, 180, 270].includes(rotation)) throw new Error("Rotação de etiqueta não suportada.");
      const width = rotation % 180 ? box.height : box.width;
      const height = rotation % 180 ? box.width : box.height;
      // Never reduce a whole A4 sheet containing multiple labels into one thermal label.
      if (width > mm(135) || height > mm(190) || width <= 0 || height <= 0) throw new Error("O Omie retornou uma folha fora do formato de etiqueta individual. O PDF original foi preservado; é necessário conferir seu layout antes de imprimir em 100 × 150 mm.");
      const page = output.addPage([mm(100), mm(150)]);
      const scale = Math.min(mm(96) / width, mm(117) / height);
      const drawWidth = width * scale; const drawHeight = height * scale;
      const x = (mm(100) - drawWidth) / 2; const y = mm(150) - mm(2) - drawHeight;
      const embedded = await output.embedPage(original, { left: box.x, bottom: box.y, right: box.x + box.width, top: box.y + box.height });
      page.drawPage(embedded, { x: x + (rotation === 180 || rotation === 270 ? drawWidth : 0),
        y: y + (rotation === 90 || rotation === 180 ? drawHeight : 0),
        width: box.width * scale, height: box.height * scale, rotate: degrees(-rotation) });
      page.drawRectangle({ x: mm(2), y: mm(25), width: mm(96), height: mm(5), color: rgb(0, 0, 0) });
      const title = "DANFE SIMPLIFICADA";
      page.drawText(title, { x: (mm(100) - bold.widthOfTextAtSize(title, 9)) / 2, y: mm(26.4), font: bold, size: 9, color: rgb(1, 1, 1) });
      const text = `NF: ${invoice.number}   Serie: ${invoice.series}   Emissao: ${invoice.issuedDate}`;
      const size = Math.min(7.1, mm(94) / normal.widthOfTextAtSize(text, 1));
      page.drawText(text, { x: mm(3), y: mm(21.7), font: normal, size });
      page.drawImage(barcode, { x: mm(5), y: mm(8.5), width: mm(90), height: mm(10.5) });
      const keyText = invoice.key.match(/.{1,4}/g)!.join(" ");
      const keySize = Math.min(6.3, mm(94) / normal.widthOfTextAtSize(keyText, 1));
      page.drawText(keyText, { x: (mm(100) - normal.widthOfTextAtSize(keyText, keySize)) / 2, y: mm(5.6), font: normal, size: keySize });
    }
  }
  if (count !== expectedVolumes) throw new Error("A quantidade de páginas da etiqueta não corresponde aos volumes do pedido. Confira no Omie antes de imprimir.");
  return output.save();
}
