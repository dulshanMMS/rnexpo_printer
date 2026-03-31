/** 80mm thermal receipt (printable ~72mm); use 576px ≈ 203dpi. */
const PAPER_WIDTH_MM = 80;
const PIXEL_WIDTH = 576;

function escapeHtml(input) {
    if (input === null || input === undefined) {
        return '';
    }

    return String(input)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderText(node) {
    const align = node.align || 'left';
    const weight = node.bold ? '700' : '400';
    const size = node.size || 14;
    const spacing = node.spacingBottom || 4;
    return `<div style="text-align:${align};font-size:${size}px;font-weight:${weight};margin:0 0 ${spacing}px 0;">${escapeHtml(node.value || '')}</div>`;
}

function renderLine() {
    return '<div style="border-top:1px dashed #000;margin:6px 0;"></div>';
}

function renderColumns(node) {
    const left = escapeHtml(node.left || '');
    const right = escapeHtml(node.right || '');
    return `<div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:4px;"><span>${left}</span><span>${right}</span></div>`;
}

function renderTable(node) {
    const headers = (node.headers || [])
        .map((header) => `<th style="border-bottom:1px solid #000;padding:2px 1px;text-align:left;">${escapeHtml(header)}</th>`)
        .join('');

    const rows = (node.rows || [])
        .map(
            (row) =>
                `<tr>${row
                    .map(
                        (cell) =>
                            `<td style="padding:2px 1px;vertical-align:top;word-break:break-word;">${escapeHtml(cell)}</td>`
                    )
                    .join('')}</tr>`
        )
        .join('');

    return `
    <table style="width:100%;border-collapse:collapse;margin:4px 0;font-size:13px;">
      <thead><tr>${headers}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderImage(node) {
    if (!node.base64) {
        return '';
    }
    return `<div style="text-align:center;margin:4px 0;"><img alt="logo" src="data:image/png;base64,${node.base64}" style="max-width:120px;height:auto;" /></div>`;
}

function renderFeed(node) {
    const lines = node.lines || 1;
    return `<div style="height:${Math.max(lines, 1) * 10}px"></div>`;
}

function renderNode(node) {
    switch (node.type) {
        case 'text':
            return renderText(node);
        case 'line':
            return renderLine();
        case 'columns':
            return renderColumns(node);
        case 'table':
            return renderTable(node);
        case 'image':
            return renderImage(node);
        case 'feed':
            return renderFeed(node);
        case 'cut':
            return '<div style="margin-top:8px;text-align:center;">--- CUT ---</div>';
        default:
            return '';
    }
}

export function buildReceiptHtml(nodes, options = {}) {
    const widthPx = Number.isFinite(options.widthPx) ? options.widthPx : PIXEL_WIDTH;
    const paperWidthMm = Number.isFinite(options.paperWidthMm) ? options.paperWidthMm : PAPER_WIDTH_MM;
    const bodyPaddingPx = Number.isFinite(options.bodyPaddingPx) ? options.bodyPaddingPx : 8;
    const body = nodes.map((node) => renderNode(node)).join('');

    return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>
          body {
            margin: 0;
            padding: ${bodyPaddingPx}px;
            width: ${widthPx}px;
            font-family: "Courier New", monospace;
            color: #000;
            line-height: 1.3;
            background: #fff;
          }
          .paper {
            width: 100%;
          }
        </style>
      </head>
      <body>
        <div class="paper" data-paper-mm="${paperWidthMm}">
          ${body}
        </div>
      </body>
    </html>
  `;
}

export { PAPER_WIDTH_MM, PIXEL_WIDTH, escapeHtml };
