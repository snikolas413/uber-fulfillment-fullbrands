export function OperationNotice({message,status}:{message:string|null|undefined;status?:'success'|'warning'|'error'}){
  if(!message)return null;
  if(status==='success')return <small className="omie-action-result omie-action-result-success" role="status">{message}</small>;
  return <details className="operation-notice"><summary>{message.length>100?message.slice(0,100)+'…':message}</summary><p role="status">{message}</p><small>Confira o motivo e ajuste os dados antes de tentar novamente. Se a operação ficou sem confirmação, consulte o Omie primeiro.</small></details>;
}
