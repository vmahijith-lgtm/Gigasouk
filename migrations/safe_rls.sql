-- ════════════════════════════════════════════════════════════════
-- safe_rls.sql — GigaSouk Privacy Hardening Migration
--
-- Apply this file in your Supabase SQL Editor AFTER gigasouk_schema.sql.
-- It is idempotent (safe to re-run any number of times).
--
-- WHAT THIS DOES (in plain English):
--
--   1. Lets each manufacturer read/update their OWN row (incl. bank
--      info). NO ONE ELSE can see bank details, GST, or address.
--      The marketplace gets sanitised factory data through the
--      backend `/api/v1/available-factories` endpoint instead.
--
--   2. Stops anyone from reading email, phone, wallet_balance, and
--      total_earnings of OTHER users. The columns are still readable
--      to the row owner (via the `/api/auth/me` backend endpoint
--      which uses the service role and is therefore unaffected).
--
--   3. Fixes a handful of broken RLS policies that compared
--      `auth.uid()` to FK columns that point at `profiles.id`
--      (random UUIDs) instead of `profiles.auth_id`. These were
--      fail-safe (denied everything) but now match correctly.
--
-- WHAT THIS DOES NOT CHANGE:
--   • Service-role / backend code keeps full access (bypasses RLS).
--   • Marketplace browsing of factories still works (via backend).
--   • Existing test users / data are untouched.
-- ════════════════════════════════════════════════════════════════


-- ────────────────────────────────────────────────────────────────
-- 1. MANUFACTURERS — self-only access
-- ────────────────────────────────────────────────────────────────

-- Manufacturer reads their OWN row (including bank info)
DROP POLICY IF EXISTS "manufacturers_self_read" ON manufacturers;
CREATE POLICY "manufacturers_self_read"
    ON manufacturers FOR SELECT
    USING (
        profile_id IN (SELECT id FROM profiles WHERE auth_id = auth.uid())
    );

-- Manufacturer updates their OWN row
DROP POLICY IF EXISTS "manufacturers_self_update" ON manufacturers;
CREATE POLICY "manufacturers_self_update"
    ON manufacturers FOR UPDATE
    USING (
        profile_id IN (SELECT id FROM profiles WHERE auth_id = auth.uid())
    );

-- NOTE: No public SELECT policy. Anyone wanting marketplace data
-- goes through the backend's /api/v1/available-factories endpoint,
-- which returns ONLY: city, distance_km, rating, queue_depth.


-- ────────────────────────────────────────────────────────────────
-- 2. PROFILES — hide email / phone / wallet_balance from non-owners
-- ────────────────────────────────────────────────────────────────

-- Frontend frequently joins designs → profiles to show the designer
-- name on product cards, so we keep a public-row SELECT but strip
-- the sensitive columns at the GRANT level.

REVOKE SELECT (email, phone, wallet_balance) ON profiles FROM anon;
REVOKE SELECT (email, phone, wallet_balance) ON profiles FROM authenticated;

-- The row owner reads their own email / phone / wallet via the
-- backend `/api/auth/me` endpoint, which uses the service role key
-- and is therefore not subject to the column REVOKE above.


-- ────────────────────────────────────────────────────────────────
-- 3. DESIGNERS — hide total_earnings from non-owners
-- ────────────────────────────────────────────────────────────────

REVOKE SELECT (total_earnings) ON designers FROM anon;
REVOKE SELECT (total_earnings) ON designers FROM authenticated;

-- Public still sees specialisation, portfolio_url, total_designs.


-- ────────────────────────────────────────────────────────────────
-- 4. FIX BROKEN POLICIES (auth.uid() vs profiles.id mismatch)
-- ────────────────────────────────────────────────────────────────
-- These policies tried to match `auth.uid()` directly against
-- profile-id FK columns. Because `auth.uid()` returns the
-- `auth.users.id` (= `profiles.auth_id`) and NOT `profiles.id`,
-- they never matched and silently denied access.
-- Replace with the IN-subquery pattern that resolves through
-- profiles.auth_id correctly.

-- 4a. orders — customer can read own orders
DROP POLICY IF EXISTS "orders_read_own_customer" ON orders;
CREATE POLICY "orders_read_own_customer"
    ON orders FOR SELECT
    USING (
        customer_id IN (SELECT id FROM profiles WHERE auth_id = auth.uid())
    );

-- 4a′. orders — manufacturer assigned on the order can read it (dashboard / realtime)
DROP POLICY IF EXISTS "orders_read_own_manufacturer" ON orders;
CREATE POLICY "orders_read_own_manufacturer"
    ON orders FOR SELECT
    USING (
        manufacturer_id IN (
            SELECT id FROM manufacturers
            WHERE profile_id IN (SELECT id FROM profiles WHERE auth_id = auth.uid())
        )
    );

-- 4b. wallet_txns — read own wallet history
DROP POLICY IF EXISTS "wallet_read_own" ON wallet_txns;
CREATE POLICY "wallet_read_own"
    ON wallet_txns FOR SELECT
    USING (
        profile_id IN (SELECT id FROM profiles WHERE auth_id = auth.uid())
    );

-- 4c. designs — public reads live; owner reads any of their own
DROP POLICY IF EXISTS "designs_read_live" ON designs;
CREATE POLICY "designs_read_live"
    ON designs FOR SELECT
    USING (
        status = 'live'
        OR designer_id IN (SELECT id FROM profiles WHERE auth_id = auth.uid())
        OR id IN (
            SELECT mc.design_id
            FROM manufacturer_commitments mc
            INNER JOIN manufacturers m ON m.id = mc.manufacturer_id
            INNER JOIN profiles p ON p.id = m.profile_id
            WHERE p.auth_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "designs_edit_own" ON designs;
CREATE POLICY "designs_edit_own"
    ON designs FOR ALL
    USING (
        designer_id IN (SELECT id FROM profiles WHERE auth_id = auth.uid())
    )
    WITH CHECK (
        designer_id IN (SELECT id FROM profiles WHERE auth_id = auth.uid())
    );

-- 4d. negotiation_rooms
DROP POLICY IF EXISTS "rooms_read_participants" ON negotiation_rooms;
CREATE POLICY "rooms_read_participants"
    ON negotiation_rooms FOR SELECT
    USING (
        designer_id IN (SELECT id FROM profiles WHERE auth_id = auth.uid())
        OR manufacturer_id IN (
            SELECT id FROM manufacturers
            WHERE profile_id IN (SELECT id FROM profiles WHERE auth_id = auth.uid())
        )
    );

-- 4e. messages
DROP POLICY IF EXISTS "messages_read_participants" ON messages;
CREATE POLICY "messages_read_participants"
    ON messages FOR SELECT
    USING (
        room_id IN (
            SELECT id FROM negotiation_rooms
            WHERE designer_id IN (SELECT id FROM profiles WHERE auth_id = auth.uid())
               OR manufacturer_id IN (
                   SELECT id FROM manufacturers
                   WHERE profile_id IN (SELECT id FROM profiles WHERE auth_id = auth.uid())
               )
        )
    );

DROP POLICY IF EXISTS "messages_insert_own" ON messages;
CREATE POLICY "messages_insert_own"
    ON messages FOR INSERT
    WITH CHECK (
        sender_id IN (SELECT id FROM profiles WHERE auth_id = auth.uid())
    );

-- 4f. manufacturer_commitments
DROP POLICY IF EXISTS "commitments_read_own" ON manufacturer_commitments;
CREATE POLICY "commitments_read_own"
    ON manufacturer_commitments FOR SELECT
    USING (
        manufacturer_id IN (
            SELECT id FROM manufacturers
            WHERE profile_id IN (SELECT id FROM profiles WHERE auth_id = auth.uid())
        )
        OR design_id IN (
            SELECT id FROM designs
            WHERE designer_id IN (SELECT id FROM profiles WHERE auth_id = auth.uid())
        )
    );

-- 4g. bids
DROP POLICY IF EXISTS "bids_read_participants" ON bids;
CREATE POLICY "bids_read_participants"
    ON bids FOR SELECT
    USING (
        negotiation_room_id IN (
            SELECT id FROM negotiation_rooms
            WHERE designer_id IN (SELECT id FROM profiles WHERE auth_id = auth.uid())
               OR manufacturer_id IN (
                   SELECT id FROM manufacturers
                   WHERE profile_id IN (SELECT id FROM profiles WHERE auth_id = auth.uid())
               )
        )
    );

DROP POLICY IF EXISTS "bids_insert_own" ON bids;
CREATE POLICY "bids_insert_own"
    ON bids FOR INSERT
    WITH CHECK (
        bidder_id IN (SELECT id FROM profiles WHERE auth_id = auth.uid())
    );

-- 4h. payouts (designer / manufacturer share)
DROP POLICY IF EXISTS "payouts_read_designer" ON payouts;
CREATE POLICY "payouts_read_designer"
    ON payouts FOR SELECT
    USING (
        order_id IN (
            SELECT o.id FROM orders o
            JOIN designs d ON o.design_id = d.id
            WHERE d.designer_id IN (
                SELECT id FROM profiles WHERE auth_id = auth.uid()
            )
        )
    );

-- 4i. regional_price_variants
DROP POLICY IF EXISTS "variants_read_own" ON regional_price_variants;
CREATE POLICY "variants_read_own"
    ON regional_price_variants FOR SELECT
    USING (
        design_id IN (
            SELECT id FROM designs
            WHERE designer_id IN (SELECT id FROM profiles WHERE auth_id = auth.uid())
        )
        OR manufacturer_id IN (
            SELECT id FROM manufacturers
            WHERE profile_id IN (SELECT id FROM profiles WHERE auth_id = auth.uid())
        )
    );

-- 4j. qc_records — profile_id must resolve via profiles.auth_id (not raw auth.uid())
DROP POLICY IF EXISTS "qc_read_manufacturer"   ON qc_records;
DROP POLICY IF EXISTS "qc_insert_manufacturer" ON qc_records;
CREATE POLICY "qc_read_manufacturer"
    ON qc_records FOR SELECT
    USING (
        manufacturer_id IN (
            SELECT id FROM manufacturers
            WHERE profile_id IN (SELECT id FROM profiles WHERE auth_id = auth.uid())
        )
    );
CREATE POLICY "qc_insert_manufacturer"
    ON qc_records FOR INSERT
    WITH CHECK (
        manufacturer_id IN (
            SELECT id FROM manufacturers
            WHERE profile_id IN (SELECT id FROM profiles WHERE auth_id = auth.uid())
        )
    );


-- ════════════════════════════════════════════════════════════════
-- DONE (database tables).
--   • Next: run migrations/storage_rls.sql once buckets cad-files and
--     design-previews exist (locks Storage uploads to auth.uid() folders).
--   • Re-running this script is safe (every CREATE is preceded by DROP IF EXISTS).
--   • To verify, in the Supabase Table Editor select the "manufacturers"
--     table → Policies tab; you should see the two new self-only
--     policies. The `bank_account_no` etc. columns are NOT visible
--     to anon/authenticated callers — only to the row owner via the
--     backend's service-role key.
-- ════════════════════════════════════════════════════════════════
