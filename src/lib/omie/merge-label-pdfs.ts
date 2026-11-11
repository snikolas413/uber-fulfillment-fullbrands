import { PDFDocument, PrintScaling } from "pdf-lib";

export const MAX_BATCH_BYTES = 20 * 1024 * 1024;
export async function mergeLabelPdfs(files: Uint8Array[]) {
  if (!files.length || files.length > 100 || files.reduce((sum, file) => sum + file.length, 0) > MAX_BATCH_BYTES) throw new Error("Selecione até 100 pedidos e 20 MB de etiquetas por PDF.");
  const output = await PDFDocument.create();
  output.setTitle("Etiquetas Correios com NF-e - Lote");
  output.catalog.getOrCreateViewerPreferences().setPrintScaling(PrintScaling.None);
  for (const bytes of files) {
    const source = await PDFDocument.load(bytes);
    if (source.isEncrypted || !source.getPageCount() || output.getPageCount() + source.getPageCount() > 200) throw new Error("O lote excede 200 etiquetas ou contém um PDF inválido.");
    for (const page of source.getPages()) {
      if (Math.abs(page.getWidth() - 100 * 72 / 25.4) > 0.1 || Math.abs(page.getHeight() - 150 * 72 / 25.4) > 0.1) throw new Error("Uma etiqueta não está no formato 100 × 150 mm. Confira os pedidos individualmente.");
    }
    for (const page of await output.copyPages(source, source.getPageIndices())) output.addPage(page);
  }
  const result = await output.save();
  if (result.length > MAX_BATCH_BYTES) throw new Error("O PDF excede 20 MB. Divida a seleção em lotes menores.");
  return result;
}
