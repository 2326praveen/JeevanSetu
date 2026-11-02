/**
 * Nominatim OpenStreetMap Free Geocoder Fallback for India
 * Zero-Cost constraint compliant.
 */

export interface GeoCoordinate {
  lat: number;
  lng: number;
  displayName: string;
}

export async function geocodeLocationText(locationText: string): Promise<GeoCoordinate | null> {
  if (!locationText || locationText.trim().length < 2) {
    return null;
  }

  try {
    const query = encodeURIComponent(`${locationText.trim()}, India`);
    const url = `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1&countrycodes=in`;

    const resp = await fetch(url, {
      headers: {
        "User-Agent": "JeevanSetu-AI-DisasterRescue/1.0 (contact: emergency-rescue@jeevansetu.in)",
        "Accept-Language": "en,hi,te,ta,kn",
      },
    });

    if (!resp.ok) {
      console.warn(`Nominatim geocoding status: ${resp.status}`);
      return null;
    }

    const data = await resp.json();
    if (Array.isArray(data) && data.length > 0) {
      const first = data[0];
      return {
        lat: parseFloat(first.lat),
        lng: parseFloat(first.lon),
        displayName: first.display_name || locationText,
      };
    }
    return null;
  } catch (err) {
    console.error("Nominatim geocoding error:", err);
    return null;
  }
}
