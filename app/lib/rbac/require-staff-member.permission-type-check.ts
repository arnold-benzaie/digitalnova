/**
 * Compile-time-only proof that requireStaffMember()'s `permission`
 * parameter is the closed Permission union from lib/rbac/permissions.ts,
 * not an arbitrary string; that (PHASE OWNER-UI-1 / SECURITY-CLEANUP-1)
 * isCurrentUserOwner() takes NO argument at all; and that (PHASE
 * OWNER-UI-3B) canCurrentUserManageWorkforce() likewise takes NO argument
 * — no workspace resolver, membership lookup, user id, role, or any other
 * override is part of either signal's public API. Never imported or
 * executed at runtime — checked exclusively by `tsc --noEmit`. If any of
 * these APIs is ever loosened, the corresponding @ts-expect-error below
 * stops suppressing anything and the project fails to typecheck, which is
 * the point.
 */
import { requireStaffMember, isCurrentUserOwner, canCurrentUserManageWorkforce } from "./require-staff-member";

// @ts-expect-error - "NOT_A_REAL_PERMISSION" is not a member of the closed Permission union.
void requireStaffMember("NOT_A_REAL_PERMISSION");

// @ts-expect-error - isCurrentUserOwner() takes no argument; nothing may be supplied here.
void isCurrentUserOwner("32371e8f-fc5e-4add-a7e4-9d4baf84252e");

// @ts-expect-error - canCurrentUserManageWorkforce() takes no argument; nothing may be supplied here.
void canCurrentUserManageWorkforce("forged-user");
