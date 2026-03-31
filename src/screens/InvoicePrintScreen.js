import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { SRI_LANKA_BANKS } from '../constants/banks';
import { buildReceiptHtml } from '../utils/receiptRenderer';
import {
    addRongtaListeners,
    fallbackPrint,
    findBluetoothPrinters,
    isRongtaAvailable,
    printTextToRongta,
    requestBluetoothPermissions
} from '../services/printerService';

const LAST_PRINTER_KEY = 'last_printer_address';
const VAT_RATE = 0.18;

function resolvePrinterWidthDots(printer) {
    const configured = Number(printer?.limitWidthDots);
    if (Number.isFinite(configured) && configured >= 200 && configured <= 880) {
        return configured;
    }
    const name = String(printer?.name || '').toLowerCase();
    return name.includes('58') ? 384 : 576;
}

function padRight(value, width) {
    const text = String(value ?? '');
    if (text.length >= width) {
        return text.slice(0, width);
    }
    return text + ' '.repeat(width - text.length);
}

function padLeft(value, width) {
    const text = String(value ?? '');
    if (text.length >= width) {
        return text.slice(-width);
    }
    return ' '.repeat(width - text.length) + text;
}

function twoCol(left, right, width) {
    const l = String(left ?? '');
    const r = String(right ?? '');
    if (l.length + r.length + 1 > width) {
        return `${l}\n${padLeft(r, width)}`;
    }
    return `${l}${' '.repeat(width - l.length - r.length)}${r}`;
}

function wrapText(text, width) {
    const source = String(text ?? '');
    if (!source) {
        return [''];
    }
    const out = [];
    let i = 0;
    while (i < source.length) {
        out.push(source.slice(i, i + width));
        i += width;
    }
    return out;
}

function buildReceiptPlainText(invoice, amounts, selectedBank, chequeNumber, columnsPerLine) {
    const width = columnsPerLine; // characters-per-line for this printer mode
    const line = '-'.repeat(width);
    const rows = [];
    rows.push(padRight('GasTech', width));
    rows.push(padRight('TAX INVOICE', width));
    rows.push(line);
    rows.push(twoCol(`Invoice:${invoice.invoiceNo}`, `Date:${invoice.date}`, width));
    rows.push(line);
    rows.push(`Customer: ${invoice.customer.name}`);
    rows.push(...wrapText(invoice.customer.address, width));
    rows.push(`Phone: ${invoice.customer.phone}`);
    rows.push(`TIN: ${invoice.customer.customerTin}`);
    rows.push(line);
    rows.push(`Supplier: ${invoice.store.name}`);
    rows.push(...wrapText(invoice.store.address, width));
    rows.push(`Phone: ${invoice.store.phone}`);
    rows.push(`TIN: ${invoice.store.supplierTin}`);
    rows.push(line);
    rows.push('No Description       Qty   Amount');
    invoice.items.forEach((item, idx) => {
        const idxTxt = padRight(idx + 1, 2);
        const name = padRight(item.name, 16);
        const qty = padLeft(item.qty, 3);
        const amt = padLeft(formatMoney(item.amount), 9);
        rows.push(`${idxTxt} ${name} ${qty} ${amt}`);
    });
    rows.push(line);
    rows.push(twoCol('Gross', formatMoney(invoice.gross), width));
    rows.push(twoCol('VAT (18%)', formatMoney(invoice.vat), width));
    rows.push(twoCol('Net Total', formatMoney(invoice.netTotal), width));
    rows.push(line);
    rows.push(twoCol('Cash', formatMoney(amounts.parsedCash), width));
    rows.push(twoCol('Cheque', formatMoney(amounts.parsedCheque), width));
    rows.push(twoCol('Credit', formatMoney(amounts.creditAmount), width));
    if (selectedBank) {
        rows.push(...wrapText(`Bank: ${selectedBank}`, width));
    }
    if (chequeNumber) {
        rows.push(...wrapText(`Cheque No: ${chequeNumber}`, width));
    }
    rows.push(line);
    rows.push('Thank you for your business');
    rows.push('');
    rows.push('');
    return rows.join('\n');
}

const INVOICE_DATA = {
    store: {
        name: 'GasTech',
        address: 'No. 125, Main Street, Colombo 10',
        phone: '+94 11 234 5678',
        supplierTin: '108765432'
    },
    customer: {
        name: 'Nimal Perera',
        address: 'No. 14, Lake Road, Kandy',
        phone: '+94 77 456 1234',
        customerTin: '204567891'
    },
    items: [
        { name: 'LPG Cylinder Refill 12.5kg', qty: 2, unitPrice: 5400 },
        { name: 'Gas Regulator', qty: 1, unitPrice: 2400 },
        { name: 'Safety Hose 1.5m', qty: 1, unitPrice: 1200 }
    ]
};

function formatMoney(value) {
    return Number(value || 0).toFixed(2);
}

function parseAmount(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function buildInvoice() {
    const now = new Date();
    const invoiceNo = `INV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
        now.getDate()
    ).padStart(2, '0')}-001`;
    const date = now.toISOString().slice(0, 10);

    const items = INVOICE_DATA.items.map((item) => ({
        ...item,
        amount: item.qty * item.unitPrice
    }));

    const gross = items.reduce((sum, item) => sum + item.amount, 0);
    const vat = gross * VAT_RATE;
    const netTotal = gross + vat;

    return {
        ...INVOICE_DATA,
        invoiceNo,
        date,
        items,
        gross,
        vat,
        netTotal
    };
}

function paymentModeLabel({ cashAmount, chequeAmount, creditAmount }) {
    const modes = [];
    if (cashAmount > 0) {
        modes.push('Cash');
    }
    if (chequeAmount > 0) {
        modes.push('Cheque');
    }
    if (creditAmount > 0) {
        modes.push('Credit');
    }

    if (modes.length === 0) {
        return 'Unpaid';
    }
    if (modes.length === 1) {
        return modes[0];
    }
    return 'Split';
}

function CheckboxRow({ label, checked, onPress, colors }) {
    return (
        <Pressable onPress={onPress} style={styles.checkboxRow}>
            <MaterialCommunityIcons
                name={checked ? 'checkbox-marked' : 'checkbox-blank-outline'}
                size={22}
                color={checked ? colors.accent : colors.textSecondary}
            />
            <Text style={[styles.checkboxLabel, { color: colors.textPrimary }]}>{label}</Text>
        </Pressable>
    );
}

export default function InvoicePrintScreen() {
    const { colors } = useTheme();
    const invoice = useMemo(() => buildInvoice(), []);

    const [selectedPrinter, setSelectedPrinter] = useState(null);
    const [discoveredPrinters, setDiscoveredPrinters] = useState([]);
    const [printing, setPrinting] = useState(false);
    const [printResult, setPrintResult] = useState('');
    const [printError, setPrintError] = useState('');
    const [resultVisible, setResultVisible] = useState(false);
    const printLockRef = useRef(false);

    const [cashEnabled, setCashEnabled] = useState(true);
    const [chequeEnabled, setChequeEnabled] = useState(false);
    const [creditEnabled, setCreditEnabled] = useState(true);

    const [cashAmount, setCashAmount] = useState('0');
    const [chequeAmount, setChequeAmount] = useState('0');
    const [selectedBank, setSelectedBank] = useState('');
    const [chequeNumber, setChequeNumber] = useState('');
    const [permissionError, setPermissionError] = useState('');

    useEffect(() => {
        let unsubscribe = () => { };

        async function setup() {
            const lastPrinterAddress = await AsyncStorage.getItem(LAST_PRINTER_KEY);

            unsubscribe = addRongtaListeners({
                onPrintersFound: (event) => {
                    const printers = Array.isArray(event) ? event : event?.printers || [];
                    setDiscoveredPrinters(printers);

                    if (lastPrinterAddress) {
                        const matched = printers.find(
                            (printer) => printer?.address === lastPrinterAddress || printer?.mac === lastPrinterAddress
                        );
                        if (matched) {
                            setSelectedPrinter({ ...matched, limitWidthDots: resolvePrinterWidthDots(matched) });
                        }
                    }
                },
                onPrintImage: (event) => {
                    if (event?.success) {
                        setPrintResult('Printed via Rongta Bluetooth successfully.');
                        setPrintError('');
                        setResultVisible(true);
                    }
                    if (event?.error) {
                        setPrintError(String(event.error));
                    }
                }
            });
        }

        setup();

        return () => {
            unsubscribe();
        };
    }, []);

    const amounts = useMemo(() => {
        const parsedCash = cashEnabled ? parseAmount(cashAmount) : 0;
        const parsedCheque = chequeEnabled ? parseAmount(chequeAmount) : 0;
        const computedCredit = Math.max(invoice.netTotal - parsedCash - parsedCheque, 0);
        const creditAmount = creditEnabled ? computedCredit : 0;
        const enteredTotal = parsedCash + parsedCheque + creditAmount;

        return {
            parsedCash,
            parsedCheque,
            creditAmount,
            enteredTotal
        };
    }, [cashEnabled, chequeEnabled, creditEnabled, cashAmount, chequeAmount, invoice.netTotal]);

    const validation = useMemo(() => {
        const issues = [];

        if (!cashEnabled && !chequeEnabled && !creditEnabled) {
            issues.push('Select at least one payment method.');
        }

        if (amounts.enteredTotal < invoice.netTotal) {
            issues.push('Total entered must be greater than or equal to invoice total.');
        }

        if (amounts.parsedCheque > 0) {
            if (!selectedBank) {
                issues.push('Bank is required for cheque payments.');
            }
            if (!chequeNumber.trim()) {
                issues.push('Cheque number is required for cheque payments.');
            }
        }

        if (!selectedPrinter) {
            issues.push('Please select a printer before printing.');
        }

        return {
            isValid: issues.length === 0,
            issues
        };
    }, [
        cashEnabled,
        chequeEnabled,
        creditEnabled,
        amounts.enteredTotal,
        amounts.parsedCheque,
        invoice.netTotal,
        selectedBank,
        chequeNumber,
        selectedPrinter
    ]);

    const handleScan = useCallback(async () => {
        setPermissionError('');

        try {
            const granted = await requestBluetoothPermissions();
            if (!granted) {
                setPermissionError('Bluetooth permission required. Check app settings.');
                return;
            }

            await findBluetoothPrinters();
        } catch (error) {
            setPrintError(
                error?.message || 'No Rongta printers discovered. Ensure printer is powered on and paired.'
            );
            setResultVisible(true);
        }
    }, []);

    const handlePrinterSelect = useCallback(async (printer) => {
        const limitWidthDots = resolvePrinterWidthDots(printer);
        setSelectedPrinter({ ...printer, limitWidthDots });
        const address = printer?.address || printer?.mac || '';
        if (address) {
            await AsyncStorage.setItem(LAST_PRINTER_KEY, address);
        }
    }, []);

    const receiptNodes = useMemo(() => {
        const rows = invoice.items.map((item, index) => [
            String(index + 1),
            item.name,
            String(item.qty),
            formatMoney(item.unitPrice),
            formatMoney(item.amount)
        ]);

        return [
            { type: 'text', value: 'GasTech', align: 'center', bold: true, size: 18, spacingBottom: 2 },
            { type: 'text', value: 'TAX INVOICE', align: 'center', bold: true, size: 14 },
            { type: 'line' },
            { type: 'columns', left: `Invoice: ${invoice.invoiceNo}`, right: `Date: ${invoice.date}` },
            { type: 'line' },
            { type: 'text', value: `Customer: ${invoice.customer.name}`, bold: true },
            { type: 'text', value: invoice.customer.address },
            { type: 'text', value: `Phone: ${invoice.customer.phone}` },
            { type: 'text', value: `Customer TIN: ${invoice.customer.customerTin}` },
            { type: 'line' },
            { type: 'text', value: `Supplier: ${invoice.store.name}`, bold: true },
            { type: 'text', value: invoice.store.address },
            { type: 'text', value: `Phone: ${invoice.store.phone}` },
            { type: 'text', value: `Supplier TIN: ${invoice.store.supplierTin}` },
            { type: 'line' },
            { type: 'table', headers: ['No', 'Description', 'Qty', 'Unit Price', 'Amount'], rows },
            { type: 'line' },
            { type: 'columns', left: 'Gross', right: formatMoney(invoice.gross) },
            { type: 'columns', left: 'VAT (18%)', right: formatMoney(invoice.vat) },
            { type: 'columns', left: 'Net Total', right: formatMoney(invoice.netTotal) },
            { type: 'line' },
            {
                type: 'text',
                value: `Mode of Payment: ${paymentModeLabel({
                    cashAmount: amounts.parsedCash,
                    chequeAmount: amounts.parsedCheque,
                    creditAmount: amounts.creditAmount
                })}`
            },
            { type: 'columns', left: 'Cash', right: formatMoney(amounts.parsedCash) },
            { type: 'columns', left: 'Cheque', right: formatMoney(amounts.parsedCheque) },
            { type: 'columns', left: 'Credit', right: formatMoney(amounts.creditAmount) },
            selectedBank ? { type: 'text', value: `Bank: ${selectedBank}` } : { type: 'feed', lines: 0 },
            chequeNumber ? { type: 'text', value: `Cheque No: ${chequeNumber}` } : { type: 'feed', lines: 0 },
            { type: 'line' },
            { type: 'text', value: 'Thank you for your business', align: 'center', bold: true },
            { type: 'feed', lines: 3 },
            { type: 'cut' }
        ];
    }, [invoice, amounts, selectedBank, chequeNumber]);

    const handlePrint = useCallback(async () => {
        if (printLockRef.current || printing) {
            return;
        }
        if (!validation.isValid) {
            return;
        }

        printLockRef.current = true;
        setPrinting(true);
        setPrintError('');
        setPrintResult('');

        const widthDots = resolvePrinterWidthDots(selectedPrinter);
        const columns = widthDots <= 400 ? 32 : 48;
        const receiptText = buildReceiptPlainText(invoice, amounts, selectedBank, chequeNumber, columns);

        try {
            if (!isRongtaAvailable()) {
                throw new Error('Rongta SDK is unavailable in this build.');
            }

            await printTextToRongta(receiptText, { ...selectedPrinter, limitWidthDots: widthDots });
            setPrintResult('Printed via Rongta Bluetooth successfully.');
            setResultVisible(true);
        } catch (error) {
            try {
                const widthDots = resolvePrinterWidthDots(selectedPrinter);
                const html = buildReceiptHtml(receiptNodes, {
                    widthPx: widthDots,
                    paperWidthMm: widthDots <= 400 ? 58 : 80
                });
                await fallbackPrint(html);
                setPrintResult('Rongta print failed. Opened system print dialog as fallback.');
                setPrintError(error?.message || 'Rongta print failed.');
                setResultVisible(true);
            } catch (fallbackError) {
                setPrintError(fallbackError?.message || error?.message || 'Print failed.');
                setResultVisible(true);
            }
        } finally {
            setPrinting(false);
            setTimeout(() => {
                printLockRef.current = false;
            }, 1200);
        }
    }, [
        validation.isValid,
        invoice,
        amounts,
        selectedBank,
        chequeNumber,
        receiptNodes,
        selectedPrinter,
        printing
    ]);

    const themed = useMemo(() => themedStyles(colors), [colors]);

    return (
        <View style={themed.root}>
            <ScrollView contentContainerStyle={themed.content}>
                <Text style={themed.title}>GasTech Invoice Payment + Thermal Print</Text>

                <View style={themed.card}>
                    <Text style={themed.sectionTitle}>Invoice Preview</Text>
                    <Text style={themed.muted}>Invoice: {invoice.invoiceNo}</Text>
                    <Text style={themed.muted}>Date: {invoice.date}</Text>
                    <Text style={themed.muted}>Customer: {invoice.customer.name}</Text>
                    <Text style={themed.muted}>Supplier: {invoice.store.name}</Text>
                    <Text style={themed.total}>Gross: LKR {formatMoney(invoice.gross)}</Text>
                    <Text style={themed.total}>VAT (18%): LKR {formatMoney(invoice.vat)}</Text>
                    <Text style={themed.totalStrong}>Net Total: LKR {formatMoney(invoice.netTotal)}</Text>
                </View>

                <View style={themed.card}>
                    <Text style={themed.sectionTitle}>Payment Methods</Text>

                    <CheckboxRow
                        label="Cash"
                        checked={cashEnabled}
                        onPress={() => setCashEnabled((current) => !current)}
                        colors={colors}
                    />
                    <CheckboxRow
                        label="Cheque"
                        checked={chequeEnabled}
                        onPress={() => setChequeEnabled((current) => !current)}
                        colors={colors}
                    />
                    <CheckboxRow
                        label="Credit"
                        checked={creditEnabled}
                        onPress={() => setCreditEnabled((current) => !current)}
                        colors={colors}
                    />

                    <TextInput
                        style={themed.input}
                        keyboardType="decimal-pad"
                        editable={cashEnabled}
                        value={cashAmount}
                        onChangeText={setCashAmount}
                        placeholder="Cash amount"
                        placeholderTextColor={colors.textSecondary}
                    />

                    <TextInput
                        style={themed.input}
                        keyboardType="decimal-pad"
                        editable={chequeEnabled}
                        value={chequeAmount}
                        onChangeText={setChequeAmount}
                        placeholder="Cheque amount"
                        placeholderTextColor={colors.textSecondary}
                    />

                    <Text style={themed.label}>Bank</Text>
                    <View style={themed.banksWrap}>
                        {SRI_LANKA_BANKS.map((bank) => (
                            <Pressable
                                key={bank}
                                style={[
                                    themed.bankChip,
                                    selectedBank === bank && themed.bankChipActive,
                                    !chequeEnabled && themed.bankChipDisabled
                                ]}
                                onPress={() => chequeEnabled && setSelectedBank(bank)}
                            >
                                <Text style={[themed.bankChipText, selectedBank === bank && themed.bankChipTextActive]}>
                                    {bank}
                                </Text>
                            </Pressable>
                        ))}
                    </View>

                    <TextInput
                        style={themed.input}
                        editable={chequeEnabled}
                        value={chequeNumber}
                        onChangeText={setChequeNumber}
                        placeholder="Cheque number"
                        placeholderTextColor={colors.textSecondary}
                    />

                    <View style={themed.summaryBox}>
                        <Text style={themed.summaryText}>Cash: LKR {formatMoney(amounts.parsedCash)}</Text>
                        <Text style={themed.summaryText}>Cheque: LKR {formatMoney(amounts.parsedCheque)}</Text>
                        <Text style={themed.summaryText}>Credit: LKR {formatMoney(amounts.creditAmount)}</Text>
                        <Text style={themed.summaryTotal}>Entered: LKR {formatMoney(amounts.enteredTotal)}</Text>
                    </View>
                </View>

                <View style={themed.card}>
                    <Text style={themed.sectionTitle}>Printer Connection</Text>

                    <Pressable style={themed.scanButton} onPress={handleScan}>
                        <MaterialCommunityIcons name="bluetooth-searching" size={18} color="#fff" />
                        <Text style={themed.scanButtonText}>Scan Bluetooth Printers</Text>
                    </Pressable>

                    {permissionError ? <Text style={themed.errorText}>{permissionError}</Text> : null}

                    <Text style={themed.label}>Discovered Printers</Text>
                    {discoveredPrinters.length === 0 ? (
                        <Text style={themed.muted}>
                            No Rongta printers discovered. Ensure printer is powered on and paired.
                        </Text>
                    ) : (
                        discoveredPrinters.map((printer, index) => {
                            const id = printer?.address || printer?.mac || `${printer?.name || 'printer'}-${index}`;
                            const selected =
                                selectedPrinter &&
                                (selectedPrinter?.address === printer?.address || selectedPrinter?.mac === printer?.mac);

                            return (
                                <Pressable
                                    key={id}
                                    style={[themed.printerItem, selected && themed.printerItemSelected]}
                                    onPress={() => handlePrinterSelect(printer)}
                                >
                                    <MaterialCommunityIcons
                                        name={selected ? 'printer-check' : 'printer-outline'}
                                        size={18}
                                        color={selected ? colors.accent : colors.textSecondary}
                                    />
                                    <View style={themed.printerMeta}>
                                        <Text style={themed.printerName}>{printer?.name || 'Unknown Printer'}</Text>
                                        <Text style={themed.printerAddress}>{printer?.address || printer?.mac || 'N/A'}</Text>
                                    </View>
                                </Pressable>
                            );
                        })
                    )}
                </View>

                {!validation.isValid ? (
                    <View style={themed.validationBox}>
                        {validation.issues.map((issue) => (
                            <Text key={issue} style={themed.validationText}>
                                • {issue}
                            </Text>
                        ))}
                    </View>
                ) : null}

                <Pressable
                    style={[themed.printButton, !validation.isValid && themed.printButtonDisabled]}
                    onPress={handlePrint}
                    disabled={!validation.isValid || printing}
                >
                    {printing ? (
                        <ActivityIndicator color="#fff" />
                    ) : (
                        <>
                            <MaterialCommunityIcons name="printer-pos" size={18} color="#fff" />
                            <Text style={themed.printButtonText}>Print Receipt</Text>
                        </>
                    )}
                </Pressable>
            </ScrollView>

            <Modal transparent visible={resultVisible} animationType="fade" onRequestClose={() => setResultVisible(false)}>
                <View style={themed.modalBackdrop}>
                    <View style={themed.modalCard}>
                        <Text style={themed.modalTitle}>Print Status</Text>
                        {printResult ? <Text style={themed.successText}>{printResult}</Text> : null}
                        {printError ? <Text style={themed.errorText}>{printError}</Text> : null}
                        <Pressable style={themed.modalButton} onPress={() => setResultVisible(false)}>
                            <Text style={themed.modalButtonText}>OK</Text>
                        </Pressable>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    checkboxRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
        gap: 8
    },
    checkboxLabel: {
        fontSize: 15,
        fontWeight: '600'
    }
});

function themedStyles(colors) {
    return StyleSheet.create({
        root: {
            flex: 1,
            backgroundColor: colors.background
        },
        content: {
            padding: 16,
            paddingBottom: 40
        },
        title: {
            fontSize: 22,
            fontWeight: '800',
            color: colors.textPrimary,
            marginBottom: 12
        },
        card: {
            backgroundColor: colors.surface,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: colors.border,
            padding: 14,
            marginBottom: 12
        },
        sectionTitle: {
            fontSize: 17,
            fontWeight: '700',
            color: colors.textPrimary,
            marginBottom: 10
        },
        muted: {
            color: colors.textSecondary,
            marginBottom: 4
        },
        total: {
            color: colors.textPrimary,
            marginBottom: 2,
            fontWeight: '600'
        },
        totalStrong: {
            color: colors.accent,
            marginTop: 4,
            fontWeight: '800'
        },
        input: {
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 10,
            backgroundColor: '#fff',
            color: colors.textPrimary,
            paddingHorizontal: 10,
            paddingVertical: 10,
            marginBottom: 10
        },
        label: {
            color: colors.textPrimary,
            fontWeight: '700',
            marginBottom: 8
        },
        banksWrap: {
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 8,
            marginBottom: 10
        },
        bankChip: {
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 18,
            paddingHorizontal: 10,
            paddingVertical: 6,
            backgroundColor: '#fff'
        },
        bankChipActive: {
            backgroundColor: colors.accentSoft,
            borderColor: colors.accent
        },
        bankChipDisabled: {
            opacity: 0.45
        },
        bankChipText: {
            color: colors.textSecondary,
            fontSize: 12
        },
        bankChipTextActive: {
            color: colors.accent,
            fontWeight: '700'
        },
        summaryBox: {
            backgroundColor: colors.accentSoft,
            borderRadius: 10,
            padding: 10
        },
        summaryText: {
            color: colors.textPrimary,
            marginBottom: 2
        },
        summaryTotal: {
            color: colors.accent,
            fontWeight: '800',
            marginTop: 4
        },
        scanButton: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            borderRadius: 10,
            paddingVertical: 10,
            backgroundColor: colors.accent,
            marginBottom: 10
        },
        scanButtonText: {
            color: '#fff',
            fontWeight: '700'
        },
        printerItem: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            padding: 10,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: colors.border,
            marginBottom: 8,
            backgroundColor: '#fff'
        },
        printerItemSelected: {
            borderColor: colors.accent,
            backgroundColor: colors.accentSoft
        },
        printerMeta: {
            flex: 1
        },
        printerName: {
            color: colors.textPrimary,
            fontWeight: '700'
        },
        printerAddress: {
            color: colors.textSecondary,
            fontSize: 12
        },
        validationBox: {
            marginBottom: 10,
            backgroundColor: '#ffe9df',
            borderWidth: 1,
            borderColor: colors.warning,
            padding: 10,
            borderRadius: 10
        },
        validationText: {
            color: colors.warning,
            marginBottom: 2
        },
        printButton: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            backgroundColor: colors.accent,
            borderRadius: 12,
            paddingVertical: 14
        },
        printButtonDisabled: {
            opacity: 0.45
        },
        printButtonText: {
            color: '#fff',
            fontWeight: '800',
            fontSize: 15
        },
        modalBackdrop: {
            flex: 1,
            backgroundColor: 'rgba(0, 0, 0, 0.4)',
            justifyContent: 'center',
            alignItems: 'center',
            padding: 20
        },
        modalCard: {
            width: '100%',
            maxWidth: 360,
            backgroundColor: colors.surface,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.border,
            padding: 16
        },
        modalTitle: {
            color: colors.textPrimary,
            fontWeight: '800',
            fontSize: 18,
            marginBottom: 10
        },
        successText: {
            color: colors.success,
            marginBottom: 8
        },
        errorText: {
            color: colors.error,
            marginBottom: 8
        },
        modalButton: {
            marginTop: 6,
            borderRadius: 8,
            backgroundColor: colors.accent,
            paddingVertical: 10,
            alignItems: 'center'
        },
        modalButtonText: {
            color: '#fff',
            fontWeight: '700'
        }
    });
}