const DATA_URLS = {
  counties:  "data/counties.geojson",
  towns:     "data/towns.geojson",
  cities:    "data/cities.geojson",
  villages:  "data/villages.geojson"
};

const CORE_REGION_BOUNDS = [
  [42.35, -74.15],
  [43.35, -73.20]
];

let map;
let searchMarker = null;
let countiesGeojson   = null;
let townsGeojson      = null;
let citiesGeojson     = null;
let villagesGeojson   = null;
let countyLayer       = null;
let townLayer         = null;
let cityLayer         = null;
let villageLayer      = null;

const resultPanel  = document.getElementById("result-panel");
const resultText   = document.getElementById("result-text");
const searchForm   = document.getElementById("search-form");
const addressInput = document.getElementById("address-input");
const resetButton  = document.getElementById("reset-button");

init();

async function init() {
  initMap();
  bindEvents();
  setResult("Loading boundary data…");

  const loaded = await loadBoundaryData();
  if (loaded) {
    addBoundaryLayers();
    setResult("Search for an address to identify the municipality and county.");
  } else {
    setWarning("Boundary data did not load. Confirm that counties.geojson, towns.geojson, cities.geojson and villages.geojson exist in the /data folder. If testing locally, use a local web server or GitHub Pages instead of opening index.html directly.");
  }
}

function initMap() {
  map = L.map("map", { zoomControl: true });
  map.fitBounds(CORE_REGION_BOUNDS);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
  setTimeout(() => map.invalidateSize(), 100);
}

function bindEvents() {
  searchForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = addressInput.value.trim();
    if (!query) {
      setWarning("Enter an address or place to search.");
      return;
    }
    await handleSearch(query);
  });

  resetButton.addEventListener("click", () => {
    if (searchMarker) {
      map.removeLayer(searchMarker);
      searchMarker = null;
    }
    addressInput.value = "";
    map.fitBounds(CORE_REGION_BOUNDS);
    setResult("Search for an address to identify the municipality and county.");
  });
}

async function loadBoundaryData() {
  try {
    const [counties, towns, cities, villages] = await Promise.all([
      fetchJson(DATA_URLS.counties),
      fetchJson(DATA_URLS.towns),
      fetchJson(DATA_URLS.cities),
      fetchJson(DATA_URLS.villages)
    ]);
    countiesGeojson  = counties;
    townsGeojson     = towns;
    citiesGeojson    = cities;
    villagesGeojson  = villages;
    return true;
  } catch (error) {
    console.error("Boundary data load error:", error);
    return false;
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}: ${response.status}`);
  return response.json();
}

function addBoundaryLayers() {
  countyLayer  = L.geoJSON(countiesGeojson,  { style: countyStyle,  onEachFeature: bindBoundaryPopup("County") }).addTo(map);
  townLayer    = L.geoJSON(townsGeojson,     { style: townStyle,    onEachFeature: bindBoundaryPopup("Town") }).addTo(map);
  cityLayer    = L.geoJSON(citiesGeojson,    { style: cityStyle,    onEachFeature: bindBoundaryPopup("City") }).addTo(map);
  villageLayer = L.geoJSON(villagesGeojson,  { style: villageStyle, onEachFeature: bindBoundaryPopup("Village") }).addTo(map);

  L.control.layers(null, {
    "Counties":  countyLayer,
    "Towns":     townLayer,
    "Cities":    cityLayer,
    "Villages":  villageLayer
  }, { collapsed: false }).addTo(map);
}

function countyStyle()  { return { color: "#222222", weight: 2.4,  opacity: 0.95, fillOpacity: 0 }; }
function townStyle()    { return { color: "#2f6fbd", weight: 1.35, opacity: 0.85, fillColor: "#2f6fbd", fillOpacity: 0.035 }; }
function cityStyle()    { return { color: "#6a2fbd", weight: 1.5,  opacity: 0.9,  fillColor: "#6a2fbd", fillOpacity: 0.05 }; }
function villageStyle() { return { color: "#b04a00", weight: 1.4,  opacity: 0.9,  dashArray: "4 3", fillColor: "#f2994a", fillOpacity: 0.06 }; }

function bindBoundaryPopup(layerType) {
  return function (feature, layer) {
    const props = feature.properties || {};
    const name = getDisplayName(props);
    layer.bindPopup(`<div class="boundary-popup"><strong>${escapeHtml(name || "Unnamed area")}</strong><span>${escapeHtml(layerType)}</span></div>`);
  };
}

async function handleSearch(query) {
  setResult("Searching…");
  const submitButton = searchForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;

  try {
    const geocodeResult = await geocodeWithNominatim(query);
    if (!geocodeResult) {
      setWarning("No match found. Try adding city, state or ZIP code.");
      return;
    }

    const { lat, lon, matchedAddress } = geocodeResult;
    showSearchMarker(lat, lon, matchedAddress);
    const lookup = lookupJurisdictions(lon, lat);
    const message = formatLookupResult(lookup, matchedAddress);

    if (lookup.county || lookup.town || lookup.city || lookup.village) {
      setResult(message);
    } else {
      setWarning(message);
    }
  } catch (error) {
    console.error("Search error:", error);
    setWarning("Search failed. Check the address and try again.");
  } finally {
    submitButton.disabled = false;
  }
}

async function geocodeWithNominatim(query) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "us");

  const response = await fetch(url.toString(), {
    headers: {
      "Accept-Language": "en",
      "User-Agent": "Albany-Municipal-Lookup/1.0 (newsroom reference tool)"
    }
  });
  if (!response.ok) throw new Error(`Nominatim error: ${response.status}`);

  const data = await response.json();
  if (!data.length) return null;

  const best = data[0];
  return {
    lon: parseFloat(best.lon),
    lat: parseFloat(best.lat),
    matchedAddress: query
  };
}

function showSearchMarker(lat, lon, matchedAddress) {
  if (searchMarker) map.removeLayer(searchMarker);
  searchMarker = L.marker([lat, lon]).addTo(map);
  searchMarker.bindPopup(`<strong>Searched address</strong><br>${escapeHtml(matchedAddress)}`).openPopup();
  map.setView([lat, lon], 14);
}

function lookupJurisdictions(lon, lat) {
  const point = turf.point([lon, lat]);
  return {
    county:  findContainingFeature(point, countiesGeojson),
    town:    findContainingFeature(point, townsGeojson),
    city:    findContainingFeature(point, citiesGeojson),
    village: findContainingFeature(point, villagesGeojson)
  };
}

function findContainingFeature(point, featureCollection) {
  if (!featureCollection || !Array.isArray(featureCollection.features)) return null;
  for (const feature of featureCollection.features) {
    if (!feature || !feature.geometry) continue;
    const geometryType = feature.geometry.type;
    if (geometryType !== "Polygon" && geometryType !== "MultiPolygon") continue;
    try {
      if (turf.booleanPointInPolygon(point, feature, { ignoreBoundary: false })) return feature;
    } catch (error) {
      console.warn("Point-in-polygon failed for feature:", feature, error);
    }
  }
  return null;
}

function formatLookupResult(lookup, matchedAddress) {
  const countyName  = lookup.county  ? cleanCountyName(getDisplayName(lookup.county.properties))   : null;
  const townName    = lookup.town    ? cleanMunicipalName(getDisplayName(lookup.town.properties))   : null;
  const cityName    = lookup.city    ? cleanMunicipalName(getDisplayName(lookup.city.properties))   : null;
  const villageName = lookup.village ? cleanMunicipalName(getDisplayName(lookup.village.properties)): null;

  if (!countyName && !townName && !cityName && !villageName) {
    return `Searched address: ${matchedAddress}. This location is outside the supported Albany-region boundary file.`;
  }

  const parts = [];

  // Village (overlaid on a town)
  if (villageName) parts.push(`Village of ${villageName}`);

  // Town or city — mutually exclusive in practice, but handle both gracefully
  if (townName)    parts.push(`Town of ${townName}`);
  if (cityName)    parts.push(`City of ${cityName}`);

  if (countyName)  parts.push(`${countyName} County`);

  return `Searched address: ${matchedAddress}. This appears to be in ${parts.join(", ")}.`;
}

function getDisplayName(props) {
  if (!props) return "";
  return props.NAMELSAD || props.NAME || props.name || props.Name || props.MUNI_NAME || props.MUNICIPALITY || props.COUNTY || "";
}

function cleanCountyName(name)     { return String(name || "").replace(/\s+County$/i, "").trim(); }
function cleanMunicipalName(name)  { return String(name || "").replace(/\s+(town|city|village|CDP|county subdivision|borough)$/i, "").trim(); }

function setResult(message)  { resultPanel.classList.remove("warning"); resultText.textContent = message; }
function setWarning(message) { resultPanel.classList.add("warning");    resultText.textContent = message; }

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&",  "&amp;")
    .replaceAll("<",  "&lt;")
    .replaceAll(">",  "&gt;")
    .replaceAll('"',  "&quot;")
    .replaceAll("'",  "&#039;");
}
