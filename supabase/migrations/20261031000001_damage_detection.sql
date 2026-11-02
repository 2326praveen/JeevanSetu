-- =====================================================================
-- JeevanSetu AI: Phase 4 Crowd Damage Detection Migration
-- Storage: damage-photos bucket & storage RLS
-- Columns: image_url and ai_analysis in hazard_reports
-- =====================================================================

-- 1. Add image_url and ai_analysis to public.hazard_reports
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'hazard_reports' 
          AND column_name = 'image_url'
    ) THEN
        ALTER TABLE public.hazard_reports ADD COLUMN image_url TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'hazard_reports' 
          AND column_name = 'ai_analysis'
    ) THEN
        ALTER TABLE public.hazard_reports ADD COLUMN ai_analysis JSONB DEFAULT '{}'::jsonb;
    END IF;
END $$;

-- 2. Create damage-photos storage bucket (if not existing)
INSERT INTO storage.buckets (id, name, public)
VALUES ('damage-photos', 'damage-photos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 3. Storage Row Level Security (RLS) Policies
-- Allow anyone (citizens anonymously or authenticated) to upload disaster photos
DROP POLICY IF EXISTS "Public damage photo upload" ON storage.objects;
CREATE POLICY "Public damage photo upload"
    ON storage.objects FOR INSERT
    TO anon, authenticated
    WITH CHECK (bucket_id = 'damage-photos');

-- Allow anyone to view damage photos (public read)
DROP POLICY IF EXISTS "Public damage photo read" ON storage.objects;
CREATE POLICY "Public damage photo read"
    ON storage.objects FOR SELECT
    TO anon, authenticated
    USING (bucket_id = 'damage-photos');

-- Authorities can delete or archive damage photos
DROP POLICY IF EXISTS "Authorities manage damage photos" ON storage.objects;
CREATE POLICY "Authorities manage damage photos"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (bucket_id = 'damage-photos' AND public.is_authority());

