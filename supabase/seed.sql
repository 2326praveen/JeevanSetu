-- =====================================================================
-- JeevanSetu AI: Realistic Seed Data for Facilities & Demo Auth Roles
-- Regions: Bengaluru (Metropolitan inland) + Dakshina Kannada / Udupi (Coastal Karnataka)
-- =====================================================================

TRUNCATE TABLE public.facilities CASCADE;

INSERT INTO public.facilities (name, kind, lat, lng, capacity, occupancy, phone, address) VALUES
-- ==================== BENGALURU REGION ====================
-- 1. Victoria Hospital (Central Bengaluru)
(
    'Victoria Hospital - Emergency Trauma Care',
    'hospital',
    12.9634,
    77.5744,
    450,
    180,
    '+91-80-26701150',
    'Fort Road, near City Market, Bengaluru, Karnataka 560002'
),
-- 2. Bowring and Lady Curzon Hospital (East Bengaluru / Shivajinagar)
(
    'Bowring & Lady Curzon Relief Hospital',
    'hospital',
    12.9833,
    77.6047,
    300,
    95,
    '+91-80-25591325',
    'Hospital Road, Tasker Town, Shivajinagar, Bengaluru, Karnataka 560001'
),
-- 3. NIMHANS Disaster Response Wing (South Bengaluru)
(
    'NIMHANS Emergency Care & Trauma Wing',
    'hospital',
    12.9377,
    77.5929,
    250,
    80,
    '+91-80-26995000',
    'Hosur Road, Lakkasandra, Bengaluru, Karnataka 560029'
),
-- 4. Kanteerava Indoor Stadium Relief Center (Central Bengaluru)
(
    'Kanteerava Stadium Mega Shelter',
    'shelter',
    12.9698,
    77.5926,
    1200,
    310,
    '+91-80-22271888',
    'Kasturba Road, Sampangi Rama Nagara, Bengaluru, Karnataka 560001'
),
-- 5. Koramangala Indoor Stadium Evacuation Hub (South-East Bengaluru)
(
    'Koramangala Community Relief & Evacuation Hub',
    'shelter',
    12.9344,
    77.6200,
    600,
    120,
    '+91-80-25530120',
    '80 Feet Road, 4th Block, Koramangala, Bengaluru, Karnataka 560034'
),
-- 6. Hebbal BBMP Disaster Relief Center (North Bengaluru)
(
    'Hebbal Flood Relief & Supply Distribution Depot',
    'relief_center',
    13.0358,
    77.5970,
    400,
    50,
    '+91-80-22975800',
    'Bellary Road, Hebbal Flyover Junction, Bengaluru, Karnataka 560024'
),
-- 7. Whitefield ESI Multi-Specialty Hospital (East IT Corridor)
(
    'ESI Hospital & Disaster Unit Whitefield',
    'hospital',
    12.9856,
    77.7289,
    200,
    45,
    '+91-80-28410214',
    'Whitefield Main Road, Kadugodi, Bengaluru, Karnataka 560067'
),
-- 8. RR Nagar Relief camp (West Bengaluru)
(
    'Rajarajeshwari Nagar Community Shelter',
    'shelter',
    12.9250,
    77.5180,
    500,
    90,
    '+91-80-28604321',
    'Ideal Homes Township, RR Nagar, Bengaluru, Karnataka 560098'
),

-- ==================== COASTAL KARNATAKA (MANGALORE / UDUPI) ====================
-- 9. Wenlock District Hospital (Mangalore Coast - Flood/Cyclone center)
(
    'Government Wenlock District Hospital',
    'hospital',
    12.8688,
    74.8436,
    500,
    220,
    '+91-824-2423300',
    'Hampankatta, Mangaluru, Dakshina Kannada, Karnataka 575001'
),
-- 10. Father Muller Medical College & Disaster Wing (Kankanady, Mangalore)
(
    'Father Muller Disaster Triage Center',
    'hospital',
    12.8601,
    74.8624,
    400,
    140,
    '+91-824-2238000',
    'Father Muller Road, Kankanady, Mangaluru, Karnataka 575002'
),
-- 11. Panambur Beach Cyclone & Tsunami Relief Center (Mangalore Port Coast)
(
    'Panambur Port Cyclone Evacuation Shelter',
    'shelter',
    12.9348,
    74.8015,
    900,
    110,
    '+91-824-2407635',
    'Near New Mangalore Port, Panambur, Mangaluru, Karnataka 575010'
),
-- 12. Ullal Coastal Flood Refuge Camp (South Coastal Mangalore)
(
    'Ullal Coastal Flood Emergency Shelter',
    'shelter',
    12.8025,
    74.8510,
    650,
    30,
    '+91-824-2465110',
    'Ullal Sea Ground Road, Kotepura, Ullal, Karnataka 575020'
),
-- 13. Udupi District Government Hospital (Ajjarakadu, Udupi)
(
    'Udupi District Hospital & Trauma Unit',
    'hospital',
    13.3364,
    74.7472,
    350,
    115,
    '+91-820-2520555',
    'Ajjarakadu, Udupi, Karnataka 576101'
),
-- 14. Malpe Harbor Marine Emergency Relief Depot (Udupi Coast)
(
    'Malpe Harbor Marine Rescue & Relief Depot',
    'relief_center',
    13.3542,
    74.7008,
    450,
    40,
    '+91-820-2538200',
    'Fisheries Jetty Road, Malpe, Udupi, Karnataka 576108'
),
-- 15. Kaup Light House Evacuation Sanctuary (Kaup Coast)
(
    'Kaup Coastal High-Ground Evacuation Center',
    'shelter',
    13.2238,
    74.7412,
    550,
    15,
    '+91-820-2551020',
    'Lighthouse Road, Padu, Kaup, Karnataka 574106'
);
