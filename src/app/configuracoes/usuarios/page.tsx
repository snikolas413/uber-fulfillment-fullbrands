import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { UserManagement } from "./user-management";

export default async function UserManagementPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile, error } = await supabase
    .from("user_profiles")
    .select("role, is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (error || profile?.role !== "admin" || profile.is_active !== true) {
    redirect("/acesso-negado");
  }

  return <UserManagement currentUserId={user.id} />;
}
