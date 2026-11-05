"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { previewOmieShippingAction, updateOmieShippingAction } from "./shipping-actions";

type Props = {
  fulfillmentId: string;
  current?: {
    carrierId?: number | null;
    packageDescription?: string | null;
    packageCount?: number | null;
    freightAmount?: number | null;
    deliveryForecast?: string | null;
    modality?: string | null;
  } | null;
};

function dateToInput(value?: string | null) {
  if (!value) return "";
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}
function dateToOmie(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

export function ShippingEditor({ fulfillmentId, current }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [carrierId, setCarrierId] = useState(String(current?.carrierId ?? ""));
  const [packageDescription, setPackageDescription] = useState(current?.packageDescription ?? "");
  const [packageCount, setPackageCount] = useState(String(current?.packageCount ?? 1));
  const [freightAmount, setFreightAmount] = useState(String(current?.freightAmount ?? ""));
  const [deliveryForecast, setDeliveryForecast] = useState(dateToInput(current?.deliveryForecast));
  const [modality, setModality] = useState(current?.modality === "0" || current?.modality === "1" || current?.modality === "2" ? current.modality : "");
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  function preview() {
    startTransition(async () => {
      const result = await previewOmieShippingAction(fulfillmentId);
      setMessage(result.message);
      if (result.status === "success" && result.current) {
        const value = result.current;
        setCarrierId(String(value.carrierId ?? ""));
        setPackageDescription(String(value.packageDescription ?? ""));
        setPackageCount(String(value.packageCount ?? 1));
        setFreightAmount(String(value.freightAmount ?? ""));
        setDeliveryForecast(dateToInput(String(value.deliveryForecast ?? "")));
        const currentModality = String(value.modality ?? "");
        setModality(currentModality === "0" || currentModality === "1" || currentModality === "2" ? currentModality : "");
        setConfirmed(false);
      }
    });
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    startTransition(async () => {
      const result = await updateOmieShippingAction(fulfillmentId, {
        carrierId: Number(carrierId),
        packageDescription,
        packageCount: Number(packageCount),
        freightAmount: Number(freightAmount.replace(",", ".")),
        deliveryForecast: dateToOmie(deliveryForecast),
        modality: modality as "0" | "1" | "2",
        confirmed,
      });
      setMessage(result.message);
      if (result.status === "success") {
        setConfirmed(false);
        router.refresh();
      }
    });
  }

  return (
    <section className="shipping-editor">
      <button type="button" className="omie-action-button" onClick={() => setOpen((value) => !value)}>
        {open ? "Fechar edição de frete" : "Editar dados de frete"}
      </button>
      {open && (
        <form className="panel shipping-editor-form" onSubmit={submit}>
          <div className="section-kicker">ATUALIZAÇÃO CONTROLADA NO OMIE</div>
          <p>Altera somente os dados de frete do pedido existente. Não cota, contrata, gera etiqueta, fatura ou posta.</p>
          <button type="button" className="omie-action-button" onClick={preview} disabled={isPending}>
            Consultar valores atuais no Omie
          </button>
          <label>
            Código interno da transportadora no Omie
            <input type="number" min="1" step="1" required value={carrierId} onChange={(event) => setCarrierId(event.target.value)} />
          </label>
          <label>
            Embalagem / espécie dos volumes
            <input maxLength={60} required value={packageDescription} onChange={(event) => setPackageDescription(event.target.value)} />
          </label>
          <label>
            Quantidade de volumes
            <input type="number" min="1" max="999" step="1" required value={packageCount} onChange={(event) => setPackageCount(event.target.value)} />
          </label>
          <label>
            Valor do frete (R$)
            <input type="number" min="0" max="999999.99" step="0.01" required value={freightAmount} onChange={(event) => setFreightAmount(event.target.value)} />
          </label>
          <label>
            Previsão de entrega
            <input type="date" required value={deliveryForecast} onChange={(event) => setDeliveryForecast(event.target.value)} />
          </label>
          <label>
            Responsável pelo frete
            <select required value={modality} onChange={(event) => setModality(event.target.value)}>
              <option value="">Selecione</option>
              <option value="0">Remetente (CIF)</option>
              <option value="1">Destinatário (FOB)</option>
              <option value="2">Terceiros</option>
            </select>
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            Conferi transportadora, embalagem, volumes, valor, previsão e responsável pelo frete. Autorizo gravar esses dados no pedido existente do Omie.
          </label>
          <button type="submit" className="omie-action-button" disabled={isPending || !confirmed}>
            {isPending ? "Processando..." : "Confirmar e atualizar frete no Omie"}
          </button>
          {message && <p role="status">{message}</p>}
        </form>
      )}
    </section>
  );
}
