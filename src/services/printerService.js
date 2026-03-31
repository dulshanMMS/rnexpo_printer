import { Platform, PermissionsAndroid, NativeEventEmitter, NativeModules } from 'react-native';
import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system';

import { PIXEL_WIDTH } from '../utils/receiptRenderer';

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

/** Renders HTML to a PDF via Expo Print and sends the file URI to native code (avoids huge base64 on the JS bridge). */
export async function printHtmlToRongta(html, printer, options = {}) {
    const requestedWidth = Number.isFinite(printer?.limitWidthDots) ? printer.limitWidthDots : PIXEL_WIDTH;
    const pageWidthPx = Math.max(320, Math.min(880, requestedWidth + 16));
    const estimatedHeight = Number.isFinite(options.estimatedHeight)
        ? options.estimatedHeight
        : Math.max(900, Math.min(3200, 900 + (options.nodeCount || 0) * 24));
    const printFile = await Print.printToFileAsync({
        html,
        width: pageWidthPx,
        height: estimatedHeight,
        textZoom: 100
    });
    await printImage(printFile.uri, printer);
}

/** @param {string} base64OrFileUri PDF or image as base64/data-URL, or a file:// / content:// URI to the PDF bytes */
export async function printImage(base64OrFileUri, printer) {
    const module = getRongtaModule();
    if (!module || typeof module.printImage !== 'function') {
        throw new Error('Rongta print not available.');
    }

    if (!printer) {
        throw new Error('No printer selected.');
    }

    await module.printImage(base64OrFileUri, printer);
}

export async function printTextToRongta(textPayload, printer) {
    const module = getRongtaModule();
    if (!module || typeof module.printText !== 'function') {
        throw new Error('Rongta text print not available.');
    }
    if (!printer) {
        throw new Error('No printer selected.');
    }
    // Many thermal printers expect CRLF line endings.
    const normalized = String(textPayload ?? '').replace(/\n/g, '\r\n');
    await module.printText(normalized, printer);
}

export async function fallbackPrint(html) {
    await Print.printAsync({ html });
}
