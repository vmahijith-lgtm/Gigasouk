-- ════════════════════════════════════════════════════════════════
-- cascade_delete_on_auth_user.sql
--
-- When a user is removed from Supabase Auth (Dashboard → Authentication
-- → delete user), automatically removes application data keyed to that
-- account so no orphaned history remains.
--
-- Apply in Supabase SQL Editor (postgres role). Idempotent: safe to re-run.
--
-- Part A — Foreign keys (CASCADE) so profile/design deletion paths do not
--   fail on NO ACTION. Re-run: DROP IF EXISTS + ADD (idempotent).
--   • designs.designer_id  → profiles(id)  ON DELETE CASCADE
--   • orders.design_id     → designs(id)   ON DELETE CASCADE
--
-- Part B — Trigger + cleanup function (BEFORE DELETE on auth.users)
--
-- IMPORTANT: Uses BEFORE DELETE on auth.users (not AFTER) so public data
-- is removed while the auth row still exists. That avoids failures when
-- profiles.auth_id references auth.users (CASCADE/RESTRICT) or when
-- CASCADE-deleting a profile would violate FKs from orders, etc.
--
-- Scope:
--   • public.* tables in gigasouk_schema (orders, designs, messages, …)
--   • storage.objects rows whose path starts with the deleted auth uid
--     (matches cad-files / design-previews upload layout)
--
-- Note: Multi-party orders where this user was customer, designer, or
-- manufacturer are deleted entirely (full purge for that auth user).
--
-- If data survives after Auth deletion: (1) ensure this file was run in SQL
-- Editor; (2) RLS must be bypassed inside the trigger — we set row_security
-- off for the transaction; (3) profile must match auth_id or primary email.
--
-- Part C — One-time / periodic purge of *orphan* data (users already removed
-- from Auth before the trigger existed, or mismatched auth_id). Run manually:
--   SELECT public.gigasouk_purge_orphan_user_data();
-- Refuses to run if auth.users has zero rows (safety). Idempotent re-run.
-- ════════════════════════════════════════════════════════════════

-- ── Part A: FKs (idempotent) ───────────────────────────────────

ALTER TABLE designs DROP CONSTRAINT IF EXISTS designs_designer_id_fkey;

ALTER TABLE designs
  ADD CONSTRAINT designs_designer_id_fkey
  FOREIGN KEY (designer_id)
  REFERENCES profiles(id)
  ON DELETE CASCADE;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_design_id_fkey;

ALTER TABLE orders
  ADD CONSTRAINT orders_design_id_fkey
  FOREIGN KEY (design_id)
  REFERENCES designs(id)
  ON DELETE CASCADE;

-- ── Part B: delete profile data + auth trigger ──────────────────

CREATE OR REPLACE FUNCTION public.gigasouk_delete_profile_data(p_profile_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  mfr_ids   uuid[];
  order_ids uuid[];
BEGIN
  -- RLS applies even to SECURITY DEFINER unless row_security is off for this txn.
  PERFORM set_config('row_security', 'off', true);

  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[])
  INTO mfr_ids
  FROM manufacturers
  WHERE profile_id = p_profile_id;

  -- regional_price_variants.manufacturer_id does not CASCADE on manufacturer delete
  IF cardinality(mfr_ids) > 0 THEN
    DELETE FROM regional_price_variants WHERE manufacturer_id = ANY (mfr_ids);
  END IF;

  -- Participation rows that must not block deletes
  DELETE FROM bids WHERE bidder_id = p_profile_id;
  DELETE FROM messages WHERE sender_id = p_profile_id;

  SELECT COALESCE(array_agg(DISTINCT o.id), ARRAY[]::uuid[])
  INTO order_ids
  FROM orders o
  WHERE o.customer_id = p_profile_id
     OR o.design_id IN (SELECT id FROM designs WHERE designer_id = p_profile_id)
     OR (cardinality(mfr_ids) > 0 AND o.manufacturer_id = ANY (mfr_ids));

  IF cardinality(order_ids) > 0 THEN
    DELETE FROM payouts WHERE order_id = ANY (order_ids);
    DELETE FROM orders WHERE id = ANY (order_ids);
  END IF;

  UPDATE payouts SET released_by = NULL WHERE released_by = p_profile_id;
  UPDATE qc_records SET manual_admin_id = NULL WHERE manual_admin_id = p_profile_id;

  DELETE FROM designs WHERE designer_id = p_profile_id;

  DELETE FROM notification_log WHERE recipient_id = p_profile_id;
  DELETE FROM wallet_txns WHERE profile_id = p_profile_id;

  DELETE FROM profiles WHERE id = p_profile_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.gigasouk_on_auth_user_deleted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  pid       uuid;
  auth_email text;
BEGIN
  -- One toggle for the whole transaction (public + storage deletes).
  PERFORM set_config('row_security', 'off', true);

  BEGIN
    DELETE FROM storage.objects
    WHERE split_part(name, '/', 1) = OLD.id::text;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'gigasouk_on_auth_user_deleted: storage.objects cleanup skipped: %',
        SQLERRM;
  END;

  SELECT id INTO pid FROM public.profiles WHERE auth_id = OLD.id LIMIT 1;

  IF pid IS NULL THEN
    auth_email := COALESCE(OLD.email::text, '');
    IF auth_email <> '' THEN
      SELECT p.id INTO pid
      FROM public.profiles p
      WHERE lower(trim(p.email)) = lower(trim(auth_email))
      LIMIT 1;
    END IF;
  END IF;

  IF pid IS NOT NULL THEN
    PERFORM public.gigasouk_delete_profile_data(pid);
  ELSE
    RAISE WARNING
      'gigasouk_on_auth_user_deleted: no public.profiles row for auth user % (email=%); app data not purged',
      OLD.id,
      COALESCE(OLD.email::text, '');
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_gigasouk_auth_user_deleted ON auth.users;

CREATE TRIGGER trg_gigasouk_auth_user_deleted
  BEFORE DELETE ON auth.users
  FOR EACH ROW
  EXECUTE PROCEDURE public.gigasouk_on_auth_user_deleted();

REVOKE ALL ON FUNCTION public.gigasouk_delete_profile_data(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.gigasouk_on_auth_user_deleted() FROM PUBLIC;

COMMENT ON FUNCTION public.gigasouk_delete_profile_data(uuid) IS
  'Deletes all GigaSouk rows for a profile (orders, designs, wallet, …). Used when auth.users row is deleted.';

-- ── Part C: purge profiles & storage not tied to any auth.users row ──

CREATE OR REPLACE FUNCTION public.gigasouk_purge_orphan_user_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  r             record;
  n_profiles    int := 0;
  n_storage     bigint := 0;
  auth_user_cnt bigint;
BEGIN
  SELECT count(*) INTO auth_user_cnt FROM auth.users;

  IF auth_user_cnt = 0 THEN
    RAISE EXCEPTION
      'gigasouk_purge_orphan_user_data: auth.users is empty — refusing to delete all profiles';
  END IF;

  PERFORM set_config('row_security', 'off', true);

  FOR r IN
    SELECT p.id AS pid
    FROM public.profiles p
    WHERE p.auth_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.auth_id)
  LOOP
    PERFORM public.gigasouk_delete_profile_data(r.pid);
    n_profiles := n_profiles + 1;
  END LOOP;

  BEGIN
    PERFORM set_config('row_security', 'off', true);
    DELETE FROM storage.objects o
    WHERE split_part(o.name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND split_part(o.name, '/', 1) NOT IN (SELECT u.id::text FROM auth.users u);
    GET DIAGNOSTICS n_storage = ROW_COUNT;
  EXCEPTION
    WHEN undefined_table THEN
      RAISE NOTICE 'gigasouk_purge_orphan_user_data: storage.objects not available';
    WHEN OTHERS THEN
      RAISE WARNING 'gigasouk_purge_orphan_user_data: storage purge skipped: %', SQLERRM;
  END;

  RETURN jsonb_build_object(
    'purged_profiles',        n_profiles,
    'purged_storage_objects', n_storage,
    'auth_users_seen',        auth_user_cnt
  );
END;
$$;

REVOKE ALL ON FUNCTION public.gigasouk_purge_orphan_user_data() FROM PUBLIC;

COMMENT ON FUNCTION public.gigasouk_purge_orphan_user_data() IS
  'Removes public.* + storage keys for profiles whose auth_id is missing or not in auth.users. Run after cleaning up legacy deleted accounts.';
