# Summit retail workspace

An independent Alpine-inspired local development application. It implements task groups, multi-product monitor lists, grouped profiles, scheduled starts, activity logs, in-app notifications, and stock-to-cart handoff. It is **not Alpine**, has no commercial bot feature-parity claim, and does not automatically place orders.

## Run

Node.js 22 or newer is required. There are no third-party runtime dependencies.

```sh
cd /workspace/test
npm test
npm start
```

The server listens on loopback port 3000. Use `PORT` to choose another port. Check readiness with `curl -fsS http://127.0.0.1:3000/api/health`. The cloud onboarding UI does not expose a localhost preview; browser access requires a development environment with local access or its supported port forwarding.

## Try the working demo

1. Open Task groups and select Weekend rotation.
2. Add tasks, select the Everyday profile group, and create the tasks.
3. Start the group. Tasks check the two simulated products.
4. Open Monitor list and select Simulate restock. Tasks move to Demo stock and generate notifications. These are simulated availability results, not successful orders.
5. Open task details, pause the group, or inspect the Activity page.

Create additional profiles, organize them into groups, create task groups with up to ten product handles, and set a future scheduled start. Scheduling uses the browser’s local time and persists as UTC. Select tasks to delete them together. Use Settings to control notifications and export a configuration without emails or address notes.

## Live-store integration status

Kith, Bodega, and Undefeated appear among Alpine’s publicly advertised retailers. Summit has public product endpoint adapters configured for those domains; **these have not been validated against a live product in this cloud environment**. Availability and access depend on the store. The store picker explicitly labels these adapters as unverified.

For a selected live store, provide its HTTPS `/products/product-handle` URL or handle. The monitor requests `/products/product-handle.js`, checks available variants and exact preferred size options, and generates a `/cart/variant:quantity` link for a match. You open the link and complete checkout yourself. No order, payment, login, CAPTCHA solving, or proxy routing is automated. Non-200 responses, challenges, redirects, unsupported schemas, and request timeouts appear as task errors. Requests are not retried faster than the configured delay; the minimum delay is 30 seconds. The selected stores must be accessible through the environment’s network policy.

Multiple products are fetched once per group, rather than once per profile. Requests are sequential with bounded response sizes and timeouts. Hostnames and product handles are restricted to the configured store list. Duplicate task creation is prevented. New stock alerts are emitted on changes, rather than on every poll.

## Local data and security

Workspace data is persisted atomically under ignored `.local/workspace.json`, with restrictive permissions. `SUMMIT_DATA_FILE` can select a different file. Active monitors pause when the server restarts; review and start them again. No payment details, passwords, or proxy credentials should be entered. Profile emails and address notes are stored as local plaintext, are not submitted to stores, and are omitted from configuration exports.

This is a single-user loopback service, with no authentication. It validates Host and Origin headers and serves only explicitly listed static assets. Keep the default loopback binding. Add authentication and encrypted credential storage before any multi-user or remote deployment.

## Tests

`npm test` exercises shared product checks, exact-size stock matching, stock-transition notifications, polling intervals, scheduling, cancellation of stale results, store failures and recovery, persistent reload, and HTTP create/start/stop workflows. Browser smoke tests were also run during development; these do not require additional runtime packages.

## Features still requiring separate implementation

- Store-specific account authentication and secure session storage.
- Proxy pools and connection testing.
- Manual challenge session management.
- Supported automated checkout and payment integration.
- Discord notifications, licensing, signed desktop packaging and auto-update.
- Commercial support operations and release guides.

Alpine’s marketing page and screenshots establish visible features, not the details of its private checkout implementation. REA was researched but is not used or installed by this project; this application was written from scratch.
