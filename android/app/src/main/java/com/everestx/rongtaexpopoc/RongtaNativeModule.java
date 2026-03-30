package com.everestx.rongtaexpopoc;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import com.rt.printerlibrary.bean.BluetoothEdrConfigBean;
import com.rt.printerlibrary.cmd.Cmd;
import com.rt.printerlibrary.cmd.EscFactory;
import com.rt.printerlibrary.connect.PrinterInterface;
import com.rt.printerlibrary.factory.connect.BluetoothFactory;
import com.rt.printerlibrary.factory.connect.PIFactory;
import com.rt.printerlibrary.factory.printer.PrinterFactory;
import com.rt.printerlibrary.factory.printer.ThermalPrinterFactory;
import com.rt.printerlibrary.printer.RTPrinter;
import com.rt.printerlibrary.setting.BitmapSetting;

import java.nio.charset.StandardCharsets;
import java.util.Set;

public class RongtaNativeModule extends ReactContextBaseJavaModule {
    private final ReactApplicationContext reactContext;
    private final PrinterFactory printerFactory = new ThermalPrinterFactory();
    private final PIFactory bluetoothFactory = new BluetoothFactory();
    private RTPrinter rtPrinter;
    private String connectedAddress;

    RongtaNativeModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
        this.rtPrinter = printerFactory.create();
    }

    @Override
    public String getName() {
        return "RongtaNativeModule";
    }

    @ReactMethod
    public void addListener(String eventName) {
        // Required by RN event emitter contract.
    }

    @ReactMethod
    public void removeListeners(double count) {
        // Required by RN event emitter contract.
    }

    @ReactMethod
    public void disconnect(Promise promise) {
        try {
            if (rtPrinter != null) {
                rtPrinter.disConnect();
            }
            connectedAddress = null;
            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("RONGTA_DISCONNECT_FAILED", e);
        }
    }

    @SuppressLint("MissingPermission")
    @ReactMethod
    public void findPrinters(String type, Promise promise) {
        if (!"Bluetooth".equalsIgnoreCase(type)) {
            promise.reject("RONGTA_UNSUPPORTED_TYPE", "Only Bluetooth discovery is supported.");
            return;
        }

        try {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null) {
                promise.reject("RONGTA_NO_BLUETOOTH", "Bluetooth adapter not available.");
                return;
            }

            Set<BluetoothDevice> bonded = adapter.getBondedDevices();
            WritableArray array = Arguments.createArray();

            if (bonded != null) {
                for (BluetoothDevice device : bonded) {
                    WritableMap item = Arguments.createMap();
                    item.putString("name", device.getName() == null ? "Unknown Printer" : device.getName());
                    item.putString("address", device.getAddress());
                    item.putString("mac", device.getAddress());
                    item.putString("connectionType", "Bluetooth");
                    array.pushMap(item);
                }
            }

            WritableMap payload = Arguments.createMap();
            payload.putArray("printers", array);
            emitEvent("onPrintersFound", payload);

            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("RONGTA_DISCOVERY_FAILED", e);
        }
    }

    @SuppressLint("MissingPermission")
    @ReactMethod
    public void printImage(final String base64Payload, final ReadableMap printer, final Promise promise) {
        new Thread(() -> {
            try {
                String address = null;
                if (printer.hasKey("address") && !printer.isNull("address")) {
                    address = printer.getString("address");
                } else if (printer.hasKey("mac") && !printer.isNull("mac")) {
                    address = printer.getString("mac");
                }

                if (address == null || address.trim().isEmpty()) {
                    throw new IllegalArgumentException("Printer address is required.");
                }

                connectIfNeeded(address);

                String cleanBase64 = base64Payload.contains(",")
                        ? base64Payload.substring(base64Payload.indexOf(',') + 1)
                        : base64Payload;

                byte[] imageBytes = Base64.decode(cleanBase64, Base64.DEFAULT);
                Bitmap bitmap = BitmapFactory.decodeByteArray(imageBytes, 0, imageBytes.length);
                if (bitmap == null) {
                    throw new IllegalStateException("Failed to decode receipt image.");
                }

                Cmd cmd = new EscFactory().create();
                BitmapSetting bitmapSetting = new BitmapSetting();
                bitmapSetting.setBimtapLimitWidth(384);

                cmd.append(cmd.getBitmapCmd(bitmapSetting, bitmap));
                cmd.append("\n\n".getBytes(StandardCharsets.UTF_8));
                cmd.append(cmd.getAllCutCmd());

                rtPrinter.writeMsgAsync(cmd.getAppendCmds());

                WritableMap payload = Arguments.createMap();
                payload.putBoolean("success", true);
                payload.putString("address", address);
                emitEvent("onPrintImage", payload);
                promise.resolve(true);
            } catch (Exception e) {
                WritableMap payload = Arguments.createMap();
                payload.putBoolean("success", false);
                payload.putString("error", e.getMessage());
                emitEvent("onPrintImage", payload);
                promise.reject("RONGTA_PRINT_FAILED", e);
            }
        }).start();
    }

    @SuppressLint("MissingPermission")
    private synchronized void connectIfNeeded(String address) throws Exception {
        if (address.equalsIgnoreCase(connectedAddress)) {
            return;
        }

        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) {
            throw new IllegalStateException("Bluetooth adapter not available.");
        }

        Set<BluetoothDevice> bonded = adapter.getBondedDevices();
        if (bonded == null) {
            throw new IllegalStateException("No paired Bluetooth devices found.");
        }

        BluetoothDevice target = null;
        for (BluetoothDevice device : bonded) {
            if (address.equalsIgnoreCase(device.getAddress())) {
                target = device;
                break;
            }
        }

        if (target == null) {
            throw new IllegalStateException("Selected printer is not paired: " + address);
        }

        BluetoothEdrConfigBean config = new BluetoothEdrConfigBean(target);
        PrinterInterface printerInterface = bluetoothFactory.create();
        printerInterface.setConfigObject(config);

        rtPrinter.setPrinterInterface(printerInterface);
        rtPrinter.connect(config);
        connectedAddress = address;
    }

    private void emitEvent(String name, Object payload) {
        reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                .emit(name, payload);
    }
}
