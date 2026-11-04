"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Send, FileCheck2, Truck, LoaderCircle } from "lucide-react";
import {
  sendOrderToOmieAction,
  syncOmieOrderAction,
  invoiceOrderAction,
  syncOmieShippingAction,
  type OmieActionResult,
} from "@/app/pedidos/omie-actions";

type ActionKind = "send" | "sync-order" | "invoice" | "sync-shipping";

const labels: Record<ActionKind, string> = {
  send: "Enviar ao Omie",
  "sync-order": "Atualizar Omie",
  invoice: "Validar e faturar",
  "sync-shipping": "Sincronizar frete",
};

const icons = {
  send: Send,
  "sync-order": RefreshCw,
  invoice: FileCheck2,
  "sync-shipping": Truck,
};

export function OmieActionButton({
  fulfillmentId,
  kind,
  size = "normal",
}: {
  fulfillmentId: string;
  kind: ActionKind;
  size?: "normal" | "small";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<OmieActionResult | null>(null);
  const Icon = icons[kind];

  function run() {
    if (kind === "send") {
      const accepted = window.confirm(
        "Esta ação criará um pedido de venda real no Omie para Uber, com o motorista como destino físico. O e-mail será preenchido, mas nenhum e-mail automático será disparado. Continuar?"
      );
      if (!accepted) return;
    }
    if (kind === "invoice") {
      const accepted = window.confirm(
        "Atenção: esta ação solicitará o faturamento ao Omie e poderá emitir uma NF-e real. Confirme que o pedido está liberado para faturamento e que a operação fiscal foi conferida. Continuar?"
      );
      if (!accepted) return;
    }

    startTransition(async () => {
      let response: OmieActionResult;
      switch (kind) {
        case "send":
          response = await sendOrderToOmieAction(fulfillmentId, true);
          break;
        case "sync-order":
          response = await syncOmieOrderAction(fulfillmentId);
          break;
        case "invoice":
          response = await invoiceOrderAction(fulfillmentId);
          break;
        case "sync-shipping":
          response = await syncOmieShippingAction(fulfillmentId);
          break;
      }
      setResult(response);
      if (response.status === "success") router.refresh();
    });
  }

  return (
    <span className="omie-action-wrap">
      <button
        type="button"
        className={`omie-action-button ${size === "small" ? "omie-action-button-small" : ""}`}
        onClick={run}
        disabled={pending}
      >
        {pending ? <LoaderCircle className="auth-spinner" size={13} /> : <Icon size={13} />}
        {pending ? "Processando..." : labels[kind]}
      </button>
      {result && (
        <small className={`omie-action-result omie-action-result-${result.status}`} role="status">
          {result.message}
        </small>
      )}
    </span>
  );
}
