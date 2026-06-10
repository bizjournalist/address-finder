const DATA_URLS = {
  counties: "data/counties.geojson",
  subdivisions: "data/county_subdivisions.geojson",
  places: "data/places.geojson"
};

const CORE_REGION_BOUNDS = [
  [42.35, -74.15],
  [43.35, -73.20]
];

let map;
let searchMarker = null;
let countiesGeojson = null;
let subdivisionsGeojson = null;
let placesGeojson = null;
let countyLayer = null;
let subdivisionLayer = null;
let placeLayer = null;

const resultPanel = document.getElementById("result-panel");
const resultText = document.getElementById("result-text");
const searchForm = document.getElementById("search-form");
const addressInput = document.getElementById("address-input");
const resetButton = document.getElementById("reset-button");

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
    setWarning("Boundary data did not load. Confirm that counties.geojson, county_subdivisions.geojson and places.geojson exist in the /data folder. If testing locally, use a local web server or GitHub Pages instead of opening index.html directly.");
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
    const [counties, subdivisions, places] = await Promise.all([
      fetchJson(DATA_URLS.counties),
      fetchJson(DATA_URLS.subdivisions),
      fetchJson(DATA_URLS.places)
    ]);
    countiesGeojson = counties;
    subdivisionsGeojson = subdivisions;
    placesGeojson = places;
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
  countyLayer = L.geoJSON(countiesGeojson, { style: countyStyle, onEachFeature: bindBoundaryPopup("County") }).addTo(map);
  subdivisionLayer = L.geoJSON(subdivisionsGeojson, { style: subdivisionStyle, onEachFeature: bindBoundaryPopup("Town/City") }).addTo(map);
  placeLayer = L.geoJSON(placesGeojson, { style: placeStyle, onEachFeature: bindBoundaryPopup("Village/Place") }).addTo(map);

  L.control.layers(null, {
    "Counties": countyLayer,
    "Towns/Cities": subdivisionLayer,
    "Villages/Places": placeLayer
  }, { collapsed: false }).addTo(map);
}

function countyStyle() { return { color: "#222222", weight: 2.4, opacity: 0.95, fillOpacity: 0 }; }
function subdivisionStyle() { return { color: "#2f6fbd", weight: 1.35, opacity: 0.85, fillColor: "#2f6fbd", fillOpacity: 0.035 }; }
function placeStyle() { return { color: "#b04a00", weight: 1.4, opacity: 0.9, dashArray: "4 3", fillColor: "#f2994a", fillOpacity: 0.06 }; }

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
    const geocodeResult = await geocodeWithCensus(query);
    if (!geocodeResult) {
      setWarning("No Census Geocoder match found. Try adding city, state or ZIP.");
      return;
    }

    const { lat, lon, matchedAddress } = geocodeResult;
    showSearchMarker(lat, lon, matchedAddress);
    const lookup = lookupJurisdictions(lon, lat);
    const message = formatLookupResult(lookup, matchedAddress);

    if (lookup.county || lookup.subdivision || lookup.place) setResult(message);
    else setWarning(message);
  } catch (error) {
    console.error("Search error:", error);
    setWarning("Search failed. Check the address and try again.");
  } finally {
    submitButton.disabled = false;
  }
}

async function geocodeWithCensus(query) {
  const url = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
  url.searchParams.set("address", query);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("format", "json");

  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`Census geocoder error: ${response.status}`);

  const data = await response.json();
  const matches = data?.result?.addressMatches || [];
  if (!matches.length) return null;

  const best = matches[0];
  const coords = best.coordinates;
  if (!coords || typeof coords.x !== "number" || typeof coords.y !== "number") return null;

  return { lon: coords.x, lat: coords.y, matchedAddress: best.matchedAddress || query };
}

function showSearchMarker(lat, lon, matchedAddress) {
  if (searchMarker) map.removeLayer(searchMarker);
  searchMarker = L.marker([lat, lon]).addTo(map);
  searchMarker.bindPopup(`<strong>Matched address</strong><br>${escapeHtml(matchedAddress)}`).openPopup();
  map.setView([lat, lon], 14);
}

function lookupJurisdictions(lon, lat) {
  const point = turf.point([lon, lat]);
  return {
    county: findContainingFeature(point, countiesGeojson),
    subdivision: findContainingFeature(point, subdivisionsGeojson),
    place: findContainingFeature(point, placesGeojson)
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
  const countyName = lookup.county ? cleanCountyName(getDisplayName(lookup.county.properties)) : null;
  const subdivisionName = lookup.subdivision ? cleanMunicipalName(getDisplayName(lookup.subdivision.properties)) : null;
  const placeName = lookup.place ? cleanMunicipalName(getDisplayName(lookup.place.properties)) : null;
  const placeType = lookup.place ? inferPlaceType(lookup.place.properties) : null;
  const subdivisionType = lookup.subdivision ? inferSubdivisionType(lookup.subdivision.properties) : null;

  if (!countyName && !subdivisionName && !placeName) {
    return `Matched address: ${matchedAddress}. This location is outside the supported Albany-region boundary file.`;
  }

  const parts = [];
  if (placeName && subdivisionName && !sameName(placeName, subdivisionName)) {
    parts.push(`${titleCase(placeType || "place")} of ${placeName}`);
    parts.push(`${titleCase(subdivisionType || "town/city")} of ${subdivisionName}`);
  } else if (subdivisionName) {
    parts.push(`${titleCase(subdivisionType || "municipality")} of ${subdivisionName}`);
  } else if (placeName) {
    parts.push(`${titleCase(placeType || "place")} of ${placeName}`);
  }
  if (countyName) parts.push(`${countyName} County`);
  return `Matched address: ${matchedAddress}. This appears to be in ${parts.join(", ")}.`;
}

function getDisplayName(props) {
  if (!props) return "";
  return props.NAMELSAD || props.NAME || props.name || props.Name || props.MUNI_NAME || props.MUNICIPALITY || props.COUNTY || "";
}
function cleanCountyName(name) { return String(name || "").replace(/\s+County$/i, "").trim(); }
function cleanMunicipalName(name) { return String(name || "").replace(/\s+(town|city|village|CDP|county subdivision|borough)$/i, "").trim(); }
function inferPlaceType(props) {
  const name = getDisplayName(props).toLowerCase();
  const lsad = String(props?.LSAD || props?.lsad || "").toLowerCase();
  if (name.includes("village")) return "village";
  if (name.includes("city")) return "city";
  if (name.includes("cdp")) return "CDP";
  if (lsad === "47") return "village";
  if (lsad === "25") return "city";
  return "place";
}
function inferSubdivisionType(props) {
  const name = getDisplayName(props).toLowerCase();
  const lsad = String(props?.LSAD || props?.lsad || "").toLowerCase();
  if (name.includes("town")) return "town";
  if (name.includes("city")) return "city";
  if (lsad === "43") return "town";
  if (lsad === "25") return "city";
  return "municipality";
}
function sameName(a, b) { return normalizeName(a) === normalizeName(b); }
function normalizeName(value) { return String(value || "").toLowerCase().replace(/\b(town|city|village|county|cdp|of)\b/g, "").replace(/[^a-z0-9]/g, "").trim(); }
function titleCase(value) {
  if (!value) return "";
  if (value.toUpperCase() === "CDP") return "CDP";
  return value.split("/").map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join("/");
}
function setResult(message) { resultPanel.classList.remove("warning"); resultText.textContent = message; }
function setWarning(message) { resultPanel.classList.add("warning"); resultText.textContent = message; }
function escapeHtml(value) { return String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
