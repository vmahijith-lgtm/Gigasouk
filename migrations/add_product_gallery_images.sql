-- Extra high-quality images: designer gallery + manufacturer showcase (private bucket paths).
-- Run after creating Storage bucket `product-images` (private). See migrations/storage_rls.sql.

ALTER TABLE designs ADD COLUMN IF NOT EXISTS gallery_image_urls TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE manufacturer_commitments ADD COLUMN IF NOT EXISTS showcase_image_urls TEXT[] NOT NULL DEFAULT '{}';
