-- =====================================================================
-- JeevanSetu AI: Migration 20261029000000_authority_dashboard
-- 1. Create rescue_teams table with real geo-coordinates (Bengaluru & Mangalore)
-- 2. Add assigned_team_id to public.tickets
-- 3. Create assign_nearest_team(ticket_id) using Haversine calculation
-- 4. Audit logging into ticket_events
-- 5. RLS policies & Realtime publication for authority dashboard
-- =====================================================================

-- 1. RESCUE_TEAMS TABLE
CREATE TABLE IF NOT EXISTS public.rescue_teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    available BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rescue_teams_available ON public.rescue_teams(available);
CREATE INDEX IF NOT EXISTS idx_rescue_teams_lat_lng ON public.rescue_teams(lat, lng);

-- 2. ADD assigned_team_id TO TICKETS TABLE
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'tickets' 
          AND column_name = 'assigned_team_id'
    ) THEN
        ALTER TABLE public.tickets 
        ADD COLUMN assigned_team_id UUID REFERENCES public.rescue_teams(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tickets_assigned_team_id ON public.tickets(assigned_team_id);

-- 3. HAVERSINE ASSIGN NEAREST TEAM FUNCTION
CREATE OR REPLACE FUNCTION public.assign_nearest_team(target_ticket_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    t_lat DOUBLE PRECISION;
    t_lng DOUBLE PRECISION;
    found_team RECORD;
    result JSONB;
BEGIN
    -- Verify authority or service role permission
    IF NOT (public.is_authority() OR auth.role() = 'service_role') THEN
        RAISE EXCEPTION 'Access denied: only authorities can assign rescue teams';
    END IF;

    -- Retrieve ticket coordinates
    SELECT lat, lng INTO t_lat, t_lng
    FROM public.tickets
    WHERE id = target_ticket_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ticket % not found', target_ticket_id;
    END IF;

    -- Fallback coordinates if ticket coordinates are null (Central Bengaluru)
    IF t_lat IS NULL OR t_lng IS NULL THEN
        t_lat := 12.9716;
        t_lng := 77.5946;
    END IF;

    -- Find nearest available rescue team using Haversine formula
    SELECT 
        rt.id,
        rt.name,
        rt.type,
        rt.lat,
        rt.lng,
        ROUND(
            (6371.0 * acos(
                LEAST(1.0, GREATEST(-1.0,
                    cos(radians(t_lat)) * cos(radians(rt.lat)) *
                    cos(radians(rt.lng) - radians(t_lng)) +
                    sin(radians(t_lat)) * sin(radians(rt.lat))
                ))
            ))::numeric, 2
        )::DOUBLE PRECISION AS distance_km
    INTO found_team
    FROM public.rescue_teams rt
    WHERE rt.available = TRUE
    ORDER BY distance_km ASC
    LIMIT 1;

    IF found_team.id IS NULL THEN
        RAISE EXCEPTION 'No available rescue teams found at this time';
    END IF;

    -- Update ticket with assigned team and update status
    UPDATE public.tickets
    SET assigned_team_id = found_team.id,
        status = 'assigned',
        updated_at = NOW()
    WHERE id = target_ticket_id;

    -- Mark team as occupied/unavailable
    UPDATE public.rescue_teams
    SET available = FALSE
    WHERE id = found_team.id;

    -- Audit log in ticket_events
    INSERT INTO public.ticket_events (ticket_id, actor, event, metadata)
    VALUES (
        target_ticket_id,
        'authority',
        'team_assigned',
        jsonb_build_object(
            'team_id', found_team.id,
            'team_name', found_team.name,
            'team_type', found_team.type,
            'distance_km', found_team.distance_km,
            'assigned_by', auth.uid()
        )
    );

    result := jsonb_build_object(
        'success', true,
        'ticket_id', target_ticket_id,
        'team_id', found_team.id,
        'team_name', found_team.name,
        'team_type', found_team.type,
        'distance_km', found_team.distance_km
    );

    RETURN result;
END;
$$;

-- 4. SEED RESCUE TEAMS (BENGALURU & MANGALORE)
INSERT INTO public.rescue_teams (name, type, lat, lng, available)
SELECT * FROM (VALUES
    -- Bengaluru Region
    ('NDRF Battalion 10 - Unit Alpha', 'ndrf', 13.0827, 77.5877, TRUE),
    ('Karnataka Fire & Emergency Quick Response', 'fire_rescue', 12.9780, 77.5860, TRUE),
    ('Civil Defence Disaster Relief Corps - South', 'civil_defence', 12.9340, 77.6101, TRUE),
    ('Victoria Trauma Medical Emergency Squad', 'medical', 12.9634, 77.5744, TRUE),
    ('Whitefield Flood Rescue Boat Unit', 'boat_rescue', 12.9720, 77.7210, TRUE),
    -- Mangalore / Coastal Region
    ('NDRF Coastal Marine Taskforce', 'ndrf', 12.9348, 74.8015, TRUE),
    ('SDRF Coastal Flood & Boat Rescue', 'boat_rescue', 12.8700, 74.8450, TRUE),
    ('Wenlock District Medical Response Team', 'medical', 12.8688, 74.8436, TRUE),
    ('Panambur Coastal Guard Rescue Unit', 'coastal_guard', 12.9250, 74.8200, TRUE),
    ('Malpe Harbor Emergency Marine Unit', 'boat_rescue', 13.3542, 74.7008, TRUE)
) AS v(name, type, lat, lng, available)
WHERE NOT EXISTS (
    SELECT 1 FROM public.rescue_teams WHERE public.rescue_teams.name = v.name
);

-- 5. RLS POLICIES FOR RESCUE_TEAMS & TICKETS VERIFICATION
ALTER TABLE public.rescue_teams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Rescue teams readable by authenticated and anon" ON public.rescue_teams;
CREATE POLICY "Rescue teams readable by authenticated and anon"
    ON public.rescue_teams FOR SELECT
    TO anon, authenticated
    USING (TRUE);

DROP POLICY IF EXISTS "Authorities can manage rescue teams" ON public.rescue_teams;
CREATE POLICY "Authorities can manage rescue teams"
    ON public.rescue_teams FOR ALL
    TO authenticated
    USING (public.is_authority())
    WITH CHECK (public.is_authority());

-- Re-verify tickets RLS boundary: Authorities SELECT/UPDATE all; Citizens read only their own
DROP POLICY IF EXISTS "Citizens read own tickets and Authorities read all" ON public.tickets;
CREATE POLICY "Citizens read own tickets and Authorities read all"
    ON public.tickets FOR SELECT
    TO anon, authenticated
    USING (
        public.is_authority()
        OR (auth.uid() IS NOT NULL AND reporter_id = auth.uid())
        OR (current_setting('request.headers', true)::json->>'x-ticket-access-token' IS NOT NULL 
            AND access_token = current_setting('request.headers', true)::json->>'x-ticket-access-token')
    );

DROP POLICY IF EXISTS "Authorities can update tickets" ON public.tickets;
CREATE POLICY "Authorities can update tickets"
    ON public.tickets FOR UPDATE
    TO authenticated
    USING (public.is_authority())
    WITH CHECK (public.is_authority());

-- 6. REALTIME REPLICATION FOR RESCUE_TEAMS
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'rescue_teams'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.rescue_teams;
    END IF;
END $$;

