"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Send, FileCheck2, Truck, LoaderCircle } from "lucide-react";
import {
  sendOrderToOmieAction,
  syncOmieOrderAction,
  invoiceOrderAction,
  syncOmieShippingAction,
  selectMiniEnviosFreightAction,
  type OmieActionResult,
} from "@/app/pedidos/omie-actions";

type ActionKind = "send" | "sync-order" | "invoice" | "sync-shipping" | "select-mini";

const labels: Record<ActionKind, string> = {
  send: "Enviar ao Omie",
  "sync-order": "Atualizar Omie",
  invoice: "Validar e faturar",
  "sync-shipping": "Sincronizar frete",
  "select-mini": "Tentar frete novamente",
};

const icons = {
  send: Send,
  "sync-order": RefreshCw,
  invoice: FileCheck2,
  "sync-shipping": Truck,
  "select-mini": Truck,
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
        "Esta ação criará o pedido no Omie e selecionará Mini Envios com frete grátis para o cliente automaticamente. O motorista será o destino físico. A etapa do pedido será mantida, sem faturamento ou e-mail automático. Continuar?"
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
          response = await sendOrderToOmieAction(fulfillmentId, false);
          if (response.status === "warning" && response.message.includes("não localizou o código de integração")) {
            const retryAccepted = window.confirm(
              "O Omie não encontrou este código de integração. Você já conferiu a fila de pedidos no ERP e confirmou que ele realmente não foi criado? Só prossiga se tiver certeza, para evitar duplicidade."
            );
            if (retryAccepted) {
              response = await sendOrderToOmieAction(fulfillmentId, true);
            }
          }
          break;
        case "sync-order":
          response = await syncOmieOrderAction(fulfillmentId);
          break;
        case "invoice":
          response = await invoiceOrderAction(fulfillmentId, true);
          break;
        case "sync-shipping":
          response = await syncOmieShippingAction(fulfillmentId);
          break;
        case "select-mini":
          response = await selectMiniEnviosFreightAction(fulfillmentId);
          break;
      }
      setResult(response);
      if (response.status === "success" || response.status === "warning") router.refresh();
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
        {pending ? (kind === "send" ? "Criando pedido e preparando frete..." : "Processando...") : labels[kind]}
      </button>
      {result && (
        <small className={`omie-action-result omie-action-result-${result.status}`} role="status">
          {result.message}
        </small>
      )}
    </span>
  );
}
