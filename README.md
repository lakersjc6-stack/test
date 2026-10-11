# Summit Pokémon Desktop

A Windows desktop app focused on Pokémon TCG release preparation, stock monitoring, and notifications. Open it from a desktop shortcut or its executable; no browser dashboard or Node.js installation is needed for the packaged app. Retailer product links intentionally open your normal browser session so you can complete checkout yourself.

## Download for Windows

1. Open this repository’s **Actions** tab.
2. Select the latest successful **Build Windows desktop** run for `main`.
3. Under **Artifacts**, download **Summit-Pokemon-Windows** (GitHub sign-in is required).
4. Extract the artifact ZIP. Run `Summit-Pokemon-0.2.0-Setup.exe` to install, or extract the inner `Summit-Pokemon-0.2.0-win.zip` and run `Summit Pokemon.exe` for a portable app.

The workflow produces an installer, a portable ZIP, and `SHA256SUMS.txt`. Artifacts expire after 30 days; the workflow can be run again from Actions. The source ZIP under Code → Download ZIP is not the compiled app.

This is an unsigned development build. No code-signing certificate is configured. Windows may show an unknown-publisher prompt; inspect the source and the included SHA256 checksums before choosing whether to run it. The portable Windows archive was built in the cloud; Windows-native runtime and notification behavior still require validation on a Windows machine.

## What works

- Desktop window with an isolated renderer and no Node.js access from the interface.
- System tray: closing the window hides the app; monitors remain running. Use the tray’s Quit command to stop the app.
- Windows notifications for stock changes and release reminders; clicking one opens the app.
- Optional keep-awake protection while monitors are active. The app cannot monitor while the computer is off or manually asleep.
- Pokémon-focused drop groups, collector groups, and up to ten product links per group.
- Release planner with user-provided announced times, lead reminders, and one-click creation of a scheduled monitoring group. Start the prepared group to activate its schedule.
- Optional USD price ceilings. Unknown prices do not match a configured ceiling.
- Per-product health and bounded retries. One unreadable product does not hide readable stock from another. Three group workers keep a slow retailer from blocking all monitoring.
- Exponential backoff after errors, from the normal 30-second minimum up to 15 minutes. Successful reads restore the normal interval.
- Activity logs, local persistence, configuration export without profile emails or addresses, and a Pokémon demo catalog.

## Retailer support and limitations

Pokémon Center US, Target, and Walmart are the first retailers. Their adapters read explicit schema.org Product / Offer availability from public product pages, when supplied. **Live support is unverified:** this cloud environment cannot currently reach those retailer domains. These are product-page parsers, not verified official retailer API integrations.

The parser distinguishes available, preorder, sold out, and unknown. A verification page, blocked request, redirect, missing structured data, ambiguous product identity, or non-Pokémon item produces an error. It does not infer stock from an Add to cart button or a successful HTTP response. Product name, seller, price, regional inventory, quantity limits, and checkout availability must be checked at the retailer. Marketplace offers are not independently seller-verified.

Supported link shapes:

- Pokémon Center US: `https://www.pokemoncenter.com/product/<id>/<optional-slug>`
- Target: `https://www.target.com/p/<slug>/-/A-<number>`
- Walmart: `https://www.walmart.com/ip/<slug>/<number>`

Release times are entered by you based on confirmed retailer announcements. The app does not discover every upcoming product or promise to hit every drop. Monitoring only covers the product links you add. It does not bypass queues, solve CAPTCHA, store retailer passwords, or automatically submit orders or payments. Store-specific authenticated inventory and checkout flows are not implemented.

Legacy Kith/Bodega/Undefeated adapters are retained for existing saved groups but are omitted from the new-group store picker.

## Try the demo

1. Open Drop groups → Pokémon TCG demo.
2. Add tasks → Select Pokémon → Create tasks.
3. Start group, then open Monitor list → Simulate restock.
4. Verify Demo stock status, notifications, and product details.
5. Pause the group when finished. Demo results are simulated and never represent successful purchases.

## Release-day preparation

Add links for the exact Pokémon products you want. Use a reasonable price ceiling. Add confirmed release times in Release planner and prepare/start the scheduled monitoring group. Keep the app running and your network connected; inspect Monitor list for readable versus unknown products. Sign into your normal retailer sessions before the release. Follow an alert to the product page and complete checkout manually. Faster polling alone does not establish better coverage or checkout success.

## Develop from source

Node.js 24 and npm are recommended for dependency installation and packaging. On Windows:

```powershell
npm ci
npm test
npm start
```

`npm start` opens the desktop app. Build installer and portable packages with `npm run build:win`. Build only the portable ZIP with `npm run build:win:portable`. Linux can cross-build the ZIP; NSIS installer generation requires Wine or a Windows runner. The included GitHub Actions workflow builds on Windows.

For backend-only development, `npm run dev:server` runs the optional local server on port 3000. It is not the normal end-user entry point. `PORT` selects another backend development port. The desktop app chooses its own ephemeral loopback port and requires a random per-process session token on all HTTP requests.

## Data and startup

The desktop workspace is saved in the Electron user-data directory under your Windows account, normally `%APPDATA%/summit-pokemon-desktop/workspace.json`. Never enter payment credentials or passwords. Contact details are local plaintext and are not automatically submitted to retailers. The backend development workspace remains under ignored `.local/workspace.json`.

Monitors intentionally pause on app restart. Review and resume them explicitly. Release reminders operate while the app is running and are persisted to avoid repeating a sent reminder. Notifications may be affected by Windows notification settings / Do Not Disturb. No Discord integration is configured.

## Validation

`npm test` runs 18 tests covering stock transitions, exact matching, schedules, cancellation, persistence, HTTP workflows, product URL validation, unknown/challenge handling, price ceilings, partial product failures, retry backoff, reminders, and desktop session/link security.

A real Electron desktop smoke test was run on Linux under a virtual display. It exercises the Pokémon demo, release planning, scheduled groups, notification settings, the isolated renderer, and close-to-tray behavior. This does not establish Windows-native toast delivery or successful retail checkout. Live retailer access remains blocked and unverified.
