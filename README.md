# Albany Region Municipal Boundary Lookup

A lightweight, static municipal-boundary lookup tool for newsroom reference.

## Files

```text
index.html
css/styles.css
js/app.js
data/counties.geojson
data/county_subdivisions.geojson
data/places.geojson
```

The included GeoJSON files are empty placeholders. Replace them with the actual boundary files, keeping the same filenames unless you update `DATA_URLS` in `js/app.js`.

## GitHub Pages testing

Publish from the repository root so `index.html` is at the top level.

## Troubleshooting

### Map tiles look broken, scattered or misaligned

That usually means Leaflet CSS did not load. This version uses jsDelivr for Leaflet CSS and JS instead of the earlier CDN setup.

### Boundary data warning appears

Confirm these paths and filenames exactly:

```text
data/counties.geojson
data/county_subdivisions.geojson
data/places.geojson
```

GitHub Pages paths are case-sensitive.

## Disclaimer

Boundary data from U.S. Census Bureau TIGER/Line files. This tool is for newsroom reference only and should not be used as a legal boundary determination.
