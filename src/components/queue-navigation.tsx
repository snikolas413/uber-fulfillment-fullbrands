import Link from 'next/link';
import { listUrl,type ListInfo } from '@/lib/operations-list';
export function QueueFilters({path,views,totals,view,search,placeholder='Nome, pedido, NF-e ou rastreio'}:{path:string;views:Record<string,string>;totals:Record<string,number|null>;view:string;search:string;placeholder?:string}){
  return <div className="queue-controls"><nav className="queue-tabs" aria-label="Filas operacionais">{Object.entries(views).map(([key,label])=><Link key={key} href={listUrl(path,key,search)} aria-current={view===key?'page':undefined}>{label}<span>{totals[key]??'—'}</span></Link>)}</nav><form action={path} className="queue-search"><input type="hidden" name="view" value={view}/><input name="q" aria-label="Buscar nesta fila" placeholder={placeholder} defaultValue={search}/><button className="secondary-button">Buscar</button>{search&&<Link className="secondary-button" href={listUrl(path,view)}>Limpar</Link>}</form></div>;
}
export function QueuePagination({path,view,search,state}:{path:string;view:string;search:string;state:ListInfo}){
  return <div className="recipient-table-footer"><span>{state.count} resultado(s) · Até 100 por página</span><nav className="order-list-pagination" aria-label="Páginas da fila">{state.page>1&&<Link className="secondary-button" href={listUrl(path,view,search,state.page-1)}>Anterior</Link>}<span>Página {state.page} de {state.pageCount}</span>{state.page<state.pageCount&&<Link className="secondary-button" href={listUrl(path,view,search,state.page+1)}>Próxima</Link>}</nav></div>;
}
