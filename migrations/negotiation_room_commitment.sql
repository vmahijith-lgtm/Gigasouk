-- ════════════════════════════════════════════════════════════════
-- negotiation_room_commitment.sql
-- Pre-order negotiation: room opens when manufacturer commitment is active,
-- before any customer order. place_order links order_id when checkout happens.
-- ════════════════════════════════════════════════════════════════

ALTER TABLE negotiation_rooms
    ADD COLUMN IF NOT EXISTS commitment_id UUID REFERENCES manufacturer_commitments(id) ON DELETE CASCADE;

ALTER TABLE negotiation_rooms
    ALTER COLUMN order_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_negotiation_rooms_one_per_commitment
    ON negotiation_rooms (commitment_id)
    WHERE commitment_id IS NOT NULL;

COMMENT ON COLUMN negotiation_rooms.commitment_id IS
    'Active manufacturer commitment; room may exist before order_id is set at checkout.';
