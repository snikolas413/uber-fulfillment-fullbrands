"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { type ImportRow, type ImportResult, validateImportRow, IMPORT_BATCH_SIZE } from "@/lib/recipient-import";
import { inspectImportAddress, type ImportInspection } from "@/lib/import-address";
import { lookupPostalAddress } from "@/lib/postal-lookup";

async function importContext(rows: ImportRow[]) {
  if (!Array.isArray(rows) || !rows.length || rows.length > IMPORT_BATCH_SIZE) throw new Error(`Envie de 1 a ${IMPORT_BATCH_SIZE} linhas por etapa.`);
  const supabase = await createSupabaseServerClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error("Sua sessão expirou. Entre novamente.");
  const { data: profile, error } = await supabase.from("user_profiles").select("role, is_active").eq("id", auth.user.id).maybeSingle();
  if (error || !profile?.is_active || !["admin", "gestor", "operador"].includes(profile.role)) throw new Error("Seu perfil não tem permissão para importar destinatários.");
  for (const row of rows) {
    if (!row || !Number.isInteger(row.line) || row.line < 2 ||
      ["cpf", "full_name", "phone_number", "email", "endereco", "numero", "complemento", "bairro", "cidade", "estado", "codigo_postal"].some(key => typeof (row as unknown as Record<string, unknown>)[key] !== "string")) {
      throw new Error("Formato de linha inválido. Selecione o arquivo novamente.");
    }
  }
  return supabase;
}

export async function inspectImportAddressesAction(rows: ImportRow[]): Promise<ImportInspection[]> {
  await importContext(rows);
  return inspectRows(rows);
}

async function inspectRows(rows: ImportRow[]) {
  const results: ImportInspection[] = [];
  // Bound concurrency; repeated CEPs share the same cached promise.
  for (let i=0;i<rows.length;i+=4) results.push(...await Promise.all(rows.slice(i,i+4).map(row => inspectImportAddress(row,lookupPostalAddress))));
  return results;
}

export async function importRecipientsAction(rows: ImportRow[]): Promise<ImportResult[]> {
  const supabase = await importContext(rows);
  const results: ImportResult[] = [];
  const inspections = await inspectRows(rows);
  for (let index=0;index<rows.length;index++) {
    const input = rows[index];
    const inspection = inspections[index];
    const row = inspection.row;
    const errors = validateImportRow(row);
    if (errors.length) { results.push({ line: row.line, status: "error", message: errors.join("; ") }); continue; }
    if (inspection.reviewRequired && input.review_confirmed !== true) {
      results.push({line: row.line, status:"error", message:"Confirme a revisão manual: " + inspection.warnings.join("; ")}); continue;
    }
    try {
      // Never overwrite an existing recipient from a file upload.
      const { data: existing, error: lookupError } = await supabase.from("recipients").select("id").eq("document_number", row.cpf).limit(1);
      if (lookupError) { results.push({ line: row.line, status: "error", message: "Não foi possível verificar o CPF. Tente novamente." }); continue; }
      if (existing?.length) { results.push({ line: row.line, status: "skipped", message: "CPF já cadastrado. Use a edição individual para atualizar." }); continue; }
      const { error: saveError } = await supabase.rpc("save_recipient_with_address", {
        p_recipient_id: null, p_full_name: row.full_name.trim(), p_document_number: row.cpf,
        p_email: row.email.trim().toLowerCase() || null, p_phone: row.phone_number || null,
        p_postal_code: row.codigo_postal, p_street: row.endereco.trim(), p_number: row.numero.trim(),
        p_complement: row.complemento.trim() || null, p_district: row.bairro.trim(), p_city: row.cidade.trim(), p_state: row.estado,
      });
      results.push(saveError ? { line: row.line, status: "error", message: "Não foi possível salvar esta linha. Confira os dados e tente novamente." }
        : { line: row.line, status: "created", message: "Destinatário e endereço cadastrados." });
    } catch {
      results.push({ line: row.line, status: "error", message: "Conexão interrompida. Confira o cadastro antes de tentar novamente." });
    }
  }
  revalidatePath("/destinatarios");
  revalidatePath("/");
  return results;
}
