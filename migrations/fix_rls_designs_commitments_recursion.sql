-- ════════════════════════════════════════════════════════════════
-- fix_rls_designs_commitments_recursion.sql
-- Breaks infinite RLS recursion between:
--   designs_read_live (OR … manufacturer_commitments …)
--   commitments_read_own (OR … designs …)
-- Triggered e.g. by: negotiation_rooms + embed manufacturer_commitments as designer.
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.design_visible_via_mfr_commitment(p_design_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM manufacturer_commitments mc
    INNER JOIN manufacturers m ON m.id = mc.manufacturer_id
    INNER JOIN profiles p ON p.id = m.profile_id
    WHERE mc.design_id = p_design_id
      AND p.auth_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.design_visible_via_mfr_commitment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.design_visible_via_mfr_commitment(uuid) TO authenticated, anon, service_role;

DROP POLICY IF EXISTS "designs_read_live" ON designs;
CREATE POLICY "designs_read_live"
    ON designs FOR SELECT
    USING (
        status = 'live'
        OR designer_id IN (SELECT id FROM profiles WHERE auth_id = auth.uid())
        OR design_visible_via_mfr_commitment(id)
    );
