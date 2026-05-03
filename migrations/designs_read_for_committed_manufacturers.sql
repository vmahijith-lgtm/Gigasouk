-- Manufacturers must read design metadata (title, preview) for designs they have committed to,
-- even when status is seeking/committed (not only live). Required for Active Jobs + embedded selects.

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
