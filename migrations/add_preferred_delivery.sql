-- Customer saved delivery / location for routing & checkout defaults
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS preferred_delivery JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN profiles.preferred_delivery IS
  'Optional { line1, city, state, pincode, lat, lng } for customers';
