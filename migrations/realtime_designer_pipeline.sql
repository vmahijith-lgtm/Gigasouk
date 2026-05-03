-- Enable Supabase Realtime for designer pipeline (status + variant notifications).
-- Run in SQL Editor if live UI updates from subscribe() are missing.

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
