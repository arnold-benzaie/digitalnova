/**
 * Compile-time-only proof that requireStaffMember()'s `permission`
 * parameter is the closed Permission union from lib/rbac/permissions.ts,
 * not an arbitrary string. Never imported or executed at runtime — checked
 * exclusively by `tsc --noEmit`. If this API is ever loosened to accept
 * `string`, the @ts-expect-error below stops suppressing anything and the
 * project fails to typecheck, which is the point.
 */
import { requireStaffMember } from "./require-staff-member";

// @ts-expect-error - "NOT_A_REAL_PERMISSION" is not a member of the closed Permission union.
void requireStaffMember("NOT_A_REAL_PERMISSION");
