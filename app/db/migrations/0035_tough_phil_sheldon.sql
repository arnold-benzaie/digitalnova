-- RBAC-OWNER-DB-INVARIANT — hand-appended, human-approved (mirrors 0034's
-- own hand-appended seed convention): normalize the OWNER staff_roles row
-- to a fixed, well-known id BEFORE creating the partial unique index below,
-- then DB-enforce AT-MOST-ONE OWNER membership per workspace.
--
-- Runs inside the migration runner's own wrapping transaction (drizzle-orm
-- migrate() wraps the whole batch in one session.transaction(...)) — no
-- BEGIN/COMMIT here. Any failure (missing/ambiguous OWNER, fixed-id
-- collision, an unrepointed/unknown FK dependency surfacing at DELETE
-- time, or a pre-existing multi-OWNER-per-workspace violation surfacing
-- at CREATE UNIQUE INDEX time) rolls back this entire block atomically:
-- the old OWNER role, its id, and every original reference are left
-- exactly as they were. Idempotent: a re-run that finds OWNER's id
-- already equal to the fixed id is a safe no-op.
--
-- Does NOT enforce at-least-one: zero OWNER staff_members rows is legal
-- both before and immediately after this migration. The controlled
-- bootstrap tool (scripts/bootstrap-first-staff-owner.mjs) establishes
-- the initial operational exactly-one separately, and needs no change —
-- it already resolves OWNER by name, never by a literal id.
DO $$
DECLARE
  v_old_owner_id staff_roles.id%TYPE;
  v_fixed_owner_id CONSTANT uuid := '6a615714-4eb7-44f3-993b-f113292f0aa2';
  v_temp_name CONSTANT text := '__owner_role_migrating_6a615714__';
BEGIN
  -- 1-3: resolve exactly one OWNER role by name; fails closed (raises)
  -- if OWNER is missing. staff_roles.name is UNIQUE, so ">1 match" is
  -- already structurally impossible.
  SELECT id INTO STRICT v_old_owner_id FROM staff_roles WHERE name = 'OWNER';

  -- Idempotent no-op: this migration already fully completed once.
  IF v_old_owner_id = v_fixed_owner_id THEN
    RETURN;
  END IF;

  -- 4: fixed UUID must not already belong to an unrelated role.
  IF EXISTS (SELECT 1 FROM staff_roles WHERE id = v_fixed_owner_id) THEN
    RAISE EXCEPTION 'staff_roles already has a row with the fixed OWNER id % that is not named OWNER', v_fixed_owner_id;
  END IF;

  -- Defensive temporary-name collision check (the INSERT below's own
  -- staff_roles.name UNIQUE constraint would also catch this).
  IF EXISTS (SELECT 1 FROM staff_roles WHERE name = v_temp_name) THEN
    RAISE EXCEPTION 'staff_roles already has a row named the temporary migration placeholder %', v_temp_name;
  END IF;

  -- 5: temporary fixed-id role, placeholder name (name is legal to reuse
  -- once the old 'OWNER'-named row is deleted below).
  INSERT INTO staff_roles (id, name) VALUES (v_fixed_owner_id, v_temp_name);

  -- 6: repoint every known dependent FK from the old id to the fixed id.
  UPDATE staff_members SET role_id = v_fixed_owner_id WHERE role_id = v_old_owner_id;
  UPDATE staff_invitations SET role_id = v_fixed_owner_id WHERE role_id = v_old_owner_id;

  -- 7: delete the old OWNER role. This is ALSO the defensive check
  -- against any unknown/unrepointed FK dependency: if some other table
  -- still references v_old_owner_id, this DELETE fails with a standard
  -- foreign-key-violation error and the whole migration rolls back.
  DELETE FROM staff_roles WHERE id = v_old_owner_id;

  -- 8: rename the temporary role to OWNER.
  UPDATE staff_roles SET name = 'OWNER' WHERE id = v_fixed_owner_id;

  -- 9: verify. Row-count check first (NULL-safe), then identity check
  -- (safe only once exactly one row is already confirmed to exist).
  IF (SELECT count(*) FROM staff_roles WHERE name = 'OWNER') <> 1 THEN
    RAISE EXCEPTION 'post-rewrite verification failed: staff_roles does not have exactly one OWNER row';
  END IF;
  IF (SELECT id FROM staff_roles WHERE name = 'OWNER') <> v_fixed_owner_id THEN
    RAISE EXCEPTION 'post-rewrite verification failed: OWNER role id does not equal the fixed id';
  END IF;
  IF EXISTS (SELECT 1 FROM staff_members WHERE role_id = v_old_owner_id)
     OR EXISTS (SELECT 1 FROM staff_invitations WHERE role_id = v_old_owner_id) THEN
    RAISE EXCEPTION 'post-rewrite verification failed: a reference to the old OWNER id still exists';
  END IF;
END $$;
--> statement-breakpoint
-- 10: DB-enforced AT-MOST-ONE OWNER per workspace. If pre-existing data
-- already violates it (multiple OWNER memberships in the same
-- workspace), this statement itself refuses — fail-closed, no automatic
-- winner is chosen, no membership is deleted or demoted.
CREATE UNIQUE INDEX "staff_members_one_owner_per_workspace" ON "staff_members" USING btree ("workspace_org_id") WHERE "staff_members"."role_id" = '6a615714-4eb7-44f3-993b-f113292f0aa2'::uuid;
