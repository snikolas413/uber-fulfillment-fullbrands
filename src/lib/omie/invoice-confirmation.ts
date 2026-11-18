import { validNfeKey } from "./shipping-invoice";
import type { BillingStatus } from "./invoice-order";

export const CONFIRMATION_INTERVAL_MS = 61_000;
export const MAX_CONFIRMATION_CHECKS = 20;

/** Confirmation never mutates Omie and must not infer a NF-e from faturada=S alone. */
export function inspectInvoiceConfirmation(status: BillingStatus & {
  ListaNfe?: { numero_nfe?: string; serie_nfe?: string; chave_nfe?: string; protocolo?: string | number; status_nfe?: string; tipo?: string }[];
}, orderId: number, integrationCode: string) {
  if (status.codigo_pedido !== orderId || status.codigo_pedido_integracao !== integrationCode) {
    throw new Error("O vínculo do pedido não foi confirmado. Confira o pedido no Omie.");
  }
  if (status.cancelada === "S") throw new Error("O pedido está cancelado no Omie. Nenhuma nova emissão foi solicitada.");
  if (status.faturada !== "S") return { confirmed: false as const };
  const notes = (status.ListaNfe ?? []).filter(note => note.tipo === "S" && note.status_nfe === "006" && note.protocolo &&
    validNfeKey(note.chave_nfe ?? "") && /^\d{1,9}$/.test(note.numero_nfe ?? "") && /^\d{1,3}$/.test(note.serie_nfe ?? "") &&
    Number(note.chave_nfe!.slice(25, 34)) === Number(note.numero_nfe) && Number(note.chave_nfe!.slice(22, 25)) === Number(note.serie_nfe));
  if (notes.length > 1) throw new Error("Mais de uma NF-e autorizada foi retornada. Confira o pedido no Omie.");
  return notes.length === 1 ? { confirmed: true as const, invoice: notes[0] } : { confirmed: false as const };
}
