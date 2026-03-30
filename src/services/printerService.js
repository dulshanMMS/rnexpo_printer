import { Platform, PermissionsAndroid, NativeEventEmitter, NativeModules } from 'react-native';
import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system';

let sdkModule = null;

try {
    sdkModule = require('expo-printers-sdk');
} catch (error) {
    sdkModule = null;
}

const RongtaPrinters = sdkModule?.RongtaPrinters || sdkModule?.default || null;
const RongtaNativeModule = NativeModules?.RongtaNativeModule || null;

function getRongtaModule() {
    if (RongtaNativeModule) {
        return RongtaNativeModule;
    }

    return RongtaPrinters;
}

export async function requestBluetoothPermissions() {
    if (Platform.OS !== 'android') {
        return true;
    }

    const android12Plus = Platform.Version >= 31;
    const permissions = android12Plus
        ? [
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
            PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
        ]
        : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];

    const result = await PermissionsAndroid.requestMultiple(permissions);
    return permissions.every((permission) => result[permission] === PermissionsAndroid.RESULTS.GRANTED);
}

export function isRongtaAvailable() {
    const module = getRongtaModule();
    return Boolean(module);
}

export function addRongtaListeners({ onPrintersFound, onPrintImage }) {
    const subscriptions = [];

    if (RongtaNativeModule) {
        const emitter = new NativeEventEmitter(RongtaNativeModule);

        if (onPrintersFound) {
            subscriptions.push(emitter.addListener('onPrintersFound', onPrintersFound));
        }

        if (onPrintImage) {
            subscriptions.push(emitter.addListener('onPrintImage', onPrintImage));
        }

        return () => {
            subscriptions.forEach((sub) => {
                if (sub?.remove) {
                    sub.remove();
                }
            });
        };
    }

    if (!RongtaPrinters || typeof RongtaPrinters.addListener !== 'function') {
        return () => { };
    }

    if (onPrintersFound) {
        subscriptions.push(RongtaPrinters.addListener('onPrintersFound', onPrintersFound));
    }

    if (onPrintImage) {
        subscriptions.push(RongtaPrinters.addListener('onPrintImage', onPrintImage));
    }

    return () => {
        subscriptions.forEach((sub) => {
            if (sub?.remove) {
                sub.remove();
            }
        });
    };
}

export async function findBluetoothPrinters() {
    const module = getRongtaModule();
    if (!module || typeof module.findPrinters !== 'function') {
        throw new Error('Rongta SDK not available in this build. Use Expo development build with native module.');
    }

    await module.findPrinters('Bluetooth');
}

export async function htmlToBase64(html) {
    const printFile = await Print.printToFileAsync({
        html,
        base64: true
    });

    if (printFile.base64) {
        return printFile.base64;
    }

    return FileSystem.readAsStringAsync(printFile.uri, {
        encoding: FileSystem.EncodingType.Base64
    });
}

export async function printImage(base64Payload, printer) {
    const module = getRongtaModule();
    if (!module || typeof module.printImage !== 'function') {
        throw new Error('Rongta print not available.');
    }

    if (!printer) {
        throw new Error('No printer selected.');
    }

    await module.printImage(base64Payload, printer);
}

export async function fallbackPrint(html) {
    await Print.printAsync({ html });
}
