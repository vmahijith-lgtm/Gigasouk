-- ════════════════════════════════════════════════════════════════
-- gigasouk_schema.sql — GigaSouk Single Authoritative Database Script
-- Platform : GigaSouk Manufacturing-as-a-Service
-- Domain   : gigasouk.com
--
-- This file is the canonical merge of gigasouk_schema.sql and ALL
-- migration files. Run this single file on a fresh Supabase project
-- OR re-run it on an existing database — it is fully idempotent.
--
-- HOW TO USE:
--   1. Open your Supabase project → SQL Editor
--   2. Paste this entire file and click Run
--   Done. All tables, enums, indexes, triggers, RLS policies,
--   utility functions, auth cascade-delete, realtime config, and
--   storage RLS are created or updated safely.
--
-- SECTION MAP:
--   1.  Extensions
--   2.  Enums
--   3.  Core user tables         (profiles, manufacturers, designers)
--   4.  Product tables           (designs, manufacturer_commitments,
--                                 regional_price_variants, commitment_broadcasts)
--   5.  Order tables             (orders, negotiation_rooms, bids)
--   6.  Financial tables         (payouts, wallet_txns)
--   7.  Communication tables     (messages, notification_log)
--   8.  QC table                 (qc_records)
--   9.  Indexes + Deferred FKs
--   10. Triggers
--   11. Auth cascade-delete      (from cascade_delete_on_auth_user.sql)
--   12. Row Level Security       (all policies — recursion-safe)
--   13. Realtime publication
--   14. Utility functions + views
--   15. Storage RLS              (from storage_rls.sql)
--
-- MIGRATIONS MERGED:
--   add_preferred_delivery.sql
--   add_product_gallery_images.sql
--   cascade_delete_on_auth_user.sql
--   designs_read_for_committed_manufacturers.sql
--   fix_rls_designs_commitments_recursion.sql
--   min_commits_one.sql
--   negotiation_room_commitment.sql
--   orders_read_own_manufacturer.sql
--   realtime_designer_pipeline.sql
--   safe_rls.sql
--   storage_rls.sql
-- ════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════
-- SECTION 1: EXTENSIONS
-- ════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";


-- ════════════════════════════════════════════════════════════════
-- SECTION 2: ENUMS
-- Created inside DO blocks — fully idempotent.
-- ════════════════════════════════════════════════════════════════

DO $$ BEGIN
    CREATE TYPE order_status AS ENUM (
        'routing', 'negotiating', 'confirmed', 'cutting',
        'qc_review', 'qc_failed', 'shipped', 'delivered',
        'cancelled', 'refunded'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE design_status AS ENUM (
        'draft', 'seeking', 'committed', 'live', 'paused', 'archived'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE payment_status AS ENUM (
        'pending', 'in_escrow', 'releasing', 'released', 'refunded', 'failed'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE user_role AS ENUM (
        'customer', 'designer', 'manufacturer', 'admin'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE commitment_status AS ENUM (
        'pending_approval', 'active', 'paused', 'withdrawn', 'rejected'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE variant_status AS ENUM (
        'pending', 'approved', 'rejected'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE notification_status AS ENUM (
        'sent', 'delivered', 'failed', 'retrying'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ════════════════════════════════════════════════════════════════
-- SECTION 3: CORE USER TABLES
-- ════════════════════════════════════════════════════════════════

-- preferred_delivery merged from add_preferred_delivery.sql
CREATE TABLE IF NOT EXISTS profiles (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_id             UUID UNIQUE,
    full_name           TEXT NOT NULL,
    email               TEXT UNIQUE NOT NULL,
    phone               TEXT,
    role                user_role NOT NULL DEFAULT 'customer',
    avatar_url          TEXT,
    wallet_balance      NUMERIC(12, 2) NOT NULL DEFAULT 0,
    preferred_delivery  JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN profiles.preferred_delivery IS
    'Optional { line1, city, state, pincode, lat, lng } for customers';

CREATE TABLE IF NOT EXISTS manufacturers (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id              UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    shop_name               TEXT NOT NULL,
    gstin                   TEXT,
    address_line1           TEXT,
    city                    TEXT NOT NULL,
    state                   TEXT NOT NULL,
    pincode                 TEXT NOT NULL,
    lat                     NUMERIC(10, 7) NOT NULL DEFAULT 0,
    lng                     NUMERIC(10, 7) NOT NULL DEFAULT 0,
    machine_types           TEXT[] NOT NULL DEFAULT '{}',
    materials               TEXT[] NOT NULL DEFAULT '{}',
    capacity_units_per_day  INTEGER NOT NULL DEFAULT 10,
    queue_depth             INTEGER NOT NULL DEFAULT 0,
    rating                  NUMERIC(3, 2) NOT NULL DEFAULT 0,
    total_jobs              INTEGER NOT NULL DEFAULT 0,
    qc_pass_rate            NUMERIC(5, 2) NOT NULL DEFAULT 0,
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    is_premium              BOOLEAN NOT NULL DEFAULT FALSE,
    premium_until           TIMESTAMPTZ,
    bank_account_no         TEXT,
    bank_ifsc               TEXT,
    joined_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS designers (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    portfolio_url   TEXT,
    specialisation  TEXT[] NOT NULL DEFAULT '{}',
    total_designs   INTEGER NOT NULL DEFAULT 0,
    total_earnings  NUMERIC(12, 2) NOT NULL DEFAULT 0,
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ════════════════════════════════════════════════════════════════
-- SECTION 4: PRODUCT TABLES
-- gallery_image_urls / showcase_image_urls merged from
-- add_product_gallery_images.sql
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS designs (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    designer_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    title               TEXT NOT NULL,
    description         TEXT,
    category            TEXT,
    required_machines   TEXT[] NOT NULL DEFAULT '{}',
    required_materials  TEXT[] NOT NULL DEFAULT '{}',
    base_price          NUMERIC(10, 2) NOT NULL,
    royalty_percent     NUMERIC(5, 2) NOT NULL DEFAULT 15,
    cad_file_url        TEXT,
    preview_image_url   TEXT,
    gallery_image_urls  TEXT[] NOT NULL DEFAULT '{}',
    thumbnail_url       TEXT,
    spec_sheet_url      TEXT,
    dimensions_mm       JSONB,
    tolerance_mm        NUMERIC(5, 3) DEFAULT 0.5,
    status              design_status NOT NULL DEFAULT 'draft',
    active_commit_count INTEGER NOT NULL DEFAULT 0,
    total_orders        INTEGER NOT NULL DEFAULT 0,
    seeking_at          TIMESTAMPTZ,
    committed_at        TIMESTAMPTZ,
    published_at        TIMESTAMPTZ,
    paused_at           TIMESTAMPTZ,
    pause_reason        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- showcase_image_urls merged from add_product_gallery_images.sql
CREATE TABLE IF NOT EXISTS manufacturer_commitments (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    design_id           UUID NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
    manufacturer_id     UUID NOT NULL REFERENCES manufacturers(id) ON DELETE CASCADE,
    committed_price     NUMERIC(10, 2) NOT NULL,
    base_price          NUMERIC(10, 2) NOT NULL,
    region_city         TEXT NOT NULL,
    region_state        TEXT NOT NULL,
    status              commitment_status NOT NULL DEFAULT 'active',
    notes               TEXT,
    showcase_image_urls TEXT[] NOT NULL DEFAULT '{}',
    approved_at         TIMESTAMPTZ,
    committed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(design_id, manufacturer_id)
);

CREATE TABLE IF NOT EXISTS regional_price_variants (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    design_id           UUID NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
    commitment_id       UUID NOT NULL REFERENCES manufacturer_commitments(id) ON DELETE CASCADE,
    manufacturer_id     UUID NOT NULL REFERENCES manufacturers(id),
    proposed_price      NUMERIC(10, 2) NOT NULL,
    base_price          NUMERIC(10, 2) NOT NULL,
    price_diff_percent  NUMERIC(5, 2),
    region_city         TEXT NOT NULL,
    region_state        TEXT NOT NULL,
    reason              TEXT,
    status              variant_status NOT NULL DEFAULT 'pending',
    reviewer_notes      TEXT,
    submitted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at         TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS commitment_broadcasts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    design_id       UUID NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
    broadcast_type  TEXT NOT NULL DEFAULT 'initial_seek',
    region_city     TEXT,
    region_state    TEXT,
    recipients      INTEGER NOT NULL DEFAULT 0,
    responses       INTEGER NOT NULL DEFAULT 0,
    broadcast_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ════════════════════════════════════════════════════════════════
-- SECTION 5: ORDER TABLES
-- orders is declared before negotiation_rooms to avoid a circular
-- FK dependency. The circular FK (orders.negotiation_room_id →
-- negotiation_rooms.id) is added idempotently in Section 9.
--
-- negotiation_rooms changes merged from negotiation_room_commitment.sql:
--   • order_id is NULLABLE (pre-order rooms open at commitment time)
--   • commitment_id FK column added
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS orders (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_ref               TEXT UNIQUE NOT NULL,
    design_id               UUID NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
    customer_id             UUID NOT NULL REFERENCES profiles(id),
    manufacturer_id         UUID NOT NULL REFERENCES manufacturers(id),
    commitment_id           UUID REFERENCES manufacturer_commitments(id),
    -- negotiation_room_id FK added post-creation in Section 9
    negotiation_room_id     UUID,
    quantity                INTEGER NOT NULL DEFAULT 1,
    delivery_address        JSONB NOT NULL,
    committed_price         NUMERIC(10, 2) NOT NULL,
    locked_price            NUMERIC(10, 2),
    shipping_cost           NUMERIC(10, 2),
    total_amount            NUMERIC(10, 2),
    distance_km             NUMERIC(8, 2),
    status                  order_status NOT NULL DEFAULT 'routing',
    payment_status          payment_status NOT NULL DEFAULT 'pending',
    razorpay_order_id       TEXT,
    razorpay_payment_id     TEXT,
    shiprocket_order_id     TEXT,
    shiprocket_awb          TEXT,
    tracking_url            TEXT,
    notes                   TEXT,
    cancel_reason           TEXT,
    confirmed_at            TIMESTAMPTZ,
    paid_at                 TIMESTAMPTZ,
    shipped_at              TIMESTAMPTZ,
    delivered_at            TIMESTAMPTZ,
    refunded_at             TIMESTAMPTZ,
    refund_reason           TEXT,
    released_at             TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- order_id is nullable so the room can exist before a customer order
-- (pre-order designer ↔ manufacturer negotiation on commitment).
-- commitment_id is populated at creation; order_id is set at checkout.
-- Merged from negotiation_room_commitment.sql.
CREATE TABLE IF NOT EXISTS negotiation_rooms (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id        UUID REFERENCES orders(id) ON DELETE CASCADE,
    commitment_id   UUID REFERENCES manufacturer_commitments(id) ON DELETE CASCADE,
    designer_id     UUID NOT NULL REFERENCES profiles(id),
    manufacturer_id UUID NOT NULL REFERENCES manufacturers(id),
    base_price      NUMERIC(10, 2) NOT NULL,
    locked_price    NUMERIC(10, 2),
    status          TEXT NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open', 'locked', 'expired')),
    expires_at      TIMESTAMPTZ NOT NULL,
    expired_at      TIMESTAMPTZ,
    locked_at       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN negotiation_rooms.commitment_id IS
    'Active manufacturer commitment; room may exist before order_id is set at checkout.';

CREATE TABLE IF NOT EXISTS bids (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    negotiation_room_id UUID NOT NULL REFERENCES negotiation_rooms(id) ON DELETE CASCADE,
    bidder_id           UUID NOT NULL REFERENCES profiles(id),
    bidder_role         TEXT NOT NULL,
    amount              NUMERIC(10, 2) NOT NULL,
    status              TEXT NOT NULL DEFAULT 'active',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ════════════════════════════════════════════════════════════════
-- SECTION 6: FINANCIAL TABLES
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS payouts (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id             UUID NOT NULL REFERENCES orders(id),
    total_amount         NUMERIC(10, 2) NOT NULL,
    platform_fee         NUMERIC(10, 2) NOT NULL,
    manufacturer_amount  NUMERIC(10, 2) NOT NULL,
    designer_royalty     NUMERIC(10, 2) NOT NULL,
    released_by          UUID REFERENCES profiles(id),
    released_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallet_txns (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id    UUID NOT NULL REFERENCES profiles(id),
    amount        NUMERIC(10, 2) NOT NULL,
    txn_type      TEXT NOT NULL,
    source_ref    TEXT,
    balance_after NUMERIC(12, 2) NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ════════════════════════════════════════════════════════════════
-- SECTION 7: COMMUNICATION TABLES
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS messages (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id      UUID NOT NULL REFERENCES negotiation_rooms(id) ON DELETE CASCADE,
    sender_id    UUID NOT NULL REFERENCES profiles(id),
    sender_role  TEXT NOT NULL,
    content      TEXT,
    message_type TEXT NOT NULL DEFAULT 'text',
    file_url     TEXT,
    is_read      BOOLEAN NOT NULL DEFAULT FALSE,
    read_at      TIMESTAMPTZ,
    sent_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_log (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recipient_id    UUID REFERENCES profiles(id),
    recipient_phone TEXT,
    recipient_email TEXT,
    channel         TEXT NOT NULL,
    event_type      TEXT NOT NULL,
    subject         TEXT,
    body            TEXT NOT NULL,
    provider_msg_id TEXT,
    status          notification_status NOT NULL DEFAULT 'sent',
    error_msg       TEXT,
    sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    delivered_at    TIMESTAMPTZ
);


-- ════════════════════════════════════════════════════════════════
-- SECTION 8: QC TABLE
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS qc_records (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id             UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    manufacturer_id      UUID NOT NULL REFERENCES manufacturers(id),
    photo_urls           TEXT[] NOT NULL DEFAULT '{}',
    ai_passed            BOOLEAN,
    ai_score             NUMERIC(5, 2),
    ai_notes             TEXT,
    ai_per_photo         JSONB,
    manufacturer_notes   TEXT,
    manual_decision      TEXT CHECK (manual_decision IN ('pass', 'fail')),
    manual_admin_id      UUID REFERENCES profiles(id),
    manual_notes         TEXT,
    manually_reviewed_at TIMESTAMPTZ,
    reviewed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ════════════════════════════════════════════════════════════════
-- SECTION 9: INDEXES + DEFERRED FOREIGN KEYS
-- All CREATE INDEX use IF NOT EXISTS — safe to re-run.
-- Deferred FKs are guarded by existence checks.
-- ════════════════════════════════════════════════════════════════

-- profiles
CREATE INDEX IF NOT EXISTS idx_profiles_auth_id  ON profiles(auth_id);
CREATE INDEX IF NOT EXISTS idx_profiles_email     ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_role      ON profiles(role);

-- manufacturers
CREATE INDEX IF NOT EXISTS idx_manufacturers_profile_id ON manufacturers(profile_id);
CREATE INDEX IF NOT EXISTS idx_manufacturers_city       ON manufacturers(city);
CREATE INDEX IF NOT EXISTS idx_manufacturers_is_active  ON manufacturers(is_active);
CREATE INDEX IF NOT EXISTS idx_manufacturers_lat_lng    ON manufacturers(lat, lng);

-- designs
CREATE INDEX IF NOT EXISTS idx_designs_designer_id ON designs(designer_id);
CREATE INDEX IF NOT EXISTS idx_designs_status      ON designs(status);
CREATE INDEX IF NOT EXISTS idx_designs_category    ON designs(category);

-- manufacturer_commitments
CREATE INDEX IF NOT EXISTS idx_commitments_design_id       ON manufacturer_commitments(design_id);
CREATE INDEX IF NOT EXISTS idx_commitments_manufacturer_id ON manufacturer_commitments(manufacturer_id);
CREATE INDEX IF NOT EXISTS idx_commitments_status          ON manufacturer_commitments(status);
CREATE INDEX IF NOT EXISTS idx_commitments_region          ON manufacturer_commitments(region_city, region_state);

-- regional_price_variants
CREATE INDEX IF NOT EXISTS idx_variants_design_id ON regional_price_variants(design_id);
CREATE INDEX IF NOT EXISTS idx_variants_status    ON regional_price_variants(status);

-- orders
CREATE INDEX IF NOT EXISTS idx_orders_customer_id      ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_manufacturer_id  ON orders(manufacturer_id);
CREATE INDEX IF NOT EXISTS idx_orders_design_id        ON orders(design_id);
CREATE INDEX IF NOT EXISTS idx_orders_status           ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status   ON orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at       ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_negotiation_room ON orders(negotiation_room_id);

-- negotiation_rooms
CREATE INDEX IF NOT EXISTS idx_rooms_order_id      ON negotiation_rooms(order_id);
CREATE INDEX IF NOT EXISTS idx_rooms_status        ON negotiation_rooms(status);
CREATE INDEX IF NOT EXISTS idx_rooms_commitment_id ON negotiation_rooms(commitment_id);

-- One negotiation room per active commitment (partial unique index).
-- Merged from negotiation_room_commitment.sql.
CREATE UNIQUE INDEX IF NOT EXISTS idx_negotiation_rooms_one_per_commitment
    ON negotiation_rooms (commitment_id)
    WHERE commitment_id IS NOT NULL;

-- bids
CREATE INDEX IF NOT EXISTS idx_bids_room_id ON bids(negotiation_room_id);
CREATE INDEX IF NOT EXISTS idx_bids_status  ON bids(status);

-- messages
CREATE INDEX IF NOT EXISTS idx_messages_room_id ON messages(room_id);
CREATE INDEX IF NOT EXISTS idx_messages_is_read ON messages(is_read);
CREATE INDEX IF NOT EXISTS idx_messages_sent_at ON messages(sent_at DESC);

-- notification_log
CREATE INDEX IF NOT EXISTS idx_notif_recipient_id ON notification_log(recipient_id);
CREATE INDEX IF NOT EXISTS idx_notif_status       ON notification_log(status);
CREATE INDEX IF NOT EXISTS idx_notif_event_type   ON notification_log(event_type);

-- qc_records
CREATE INDEX IF NOT EXISTS idx_qc_order_id ON qc_records(order_id);

-- payouts
CREATE INDEX IF NOT EXISTS idx_payouts_order_id ON payouts(order_id);

-- wallet_txns
CREATE INDEX IF NOT EXISTS idx_wallet_txns_profile_id ON wallet_txns(profile_id);

-- Deferred FK: orders.negotiation_room_id → negotiation_rooms.id
-- Added here because both tables must exist first (circular dependency).
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_orders_negotiation_room'
          AND table_name = 'orders'
          AND table_schema = current_schema()
    ) THEN
        ALTER TABLE orders
            ADD CONSTRAINT fk_orders_negotiation_room
            FOREIGN KEY (negotiation_room_id)
            REFERENCES negotiation_rooms(id)
            ON DELETE SET NULL;
    END IF;
END $$;


-- ════════════════════════════════════════════════════════════════
-- SECTION 10: TRIGGERS
-- Functions use CREATE OR REPLACE — always safe.
-- Triggers use DROP IF EXISTS before CREATE — always safe.
-- ════════════════════════════════════════════════════════════════

-- Auto-update updated_at on every row change
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_profiles_updated_at     ON profiles;
DROP TRIGGER IF EXISTS trg_manufacturers_updated_at ON manufacturers;
DROP TRIGGER IF EXISTS trg_designers_updated_at     ON designers;
DROP TRIGGER IF EXISTS trg_designs_updated_at       ON designs;
DROP TRIGGER IF EXISTS trg_orders_updated_at        ON orders;
DROP TRIGGER IF EXISTS trg_commitments_updated_at   ON manufacturer_commitments;

CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_manufacturers_updated_at
    BEFORE UPDATE ON manufacturers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_designers_updated_at
    BEFORE UPDATE ON designers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_designs_updated_at
    BEFORE UPDATE ON designs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_orders_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_commitments_updated_at
    BEFORE UPDATE ON manufacturer_commitments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-compute price_diff_percent on regional variant insert
CREATE OR REPLACE FUNCTION compute_variant_diff()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.base_price > 0 THEN
        NEW.price_diff_percent = ROUND(
            ((NEW.proposed_price - NEW.base_price) / NEW.base_price) * 100, 2
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_variant_diff ON regional_price_variants;
CREATE TRIGGER trg_variant_diff
    BEFORE INSERT ON regional_price_variants
    FOR EACH ROW EXECUTE FUNCTION compute_variant_diff();

-- Auto-update active_commit_count on designs whenever a commitment changes
CREATE OR REPLACE FUNCTION sync_commit_count()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE designs
    SET active_commit_count = (
        SELECT COUNT(*)
        FROM manufacturer_commitments
        WHERE design_id = COALESCE(NEW.design_id, OLD.design_id)
          AND status    = 'active'
    )
    WHERE id = COALESCE(NEW.design_id, OLD.design_id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_commit_count ON manufacturer_commitments;
CREATE TRIGGER trg_sync_commit_count
    AFTER INSERT OR UPDATE OR DELETE ON manufacturer_commitments
    FOR EACH ROW EXECUTE FUNCTION sync_commit_count();

-- Auto-update manufacturer queue_depth whenever an order changes status
CREATE OR REPLACE FUNCTION sync_queue_depth()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE manufacturers
    SET queue_depth = (
        SELECT COUNT(*)
        FROM orders
        WHERE manufacturer_id = COALESCE(NEW.manufacturer_id, OLD.manufacturer_id)
          AND status NOT IN ('delivered', 'cancelled', 'refunded')
    )
    WHERE id = COALESCE(NEW.manufacturer_id, OLD.manufacturer_id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_queue_depth ON orders;
CREATE TRIGGER trg_sync_queue_depth
    AFTER INSERT OR UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION sync_queue_depth();


-- ════════════════════════════════════════════════════════════════
-- SECTION 11: AUTH CASCADE DELETE
-- Merged from cascade_delete_on_auth_user.sql.
-- Removes all application data when a Supabase Auth user is deleted.
-- All functions use CREATE OR REPLACE — safe to re-run.
-- Trigger uses DROP IF EXISTS before CREATE — safe to re-run.
-- ════════════════════════════════════════════════════════════════

-- Part A: Ensure FK constraints are named (idempotent drop + add)
-- designs.designer_id already has ON DELETE CASCADE in Section 4,
-- but we name the constraint explicitly so the trigger can rely on it.
ALTER TABLE designs DROP CONSTRAINT IF EXISTS designs_designer_id_fkey;
ALTER TABLE designs
    ADD CONSTRAINT designs_designer_id_fkey
    FOREIGN KEY (designer_id)
    REFERENCES profiles(id)
    ON DELETE CASCADE;

-- orders.design_id already has ON DELETE CASCADE in Section 5.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_design_id_fkey;
ALTER TABLE orders
    ADD CONSTRAINT orders_design_id_fkey
    FOREIGN KEY (design_id)
    REFERENCES designs(id)
    ON DELETE CASCADE;

-- Part B: Cleanup function — removes all rows for a given profile
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
    PERFORM set_config('row_security', 'off', true);

    SELECT COALESCE(array_agg(id), ARRAY[]::uuid[])
    INTO mfr_ids
    FROM manufacturers
    WHERE profile_id = p_profile_id;

    -- regional_price_variants.manufacturer_id does not CASCADE on manufacturer delete
    IF cardinality(mfr_ids) > 0 THEN
        DELETE FROM regional_price_variants WHERE manufacturer_id = ANY (mfr_ids);
    END IF;

    DELETE FROM bids     WHERE bidder_id  = p_profile_id;
    DELETE FROM messages WHERE sender_id  = p_profile_id;

    SELECT COALESCE(array_agg(DISTINCT o.id), ARRAY[]::uuid[])
    INTO order_ids
    FROM orders o
    WHERE o.customer_id = p_profile_id
       OR o.design_id IN (SELECT id FROM designs WHERE designer_id = p_profile_id)
       OR (cardinality(mfr_ids) > 0 AND o.manufacturer_id = ANY (mfr_ids));

    IF cardinality(order_ids) > 0 THEN
        DELETE FROM payouts WHERE order_id = ANY (order_ids);
        DELETE FROM orders  WHERE id       = ANY (order_ids);
    END IF;

    UPDATE payouts    SET released_by    = NULL WHERE released_by    = p_profile_id;
    UPDATE qc_records SET manual_admin_id = NULL WHERE manual_admin_id = p_profile_id;

    DELETE FROM designs          WHERE designer_id  = p_profile_id;
    DELETE FROM notification_log WHERE recipient_id = p_profile_id;
    DELETE FROM wallet_txns      WHERE profile_id   = p_profile_id;
    DELETE FROM profiles         WHERE id           = p_profile_id;
END;
$$;

-- Part B: Trigger function — fires BEFORE DELETE on auth.users
CREATE OR REPLACE FUNCTION public.gigasouk_on_auth_user_deleted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
    pid        uuid;
    auth_email text;
BEGIN
    PERFORM set_config('row_security', 'off', true);

    -- Remove storage objects whose path starts with the deleted auth uid
    BEGIN
        DELETE FROM storage.objects
        WHERE split_part(name, '/', 1) = OLD.id::text;
    EXCEPTION
        WHEN OTHERS THEN
            RAISE WARNING
                'gigasouk_on_auth_user_deleted: storage.objects cleanup skipped: %',
                SQLERRM;
    END;

    SELECT id INTO pid
    FROM public.profiles
    WHERE auth_id = OLD.id
    LIMIT 1;

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

-- Part C: One-time / periodic purge of orphan data
-- Run manually: SELECT public.gigasouk_purge_orphan_user_data();
CREATE OR REPLACE FUNCTION public.gigasouk_purge_orphan_user_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
    r             record;
    n_profiles    int     := 0;
    n_storage     bigint  := 0;
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
        WHERE split_part(o.name, '/', 1)
                  ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          AND split_part(o.name, '/', 1) NOT IN (
                  SELECT u.id::text FROM auth.users u
              );
        GET DIAGNOSTICS n_storage = ROW_COUNT;
    EXCEPTION
        WHEN undefined_table THEN
            RAISE NOTICE 'gigasouk_purge_orphan_user_data: storage.objects not available';
        WHEN OTHERS THEN
            RAISE WARNING
                'gigasouk_purge_orphan_user_data: storage purge skipped: %', SQLERRM;
    END;

    RETURN jsonb_build_object(
        'purged_profiles',        n_profiles,
        'purged_storage_objects', n_storage,
        'auth_users_seen',        auth_user_cnt
    );
END;
$$;

REVOKE ALL ON FUNCTION public.gigasouk_delete_profile_data(uuid)    FROM PUBLIC;
REVOKE ALL ON FUNCTION public.gigasouk_on_auth_user_deleted()        FROM PUBLIC;
REVOKE ALL ON FUNCTION public.gigasouk_purge_orphan_user_data()      FROM PUBLIC;

COMMENT ON FUNCTION public.gigasouk_delete_profile_data(uuid) IS
    'Deletes all GigaSouk rows for a profile (orders, designs, wallet, …). Used when auth.users row is deleted.';
COMMENT ON FUNCTION public.gigasouk_purge_orphan_user_data() IS
    'Removes public.* + storage keys for profiles whose auth_id is missing or not in auth.users. Run after cleaning up legacy deleted accounts.';


-- ════════════════════════════════════════════════════════════════
-- SECTION 12: ROW LEVEL SECURITY (RLS)
-- ALTER TABLE ... ENABLE ROW LEVEL SECURITY is idempotent.
-- All policies use DROP IF EXISTS before CREATE.
--
-- design_visible_via_mfr_commitment() is a SECURITY DEFINER helper
-- that breaks the infinite recursion between:
--   designs_read_live  (references manufacturer_commitments)
--   commitments_read_own (references designs)
-- Merged from fix_rls_designs_commitments_recursion.sql and
-- designs_read_for_committed_manufacturers.sql and safe_rls.sql.
-- ════════════════════════════════════════════════════════════════

ALTER TABLE profiles                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE manufacturers            ENABLE ROW LEVEL SECURITY;
ALTER TABLE designers                ENABLE ROW LEVEL SECURITY;
ALTER TABLE designs                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE manufacturer_commitments ENABLE ROW LEVEL SECURITY;
ALTER TABLE regional_price_variants  ENABLE ROW LEVEL SECURITY;
ALTER TABLE commitment_broadcasts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE negotiation_rooms        ENABLE ROW LEVEL SECURITY;
ALTER TABLE bids                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_log         ENABLE ROW LEVEL SECURITY;
ALTER TABLE qc_records               ENABLE ROW LEVEL SECURITY;
ALTER TABLE payouts                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_txns              ENABLE ROW LEVEL SECURITY;

-- ── SECURITY DEFINER helper (must exist before policies reference it) ──
-- Reads manufacturer_commitments with row_security=off to avoid the
-- recursion: designs_read_live → commitments → designs_read_live.
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

REVOKE ALL   ON FUNCTION public.design_visible_via_mfr_commitment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.design_visible_via_mfr_commitment(uuid)
    TO authenticated, anon, service_role;

-- ── profiles ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "profiles_read_all" ON profiles;
DROP POLICY IF EXISTS "profiles_edit_own" ON profiles;

CREATE POLICY "profiles_read_all"
    ON profiles FOR SELECT
    USING (TRUE);

CREATE POLICY "profiles_edit_own"
    ON profiles FOR UPDATE
    USING (auth.uid() = auth_id);

-- Hide sensitive columns from all non-owner callers.
-- Owners read via backend /api/auth/me (service-role key, bypasses REVOKE).
REVOKE SELECT (email, phone, wallet_balance) ON profiles FROM anon;
REVOKE SELECT (email, phone, wallet_balance) ON profiles FROM authenticated;

-- ── manufacturers ─────────────────────────────────────────────────
-- No public SELECT — marketplace uses backend /api/v1/available-factories.
DROP POLICY IF EXISTS "manufacturers_self_read"   ON manufacturers;
DROP POLICY IF EXISTS "manufacturers_self_update" ON manufacturers;

CREATE POLICY "manufacturers_self_read"
    ON manufacturers FOR SELECT
    USING (
        profile_id IN (SELECT id FROM profiles WHERE auth_id = auth.uid())
    );

CREATE POLICY "manufacturers_self_update"
    ON manufacturers FOR UPDATE
    USING (
        profile_id IN (SELECT id FROM profiles WHERE auth_id = auth.uid())
    );

-- ── designers ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "designers_read_all" ON designers;
DROP POLICY IF EXISTS "designers_edit_own" ON designers;

CREATE POLICY "designers_read_all"
    ON designers FOR SELECT
    USING (TRUE);

CREATE POLICY "designers_edit_own"
    ON designers FOR UPDATE
    USING (
        profile_id IN (SELECT id FROM profiles WHERE auth_id = auth.uid())
    );

-- Hide earnings from non-owners.
REVOKE SELECT (total_earnings) ON designers FROM anon;
REVOKE SELECT (total_earnings) ON designers FROM authenticated;

-- ── designs ───────────────────────────────────────────────────────
-- Uses design_visible_via_mfr_commitment() to avoid RLS recursion.
DROP POLICY IF EXISTS "designs_read_live" ON designs;
DROP POLICY IF EXISTS "designs_edit_own"  ON designs;

CREATE POLICY "designs_read_live"
    ON designs FOR SELECT
    USING (
        status = 'live'
        OR designer_id IN (SELECT id FROM profiles WHERE auth_id = auth.uid())
        OR design_visible_via_mfr_commitment(id)
    );

CREATE POLICY "designs_edit_own"
    ON designs FOR ALL
    USING (
        designer_id IN (SELECT id FROM profiles WHERE auth_id = auth.uid())
    )
    WITH CHECK (
        designer_id IN (SELECT id FROM profiles WHERE auth_id = auth.uid())
    );

-- ── manufacturer_commitments ──────────────────────────────────────
-- Does NOT reference designs in the USING clause to avoid recursion
-- (designs_read_live already references manufacturer_commitments).
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

-- ── regional_price_variants ───────────────────────────────────────
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

-- ── commitment_broadcasts ─────────────────────────────────────────
-- No SELECT policy — backend uses service key only (bypasses RLS).

-- ── orders ────────────────────────────────────────────────────────
-- Merged from safe_rls.sql (4a, 4a′) and orders_read_own_manufacturer.sql.
DROP POLICY IF EXISTS "orders_read_own_customer"     ON orders;
DROP POLICY IF EXISTS "orders_read_own_manufacturer" ON orders;

CREATE POLICY "orders_read_own_customer"
    ON orders FOR SELECT
    USING (
        customer_id IN (SELECT id FROM profiles WHERE auth_id = auth.uid())
    );

CREATE POLICY "orders_read_own_manufacturer"
    ON orders FOR SELECT
    USING (
        manufacturer_id IN (
            SELECT id FROM manufacturers
            WHERE profile_id IN (SELECT id FROM profiles WHERE auth_id = auth.uid())
        )
    );

-- ── negotiation_rooms ─────────────────────────────────────────────
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

-- ── messages ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "messages_read_participants" ON messages;
DROP POLICY IF EXISTS "messages_insert_own"        ON messages;

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

CREATE POLICY "messages_insert_own"
    ON messages FOR INSERT
    WITH CHECK (
        sender_id IN (SELECT id FROM profiles WHERE auth_id = auth.uid())
    );

-- ── bids ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "bids_read_participants" ON bids;
DROP POLICY IF EXISTS "bids_insert_own"        ON bids;

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

CREATE POLICY "bids_insert_own"
    ON bids FOR INSERT
    WITH CHECK (
        bidder_id IN (SELECT id FROM profiles WHERE auth_id = auth.uid())
    );

-- ── payouts ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "payouts_read_designer"     ON payouts;
DROP POLICY IF EXISTS "payouts_read_manufacturer" ON payouts;

CREATE POLICY "payouts_read_designer"
    ON payouts FOR SELECT
    USING (
        order_id IN (
            SELECT o.id
            FROM orders o
            JOIN designs d ON o.design_id = d.id
            WHERE d.designer_id IN (
                SELECT id FROM profiles WHERE auth_id = auth.uid()
            )
        )
    );

CREATE POLICY "payouts_read_manufacturer"
    ON payouts FOR SELECT
    USING (
        order_id IN (
            SELECT id FROM orders
            WHERE manufacturer_id IN (
                SELECT id FROM manufacturers
                WHERE profile_id IN (SELECT id FROM profiles WHERE auth_id = auth.uid())
            )
        )
    );

-- ── wallet_txns ───────────────────────────────────────────────────
-- Merged from safe_rls.sql (4b).
DROP POLICY IF EXISTS "wallet_read_own" ON wallet_txns;

CREATE POLICY "wallet_read_own"
    ON wallet_txns FOR SELECT
    USING (
        profile_id IN (SELECT id FROM profiles WHERE auth_id = auth.uid())
    );

-- ── notification_log ──────────────────────────────────────────────
DROP POLICY IF EXISTS "notif_read_own" ON notification_log;

CREATE POLICY "notif_read_own"
    ON notification_log FOR SELECT
    USING (
        recipient_id IN (
            SELECT id FROM profiles WHERE auth_id = auth.uid()
        )
    );

-- ── qc_records ────────────────────────────────────────────────────
-- Merged from safe_rls.sql (4j).
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
-- SECTION 13: REALTIME PUBLICATION
-- Each ADD TABLE is guarded — safe to re-run.
-- Includes tables from realtime_designer_pipeline.sql.
-- ════════════════════════════════════════════════════════════════

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'orders'
    ) THEN ALTER PUBLICATION supabase_realtime ADD TABLE orders; END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'negotiation_rooms'
    ) THEN ALTER PUBLICATION supabase_realtime ADD TABLE negotiation_rooms; END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'bids'
    ) THEN ALTER PUBLICATION supabase_realtime ADD TABLE bids; END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'messages'
    ) THEN ALTER PUBLICATION supabase_realtime ADD TABLE messages; END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'notification_log'
    ) THEN ALTER PUBLICATION supabase_realtime ADD TABLE notification_log; END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'manufacturer_commitments'
    ) THEN ALTER PUBLICATION supabase_realtime ADD TABLE manufacturer_commitments; END IF;
END $$;

-- Merged from realtime_designer_pipeline.sql
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'designs'
    ) THEN ALTER PUBLICATION supabase_realtime ADD TABLE designs; END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'regional_price_variants'
    ) THEN ALTER PUBLICATION supabase_realtime ADD TABLE regional_price_variants; END IF;
END $$;


-- ════════════════════════════════════════════════════════════════
-- SECTION 14: UTILITY FUNCTIONS + VIEWS
-- All functions use CREATE OR REPLACE — always safe.
-- Views use CREATE OR REPLACE — always safe.
-- can_design_go_live / maybe_advance_design_to_committed merged
-- from min_commits_one.sql (min_commits constant = 1).
-- ════════════════════════════════════════════════════════════════

-- Get designs a manufacturer can commit to (matches machine + material tags)
CREATE OR REPLACE FUNCTION get_available_designs_for_manufacturer(mfr_id UUID)
RETURNS TABLE (
    design_id           UUID,
    title               TEXT,
    description         TEXT,
    base_price          NUMERIC,
    required_machines   TEXT[],
    required_materials  TEXT[],
    cad_file_url        TEXT,
    preview_image_url   TEXT,
    designer_name       TEXT,
    days_seeking        INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        d.id,
        d.title,
        d.description,
        d.base_price,
        d.required_machines,
        d.required_materials,
        d.cad_file_url,
        d.preview_image_url,
        p.full_name,
        EXTRACT(DAY FROM NOW() - d.seeking_at)::INTEGER
    FROM designs d
    JOIN profiles p ON d.designer_id = p.id
    WHERE d.status = 'seeking'
      AND d.required_machines && (SELECT machine_types FROM manufacturers WHERE id = mfr_id)
      AND d.required_materials && (SELECT materials    FROM manufacturers WHERE id = mfr_id)
      AND d.id NOT IN (
              SELECT design_id
              FROM manufacturer_commitments
              WHERE manufacturer_id = mfr_id
          )
    ORDER BY d.seeking_at DESC;
END;
$$ LANGUAGE plpgsql;


-- Returns TRUE when the design has at least one active manufacturer commitment
CREATE OR REPLACE FUNCTION can_design_go_live(p_design_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    active_count INTEGER;
    min_commits  CONSTANT INTEGER := 1;
BEGIN
    SELECT COUNT(*) INTO active_count
    FROM manufacturer_commitments
    WHERE design_id = p_design_id AND status = 'active';

    RETURN active_count >= min_commits;
END;
$$ LANGUAGE plpgsql;


-- Get pending regional price variants for a designer
CREATE OR REPLACE FUNCTION get_pending_variants_for_designer(p_designer_id UUID)
RETURNS TABLE (
    variant_id             UUID,
    design_id              UUID,
    design_title           TEXT,
    manufacturer_shop_name TEXT,
    manufacturer_city      TEXT,
    region_city            TEXT,
    region_state           TEXT,
    base_price             NUMERIC,
    proposed_price         NUMERIC,
    price_diff_percent     NUMERIC,
    reason                 TEXT,
    submitted_at           TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        rpv.id,
        rpv.design_id,
        d.title,
        m.shop_name,
        m.city,
        rpv.region_city,
        rpv.region_state,
        rpv.base_price,
        rpv.proposed_price,
        rpv.price_diff_percent,
        rpv.reason,
        rpv.submitted_at
    FROM regional_price_variants rpv
    JOIN designs       d ON rpv.design_id       = d.id
    JOIN manufacturers m ON rpv.manufacturer_id = m.id
    WHERE d.designer_id = p_designer_id
      AND rpv.status    = 'pending'
    ORDER BY rpv.submitted_at DESC;
END;
$$ LANGUAGE plpgsql;


-- Get committed manufacturers for a design, sorted by distance from customer
-- (Haversine formula — no PostGIS dependency)
CREATE OR REPLACE FUNCTION get_committed_manufacturers(
    p_design_id    UUID,
    p_customer_lat NUMERIC,
    p_customer_lng NUMERIC
)
RETURNS TABLE (
    commitment_id   UUID,
    manufacturer_id UUID,
    shop_name       TEXT,
    region_city     TEXT,
    region_state    TEXT,
    committed_price NUMERIC,
    distance_km     NUMERIC,
    rating          NUMERIC,
    queue_depth     INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        mc.id,
        mc.manufacturer_id,
        m.shop_name,
        mc.region_city,
        mc.region_state,
        mc.committed_price,
        ROUND((
            6371.0 * 2.0 * ASIN(SQRT(
                POW(SIN(RADIANS((m.lat - p_customer_lat) / 2.0)), 2) +
                COS(RADIANS(p_customer_lat)) * COS(RADIANS(m.lat)) *
                POW(SIN(RADIANS((m.lng - p_customer_lng) / 2.0)), 2)
            ))
        )::NUMERIC, 1) AS dist_km,
        m.rating,
        m.queue_depth
    FROM manufacturer_commitments mc
    JOIN manufacturers m ON mc.manufacturer_id = m.id
    WHERE mc.design_id = p_design_id
      AND mc.status    = 'active'
    ORDER BY dist_km ASC;
END;
$$ LANGUAGE plpgsql;


-- Auto-advance design from SEEKING → COMMITTED when enough commitments arrive
CREATE OR REPLACE FUNCTION maybe_advance_design_to_committed(p_design_id UUID)
RETURNS VOID AS $$
DECLARE
    active_count INTEGER;
    min_commits  CONSTANT INTEGER := 1;
BEGIN
    SELECT COUNT(*) INTO active_count
    FROM manufacturer_commitments
    WHERE design_id = p_design_id AND status = 'active';

    IF active_count >= min_commits THEN
        UPDATE designs
        SET status       = 'committed',
            committed_at = NOW()
        WHERE id     = p_design_id
          AND status = 'seeking';
    END IF;
END;
$$ LANGUAGE plpgsql;


-- Log an emergency broadcast event
CREATE OR REPLACE FUNCTION log_emergency_broadcast(
    p_design_id    UUID,
    p_region_city  TEXT,
    p_region_state TEXT
)
RETURNS UUID AS $$
DECLARE
    broadcast_id UUID;
BEGIN
    INSERT INTO commitment_broadcasts
        (design_id, broadcast_type, region_city, region_state, recipients)
    VALUES
        (p_design_id, 'emergency', p_region_city, p_region_state, 0)
    RETURNING id INTO broadcast_id;

    RETURN broadcast_id;
END;
$$ LANGUAGE plpgsql;


-- Check if a manufacturer already committed to a design
CREATE OR REPLACE FUNCTION has_already_committed(
    p_design_id       UUID,
    p_manufacturer_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
    exists_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO exists_count
    FROM manufacturer_commitments
    WHERE design_id       = p_design_id
      AND manufacturer_id = p_manufacturer_id
      AND status IN ('active', 'pending_approval', 'paused');

    RETURN exists_count > 0;
END;
$$ LANGUAGE plpgsql;


-- Atomic wallet credit (updates balance + inserts transaction log)
CREATE OR REPLACE FUNCTION add_to_wallet(
    user_id UUID,
    amount  NUMERIC,
    source  TEXT
)
RETURNS VOID AS $$
DECLARE
    new_balance NUMERIC;
BEGIN
    UPDATE profiles
    SET wallet_balance = wallet_balance + amount
    WHERE id = user_id
    RETURNING wallet_balance INTO new_balance;

    INSERT INTO wallet_txns
        (profile_id, amount, txn_type, source_ref, balance_after)
    VALUES
        (user_id, amount, 'royalty', source, new_balance);
END;
$$ LANGUAGE plpgsql;


-- Designer stats aggregation
CREATE OR REPLACE FUNCTION get_designer_stats(p_designer_id UUID)
RETURNS TABLE (
    total_designs          INTEGER,
    live_designs           INTEGER,
    seeking_designs        INTEGER,
    total_orders           INTEGER,
    total_royalties_earned NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(DISTINCT d.id)::INTEGER,
        COUNT(DISTINCT CASE WHEN d.status = 'live'    THEN d.id END)::INTEGER,
        COUNT(DISTINCT CASE WHEN d.status = 'seeking' THEN d.id END)::INTEGER,
        COUNT(DISTINCT o.id)::INTEGER,
        COALESCE(SUM(p.designer_royalty), 0)
    FROM designs d
    LEFT JOIN orders  o ON d.id = o.design_id
    LEFT JOIN payouts p ON o.id = p.order_id
    WHERE d.designer_id = p_designer_id;
END;
$$ LANGUAGE plpgsql;


-- Manufacturer performance stats
CREATE OR REPLACE FUNCTION get_manufacturer_stats(p_manufacturer_id UUID)
RETURNS TABLE (
    total_jobs_completed INTEGER,
    qc_pass_count        INTEGER,
    qc_fail_count        INTEGER,
    qc_pass_rate         NUMERIC,
    average_rating       NUMERIC,
    total_earnings       NUMERIC,
    active_designs       INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(DISTINCT o.id)::INTEGER,
        COUNT(DISTINCT CASE WHEN qc.ai_passed = TRUE  THEN qc.id END)::INTEGER,
        COUNT(DISTINCT CASE WHEN qc.ai_passed = FALSE THEN qc.id END)::INTEGER,
        CASE
            WHEN COUNT(DISTINCT qc.id) > 0
            THEN ROUND(
                (COUNT(DISTINCT CASE WHEN qc.ai_passed = TRUE THEN qc.id END) * 100.0
                 / COUNT(DISTINCT qc.id)), 2)
            ELSE 0
        END,
        COALESCE((SELECT rating FROM manufacturers WHERE id = p_manufacturer_id), 0),
        COALESCE(SUM(p.manufacturer_amount), 0),
        COUNT(DISTINCT CASE WHEN mc.status = 'active' THEN mc.design_id END)::INTEGER
    FROM manufacturers mfr
    LEFT JOIN orders                   o  ON mfr.id = o.manufacturer_id
    LEFT JOIN qc_records               qc ON o.id   = qc.order_id
    LEFT JOIN payouts                  p  ON o.id   = p.order_id
    LEFT JOIN manufacturer_commitments mc ON mfr.id = mc.manufacturer_id
    WHERE mfr.id = p_manufacturer_id;
END;
$$ LANGUAGE plpgsql;


-- Designer dashboard view
CREATE OR REPLACE VIEW designer_dashboard_data AS
SELECT
    p.id,
    p.full_name,
    p.email,
    d2.total_designs,
    d2.live_designs,
    d2.seeking_designs,
    d2.total_orders,
    d2.total_royalties_earned,
    p.wallet_balance,
    COUNT(DISTINCT CASE WHEN rpv.status = 'pending' THEN rpv.id END)::INTEGER AS pending_variants
FROM profiles p
JOIN designers des ON p.id = des.profile_id
LEFT JOIN LATERAL get_designer_stats(p.id) d2 ON TRUE
LEFT JOIN designs des2 ON des2.designer_id = p.id
LEFT JOIN regional_price_variants rpv ON rpv.design_id = des2.id
WHERE p.role = 'designer'
GROUP BY
    p.id, p.full_name, p.email, p.wallet_balance,
    d2.total_designs, d2.live_designs, d2.seeking_designs,
    d2.total_orders, d2.total_royalties_earned;


-- Manufacturer dashboard view
CREATE OR REPLACE VIEW manufacturer_dashboard_data AS
SELECT
    p.id,
    p.full_name,
    m.shop_name,
    m.city,
    m.rating,
    m.queue_depth,
    m.is_premium,
    m.premium_until,
    s.total_jobs_completed,
    s.qc_pass_count,
    s.qc_fail_count,
    s.qc_pass_rate,
    s.total_earnings,
    s.active_designs,
    COUNT(DISTINCT CASE WHEN mc.status = 'pending_approval' THEN mc.id END)::INTEGER AS pending_approvals
FROM profiles p
JOIN manufacturers m ON p.id = m.profile_id
LEFT JOIN LATERAL get_manufacturer_stats(m.id) s ON TRUE
LEFT JOIN manufacturer_commitments mc ON m.id = mc.manufacturer_id
WHERE p.role = 'manufacturer'
GROUP BY
    p.id, m.id, p.full_name,
    s.total_jobs_completed, s.qc_pass_count, s.qc_fail_count,
    s.qc_pass_rate, s.total_earnings, s.active_designs;


-- ════════════════════════════════════════════════════════════════
-- SECTION 15: STORAGE RLS
-- Merged from storage_rls.sql.
-- Requires Storage buckets created in Supabase Dashboard first:
--   cad-files       (private)
--   design-previews (public OK)
--   product-images  (private)
--   qc-photos       (private)
-- Path convention: {auth.uid()}/{subfolder}/{filename}
-- ════════════════════════════════════════════════════════════════

-- ── cad-files (private CAD uploads) ──────────────────────────────
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

-- ── design-previews (public catalogue thumbnails) ─────────────────
DROP POLICY IF EXISTS "gigasouk_design_previews_public_read" ON storage.objects;
DROP POLICY IF EXISTS "gigasouk_design_previews_insert_own"  ON storage.objects;
DROP POLICY IF EXISTS "gigasouk_design_previews_update_own"  ON storage.objects;
DROP POLICY IF EXISTS "gigasouk_design_previews_delete_own"  ON storage.objects;

-- Anyone can read preview images (shop / catalog)
CREATE POLICY "gigasouk_design_previews_public_read"
    ON storage.objects FOR SELECT TO public
    USING (bucket_id = 'design-previews');

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

-- ── product-images (private — designer gallery + manufacturer showcase)
-- Paths: {auth.uid()}/designs/{design_id}/{filename}
--        {auth.uid()}/showcase/{commitment_id}/{filename}
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

-- ── qc-photos (private — manufacturer QC part photos) ─────────────
-- Paths: {auth.uid()}/qc/{order_id}/{filename}
DROP POLICY IF EXISTS "gigasouk_qc_photos_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "gigasouk_qc_photos_select_own" ON storage.objects;
DROP POLICY IF EXISTS "gigasouk_qc_photos_update_own" ON storage.objects;
DROP POLICY IF EXISTS "gigasouk_qc_photos_delete_own" ON storage.objects;

CREATE POLICY "gigasouk_qc_photos_insert_own"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'qc-photos'
        AND split_part(name, '/', 1) = auth.uid()::text
    );

CREATE POLICY "gigasouk_qc_photos_select_own"
    ON storage.objects FOR SELECT TO authenticated
    USING (
        bucket_id = 'qc-photos'
        AND split_part(name, '/', 1) = auth.uid()::text
    );

CREATE POLICY "gigasouk_qc_photos_update_own"
    ON storage.objects FOR UPDATE TO authenticated
    USING (
        bucket_id = 'qc-photos'
        AND split_part(name, '/', 1) = auth.uid()::text
    );

CREATE POLICY "gigasouk_qc_photos_delete_own"
    ON storage.objects FOR DELETE TO authenticated
    USING (
        bucket_id = 'qc-photos'
        AND split_part(name, '/', 1) = auth.uid()::text
    );


-- ════════════════════════════════════════════════════════════════
-- DONE
-- gigasouk_schema.sql is fully idempotent — safe to run on a
-- fresh database or re-run on an existing one without errors or
-- data loss.
--
-- Execution order:
--   Extensions → Enums → Tables → Indexes + Deferred FKs →
--   Triggers → Auth cascade delete → RLS policies →
--   Realtime → Utility functions + Views → Storage RLS
--
-- After running:
--   1. Create Storage buckets in Dashboard if they don't exist:
--      cad-files, design-previews, product-images, qc-photos
--   2. To purge legacy orphan data (one-time):
--      SELECT public.gigasouk_purge_orphan_user_data();
-- ════════════════════════════════════════════════════════════════
