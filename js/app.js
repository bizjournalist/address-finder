const DATA_URLS = {
  counties:  "data/counties.geojson",
  towns:     "data/towns.geojson",
  cities:    "data/cities.geojson",
  villages:  "data/villages.geojson"
};

const CORE_REGION_BOUNDS = [
  [42.55, -74.00],
  [43.10, -73.45]
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
const copyButton   = document.getElementById("copy-button");

init();

async function init() {
  initMap();
  bindEvents();
  setResult("Loading boundary data…");

  const loaded = await loadBoundaryData();
  if (loaded) {
    addBoundaryLayers();
    setResult(null);
  } else {
    setWarning("Boundary data did not load. Confirm that counties.geojson, towns.geojson, cities.geojson and villages.geojson exist in the /data folder. If testing locally, use a local web server or GitHub Pages instead of opening index.html directly.");
  }
}

// --- Map init -----------------------------------------------------------

function initMap() {
  map = L.map("map", { zoomControl: true });
  map.fitBounds(CORE_REGION_BOUNDS);

  // FIX 1: CartoDB Positron — low-contrast grey base map designed for
  // data overlays. Replaces the busy default OpenStreetMap tile.
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 19,
    subdomains: "abcd",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
  }).addTo(map);

  setTimeout(() => map.invalidateSize(), 100);
}

// --- Events -------------------------------------------------------------

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
    setResult(null);
  });

  copyButton.addEventListener("click", () => {
    const text = resultText.dataset.copyText;
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      copyButton.textContent = "Copied";
      setTimeout(() => { copyButton.innerHTML = '<i class="ti ti-copy"></i> Copy'; }, 1800);
    });
  });
}

// --- Data loading -------------------------------------------------------

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

// --- Layer rendering ----------------------------------------------------

function addBoundaryLayers() {
  countyLayer  = L.geoJSON(countiesGeojson,  { style: countyStyle,  onEachFeature: bindBoundaryPopup("County") });
  townLayer    = L.geoJSON(townsGeojson,     { style: townStyle,    onEachFeature: bindBoundaryPopup("Town") });
  cityLayer    = L.geoJSON(citiesGeojson,    { style: cityStyle,    onEachFeature: bindBoundaryPopup("City") });
  villageLayer = L.geoJSON(villagesGeojson,  { style: villageStyle, onEachFeature: bindBoundaryPopup("Village") });

  // FIX 4 (revised): Only counties visible by default. Towns, cities and
  // villages are available in the layer control but start hidden.
  countyLayer.addTo(map);

  L.control.layers(null, {
    "Counties":  countyLayer,
    "Towns":     townLayer,
    "Cities":    cityLayer,
    "Villages":  villageLayer
  }, { collapsed: false }).addTo(map);
}

// FIX 2: Layer styles
// Counties: heavy dark stroke, no fill — structural frame.
// Towns and cities: equal weight (1.2px), same low opacity — same
// functional significance for this tool, distinguished only by color.
// Villages: same weight as towns/cities, solid (not dashed), warm amber.

function countyStyle()  {
  return { color: "#1a1a1a", weight: 2.2, opacity: 0.85, fillOpacity: 0 };
}
function townStyle()    { return { color: "#888888", weight: 1.1, opacity: 0.6,  fillOpacity: 0 }; }
function cityStyle()    { return { color: "#888888", weight: 1.1, opacity: 0.6,  fillOpacity: 0 }; }
function villageStyle() { return { color: "#bbbbbb", weight: 1.0, opacity: 0.75, fillOpacity: 0 }; }

function bindBoundaryPopup(layerType) {
  return function (feature, layer) {
    const props = feature.properties || {};
    const name = getDisplayName(props);
    layer.bindPopup(`<div class="boundary-popup"><strong>${escapeHtml(name || "Unnamed area")}</strong><span>${escapeHtml(layerType)}</span></div>`);
  };
}

// --- Search -------------------------------------------------------------

async function handleSearch(query) {
  setSearching();
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

    if (lookup.county || lookup.town || lookup.city || lookup.village) {
      setResult(lookup, matchedAddress);
    } else {
      setWarning(`Outside supported boundary. Try a more specific address in the Albany region.`);
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

// FIX 5: Custom circle marker — high contrast red with white ring so it
// stands out clearly against the blue town boundary lines.
function showSearchMarker(lat, lon, matchedAddress) {
  if (searchMarker) map.removeLayer(searchMarker);
  searchMarker = L.circleMarker([lat, lon], {
    radius: 8,
    color: "#fff",
    weight: 2.5,
    fillColor: "#dc2626",
    fillOpacity: 1
  }).addTo(map);
  searchMarker.bindPopup(`<strong>Searched address</strong><br>${escapeHtml(matchedAddress)}`).openPopup();
  map.setView([lat, lon], 14);
}

// --- Lookup -------------------------------------------------------------

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

// --- Result display -----------------------------------------------------

// FIX 3: Structured result panel. Instead of a single run-on sentence,
// the result now sets distinct data attributes that index.html renders as
// a primary jurisdiction line and a secondary address line. A plain-text
// copy string is stored in data-copy-text for the copy button.

function setResult(lookup, matchedAddress) {
  resultPanel.classList.remove("warning");
  copyButton.style.display = "none";

  if (!lookup) {
    resultText.innerHTML = "Search for an address to identify the municipality and county.";
    resultText.dataset.copyText = "";
    return;
  }

  const countyName  = lookup.county  ? cleanCountyName(getDisplayName(lookup.county.properties))    : null;
  const townName    = lookup.town    ? cleanMunicipalName(getDisplayName(lookup.town.properties))    : null;
  const cityName    = lookup.city    ? cleanMunicipalName(getDisplayName(lookup.city.properties))    : null;
  const villageName = lookup.village ? cleanMunicipalName(getDisplayName(lookup.village.properties)) : null;

  const parts = [];
  if (villageName) parts.push(`Village of ${villageName}`);
  if (townName)    parts.push(`Town of ${townName}`);
  if (cityName)    parts.push(`City of ${cityName}`);
  if (countyName)  parts.push(`${countyName} County`);

  const primaryLine = parts.join(", ");
  const copyText    = `${primaryLine} — ${matchedAddress}`;

  resultText.innerHTML =
    `<span class="result-primary">${escapeHtml(primaryLine)}</span>` +
    `<span class="result-address">${escapeHtml(matchedAddress)}</span>`;
  resultText.dataset.copyText = copyText;

  copyButton.innerHTML = '<i class="ti ti-copy" aria-hidden="true"></i> Copy';
  copyButton.style.display = "inline-flex";
}

function setSearching() {
  resultPanel.classList.remove("warning");
  resultText.innerHTML = "Searching…";
  resultText.dataset.copyText = "";
  copyButton.style.display = "none";
}

function setWarning(message) {
  resultPanel.classList.add("warning");
  resultText.innerHTML = escapeHtml(message);
  resultText.dataset.copyText = "";
  copyButton.style.display = "none";
}

// --- Helpers ------------------------------------------------------------

function getDisplayName(props) {
  if (!props) return "";
  return props.NAMELSAD || props.NAME || props.name || props.Name || props.MUNI_NAME || props.MUNICIPALITY || props.COUNTY || "";
}

function cleanCountyName(name)    { return String(name || "").replace(/\s+County$/i, "").trim(); }
function cleanMunicipalName(name) { return String(name || "").replace(/\s+(town|city|village|CDP|county subdivision|borough)$/i, "").trim(); }

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&",  "&amp;")
    .replaceAll("<",  "&lt;")
    .replaceAll(">",  "&gt;")
    .replaceAll('"',  "&quot;")
    .replaceAll("'",  "&#039;");
}
