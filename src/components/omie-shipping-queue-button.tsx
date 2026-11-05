"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Truck, LoaderCircle } from "lucide-react";
import { queueOmieShippingAction, type QueueShippingResult } from "@/app/pedidos/shipping-actions";

export function OmieShippingQueueButton({ fulfillmentId }: { fulfillmentId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<QueueShippingResult | null>(null);
  function enqueue() {
    if (!window.confirm("Solicitar ao executor que configure Correios, embalagem UBER, Mini Envios e cotação de frete no pedido já existente? Nenhuma etiqueta ou postagem será gerada.")) return;
    startTransition(async () => {
      const response = await queueOmieShippingAction(fulfillmentId);
      setResult(response);
      if (response.status === "success") router.refresh();
    });
  }
  return <span className="omie-action-wrap">
    <button type="button" className="omie-action-button omie-action-button-small" onClick={enqueue} disabled={pending}>
      {pending ? <LoaderCircle className="auth-spinner" size={13} /> : <Truck size={13} />}
      {pending ? "Enfileirando..." : "Configurar frete"}
    </button>
    {result && <small className={`omie-action-result omie-action-result-${result.status}`} role="status">{result.message}</small>}
  </span>;
}
