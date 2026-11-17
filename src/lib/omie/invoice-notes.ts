export const DELIVERY_INVOICE_NOTE = "Entrega em domicílio de terceiro destinatário não contribuinte do ICMS";

export function withDeliveryInvoiceNote(existing: string | null | undefined) {
  const current = existing ?? "";
  if (current.normalize("NFC").includes(DELIVERY_INVOICE_NOTE)) return current;
  return current.trim() ? current + "|" + DELIVERY_INVOICE_NOTE : DELIVERY_INVOICE_NOTE;
}

export function sameInvoiceNotes(actual: string | null | undefined, expected: string) {
  const canonical = (value: string) => value.normalize("NFC").replace(/\r\n|\r|\n/g, "|")
    .split("|").map(line => line.trim().replace(/\s+/g, " ")).filter(Boolean).join("|");
  return canonical(actual ?? "") === canonical(expected);
}
