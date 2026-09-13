# Tesla onboarding

## Prerequisites

- Model 3/Y with Fleet Telemetry >= 1.3.0, introduced in vehicle firmware 2026.26.6. Use `fleet_status` as the capability check; a software version label alone is not acceptance.
- An approved Tesla Developer application for this installation, with Authorization Code and Client Credentials grants, and your own Tesla account.
- Public app HTTPS and an externally reachable telemetry mTLS endpoint. Configure the VPS as described in [operations](operations.md).

Follow the current [Tesla application setup](https://developer.tesla.com/), [authentication](https://developer.tesla.com/docs/fleet-api/authentication/third-party-tokens), and [telemetry documentation](https://developer.tesla.com/docs/fleet-api/fleet-telemetry). Provider requirements can change independently of this release.

## 1. Prepare the server and Developer application

Set `APP_ORIGIN=https://lease.your-domain.example`, the corresponding `APP_DOMAIN`, and a DNS `TELEMETRY_HOST`. Use exact values, not example domains. Register the app origin with Tesla and set the OAuth redirect URI to:

```text
https://lease.your-domain.example/api/tesla/callback
```

Enable the `openid`, `offline_access`, and `vehicle_device_data` scopes. This app requests only those scopes. It does not request location, charging or remote-control scopes. Set `TESLA_CLIENT_ID`, `TESLA_CLIENT_SECRET`, and `TESLA_REGION` (`eu` or `na`) in the private `.env`. Never enter a Tesla account password into this application.

The command public key must be reachable at:

```text
https://lease.your-domain.example/.well-known/appspecific/com.tesla.3p.public-key.pem
```

Generate it using the provided certificate tool, and keep it available for the lifetime of the integration. The command authentication private key is different from the proxy TLS private key. The telemetry CA is your installation's dedicated CA; its public certificate is embedded in the signed telemetry configuration. Do not replace it during routine leaf-certificate renewal.

## 2. Register, authorize, select and pair

In **Vertrag & Verbindung**:

1. Click **Domain registrieren**. The backend obtains a partner token and registers the app domain with the configured Tesla region.
2. Click **Mit Tesla anmelden**. Complete Tesla's consent flow. The callback requires the original app session and a fresh, single-use state.
3. Load vehicles and select the intended Model 3/Y. A populated installation cannot be switched to a different vehicle.
4. Click **Schlüssel hinzufügen** on your phone. Select the correct car in the Tesla app and accept the key pairing. The phone must be able to complete Tesla's pairing flow with the car.
5. Click **Status prüfen**. Resolve unsupported firmware, missing key, authorization or configuration-limit errors before continuing.
6. Click **Erfassung konfigurieren**. The backend uses the official TLS command proxy to sign the configuration. Check again after the car next connects until the UI reports **Synchronisiert**.

The configured field selection is intentionally small:

```json
{
  "delivery_policy": "latest",
  "fields": {
    "Gear": { "interval_seconds": 1, "include_fields": ["Odometer"] }
  }
}
```

The actual configuration additionally contains the telemetry hostname, port and public CA. There are no `vehicle_data` polling loops, wake commands or location signals. Included odometers arrive on gear events. Boundary accuracy and brief transitions must still be verified on the physical vehicle.

## 3. Billing

Tesla currently documents a $10 monthly discount on pay-per-use usage. It is not a permanent promise of a free service and is not multiplied per installation or vehicle on a shared developer account. The portal may require a payment method. Verify the portal's **zero additional-spend billing limit**, available discount and actual usage for your account before configuring telemetry; the app never increases a limit.

At the published rate of 150,000 streaming signals per dollar, a hypothetical 1,000 delivered signals would cost roughly $0.0067 before the discount. Startup/reconnection signals, retries and API setup requests add usage. The app's received-event count cannot replace Tesla's invoice or account-wide usage report. Check the [current prices](https://developer.tesla.com/) and [billing rules](https://developer.tesla.com/docs/fleet-api/billing-and-limits).

If Tesla suspends an application for its billing limit, telemetry configuration can be removed and is not automatically restored by Tesla. Resolve the portal state and explicitly configure telemetry again. Never raise the limit automatically to keep collection running.

## Troubleshooting and disconnect

Normal vehicle sleep produces silence/disconnection. That alone is not a server failure or trip ending. A disconnected/failed broker, authorization error, unsupported firmware, mismatched configuration or rejected record is a separate condition shown by the app.

Use `docker compose logs app telemetry command-proxy` for technical errors, without enabling verbose request/token logging. Verify the public key URL, DNS, open telemetry port, certificate validity, CA and `fleet_telemetry_config` synchronization. The app does not wake the car to resolve an issue.

**Tesla-Verbindung trennen** removes the application's telemetry configuration before deleting its local tokens. If authorization has already been revoked, remove the integration in Tesla's consent/key management and resolve the error before treating the connection as stopped. Existing mileage history remains private in SQLite.
