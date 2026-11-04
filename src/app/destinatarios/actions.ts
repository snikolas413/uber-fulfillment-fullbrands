"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type RecipientActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

const emptyToNull = (value: string) => value.trim() || null;
const digitsOnly = (value: string) => value.replace(/\D/g, "");

export async function saveRecipientAction(
  _previousState: RecipientActionState,
  formData: FormData,
): Promise<RecipientActionState> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: authData, error: authError } = await supabase.auth.getUser();

    if (authError || !authData.user) {
      return { status: "error", message: "Sua sessão expirou. Entre novamente para continuar." };
    }

    const { data: profile, error: profileError } = await supabase
      .from("user_profiles")
      .select("role, is_active")
      .eq("id", authData.user.id)
      .maybeSingle();

    const writableRoles = ["admin", "gestor", "operador"];
    if (profileError || !profile?.is_active || !writableRoles.includes(profile.role)) {
      return { status: "error", message: "Seu perfil não tem permissão para cadastrar ou editar destinatários." };
    }

    const recipientId = String(formData.get("recipient_id") ?? "").trim() || null;
    if (recipientId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(recipientId)) {
      return { status: "error", message: "Identificador de destinatário inválido." };
    }

    const fullName = String(formData.get("full_name") ?? "").trim();
    const documentNumber = digitsOnly(String(formData.get("document_number") ?? ""));
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const phone = digitsOnly(String(formData.get("phone") ?? ""));
    const postalCode = digitsOnly(String(formData.get("postal_code") ?? ""));
    const street = String(formData.get("street") ?? "").trim();
    const number = String(formData.get("number") ?? "").trim();
    const complement = String(formData.get("complement") ?? "").trim();
    const district = String(formData.get("district") ?? "").trim();
    const city = String(formData.get("city") ?? "").trim();
    const state = String(formData.get("state") ?? "").trim().toUpperCase();

    if (fullName.length < 3) {
      return { status: "error", message: "Informe o nome completo do destinatário." };
    }
    if (documentNumber && ![11, 14].includes(documentNumber.length)) {
      return { status: "error", message: "CPF/CNPJ deve conter 11 ou 14 números." };
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { status: "error", message: "Informe um e-mail válido." };
    }
    if (phone && (phone.length < 10 || phone.length > 13)) {
      return { status: "error", message: "Telefone deve conter DDD e número." };
    }
    if (!/^[0-9]{8}$/.test(postalCode)) {
      return { status: "error", message: "Informe um CEP válido com 8 números." };
    }
    if (!street || !number || !district || !city || !/^[A-Z]{2}$/.test(state)) {
      return { status: "error", message: "Preencha rua, número, bairro, cidade e UF." };
    }

    const { error } = await supabase.rpc("save_recipient_with_address", {
      p_recipient_id: recipientId,
      p_full_name: fullName,
      p_document_number: emptyToNull(documentNumber ?? ""),
      p_email: emptyToNull(email),
      p_phone: emptyToNull(phone),
      p_postal_code: postalCode,
      p_street: street,
      p_number: number,
      p_complement: emptyToNull(complement),
      p_district: district,
      p_city: city,
      p_state: state,
    });

    if (error) {
      if (error.code === "PGRST202" || error.message.includes("save_recipient_with_address")) {
        return {
          status: "error",
          message: "A atualização do banco ainda não foi aplicada. O cadastro será liberado após a publicação da migration.",
        };
      }
      if (error.message.includes("FORBIDDEN")) {
        return { status: "error", message: "Seu perfil não tem permissão para esta operação." };
      }
      if (error.message.includes("RECIPIENT_NOT_FOUND")) {
        return { status: "error", message: "Este destinatário não foi encontrado. Atualize a página e tente novamente." };
      }
      console.error("Erro ao salvar destinatário:", error);
      return { status: "error", message: "Não foi possível salvar o destinatário. Verifique os dados e tente novamente." };
    }

    revalidatePath("/destinatarios");
    revalidatePath("/");
    return { status: "success", message: "Destinatário salvo com sucesso. O histórico de endereços foi preservado." };
  } catch (error) {
    console.error("Falha inesperada ao salvar destinatário:", error);
    return { status: "error", message: "Ocorreu um erro inesperado ao salvar. Tente novamente." };
  }
}
