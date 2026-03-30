# Rongta Expo PoC

Single-screen React Native Expo proof-of-concept for:
- Hardcoded GasTech invoice
- Payment entry (Cash/Cheque/Credit)
- Bluetooth printer scan + selection via Rongta SDK
- Thermal receipt print attempt via Rongta
- Fallback to system print dialog (expo-print)

## Implemented Files

- App entry and screen wiring: `App.js`
- Single-screen UI and business flow: `src/screens/InvoicePrintScreen.js`
- Receipt HTML renderer (58mm): `src/utils/receiptRenderer.js`
- Rongta SDK + permissions + fallback wrapper: `src/services/printerService.js`
- Theme colors provider: `src/theme/ThemeContext.js`
- Sri Lanka banks constants: `src/constants/banks.js`
- Android permissions and dev-client plugin: `app.json`

## Step-by-Step Run (Developer Build)

1. Install dependencies

```bash
cd rongta-expo-poc
npm install
```

2. Build native Android dev client

```bash
npm run android
```

3. Start Metro for dev client

```bash
npm run start:dev
```

4. On first launch in the app
- Tap Scan Bluetooth Printers
- Grant Bluetooth permissions
- Select a discovered printer
- Enter payment values
- Tap Print Receipt

5. Fallback behavior
- If Rongta print fails or native module is unavailable, the app opens system print dialog using `expo-print`.

## Notes for Bluetooth Testing

- Expo Go is not enough for native Bluetooth modules.
- Use Expo Developer Build (`expo run:android`) for Rongta SDK integration.
- Emulator Bluetooth is unreliable. Real device is strongly recommended for actual Rongta tests.
- For Windows desktop-only iteration, you can still run the app and validate UI and fallback print flow.

## Troubleshooting

- Printer not discovered: ensure printer is powered on and paired in Android settings.
- Permission denied: open Android App Settings and allow Bluetooth + Location.
- Rongta unavailable: ensure `expo-printers-sdk` native module is linked in the dev build.
- Wrong print formatting: adjust paper constants in `src/utils/receiptRenderer.js`.
