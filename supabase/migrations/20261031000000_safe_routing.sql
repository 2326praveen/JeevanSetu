-- =====================================================================
-- JeevanSetu AI: Phase 3 Safe Routing & Hazard Management Migration
-- Table: hazard_reports
-- RLS: Public read, public submit, authority verify/manage
-- Realtime: Enabled
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.hazard_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hazard_type TEXT NOT NULL, -- 'flooded_road', 'blocked_path', 'collapsed_bridge', 'fallen_tree', 'power_cable', 'fire_smoke', 'other'
    severity SMALLINT NOT NULL DEFAULT 3 CHECK (severity BETWEEN 1 AND 5),
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    description TEXT NOT NULL,
    avoid_radius_meters INTEGER NOT NULL DEFAULT 250 CHECK (avoid_radius_meters >= 50),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    reporter_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hazard_reports_lat_lng ON public.hazard_reports(lat, lng);
CREATE INDEX IF NOT EXISTS idx_hazard_reports_active ON public.hazard_reports(is_active);
CREATE INDEX IF NOT EXISTS idx_hazard_reports_type ON public.hazard_reports(hazard_type);

-- Enable RLS
ALTER TABLE public.hazard_reports ENABLE ROW LEVEL SECURITY;

-- 1. Public read policy: Anyone can see active crowd hazard reports
DROP POLICY IF EXISTS "Hazard reports are readable by anyone" ON public.hazard_reports;
CREATE POLICY "Hazard reports are readable by anyone"
    ON public.hazard_reports FOR SELECT
    TO anon, authenticated
    USING (TRUE);

-- 2. Public insert policy: Citizens can submit hazards during disasters
DROP POLICY IF EXISTS "Anyone can report a hazard" ON public.hazard_reports;
CREATE POLICY "Anyone can report a hazard"
    ON public.hazard_reports FOR INSERT
    TO anon, authenticated
    WITH CHECK (TRUE);

-- 3. Authority manage policy: Authorities can resolve or update hazards
DROP POLICY IF EXISTS "Authorities can manage hazards" ON public.hazard_reports;
CREATE POLICY "Authorities can manage hazards"
    ON public.hazard_reports FOR ALL
    TO authenticated
    USING (public.is_authority())
    WITH CHECK (public.is_authority());

-- Enable Realtime Replication for Hazard Reports
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'hazard_reports'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.hazard_reports;
    END IF;
END $$;

-- Initial Seed Data: Realistic Road Blocks & Flood Hazards
INSERT INTO public.hazard_reports (hazard_type, severity, lat, lng, description, avoid_radius_meters, is_active)
VALUES 
-- Bengaluru Region Hazards
(
    'flooded_road',
    4,
    12.9680,
    77.5850,
    'K.R. Market Railway Underpass flooded with 3.5ft water. Vehicles stalled, impassable.',
    300,
    TRUE
),
(
    'fallen_tree',
    3,
    12.9420,
    77.6180,
    'Uprooted tree blocking 80ft Road, Koramangala. Northbound lane blocked.',
    150,
    TRUE
),
(
    'power_cable',
    5,
    12.9750,
    77.6020,
    'Snapped live electrical transmission wire submerged in rainwater near Shivajinagar.',
    200,
    TRUE
),

-- Mangalore & Coastal Karnataka Hazards
(
    'flooded_road',
    5,
    12.8640,
    74.8460,
    'Netravati flash surge inundating Hampankatta main connector road. Water depth >4 feet.',
    350,
    TRUE
),
(
    'collapsed_bridge',
    5,
    12.9150,
    74.8180,
    'Culvert washed away near Panambur coastal link road. Road completely cut off.',
    400,
    TRUE
),
(
    'blocked_path',
    3,
    13.3420,
    74.7200,
    'Malpe coastal harbor access road obstructed by storm debris and mud.',
    200,
    TRUE
)
ON CONFLICT DO NOTHING;

