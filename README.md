# Supplier Atlas

Supplier Atlas screens the entire shared supplier list when an invited member opens the workspace or selects **Scan all suppliers**. The map and supplier table initially show suppliers with yellow or red signals. Clear **Yellow or red only** to see the full list. Changing the view preserves the scope of the next scan.

Atlas checks Global Incident Tracker, GDACS and recent industry reports. Industry reports cover production incidents, labor action, logistics disruption, operational cyber incidents, product quality and recalls, and financial distress. The public feed refreshes three times daily. The **Industry reports** section lets members browse by risk type, including reports without a supplier match.

Atlas compares public evidence with the shared supplier list in the browser. Owners also scan the saved project register. A member can include a reviewed JSON register in the current tab. Each scan shows which sources returned evidence, when saved records were reviewed and which feeds were unavailable. A yellow signal marks a site for review. A red signal requires recent evidence of an active operational disruption at the named site.

Under **Manage supplier list**, owners and editors can import a CSV or TSV file, paste an Excel table, and save changes to the shared list. The required columns are Name, DUNS, Country and City. Optional Latitude and Longitude columns accept coordinates. DUNS values stay as text. If an owner previously saved a list in this browser, **Export previous browser list** downloads that separate list as a CSV.

The map uses supplier coordinates or approximate city locations from the bundled GeoNames gazetteer. Members can inspect geographic precision and evidence for each flagged site. An optional online location lookup sends the selected city and country to Nominatim.

## GitHub Pages

The application requires an active Atlas account to load supplier records. The repository contains the browser application, public geographic data and public industry report metadata.

GitHub Pages serves the `docs/` folder on `main`. [Open Supplier Atlas](https://kaptinodium.github.io/supplier-atlas/) and sign in with your Atlas account.

To open Atlas locally, run `python -m http.server 8000 --bind 127.0.0.1 --directory docs` from the repository root and open [Supplier Atlas on this computer](http://127.0.0.1:8000/). Sign in with your existing Atlas account.

Run `node --test "tests/*.test.mjs"` from the repository root. Geographic data, map software and screening sources are documented in the [attributions](docs/ATTRIBUTION.md).
