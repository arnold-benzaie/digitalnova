/**
 * Compile-time-only proof that requireStaffMember()'s `permission`
 * parameter is the closed Permission union from lib/rbac/permissions.ts,
 * not an arbitrary string, and (PHASE OWNER-UI-1 / SECURITY-CLEANUP-1)
 * that isCurrentUserOwner() takes NO argument at all — no workspace
 * resolver, membership lookup, user id, role, or any other override is
 * part of its public API. Never imported or executed at runtime — checked
 * exclusively by `tsc --noEmit`. If either API is ever loosened, the
 * corresponding @ts-expect-error below stops suppressing anything and the
 * project fails to typecheck, which is the point.
 */
import { requireStaffMember, isCurrentUserOwner } from "./require-staff-member";

// @ts-expect-error - "NOT_A_REAL_PERMISSION" is not a member of the closed Permission union.
void requireStaffMember("NOT_A_REAL_PERMISSION");

// @ts-expect-error - isCurrentUserOwner() takes no argument; nothing may be supplied here.
void isCurrentUserOwner("32371e8f-fc5e-4add-a7e4-9d4baf84252e");
