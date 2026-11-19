export const auditLabels:Record<string,string>={
 'recipient.created':'Destinatário cadastrado','recipient.updated':'Cadastro atualizado','fulfillment.prepared':'Pedido preparado',
 'omie.order.created':'Pedido criado no Omie','omie.order.synced':'Pedido conferido no Omie','omie.order.cancellation_synced':'Cancelamento sincronizado',
 'omie.operation.failed':'Operação com erro','omie.invoice.result':'Resultado do faturamento','omie.invoice.confirmation':'Conferência da NF-e',
 'omie.separation.confirmed':'Envio para separação confirmado','omie.separation.failed':'Falha no envio para separação',
 'shipping.label_ready':'Etiqueta pronta para impressão','shipping.label_failed':'Falha na etiqueta','shipping.label_retry_authorized':'Nova tentativa de etiqueta confirmada',
 'shipping.invoice_xml_verified':'Autorização da NF-e conferida pelo XML','omie.shipping.synced':'Dados de entrega atualizados',
 'omie.freight.manual_adjustment_confirmed':'Ajuste manual de frete conferido',
};
export function auditDescription(action:string){
  if(auditLabels[action])return auditLabels[action];
  if(action.includes('confirmation'))return 'Conferência do faturamento';
  if(action.includes('freight'))return 'Atualização do frete';
  if(action.includes('order'))return 'Atualização do pedido';
  return 'Movimentação da operação';
}
