"use client";

import { useActionState, useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Search, Plus, Pencil, MapPin, Mail, Phone, FileText, Clock3,
  ChevronDown, ChevronUp, X, LoaderCircle, Users, MapPinned, ShieldCheck
} from "lucide-react";
import { saveRecipientAction, type RecipientActionState } from "./actions";

type Address = {
  id: string;
  postal_code: string;
  street: string;
  number: string;
  complement: string | null;
  district: string;
  city: string;
  state: string;
  validation_status: "pending" | "valid" | "invalid" | "manual_review";
  created_at: string;
};

export type Recipient = {
  id: string;
  full_name: string;
  document_number: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
  updated_at: string;
  delivery_addresses: Address[];
};

const initialState: RecipientActionState = { status: "idle", message: "" };

function digits(value: string | null) {
  return (value ?? "").replace(/\D/g, "");
}

function formatDocument(value: string | null) {
  const raw = digits(value);
  if (raw.length === 11) return raw.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  if (raw.length === 14) return raw.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  return value || "Não informado";
}

function formatPostalCode(value: string) {
  return digits(value).replace(/^(\d{5})(\d{3})$/, "$1-$2");
}

function formatAddress(address: Address) {
  const lineOne = [address.street, address.number].filter(Boolean).join(", ");
  const lineTwo = [address.complement, address.district].filter(Boolean).join(" · ");
  return [lineOne, lineTwo, `${address.city}/${address.state}`, formatPostalCode(address.postal_code)].filter(Boolean).join(" · ");
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Data indisponível" : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(date);
}

function latestAddress(recipient: Recipient) {
  return [...(recipient.delivery_addresses ?? [])].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )[0];
}

export function RecipientManagement({
  recipients,
  canWrite,
  loadError,
}: {
  recipients: Recipient[];
  canWrite: boolean;
  loadError?: string | null;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Recipient | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [expandedHistory, setExpandedHistory] = useState<string | null>(null);

  const visibleRecipients = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    if (!term) return recipients;
    const numericTerm = digits(term);
    return recipients.filter((recipient) => {
      const address = latestAddress(recipient);
      const searchable = [
        recipient.full_name,
        recipient.document_number ?? "",
        recipient.email ?? "",
        recipient.phone ?? "",
        address?.city ?? "",
        address?.state ?? "",
        address?.postal_code ?? "",
      ].join(" ").toLocaleLowerCase("pt-BR");
      return searchable.includes(term) || (numericTerm.length > 0 && digits(searchable).includes(numericTerm));
    });
  }, [recipients, search]);

  const addressCount = recipients.reduce((total, recipient) => total + (recipient.delivery_addresses?.length ?? 0), 0);
  const validatedCount = recipients.reduce(
    (total, recipient) => total + (recipient.delivery_addresses ?? []).filter((address) => address.validation_status === "valid").length,
    0,
  );

  const openNew = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (recipient: Recipient) => {
    setEditing(recipient);
    setModalOpen(true);
  };

  const handleSaved = useCallback(() => {
    setModalOpen(false);
    setEditing(null);
    router.refresh();
  }, [router]);

  return (
    <div className="recipient-page">
      <section className="welcome-row recipient-welcome">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> BASE DE DESTINATÁRIOS</div>
          <h1>Destinatários</h1>
          <p className="page-lead">Motoristas, contatos e endereços de entrega da operação Uber.</p>
        </div>
        {canWrite && <button type="button" className="primary-button" onClick={openNew}><Plus size={17} /> Novo destinatário</button>}
      </section>

      <section className="recipient-metrics">
        <article className="recipient-stat"><span className="recipient-stat-icon"><Users size={17} /></span><div><strong>{recipients.length}</strong><small>Destinatários cadastrados</small></div></article>
        <article className="recipient-stat"><span className="recipient-stat-icon"><MapPinned size={17} /></span><div><strong>{addressCount}</strong><small>Versões de endereço</small></div></article>
        <article className="recipient-stat"><span className="recipient-stat-icon"><ShieldCheck size={17} /></span><div><strong>{validatedCount}</strong><small>Endereços validados</small></div></article>
      </section>

      <section className="panel recipient-panel">
        <div className="recipient-toolbar">
          <div><span className="section-kicker">CADASTRO INTERNO</span><h2>Base de motoristas</h2></div>
          <label className="recipient-search"><Search size={16} /><input aria-label="Buscar destinatário" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome, CPF, telefone ou cidade" /></label>
        </div>
        {loadError && <div className="recipient-alert recipient-alert-error">{loadError}</div>}
        {visibleRecipients.length > 0 ? (
          <div className="recipient-table-wrap">
            <table className="recipient-table">
              <thead><tr><th>DESTINATÁRIO</th><th>CONTATO</th><th>ENDEREÇO MAIS RECENTE</th><th>CADASTRO</th><th /></tr></thead>
              <tbody>
                {visibleRecipients.map((recipient) => {
                  const currentAddress = latestAddress(recipient);
                  const addresses = [...(recipient.delivery_addresses ?? [])].sort(
                    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
                  );
                  const historyOpen = expandedHistory === recipient.id;
                  return (
                    <tr key={recipient.id} className="recipient-row-group">
                      <td colSpan={5} className="recipient-row-cell">
                        <div className="recipient-row">
                          <div className="recipient-person">
                            <span className="recipient-avatar">{recipient.full_name.trim().slice(0, 1).toUpperCase() || "D"}</span>
                            <div><strong>{recipient.full_name}</strong><small><FileText size={12} /> {formatDocument(recipient.document_number)}</small></div>
                          </div>
                          <div className="recipient-contact">
                            {recipient.email ? <span><Mail size={12} />{recipient.email}</span> : <small>Sem e-mail informado</small>}
                            {recipient.phone ? <span><Phone size={12} />{recipient.phone}</span> : <small>Sem telefone informado</small>}
                          </div>
                          <div className="recipient-address">
                            {currentAddress ? <><span><MapPin size={13} />{formatAddress(currentAddress)}</span><small className={`address-status address-status-${currentAddress.validation_status}`}>{currentAddress.validation_status === "valid" ? "Validado" : currentAddress.validation_status === "invalid" ? "Inválido" : currentAddress.validation_status === "manual_review" ? "Revisão manual" : "Pendente de validação"}</small></> : <small>Endereço não cadastrado</small>}
                          </div>
                          <div className="recipient-date"><Clock3 size={12} />{formatDate(recipient.created_at)}</div>
                          <div className="recipient-actions">
                            {canWrite && <button type="button" className="icon-action" onClick={() => openEdit(recipient)} aria-label={`Editar ${recipient.full_name}`} title="Editar"><Pencil size={15} /></button>}
                            <button type="button" className="icon-action" onClick={() => setExpandedHistory(historyOpen ? null : recipient.id)} aria-label="Ver histórico de endereços" title="Histórico de endereços">{historyOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
                          </div>
                        </div>
                        {historyOpen && (
                          <div className="address-history">
                            <strong>Histórico de endereços</strong>
                            {addresses.length ? addresses.map((address, index) => (
                              <div className="address-history-item" key={address.id}>
                                <span className="address-history-index">{index === 0 ? "ATUAL" : `V${addresses.length - index}`}</span>
                                <span>{formatAddress(address)}</span>
                                <small>{formatDate(address.created_at)}</small>
                              </div>
                            )) : <small>Nenhum endereço registrado.</small>}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="recipient-empty">
            <span className="recipient-empty-icon"><Users size={24} /></span>
            <strong>{search ? "Nenhum resultado encontrado" : "Sua base de destinatários está vazia"}</strong>
            <p>{search ? "Revise o termo pesquisado ou tente buscar por outro dado." : "Cadastre o primeiro motorista para iniciar a preparação dos pedidos e entregas."}</p>
            {!search && canWrite && <button type="button" className="secondary-button" onClick={openNew}><Plus size={15} /> Cadastrar primeiro destinatário</button>}
          </div>
        )}
        <div className="recipient-table-footer"><span>{visibleRecipients.length} de {recipients.length} destinatário(s)</span><span>Endereços anteriores são preservados no histórico.</span></div>
      </section>

      {modalOpen && (
        <RecipientForm
          key={editing?.id ?? "new-recipient"}
          recipient={editing}
          onClose={() => setModalOpen(false)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

function RecipientForm({
  recipient,
  onClose,
  onSaved,
}: {
  recipient: Recipient | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [state, formAction, pending] = useActionState(saveRecipientAction, initialState);
  const address = recipient ? latestAddress(recipient) : undefined;

  useEffect(() => {
    if (state.status === "success") onSaved();
  }, [state.status, onSaved]);

  return (
    <div className="recipient-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="recipient-modal" role="dialog" aria-modal="true" aria-labelledby="recipient-modal-title">
        <div className="recipient-modal-header">
          <div><span className="section-kicker">{recipient ? "ATUALIZAÇÃO CADASTRAL" : "NOVO CADASTRO"}</span><h2 id="recipient-modal-title">{recipient ? "Editar destinatário" : "Cadastrar destinatário"}</h2><p>Informe os dados do motorista e o endereço de entrega.</p></div>
          <button type="button" className="icon-action" onClick={onClose} aria-label="Fechar"><X size={18} /></button>
        </div>
        <form action={formAction} className="recipient-form">
          <input type="hidden" name="recipient_id" value={recipient?.id ?? ""} />
          <div className="recipient-form-section"><strong>Dados do destinatário</strong><span>Informações para identificação e contato.</span></div>
          <div className="recipient-form-grid">
            <label className="field-wide">Nome completo *<input name="full_name" required minLength={3} maxLength={160} defaultValue={recipient?.full_name ?? ""} placeholder="Nome do motorista" /></label>
            <label>CPF/CNPJ<input name="document_number" inputMode="numeric" defaultValue={recipient?.document_number ?? ""} placeholder="Somente números" maxLength={18} /></label>
            <label>Telefone<input name="phone" inputMode="tel" defaultValue={recipient?.phone ?? ""} placeholder="(00) 00000-0000" maxLength={20} /></label>
            <label className="field-wide">E-mail<input name="email" type="email" defaultValue={recipient?.email ?? ""} placeholder="motorista@email.com" maxLength={160} /></label>
          </div>

          <div className="recipient-form-section recipient-address-section"><strong>Endereço de entrega</strong><span>Ao alterar o endereço, uma nova versão será criada e os endereços ligados a pedidos anteriores serão mantidos.</span></div>
          <div className="recipient-form-grid">
            <label>CEP *<input name="postal_code" required inputMode="numeric" defaultValue={address?.postal_code ?? ""} placeholder="00000-000" maxLength={9} /></label>
            <label className="field-wide">Logradouro *<input name="street" required defaultValue={address?.street ?? ""} placeholder="Rua, avenida, rodovia..." maxLength={180} /></label>
            <label>Número *<input name="number" required defaultValue={address?.number ?? ""} placeholder="Número ou S/N" maxLength={30} /></label>
            <label>Complemento<input name="complement" defaultValue={address?.complement ?? ""} placeholder="Casa, bloco, apto..." maxLength={100} /></label>
            <label>Bairro *<input name="district" required defaultValue={address?.district ?? ""} maxLength={100} /></label>
            <label>Cidade *<input name="city" required defaultValue={address?.city ?? ""} maxLength={100} /></label>
            <label>UF *<input name="state" required defaultValue={address?.state ?? ""} placeholder="SC" maxLength={2} /></label>
          </div>
          <div className="recipient-form-note"><ShieldCheck size={15} /> O cadastro é protegido por perfil e gravado com registro de auditoria.</div>
          {state.status === "error" && <div className="recipient-alert recipient-alert-error">{state.message}</div>}
          <div className="recipient-form-actions">
            <button type="button" className="recipient-cancel" onClick={onClose} disabled={pending}>Cancelar</button>
            <button type="submit" className="primary-button" disabled={pending}>{pending ? <><LoaderCircle className="auth-spinner" size={15} /> Salvando...</> : <><Plus size={15} /> Salvar destinatário</>}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
