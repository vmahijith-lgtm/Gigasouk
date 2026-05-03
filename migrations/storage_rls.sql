-- ════════════════════════════════════════════════════════════════
-- storage_rls.sql — Storage bucket RLS (cad-files, design-previews)
--
-- Apply in Supabase SQL Editor AFTER buckets exist:
--   Dashboard → Storage → New bucket → cad-files (private)
--                                    → design-previews (public OK)
--
-- Matches frontend uploads where the first path segment is auth.uid()
-- (see GigaSoukStagingArea.jsx uploadFile).
--
-- Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════

-- ── cad-files (private CAD uploads) ───────────────────────────────
DROP POLICY IF EXISTS "gigasouk_cad_files_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "gigasouk_cad_files_select_own" ON storage.objects;
DROP POLICY IF EXISTS "gigasouk_cad_files_update_own" ON storage.objects;
DROP POLICY IF EXISTS "gigasouk_cad_files_delete_own" ON storage.objects;

CREATE POLICY "gigasouk_cad_files_insert_own"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'cad-files'
        AND split_part(name, '/', 1) = auth.uid()::text
    );

CREATE POLICY "gigasouk_cad_files_select_own"
    ON storage.objects FOR SELECT TO authenticated
    USING (
        bucket_id = 'cad-files'
        AND split_part(name, '/', 1) = auth.uid()::text
    );

CREATE POLICY "gigasouk_cad_files_update_own"
    ON storage.objects FOR UPDATE TO authenticated
    USING (
        bucket_id = 'cad-files'
        AND split_part(name, '/', 1) = auth.uid()::text
    );

CREATE POLICY "gigasouk_cad_files_delete_own"
    ON storage.objects FOR DELETE TO authenticated
    USING (
        bucket_id = 'cad-files'
        AND split_part(name, '/', 1) = auth.uid()::text
    );

-- ── design-previews (public catalogue thumbnails) ────────────────
DROP POLICY IF EXISTS "gigasouk_design_previews_public_read" ON storage.objects;
DROP POLICY IF EXISTS "gigasouk_design_previews_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "gigasouk_design_previews_update_own" ON storage.objects;
DROP POLICY IF EXISTS "gigasouk_design_previews_delete_own" ON storage.objects;

-- Anyone can read preview images (shop/catalog).
CREATE POLICY "gigasouk_design_previews_public_read"
    ON storage.objects FOR SELECT TO public
    USING (bucket_id = 'design-previews');

-- Only the owning auth user can write into their folder prefix.
CREATE POLICY "gigasouk_design_previews_insert_own"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'design-previews'
        AND split_part(name, '/', 1) = auth.uid()::text
    );

CREATE POLICY "gigasouk_design_previews_update_own"
    ON storage.objects FOR UPDATE TO authenticated
    USING (
        bucket_id = 'design-previews'
        AND split_part(name, '/', 1) = auth.uid()::text
    );

CREATE POLICY "gigasouk_design_previews_delete_own"
    ON storage.objects FOR DELETE TO authenticated
    USING (
        bucket_id = 'design-previews'
        AND split_part(name, '/', 1) = auth.uid()::text
    );

-- ── product-images (private — designer gallery + manufacturer showcase) ─
-- Create bucket `product-images` in Dashboard (private). Paths:
--   {auth.uid()}/designs/{design_id}/{filename}
--   {auth.uid()}/showcase/{commitment_id}/{filename}

DROP POLICY IF EXISTS "gigasouk_product_images_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "gigasouk_product_images_select_own" ON storage.objects;
DROP POLICY IF EXISTS "gigasouk_product_images_update_own" ON storage.objects;
DROP POLICY IF EXISTS "gigasouk_product_images_delete_own" ON storage.objects;

CREATE POLICY "gigasouk_product_images_insert_own"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'product-images'
        AND split_part(name, '/', 1) = auth.uid()::text
    );

CREATE POLICY "gigasouk_product_images_select_own"
    ON storage.objects FOR SELECT TO authenticated
    USING (
        bucket_id = 'product-images'
        AND split_part(name, '/', 1) = auth.uid()::text
    );

CREATE POLICY "gigasouk_product_images_update_own"
    ON storage.objects FOR UPDATE TO authenticated
    USING (
        bucket_id = 'product-images'
        AND split_part(name, '/', 1) = auth.uid()::text
    );

CREATE POLICY "gigasouk_product_images_delete_own"
    ON storage.objects FOR DELETE TO authenticated
    USING (
        bucket_id = 'product-images'
        AND split_part(name, '/', 1) = auth.uid()::text
    );

-- ════════════════════════════════════════════════════════════════
-- Notes:
-- • Backend signed URLs for CAD use the service role → bypasses RLS.
-- • Product gallery / showcase images are read via backend-signed URLs for
--   customers and other parties (same pattern as CAD).
-- • If uploads still fail, confirm bucket ids exactly match 'cad-files'
--   and 'design-previews' (Supabase is case-sensitive).
-- ════════════════════════════════════════════════════════════════
