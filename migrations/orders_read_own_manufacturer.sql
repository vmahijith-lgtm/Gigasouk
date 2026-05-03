-- Manufacturers must SELECT orders where they are the assigned manufacturer.
-- Apply if Active Jobs / realtime orders are empty for authenticated workshops.
-- Idempotent with gigasouk_schema.sql and migrations/safe_rls.sql section 4a′.

DROP POLICY IF EXISTS "orders_read_own_manufacturer" ON orders;

CREATE POLICY "orders_read_own_manufacturer"
    ON orders FOR SELECT
    USING (
        manufacturer_id IN (
            SELECT id FROM manufacturers
            WHERE profile_id IN (SELECT id FROM profiles WHERE auth_id = auth.uid())
        )
    );
