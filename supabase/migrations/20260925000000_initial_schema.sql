-- =====================================================================
-- JeevanSetu AI: Phase 1 Database Schema & Security Migration
-- Tables: profiles, tickets, facilities, ticket_events
-- Custom Functions: nearest_facilities (Haversine formula, no extensions required)
-- =====================================================================

-- 1. Enable UUID Extension (standard in PostgreSQL / Supabase)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Custom ENUM types
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('citizen', 'authority');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE intake_channel AS ENUM ('app', 'sms', 'voice');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE emergency_category AS ENUM (
        'flood', 'cyclone', 'landslide', 'fire', 'earthquake', 'medical', 'other'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE ticket_status AS ENUM (
        'new', 'assigned', 'in_progress', 'resolved'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE facility_kind AS ENUM (
        'shelter', 'hospital', 'relief_center'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- =====================================================================
-- 3. PROFILES TABLE
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role user_role NOT NULL DEFAULT 'citizen',
    full_name TEXT,
    phone TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger to auto-create profile on Supabase auth signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, role, full_name, phone)
    VALUES (
        NEW.id,
        COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'citizen'),
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
        NEW.raw_user_meta_data->>'phone'
    )
    ON CONFLICT (id) DO UPDATE
    SET role = EXCLUDED.role,
        full_name = EXCLUDED.full_name,
        phone = EXCLUDED.phone;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =====================================================================
-- 4. TICKETS TABLE
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    channel intake_channel NOT NULL DEFAULT 'app',
    original_text TEXT NOT NULL,
    original_language TEXT NOT NULL DEFAULT 'en',
    translated_text_en TEXT,
    emergency_type emergency_category NOT NULL DEFAULT 'other',
    urgency SMALLINT NOT NULL CHECK (urgency BETWEEN 1 AND 5),
    people_at_risk INTEGER NOT NULL DEFAULT 1 CHECK (people_at_risk >= 0),
    vulnerable_flags TEXT[] NOT NULL DEFAULT '{}',
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    address_text TEXT,
    status ticket_status NOT NULL DEFAULT 'new',
    assigned_to UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    reporter_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    reporter_phone TEXT,
    access_token TEXT NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
    ai_summary TEXT,
    reply_in_user_language TEXT
);

CREATE INDEX IF NOT EXISTS idx_tickets_status ON public.tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_urgency ON public.tickets(urgency DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON public.tickets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_reporter_id ON public.tickets(reporter_id);
CREATE INDEX IF NOT EXISTS idx_tickets_access_token ON public.tickets(access_token);

-- =====================================================================
-- 5. FACILITIES TABLE
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.facilities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    kind facility_kind NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    capacity INTEGER NOT NULL DEFAULT 100 CHECK (capacity >= 0),
    occupancy INTEGER NOT NULL DEFAULT 0 CHECK (occupancy >= 0),
    phone TEXT,
    address TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_facilities_kind ON public.facilities(kind);
CREATE INDEX IF NOT EXISTS idx_facilities_lat_lng ON public.facilities(lat, lng);

-- =====================================================================
-- 6. TICKET_EVENTS (AUDIT LOG) TABLE
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.ticket_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
    actor TEXT NOT NULL DEFAULT 'system',
    event TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticket_events_ticket_id ON public.ticket_events(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_events_created_at ON public.ticket_events(created_at DESC);

-- =====================================================================
-- 7. HAVERSINE NEAREST FACILITIES FUNCTION (ZERO PAID EXTENSIONS)
-- =====================================================================
-- Formula: Earth radius ~6371 km
CREATE OR REPLACE FUNCTION public.nearest_facilities(
    user_lat DOUBLE PRECISION,
    user_lng DOUBLE PRECISION,
    facility_type facility_kind DEFAULT NULL,
    max_results INTEGER DEFAULT 5
)
RETURNS TABLE (
    id UUID,
    name TEXT,
    kind facility_kind,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    capacity INTEGER,
    occupancy INTEGER,
    phone TEXT,
    address TEXT,
    distance_km DOUBLE PRECISION
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        f.id,
        f.name,
        f.kind,
        f.lat,
        f.lng,
        f.capacity,
        f.occupancy,
        f.phone,
        f.address,
        ROUND(
            (6371.0 * acos(
                LEAST(1.0, GREATEST(-1.0,
                    cos(radians(user_lat)) * cos(radians(f.lat)) *
                    cos(radians(f.lng) - radians(user_lng)) +
                    sin(radians(user_lat)) * sin(radians(f.lat))
                ))
            ))::numeric, 2
        )::DOUBLE PRECISION AS distance_km
    FROM public.facilities f
    WHERE f.is_active = TRUE
      AND (facility_type IS NULL OR f.kind = facility_type)
    ORDER BY distance_km ASC
    LIMIT max_results;
END;
$$;

-- =====================================================================
-- 8. ROW LEVEL SECURITY (RLS) POLICIES
-- =====================================================================

-- Helper function to check if current authenticated user is an authority
CREATE OR REPLACE FUNCTION public.is_authority()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'authority'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_events ENABLE ROW LEVEL SECURITY;

-- 8.1 PROFILES POLICIES
DROP POLICY IF EXISTS "Public profiles are readable by authenticated users" ON public.profiles;
CREATE POLICY "Public profiles are readable by authenticated users"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (TRUE);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- 8.2 FACILITIES POLICIES
-- Publicly readable by everyone (citizen, authority, anon)
DROP POLICY IF EXISTS "Facilities are readable by anyone" ON public.facilities;
CREATE POLICY "Facilities are readable by anyone"
    ON public.facilities FOR SELECT
    TO anon, authenticated
    USING (TRUE);

-- Authority can insert/update/delete facilities
DROP POLICY IF EXISTS "Authorities can manage facilities" ON public.facilities;
CREATE POLICY "Authorities can manage facilities"
    ON public.facilities FOR ALL
    TO authenticated
    USING (public.is_authority())
    WITH CHECK (public.is_authority());

-- 8.3 TICKETS POLICIES
-- Anyone (anon or citizen) can insert a ticket
DROP POLICY IF EXISTS "Anyone can submit a ticket" ON public.tickets;
CREATE POLICY "Anyone can submit a ticket"
    ON public.tickets FOR INSERT
    TO anon, authenticated
    WITH CHECK (TRUE);

-- Citizens can read only their own tickets (via reporter_id or access_token via RPC / filter)
-- Authorities can read all tickets
DROP POLICY IF EXISTS "Citizens read own tickets and Authorities read all" ON public.tickets;
CREATE POLICY "Citizens read own tickets and Authorities read all"
    ON public.tickets FOR SELECT
    TO anon, authenticated
    USING (
        public.is_authority()
        OR (auth.uid() IS NOT NULL AND reporter_id = auth.uid())
        -- Anonymous users query specific ticket with id and access_token in client queries
        OR (current_setting('request.headers', true)::json->>'x-ticket-access-token' IS NOT NULL 
            AND access_token = current_setting('request.headers', true)::json->>'x-ticket-access-token')
    );

-- Authorities can update any ticket (assign, change status, etc.)
DROP POLICY IF EXISTS "Authorities can update tickets" ON public.tickets;
CREATE POLICY "Authorities can update tickets"
    ON public.tickets FOR UPDATE
    TO authenticated
    USING (public.is_authority())
    WITH CHECK (public.is_authority());

-- 8.4 TICKET_EVENTS POLICIES
-- Anyone can insert a ticket event (e.g. system intake, edge function)
DROP POLICY IF EXISTS "Anyone can log ticket events" ON public.ticket_events;
CREATE POLICY "Anyone can log ticket events"
    ON public.ticket_events FOR INSERT
    TO anon, authenticated
    WITH CHECK (TRUE);

-- Authorities read all events, citizens read events for their own tickets
DROP POLICY IF EXISTS "View ticket events" ON public.ticket_events;
CREATE POLICY "View ticket events"
    ON public.ticket_events FOR SELECT
    TO anon, authenticated
    USING (
        public.is_authority()
        OR EXISTS (
            SELECT 1 FROM public.tickets t
            WHERE t.id = ticket_events.ticket_id
              AND (t.reporter_id = auth.uid())
        )
    );

-- =====================================================================
-- 9. SUPABASE REALTIME REPLICATION
-- =====================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'tickets'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.tickets;
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'ticket_events'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.ticket_events;
    END IF;
END $$;
