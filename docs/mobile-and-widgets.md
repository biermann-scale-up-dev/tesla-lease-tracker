# Mobile app, offline data and widgets

## Install and navigate

Open your installation over HTTPS. On iPhone, use Safari's **Share → Add to Home Screen** flow. Browsers supporting an install prompt also expose an installation button in **Einstellungen**. The installed app uses the same private owner login as the browser. Browser and installed-app storage may be separate; log in once on each surface you use.

The four sections are **Übersicht**, **Fahrten**, **Auswertungen** and **Einstellungen**. Links such as `/#trips` and `/#analytics` can be bookmarked; browser back/forward preserves navigation. Mobile trip cards expand to show start/end times, readings and missing-data explanations. Forecasts retain the same four independently calculated bases on all screen sizes.

Appearance defaults to the device's system preference. **Einstellungen → Darstellung** can select light or dark explicitly. That preference is local to the browser or installed app. The overview's selected forecast is also local; its default is `window-1`, the second configured window (initially 30 days).

## Offline data and app updates

After a successful authenticated load, IndexedDB stores a separate display snapshot: lease display dates/allowance/timezone, budgets, four forecasts, aggregate history, aggregate trip counts and the latest 20 trip entries. It excludes the handover configuration, VIN, Tesla credentials, owner password and device keys. The service worker caches only public application files; all API responses remain `Cache-Control: no-store`.

Offline views show the saved timestamp, frozen calculation timestamp and last vehicle reading separately. Forecasts are not recomputed against today's date using stale inputs. A transport or server failure can display the previous snapshot; rejected authentication cannot. Contract edits, forecast-window changes and pairing require a connection and are never queued.

A snapshot expires with its owner session, at most seven days after login. Logout immediately blocks local access, clears the snapshot and revokes the server session when reachable. An offline logout persists a local marker so closing/reopening cannot restore access; the next connected opening completes server logout. Clearing site data removes the local snapshot too. Browser storage eviction can make offline data unavailable; reconnect to populate it again.

The installed shell keeps HTML and assets on one build revision. Updates are offered explicitly, and the update button is disabled while a contract, forecast or pairing form has unsaved changes. Accepting an update activates the waiting worker and reloads the app. Service workers are enabled for production builds, including the locally built demo, not the Vite development server.

## iPhone with Scriptable

1. Install [Scriptable](https://scriptable.app/) on the iPhone.
2. In the tracker, open **Einstellungen → Widgets und gekoppelte Geräte**. Download `lease-tracker.scriptable.js` and import it into Scriptable.
3. Enter a device name, choose its forecast basis and create an iPhone code. Codes expire after ten minutes and can be used once.
4. Run the script in Scriptable. Enter the installation's HTTPS origin and the twelve-character code. The permanent reader credential is stored in [Scriptable Keychain](https://docs.scriptable.app/keychain/), not inside the script or widget parameters.
5. Add a small or medium Scriptable Home Screen widget, or a rectangular Lock Screen widget, and select the imported script. Each size uses the same connection. The Lock Screen widget exposes remaining mileage and allowance status on the lock screen.

Small: remaining mileage, allowance deviation and last data time. Medium: additionally the selected end-of-contract forecast and last completed/closed trip. Rectangular Lock Screen: a compact budget/status/time view. Scriptable follows system light/dark appearance; Lock Screen tint and wallpaper determine its final appearance.

Tapping a widget opens the tracker URL. iOS determines whether that opens in the browser or installed app. The script requests another update no earlier than 30 minutes, but **iOS controls the actual update schedule**; it cannot guarantee an update immediately after every drive. See [Scriptable's widget API](https://docs.scriptable.app/listwidget/).

On a connection failure the widget shows its last successful local summary with a stale-data notice. A confirmed 401 removes both its saved summary and key and asks for pairing again. Running the script manually offers a preview, reconnection or local removal. Local removal does not revoke the server credential; use the tracker device list to revoke it as well.

## Tesla browser

While parked, open `https://YOUR_APP_HOST/tesla` and bookmark it. Choose **Mit Smartphone koppeln**, scan the QR code and log in to the tracker on your phone. Confirm the code shown in the car using **Tesla-Zugriff bestätigen**. Approval alone cannot issue a credential to another browser: claiming also requires the secret retained by the requesting Tesla page. Reloading during an unfinished pairing requires a new code.

After pairing, the browser receives a separate HttpOnly reader cookie. Its page contains only allowance, deviation, the chosen forecast, last closed trip, data quality and timestamps. It refreshes every 60 seconds while visible, when brought back to the foreground and on manual refresh. It never wakes or polls the vehicle. Existing values remain visibly stale during an outage; confirmed revocation clears them.

Browser availability and rendering depend on the vehicle's software and market. This is a web page for a parked quick glance, not a Tesla system widget. Clearing vehicle browser cookies requires pairing again. The reader cookie is renewed on successful use with a one-year lifetime; the underlying credential remains valid until revoked.

## Manage access and upgrade

The owner can change each device's forecast basis and revoke individual devices in **Einstellungen**. The device list includes the name, kind and last successful access time. A missing forecast shows its specific reason rather than substituting another basis. Window IDs refer to the three configurable slots, so editing a slot's length also updates devices using that slot.

Migration 3 adds hashed reader credentials and expiring pairing records without modifying existing lease, telemetry, owner-session or OAuth data. Back up the SQLite database before upgrading using the existing [operations guide](operations.md). Restore the database together with the matching encryption key if rolling back; do not remove migration records by hand.

No app password or Tesla token is sent to Scriptable or the vehicle browser. Reader credentials authorize only `GET /api/widget-summary`; they cannot access the owner dashboard, contract, device administration or Tesla control endpoints. The snapshot is computed from existing SQLite data and causes no additional Tesla API calls.
