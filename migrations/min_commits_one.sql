-- Align DB helpers with MIN_COMMITS_TO_GO_LIVE = 1 (single active commitment unlocks pipeline)

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
