-- =====================================================================
-- JeevanSetu AI: Phase 1 Disaster Prediction Engine Migration
-- Table: risk_forecasts
-- Function: get_nearest_risk_forecast
-- RLS: Public read, authority/service_role write
-- Realtime: Enabled
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.risk_forecasts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    region TEXT NOT NULL UNIQUE,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    hazard TEXT NOT NULL, -- 'flood', 'cyclone', 'landslide', 'heatwave', 'earthquake', 'none'
    score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
    level TEXT NOT NULL CHECK (level IN ('low', 'moderate', 'high', 'critical')),
    advisory TEXT NOT NULL,
    metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
    checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
    valid_until TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_risk_forecasts_lat_lng ON public.risk_forecasts(lat, lng);
CREATE INDEX IF NOT EXISTS idx_risk_forecasts_hazard ON public.risk_forecasts(hazard);
CREATE INDEX IF NOT EXISTS idx_risk_forecasts_level ON public.risk_forecasts(level);

-- Enable RLS
ALTER TABLE public.risk_forecasts ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Risk forecasts are readable by anyone" ON public.risk_forecasts;
CREATE POLICY "Risk forecasts are readable by anyone"
    ON public.risk_forecasts FOR SELECT
    TO anon, authenticated
    USING (TRUE);

DROP POLICY IF EXISTS "Authorities and service role can manage risk forecasts" ON public.risk_forecasts;
CREATE POLICY "Authorities and service role can manage risk forecasts"
    ON public.risk_forecasts FOR ALL
    TO authenticated
    USING (public.is_authority())
    WITH CHECK (public.is_authority());

-- Haversine function to fetch nearest risk forecast
CREATE OR REPLACE FUNCTION public.get_nearest_risk_forecast(
    user_lat DOUBLE PRECISION,
    user_lng DOUBLE PRECISION
)
RETURNS TABLE (
    id UUID,
    region TEXT,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    hazard TEXT,
    score INTEGER,
    level TEXT,
    advisory TEXT,
    metrics JSONB,
    checklist JSONB,
    valid_until TIMESTAMPTZ,
    distance_km DOUBLE PRECISION
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        rf.id,
        rf.region,
        rf.lat,
        rf.lng,
        rf.hazard,
        rf.score,
        rf.level,
        rf.advisory,
        rf.metrics,
        rf.checklist,
        rf.valid_until,
        ROUND(
            (6371.0 * acos(
                LEAST(1.0, GREATEST(-1.0,
                    cos(radians(user_lat)) * cos(radians(rf.lat)) *
                    cos(radians(rf.lng) - radians(user_lng)) +
                    sin(radians(user_lat)) * sin(radians(rf.lat))
                ))
            ))::numeric, 2
        )::DOUBLE PRECISION AS distance_km
    FROM public.risk_forecasts rf
    ORDER BY distance_km ASC
    LIMIT 1;
END;
$$;

-- Realtime Publication
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'risk_forecasts'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.risk_forecasts;
    END IF;
END $$;

-- Initial Seed Data for Demo Districts
INSERT INTO public.risk_forecasts (region, lat, lng, hazard, score, level, advisory, metrics, checklist, valid_until)
VALUES 
(
    'Dakshina Kannada (Mangaluru)',
    12.9141,
    74.8560,
    'flood',
    78,
    'high',
    'Severe coastal rainfall exceeding 72mm and surging river runoff detected in Netravati catchment. Low-lying riparian zones and coastal habitations face imminent waterlogging.',
    '{"precipitation_mm": 72.4, "river_discharge_m3s": 380, "wind_speed_kmh": 48, "max_temp_c": 29.5}'::jsonb,
    '["Store 3 days potable water and non-perishable rations", "Elevate electrical appliances and disconnect grounded mains", "Secure vital identity documents in watertight pouches", "Identify your nearest safe shelter (Govt PU College or Relief Hall)"]'::jsonb,
    NOW() + INTERVAL '24 hours'
),
(
    'Bengaluru Urban',
    12.9716,
    77.5946,
    'flood',
    42,
    'moderate',
    'Moderate convective evening showers anticipated with storm drain bottlenecks in eastern corridors. Risk of localized road flooding in underpasses.',
    '{"precipitation_mm": 28.5, "river_discharge_m3s": 42, "wind_speed_kmh": 24, "max_temp_c": 31.0}'::jsonb,
    '["Avoid transit through known flooded underpasses during storm", "Check perimeter drainage around ground-floor entrances", "Charge mobile phones and powerbanks before expected downpour"]'::jsonb,
    NOW() + INTERVAL '24 hours'
),
(
    'Uttara Kannada (Karwar)',
    14.8185,
    74.1350,
    'landslide',
    74,
    'high',
    'Saturated Western Ghats soil layers following 88mm continuous precipitation. Elevated risk of debris flow and rockslides along ghat corridors and NH-66.',
    '{"precipitation_mm": 88.0, "river_discharge_m3s": 210, "wind_speed_kmh": 36, "max_temp_c": 27.5}'::jsonb,
    '["Avoid non-essential transit across steep mountain ghat roads", "Inspect hillsides for new surface cracks, tilted trees, or muddy seepages", "Evacuate immediately if rumbling sounds or slope movement occur"]'::jsonb,
    NOW() + INTERVAL '24 hours'
),
(
    'Puri / Coastal Odisha',
    19.8135,
    85.8312,
    'cyclone',
    86,
    'critical',
    'Severe cyclonic storm system advancing through Bay of Bengal with sustained wind gusts of 86 km/h and coastal tidal surge warnings.',
    '{"precipitation_mm": 115.0, "river_discharge_m3s": 520, "wind_speed_kmh": 86, "max_temp_c": 27.0}'::jsonb,
    '["Follow coastal evacuation directives to designated cyclone shelters immediately", "Board up or latch all glass windows and secure loose rooftop items", "Keep battery-powered radio and emergency lighting at hand", "Do not venture into open sea or coastal beaches under any circumstance"]'::jsonb,
    NOW() + INTERVAL '24 hours'
),
(
    'Delhi NCR',
    28.6139,
    77.2090,
    'heatwave',
    68,
    'high',
    'Severe heatwave conditions with peak afternoon temperatures touching 43.8°C and low humidity. High risk of dehydration and heat exhaustion.',
    '{"precipitation_mm": 0.0, "river_discharge_m3s": 12, "wind_speed_kmh": 16, "max_temp_c": 43.8}'::jsonb,
    '["Avoid direct outdoor sun exposure between 11:30 AM and 4:30 PM", "Drink water and ORS/coconut water frequently even if not feeling thirsty", "Ensure shaded quarters and hydration for children, elderly, and pets"]'::jsonb,
    NOW() + INTERVAL '24 hours'
)
ON CONFLICT (region) DO UPDATE
SET hazard = EXCLUDED.hazard,
    score = EXCLUDED.score,
    level = EXCLUDED.level,
    advisory = EXCLUDED.advisory,
    metrics = EXCLUDED.metrics,
    checklist = EXCLUDED.checklist,
    valid_until = EXCLUDED.valid_until,
    updated_at = NOW();

