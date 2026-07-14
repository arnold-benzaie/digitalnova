import { ComingSoon } from "@/components/coming-soon";
import { requireStaffRole } from "@/lib/dev-role";

export default async function AdminUsersPage() {
  await requireStaffRole();

  return (
    <ComingSoon
      title="Utilisateurs"
      description="La gestion des comptes et des rôles (admin / staff / client) arrive une fois Clerk connecté avec de vraies clés."
    />
  );
}
