import { DOMParser, type Element } from "@xmldom/xmldom";

const NS = "http://www.portalfiscal.inf.br/nfe";
const MAX_XML_BYTES = 2 * 1024 * 1024;
const invalid = () => new Error("A autorização da NF-e no XML não foi confirmada. Nenhuma etiqueta foi solicitada.");

function one(parent: Element, name: string): Element {
  const nodes = parent.getElementsByTagNameNS(NS, name);
  if (nodes.length !== 1) throw invalid();
  return nodes.item(0)!;
}
function value(parent: Element, name: string) {
  const node = one(parent, name);
  if (node.parentNode !== parent || node.childNodes.length !== 1 || node.firstChild?.nodeType !== 3) throw invalid();
  return node.textContent?.trim() ?? "";
}

/** Only trust a processed production NF-e obtained from Omie's authenticated response. */
export function assertXmlAuthorization(xml: string, expected: { key: string; protocol: string; number: string; series: string; issuedDate: string }) {
  if (new TextEncoder().encode(xml).length > MAX_XML_BYTES || /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml) ||
    !/^\d{44}$/.test(expected.key) || !/^\d{15}$/.test(expected.protocol)) throw invalid();
  const doc = new DOMParser({ onError() { throw invalid(); } }).parseFromString(xml, "application/xml");
  const root = doc.documentElement;
  if (!root || root.localName !== "nfeProc" || root.namespaceURI !== NS || doc.doctype) throw invalid();
  const nfe = one(root, "NFe"), prot = one(root, "protNFe"), info = one(nfe, "infNFe"), authorization = one(prot, "infProt");
  const ide = one(info, "ide");
  if (nfe.parentNode !== root || prot.parentNode !== root || info.parentNode !== nfe || authorization.parentNode !== prot ||
    ide.parentNode !== info || info.getAttribute("Id") !== "NFe" + expected.key ||
    value(authorization, "cStat") !== "100" || value(authorization, "tpAmb") !== "1" ||
    value(authorization, "chNFe") !== expected.key || value(authorization, "nProt") !== expected.protocol ||
    value(ide, "tpAmb") !== "1" || value(ide, "mod") !== "55" || value(ide, "tpNF") !== "1" ||
    Number(value(ide, "nNF")) !== Number(expected.number) || Number(value(ide, "serie")) !== Number(expected.series)) throw invalid();
  const issued = value(ide, "dhEmi").slice(0, 10);
  if (issued !== expected.issuedDate.split("/").reverse().join("-") ||
    doc.getElementsByTagNameNS(NS, "infEvento").length || doc.getElementsByTagNameNS(NS, "retEvento").length) throw invalid();
}

function xmlUrl(input: string) {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.hostname !== "cdn.omie.com.br" || url.username || url.password ||
    (url.port && url.port !== "443")) throw invalid();
  return url;
}

export async function verifyOmieXmlAuthorization(url: string, expected: Parameters<typeof assertXmlAuthorization>[1]) {
  let current = xmlUrl(url);
  for (let redirects = 0; redirects < 4; redirects++) {
    const response = await fetch(current, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(30_000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw invalid();
      current = xmlUrl(new URL(location, current).href); continue;
    }
    if (!response.ok || !response.body || Number(response.headers.get("content-length") ?? 0) > MAX_XML_BYTES) throw invalid();
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_XML_BYTES) throw invalid();
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    const bytes = new Uint8Array(size); let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    assertXmlAuthorization(new TextDecoder("utf-8", { fatal: true }).decode(bytes), expected);
    return;
  }
  throw invalid();
}
