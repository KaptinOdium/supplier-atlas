# Supplier Atlas

Supplier Atlas screens the entire shared supplier list when an invited member opens the workspace or selects **Scan all suppliers**. Register filters affect only the supplier table. Findings list the matched supplier, site, reason, review date and source references.

Atlas checks Global Incident Tracker and GDACS for public reports and compares them with the supplier list in the browser. Owners also scan the saved project register. A member can include a reviewed JSON register in the current tab. Each scan shows which sources returned evidence, when saved records were reviewed and which feeds were unavailable. Public alerts near a supplier appear in yellow for review. A red signal requires recent evidence of an active operational disruption at the named site.

Under **Manage supplier list**, owners and editors can import a CSV or TSV file, paste an Excel table, and save changes to the shared list. The required columns are Name, DUNS, Country and City. Optional Latitude and Longitude columns accept coordinates. DUNS values stay as text. If an owner previously saved a list in this browser, **Export previous browser list** downloads that separate list as a CSV.

The map uses supplier coordinates or approximate city locations from the bundled GeoNames gazetteer. Members can inspect geographic precision and evidence for each flagged site. An optional online location lookup sends the selected city and country to Nominatim.

## GitHub Pages

The application requires an active Atlas account to load supplier records. The repository contains the browser application and public geographic data.

GitHub Pages serves the `docs/` folder on `main`. [Open Supplier Atlas](https://kaptinodium.github.io/supplier-atlas/) and sign in with your Atlas account.

To open Atlas locally, run `python -m http.server 8000 --bind 127.0.0.1 --directory docs` from the repository root and open [Supplier Atlas on this computer](http://127.0.0.1:8000/). Sign in with your existing Atlas account.

Run `node --test "tests/*.test.mjs"` from the repository root. Geographic data, map software and screening sources are documented in the [attributions](docs/ATTRIBUTION.md).
