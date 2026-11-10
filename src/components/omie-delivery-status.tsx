"use client";

import { useState, useTransition } from "react";
import { previewMiniEnviosDeliveryAction, type OmieActionResult } from "@/app/pedidos/omie-actions";

export function OmieDeliveryStatus() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<OmieActionResult | null>(null);
  return <div className="recipient-form-note" style={{ flexWrap: "wrap" }}>
    <span>Tipo de entrega: <strong>Mini Envios</strong>, selecionado automaticamente no envio ao Omie.</span>
    <button type="button" className="secondary-button" disabled={pending} onClick={() => startTransition(async () => {
      setResult(await previewMiniEnviosDeliveryAction());
    })}>{pending ? "Consultando…" : "Conferir tipo no Omie"}</button>
    {result && <span role="status" className={`omie-action-result omie-action-result-${result.status}`} style={{ maxWidth: "100%" }}>{result.message}</span>}
  </div>;
}
