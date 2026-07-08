// ==UserScript==
// @name         TECH - Calibration Table
// @namespace    http://tampermonkey.net/
// @version      5.0
// @description  Replace calibration textareas with an editable Excel-like table; serializes back for PDF printing. Linked tables share columns, one-way tolerance sync (master→slave), custom unit input, sheet mode keeps pre/post data independent. Web Serial torque-tester input embedded in each table's action bar: click a cell, pull the wrench, value fills and auto-advances. Row deletion broadcasts to linked tables. Serial framing matches Norbar TTT factory defaults (9600 baud, 8 data/2 stop bits, no parity, CR-only line ending).
// @author       You
// @match        https://bristow-app.azurewebsites.net/Orders/Orders/Edit*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Calibration-Table.user.js
// @downloadURL  https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Calibration-Table.user.js
// ==/UserScript==

(function () {
    'use strict';

    // ─── CONFIG ────────────────────────────────────────────────────────────────
    const TABLES = [
        {
            textareaId: 'OrderHead_CustomFields_10__Text',
            label: 'Calibration Data',
            columns: ['TEST POINT', 'UUT', '% ERROR'],
            defaultRows: 5,
        },
        {
            textareaId: 'OrderHead_CustomFields_11__Text',
            label: 'Calibration Data (cont.)',
            columns: ['TEST POINT', 'UUT', '% ERROR'],
            defaultRows: 5,
            linkedFrom: 'OrderHead_CustomFields_10__Text',
        },
    ];

    const MAX_COLS = 6; // hard cap so the printed table still fits a PDF page
    // ───────────────────────────────────────────────────────────────────────────

    const _style = document.createElement('style');
    _style.textContent = `
        .cal-wrapper {
            font-family: Roboto, system-ui, sans-serif;
            font-size: 13px; color: #001c40; margin-bottom: 14px;
        }
        .cal-label {
            font-size: 11px; font-weight: 600; color: #777;
            text-transform: uppercase; letter-spacing: .06em; margin-bottom: 5px;
        }
        .cal-table-wrap { overflow-x: auto; border: 1px solid rgba(33,37,41,0.2); border-radius: 4px; }

        /* ── CARD MODE ── */
        .cal-table { border-collapse: collapse; width: 100%; min-width: 500px; font-size: 13px; background: #fff; }
        .cal-table thead tr { background: #265c89; color: #fff; }
        .cal-table thead th {
            padding: 8px 10px; font-weight: 600; font-size: 12px; text-align: left;
            white-space: nowrap; border-right: 1px solid rgba(255,255,255,0.15); cursor: pointer;
        }
        .cal-table thead th:last-child { border-right: none; }
        .cal-table thead th:hover { background: #2b6699; }
        .cal-table thead th.cal-th-fixed { cursor: default; }
        .cal-table thead th.cal-th-fixed:hover { background: #265c89; }
        .cal-table tbody tr:nth-child(even) { background: #EEF6FF; }
        .cal-table tbody tr:hover { background: #dceefb; }
        .cal-table tbody td { padding: 2px 3px; border: 1px solid #dde3ea; }
        .cal-table tbody td input {
            width: 100%; border: none; background: transparent; padding: 5px 7px;
            font-size: 13px; font-family: Roboto, system-ui, sans-serif;
            color: #001c40; outline: none; box-sizing: border-box;
        }
        .cal-table tbody td input:focus { background: #fffbe6; box-shadow: inset 0 0 0 2px #337ab7; border-radius: 2px; }
        .cal-table tbody td input.cal-calc-cell { background: #f8f9fa; color: #555; cursor: default; }
        .cal-table tbody td input.cal-formula-cell { background: #f0f7ff; }
        .cal-table tbody td input[readonly] { background: #f0f0f0 !important; color: #999; cursor: default; }
        .cal-table tbody td.row-num {
            color: #aaa; font-size: 11px; text-align: center; width: 26px; padding: 0;
            cursor: default; user-select: none; border-right: 2px solid #dde3ea;
        }
        .cal-table tbody td.del-col { width: 26px; text-align: center; padding: 0; }
        .cal-table tbody td.del-col button {
            background: none; border: none; color: #c0392b; cursor: pointer;
            font-size: 15px; line-height: 1; padding: 4px 5px; opacity: 0.45; transition: opacity .12s;
        }
        .cal-table tbody td.del-col button:hover { opacity: 1; }

        /* ── SHEET MODE ── */
        .cal-sheet-table { border-collapse: collapse; width: 100%; min-width: 500px; font-size: 12px; background: #fff; }
        .cal-sheet-table th, .cal-sheet-table td { border: 1px solid #d4d4d4; padding: 0; white-space: nowrap; }
        .cal-sheet-table th {
            background: #f1f3f4; color: #444; font-weight: 600; font-size: 11px;
            text-align: center; padding: 3px 6px; user-select: none;
        }
        .cal-sheet-table th.cal-sheet-corner { width: 32px; }
        .cal-sheet-table th.cal-sheet-letter { min-width: 80px; cursor: pointer; }
        .cal-sheet-table th.cal-sheet-letter:hover { background: #e3e6e8; }
        .cal-sheet-table td.cal-sheet-rownum {
            background: #f1f3f4; color: #555; font-size: 11px;
            text-align: center; width: 32px; user-select: none; cursor: default;
        }
        .cal-sheet-table tbody tr:hover td.cal-sheet-rownum { background: #e3e6e8; }
        .cal-sheet-table td.cal-sheet-cell { padding: 0; }
        .cal-sheet-table td.cal-sheet-cell input {
            width: 100%; min-width: 80px; border: none; background: transparent; padding: 4px 6px;
            font-size: 12px; font-family: Roboto, system-ui, sans-serif;
            color: #001c40; outline: none; box-sizing: border-box; display: block;
        }
        .cal-sheet-table td.cal-sheet-cell input:focus { box-shadow: 0 0 0 2px #1a73e8 inset; background: #fff; }
        .cal-sheet-table td.cal-sheet-cell input[readonly] { background: #f5f5f5; color: #999; cursor: default; }
        .cal-sheet-table td.del-col { background: #f1f3f4; width: 22px; text-align: center; }
        .cal-sheet-table td.del-col button {
            background: none; border: none; color: #c0392b; cursor: pointer;
            font-size: 13px; padding: 2px 4px; opacity: 0.4;
        }
        .cal-sheet-table td.del-col button:hover { opacity: 1; }

        /* ── ACTIONS ── */
        .cal-actions { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
        .cal-btn {
            display: inline-block; padding: 3px 8px; font-size: 12px;
            font-family: Roboto, system-ui, sans-serif; font-weight: 400;
            line-height: 1.5; cursor: pointer; border: 1px solid transparent;
            border-radius: 3px; transition: background .12s, border-color .12s;
        }
        .cal-btn:disabled { opacity: .35; cursor: not-allowed; }
        .cal-btn-add    { background: #27ae60; color: #fff; border-color: #27ae60; }
        .cal-btn-add:hover { background: #219150; border-color: #219150; }
        .cal-btn-clear  { background: #fff; color: #c0392b; border-color: #c0392b; }
        .cal-btn-clear:hover { background: #fdf0ee; }
        .cal-btn-col-add { background: #337ab7; color: #fff; border-color: #337ab7; }
        .cal-btn-col-add:hover { background: #2b6699; border-color: #2b6699; }
        .cal-btn-col-del { background: #fff; color: #888; border-color: #ccc; }
        .cal-btn-col-del:hover { color: #c0392b; border-color: #c0392b; }
        .cal-col-input {
            font-size: 12px; font-family: Roboto, system-ui, sans-serif;
            padding: 3px 8px; border: 1px solid rgba(33,37,41,0.2);
            border-radius: 3px; width: 140px; color: #001c40;
        }
        .cal-hint { font-size: 11px; color: #999; }
        .cal-head-edit {
            background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.5);
            border-radius: 2px; color: #fff; font-size: 12px;
            font-family: Roboto, system-ui, sans-serif; font-weight: 600;
            padding: 2px 5px; width: 100%; outline: none;
        }
        .cal-mode-switch { display: inline-flex; border: 1px solid #ccc; border-radius: 3px; overflow: hidden; }
        .cal-mode-btn {
            padding: 3px 9px; font-size: 11px; font-family: Roboto, system-ui, sans-serif;
            background: #fff; color: #555; border: none; cursor: pointer; border-right: 1px solid #ccc;
        }
        .cal-mode-btn:last-child { border-right: none; }
        .cal-mode-btn.active { background: #265c89; color: #fff; }

        /* ── SERIAL TESTER CONTROLS (embedded in action bar) ── */
        .cal-serial-controls {
            display: inline-flex; align-items: center; gap: 5px;
            margin-left: 6px; padding-left: 10px; border-left: 1px solid #ddd;
        }
        .cal-serial-baud { width: 46px; font-size: 12px; }
        .cal-serial-status { color: #c0392b; max-width: 260px; }
        .cal-serial-status.good { color: #219150; }

        /* ── PRINT / PDF ── */
        @media print {
            textarea[id^="OrderHead_CustomFields_"] { display: none !important; }
            .cal-actions { display: none !important; }
            .cal-label { display: none !important; }
            .cal-table-wrap { overflow: visible !important; border: none !important; }
            .cal-table, .cal-sheet-table { min-width: 0 !important; width: 100% !important; }
            .cal-table thead tr {
                background: #265c89 !important; color: #fff !important;
                -webkit-print-color-adjust: exact; print-color-adjust: exact;
            }
            .cal-table tbody tr:nth-child(even) {
                background: #EEF6FF !important;
                -webkit-print-color-adjust: exact; print-color-adjust: exact;
            }
            .cal-table tbody td { border: 1px solid #ccc !important; }
            .cal-table tbody td.row-num { border-right: 2px solid #ccc !important; }
            .cal-sheet-table th {
                background: #f1f3f4 !important; color: #444 !important;
                -webkit-print-color-adjust: exact; print-color-adjust: exact;
            }
            .cal-sheet-table td.cal-sheet-rownum {
                background: #f1f3f4 !important;
                -webkit-print-color-adjust: exact; print-color-adjust: exact;
            }
            #cal-serial-panel { display: none !important; }
        }
    `;
    document.head.appendChild(_style);

    // ── Serialize rows -> padded ASCII table ──────────────────────────────────
    function serialize(rows, cols, unit, fsPct, fsVal, serialNumbers, gaugeSpecs) {
        // Build display headers: rename % ERROR columns to % FS ERROR when %FS/#FS are set
        const displayCols = cols.map((col, ci) => {
            if (gaugeSpecs && gaugeSpecs.length > 0) {
                for (let gi = 0; gi < gaugeSpecs.length; gi++) {
                    const spec = gaugeSpecs[gi];
                    const errName = gaugeSpecs.length === 1 ? '% ERROR' : '% ERROR ' + (gi + 1);
                    const fsErrName = gaugeSpecs.length === 1 ? '% FS ERROR' : '% FS ERROR ' + (gi + 1);
                    if (col === errName) {
                        const fsP = parseFloat(spec.fsPct);
                        const fsV = parseFloat(spec.fsVal);
                        if (spec.fsPct && !isNaN(fsP) && fsP !== 0 &&
                            spec.fsVal && !isNaN(fsV) && fsV !== 0) {
                            return fsErrName;
                        }
                    }
                }
            }
            return col;
        });

        const allRows = [displayCols, ...rows];
        const widths = displayCols.map((_, ci) =>
            Math.max(...allRows.map(r => String(r[ci] || '').length))
        );
        const sep = '+' + widths.map(w => '-'.repeat(w + 2)).join('+') + '+';
        const fmt = row =>
            '|' + displayCols.map((_, ci) => ' ' + String(row[ci] || '').padEnd(widths[ci]) + ' ').join('|') + '|';
        const lines = [];
        if (gaugeSpecs && gaugeSpecs.length > 0) {
            gaugeSpecs.forEach((spec, i) => {
                const parts = [];
                if (spec.unit) parts.push('Unit: ' + spec.unit);
                const fsP = parseFloat(spec.fsPct);
                const fsV = parseFloat(spec.fsVal);
                if (spec.fsPct && !isNaN(fsP) && fsP !== 0) parts.push('%FS: ' + spec.fsPct);
                if (spec.fsVal && !isNaN(fsV) && fsV !== 0) parts.push('#FS: ' + spec.fsVal);
                if (spec.serial) parts.push('SN: ' + spec.serial);
                if (parts.length > 0) {
                    if (gaugeSpecs.length > 1) lines.push('Gauge ' + (i + 1));
                    lines.push(parts.join(', '));
                }
            });
        }
        const header = lines.length ? lines.join('\n') + '\n' : '';
        return header + [sep, fmt(displayCols), sep, ...rows.map(fmt), sep].join('\n');
    }

    // ── Restore previously saved table data ──────────────────────────────────
    function deserialize(text) {
        if (!text || !text.includes('|')) return { rows: null, headers: null, gaugeSpecs: [{ unit: '', fsPct: '', fsVal: '', serial: '' }] };
        const lines = text.split('\n');
        const gaugeSpecs = [];
        const dataLines = lines.filter(l => /^\|/.test(l));
        if (dataLines.length < 2) return { rows: null, headers: null, gaugeSpecs };
        const headers = dataLines[0].split('|').slice(1, -1).map(c => c.trim());

        // Detect gauge count from column headers
        const hasGaugeHeaders = headers.some(h => /^Gauge \d+$/.test(h));
        let gaugeCount = 1;
        if (hasGaugeHeaders) {
            gaugeCount = Math.max(...headers.map(h => {
                const m = h.match(/Gauge (\d+)/);
                return m ? parseInt(m[1], 10) : 1;
            }));
        }

        // Parse compact gauge spec lines
        // Format A (single): "Unit: Degrees, SN: 123"
        // Format B (multi):  "Gauge 1\nUnit: Degrees, SN: 123\nGauge 2\nUnit: VDC, %FS: 1, #FS: 300, SN: 456"
        const specLines = lines.filter(l => !l.startsWith('|') && !l.startsWith('+'));
        const gaugeBlocks = [];
        let currentBlock = null;

        for (const line of specLines) {
            const gaugeMatch = line.match(/^Gauge (\d+)$/);
            if (gaugeMatch) {
                currentBlock = { gauge: parseInt(gaugeMatch[1], 10), parts: {} };
                gaugeBlocks.push(currentBlock);
            } else if (line.includes(':')) {
                if (!currentBlock) {
                    currentBlock = { gauge: 1, parts: {} };
                    gaugeBlocks.push(currentBlock);
                }
                // Parse comma-separated "Key: Value" pairs
                line.split(',').forEach(part => {
                    const kv = part.trim().split(': ');
                    if (kv.length === 2) {
                        const key = kv[0].trim();
                        const val = kv[1].trim();
                        if (key === 'Unit') currentBlock.parts.unit = val;
                        else if (key === '%FS') currentBlock.parts.fsPct = val;
                        else if (key === '#FS') currentBlock.parts.fsVal = val;
                        else if (key === 'SN') currentBlock.parts.serial = val;
                    }
                });
            }
        }

        // Fill gaugeSpecs array
        for (let i = 0; i < gaugeCount; i++) {
            const block = gaugeBlocks.find(b => b.gauge === i + 1);
            gaugeSpecs.push({
                unit: block ? block.parts.unit || '' : '',
                fsPct: block ? block.parts.fsPct || '' : '',
                fsVal: block ? block.parts.fsVal || '' : '',
                serial: block ? block.parts.serial || '' : ''
            });
        }

        return {
            headers,
            gaugeSpecs,
            rows: dataLines.slice(1).map(line =>
                line.split('|').slice(1, -1).map(c => c.trim())
            )
        };
    }

    function colLetter(i) {
        let s = ''; i++;
        while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
        return s;
    }

    // Format error value: auto-trim trailing zeros, max 4 decimal places
    function formatError(val) {
        if (val === '' || val === undefined || val === null) return '';
        const n = parseFloat(val);
        if (isNaN(n)) return '';
        if (n === 0) return '0';
        return parseFloat(n.toFixed(4)).toString();
    }

    // ── Formula helpers ─────────────────────────────────────────────────────
    function parseCellRef(ref) {
        const m = ref.match(/^([A-Z]+)(\d+)$/i);
        if (!m) return null;
        let col = 0;
        for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
        return { row: parseInt(m[2], 10) - 1, col: col - 1 };
    }

    function evalFormula(formula, rows, cols, ri, ci, visited) {
        if (!visited) visited = new Set();
        const key = ri + ',' + ci;
        if (visited.has(key)) return '#CIRC!';
        visited.add(key);

        let expr = formula.replace(/^=\s*/, '');

        // Empty or incomplete formula — show blank, not an error
        if (!expr) return '';

        // Replace cell references like A1, B3 with numeric values
        expr = expr.replace(/\b([A-Z]+\d+)\b/gi, (match) => {
            const ref = parseCellRef(match);
            if (!ref || ref.row < 0 || ref.row >= rows.length || ref.col < 0 || ref.col >= cols.length) return '0';
            const val = rows[ref.row][ref.col];
            if (!val || val === '') return '0';
            if (String(val).startsWith('=')) {
                const sub = evalFormula(val, rows, cols, ref.row, ref.col, new Set(visited));
                return isNaN(parseFloat(sub)) ? '0' : sub;
            }
            return isNaN(parseFloat(val)) ? '0' : val;
        });

        // Only allow safe characters: digits, operators, parens, dots, spaces
        // If letters remain after cell-ref replacement, formula is incomplete — show blank
        if (!expr || /[a-df-z]/i.test(expr)) return '';
        if (!/^[\d+\-*/().e\s]+$/i.test(expr)) return '#ERR!';

        try {
            const result = Function('"use strict"; return (' + expr + ')')();
            if (typeof result !== 'number' || !isFinite(result)) return '';
            return parseFloat(result.toFixed(10)).toString();
        } catch {
            return '#ERR!';
        }
    }

    // Decide whether saved headers represent card-mode structure
    function isCardModeHeaders(headers, baseColumns) {
        if (!headers || headers.length === 0) return false;
        if (headers.length === baseColumns.length && headers.every((h, i) => h === baseColumns[i])) return true;
        if (headers.length >= 3 && headers.length % 3 === 0) {
            for (let i = 0; i < headers.length; i += 3) {
                const h1 = headers[i + 1];
                const h2 = headers[i + 2];
                if (!/UUT/i.test(h1) || !/ERROR/i.test(h2)) return false;
            }
            return true;
        }
        return false;
    }

    // ── Linked-table shared state registry ─────────────────────────────────────
    // Linked tables share the SAME cols array object. gaugeSpecs is shared for
    // the master but deep-copied for each slave, so tolerance edits are one-way
    // (master → slave). Structural changes (add/remove column/gauge) still
    // broadcast to all widgets via broadcastStructureChange().
    const LINK_GROUPS = {}; // groupId -> { cols, gaugeSpecs, viewMode, widgets: [], initialSyncDone }

    // ── Build one table widget ────────────────────────────────────────────────
    function buildWidget(config) {
        const ta = document.getElementById(config.textareaId);
        if (!ta || ta.tagName !== 'TEXTAREA') return false;
        if (ta.previousElementSibling && ta.previousElementSibling.classList.contains('cal-wrapper')) return true;

        const groupId = config.linkedFrom || config.textareaId;
        const isSlave = !!config.linkedFrom;
        const existing = deserialize(ta.value);

        let group = LINK_GROUPS[groupId];
        if (!group) {
            const cardMode = isCardModeHeaders(existing.headers, config.columns);
            const cols = (existing.headers && existing.headers.length) ? existing.headers.slice() : config.columns.slice();
            const gaugeSpecs = (existing.gaugeSpecs && existing.gaugeSpecs.length)
                ? existing.gaugeSpecs
                : [{ unit: '', fsPct: '', fsVal: '', serial: '' }];
            group = LINK_GROUPS[groupId] = {
                cols, gaugeSpecs,
                viewMode: cardMode ? 'card' : 'sheet',
                widgets: [],
                initialSyncDone: false,
            };
        }

        const cols = group.cols;
        // Slave gets its own copy of gaugeSpecs so tolerance edits are one-way (master→slave)
        const gaugeSpecs = isSlave
            ? JSON.parse(JSON.stringify(group.gaugeSpecs))
            : group.gaugeSpecs;

        let rows = (existing.rows && existing.rows.length)
            ? existing.rows
            : Array.from({ length: config.defaultRows }, () => Array(cols.length).fill(''));
        // Normalize any row to the current shared column count (also heals old
        // data that had drifted to a different column count before this fix)
        rows.forEach(r => {
            while (r.length < cols.length) r.push('');
            while (r.length > cols.length) r.pop();
        });

        ta.style.display = 'none';

        const wrapper = document.createElement('div');
        wrapper.className = 'cal-wrapper';
        wrapper.appendChild(Object.assign(document.createElement('div'), { className: 'cal-label', textContent: config.label }));

        const tableWrap = document.createElement('div');
        tableWrap.className = 'cal-table-wrap';
        wrapper.appendChild(tableWrap);

        const actions = document.createElement('div');
        actions.className = 'cal-actions';
        wrapper.appendChild(actions);

        ta.parentNode.insertBefore(wrapper, ta);

        let tabAnchorCol = 0;
        let widget; // forward reference, assigned near the end of this function

        // ── Helpers ──────────────────────────────────────────────────────────

        function cellVal(r, c) {
            const v = rows[r] && rows[r][c];
            if (typeof v === 'string' && v.startsWith('=')) return evalFormula(v, rows, cols, r, c);
            return v || '';
        }

        function hasAnyData() {
            if (gaugeSpecs.some(s => s.unit || s.fsPct || s.fsVal || s.serial)) return true;
            return rows.some(row => row.some(c => c && c.trim() !== ''));
        }

        function refreshFormulaDisplay() {
            const active = document.activeElement;
            tableWrap.querySelectorAll('input[data-ri]').forEach(cell => {
                if (cell === active) return;
                const r = parseInt(cell.dataset.ri, 10);
                const c = parseInt(cell.dataset.ci, 10);
                if (Number.isNaN(r) || Number.isNaN(c)) return;
                const val = rows[r][c];
                if (typeof val === 'string' && val.startsWith('=')) {
                    cell.value = evalFormula(val, rows, cols, r, c);
                }
            });
        }

        let _isSyncing = false;
        function sync() {
            if (_isSyncing) return;
            _isSyncing = true;
            if (group.viewMode !== 'sheet') rows.forEach((_, ri) => calcError(ri));
            if (group.viewMode === 'card') {
                gaugeSpecs.forEach((spec, gi) => {
                    let errCol;
                    if (gaugeSpecs.length === 1 && gi === 0) errCol = cols.indexOf('% ERROR');
                    else errCol = cols.indexOf('% ERROR ' + (gi + 1));
                    if (errCol < 0) return;
                    rows.forEach((row, ri) => {
                        const inp = tableWrap.querySelector(`input[data-ri="${ri}"][data-ci="${errCol}"]`);
                        if (inp) inp.value = row[errCol] || '';
                    });
                });
            }
            refreshFormulaDisplay();
            const resolved = rows.map((row, ri) => row.map((_, ci) => cellVal(ri, ci)));
            ta.value = hasAnyData() ? serialize(resolved, cols, null, null, null, null, gaugeSpecs) : '';
            ta.dispatchEvent(new Event('change', { bubbles: true }));
            ta.dispatchEvent(new Event('input',  { bubbles: true }));
            // Master pushes TEST POINT / Gauge N values into any linked slave table
            if (!isSlave) {
                group.widgets.forEach(w => { if (w !== widget && w.isSlave) w.pullTestPoints(rows); });
            }
            _isSyncing = false;
        }

        function focusCell(ri, ci) {
            const inp = tableWrap.querySelector(`input[data-ri="${ri}"][data-ci="${ci}"]`);
            if (inp) inp.focus();
        }

        function addRow() {
            rows.push(Array(cols.length).fill(''));
            render();
            sync();
        }

        function calcError(ri) {
            gaugeSpecs.forEach((spec, gi) => {
                let tpCol, uutCol, errCol;
                if (gaugeSpecs.length === 1 && gi === 0) {
                    tpCol = cols.indexOf('TEST POINT');
                    uutCol = cols.indexOf('UUT');
                    errCol = cols.indexOf('% ERROR');
                } else {
                    tpCol = cols.indexOf('Gauge ' + (gi + 1));
                    uutCol = cols.indexOf('UUT ' + (gi + 1));
                    errCol = cols.indexOf('% ERROR ' + (gi + 1));
                }
                if (tpCol < 0 || uutCol < 0 || errCol < 0) return;
                const tp  = parseFloat(cellVal(ri, tpCol));
                const uut = parseFloat(cellVal(ri, uutCol));
                if (isNaN(tp) || isNaN(uut)) { rows[ri][errCol] = ''; return; }
                const fsPct = parseFloat(spec.fsPct);
                const fsVal = parseFloat(spec.fsVal);
                if (!isNaN(fsPct) && !isNaN(fsVal) && fsVal !== 0) {
                    rows[ri][errCol] = formatError(((uut - tp) / fsVal) * 100);
                } else if (tp !== 0) {
                    rows[ri][errCol] = formatError(((uut - tp) / tp) * 100);
                } else {
                    rows[ri][errCol] = '';
                }
            });
        }

        function refreshErrorCols() {
            if (group.viewMode === 'sheet') return;
            gaugeSpecs.forEach((spec, gi) => {
                let errCol;
                if (gaugeSpecs.length === 1 && gi === 0) errCol = cols.indexOf('% ERROR');
                else errCol = cols.indexOf('% ERROR ' + (gi + 1));
                if (errCol < 0) return;
                rows.forEach((_, ri) => {
                    calcError(ri);
                    const inp = tableWrap.querySelector(`input[data-ri="${ri}"][data-ci="${errCol}"]`);
                    if (inp) inp.value = rows[ri][errCol] || '';
                });
            });
        }

        function nextEditable(c, dir, isSheet) {
            const errorCols = new Set();
            if (!isSheet) {
                gaugeSpecs.forEach((spec, gi) => {
                    if (gaugeSpecs.length === 1 && gi === 0) errorCols.add(cols.indexOf('% ERROR'));
                    else errorCols.add(cols.indexOf('% ERROR ' + (gi + 1)));
                });
            }
            let nc = c + dir;
            while (nc >= 0 && nc < cols.length && errorCols.has(nc)) nc += dir;
            return nc;
        }

        function calcRowError(ri) {
            if (group.viewMode === 'sheet') return;
            gaugeSpecs.forEach((spec, gi) => {
                let tpCol, uutCol, errCol;
                if (gaugeSpecs.length === 1 && gi === 0) {
                    tpCol = cols.indexOf('TEST POINT');
                    uutCol = cols.indexOf('UUT');
                    errCol = cols.indexOf('% ERROR');
                } else {
                    tpCol = cols.indexOf('Gauge ' + (gi + 1));
                    uutCol = cols.indexOf('UUT ' + (gi + 1));
                    errCol = cols.indexOf('% ERROR ' + (gi + 1));
                }
                if (tpCol < 0 || uutCol < 0 || errCol < 0) return;
                const errInp = tableWrap.querySelector(`input[data-ri="${ri}"][data-ci="${errCol}"]`);
                const tp  = parseFloat(cellVal(ri, tpCol));
                const uut = parseFloat(cellVal(ri, uutCol));
                const err = (!isNaN(tp) && !isNaN(uut) && tp !== 0)
                    ? formatError(((uut - tp) / tp) * 100) : '';
                rows[ri][errCol] = err;
                if (errInp) errInp.value = err;
            });
        }

        function activeCellPos() {
            const active = document.activeElement;
            if (!active || !tableWrap.contains(active) || active.tagName !== 'INPUT') return null;
            const ri = parseInt(active.dataset.ri, 10);
            const ci = parseInt(active.dataset.ci, 10);
            if (Number.isNaN(ri) || Number.isNaN(ci)) return null;
            return { ri, ci };
        }

        // ── Window-level capture handler (fires before Kendo's document handler) ─
        function onWindowKeydown(e) {
            if (!tableWrap.contains(document.activeElement)) return;
            if (document.activeElement.tagName !== 'INPUT') return;

            const pos = activeCellPos();
            if (!pos) return;

            const { ri, ci } = pos;
            const C = cols.length;
            const errorCols = new Set();
            const isSheet = group.viewMode === 'sheet';
            if (!isSheet) {
                gaugeSpecs.forEach((spec, gi) => {
                    if (gaugeSpecs.length === 1 && gi === 0) errorCols.add(cols.indexOf('% ERROR'));
                    else errorCols.add(cols.indexOf('% ERROR ' + (gi + 1)));
                });
            }

            if (e.key === 'Tab') {
                e.preventDefault();
                e.stopImmediatePropagation();

                if (!e.shiftKey) {
                    const nc = nextEditable(ci, 1, isSheet);
                    if (nc < C) {
                        focusCell(ri, nc);
                    } else {
                        calcRowError(ri);
                        let firstCol = 0;
                        while (firstCol < C && errorCols.has(firstCol)) firstCol++;
                        if (ri + 1 >= rows.length) addRow();
                        focusCell(ri + 1, firstCol);
                    }
                } else {
                    const pc = nextEditable(ci, -1, isSheet);
                    if (pc >= 0) {
                        focusCell(ri, pc);
                    } else if (ri > 0) {
                        calcRowError(ri);
                        let lastCol = C - 1;
                        while (lastCol >= 0 && errorCols.has(lastCol)) lastCol--;
                        if (lastCol >= 0) focusCell(ri - 1, lastCol);
                    }
                }

            } else if (e.key === 'Enter') {
                e.preventDefault();
                e.stopImmediatePropagation();
                calcRowError(ri);
                let targetCol = tabAnchorCol;
                if (!isSheet && errorCols.has(targetCol)) targetCol = nextEditable(targetCol, 1, isSheet);
                if (ri + 1 >= rows.length) addRow();
                focusCell(ri + 1, targetCol);

            } else if (e.key === 'ArrowDown') {
                e.preventDefault(); e.stopImmediatePropagation();
                if (ri + 1 >= rows.length) { if (isSheet) addRow(); else return; }
                focusCell(ri + 1, ci);

            } else if (e.key === 'ArrowUp') {
                e.preventDefault(); e.stopImmediatePropagation();
                if (ri > 0) focusCell(ri - 1, ci);

            } else if (e.key === 'ArrowRight') {
                if (document.activeElement.selectionStart !== document.activeElement.value.length) return;
                const nc = nextEditable(ci, 1, isSheet);
                if (nc < C) { e.preventDefault(); e.stopImmediatePropagation(); focusCell(ri, nc); }

            } else if (e.key === 'ArrowLeft') {
                if (document.activeElement.selectionStart !== 0) return;
                const pc = nextEditable(ci, -1, isSheet);
                if (pc >= 0) { e.preventDefault(); e.stopImmediatePropagation(); focusCell(ri, pc); }

            } else if (e.key === 'F2') {
                e.preventDefault();
                e.stopImmediatePropagation();
                const inp = document.activeElement;
                inp.setSelectionRange(inp.value.length, inp.value.length);
            }
        }

        window.addEventListener('keydown', onWindowKeydown, true);

        // ── Cell input factory ──────────────────────────────────────────────
        function makeInput(ri, ci, isSheet) {
            const errorCols = new Set();
            if (!isSheet) {
                gaugeSpecs.forEach((spec, gi) => {
                    if (gaugeSpecs.length === 1 && gi === 0) errorCols.add(cols.indexOf('% ERROR'));
                    else errorCols.add(cols.indexOf('% ERROR ' + (gi + 1)));
                });
            }
            const inp = document.createElement('input');
            inp.type = 'text';
            inp.tabIndex = -1;
            inp.dataset.ri = ri;
            inp.dataset.ci = ci;

            const raw = rows[ri][ci] || '';
            inp.value = (typeof raw === 'string' && raw.startsWith('=')) ? evalFormula(raw, rows, cols, ri, ci) : raw;

            const isCalcCell = !isSheet && errorCols.has(ci);
            if (isCalcCell) inp.classList.add('cal-calc-cell');
            if (typeof raw === 'string' && raw.startsWith('=')) inp.classList.add('cal-formula-cell');

            inp.addEventListener('mousedown', () => { tabAnchorCol = ci; });
            inp.addEventListener('focus', () => {
                const raw2 = rows[ri][ci] || '';
                inp.value = (typeof raw2 === 'string' && raw2.startsWith('=')) ? raw2 : (rows[ri][ci] || '');
                inp.select();
            });

            inp.addEventListener('paste', e => {
                const text = (e.clipboardData || window.clipboardData).getData('text');
                if (!text || (!text.includes('\t') && !text.includes('\n'))) return;
                e.preventDefault();
                inp.blur(); // flush any stale save on this cell BEFORE writing the pasted value below —
                            // otherwise the table rebuild right after focus-loss clobbers this one cell
                const grid = text.replace(/\r/g, '').split('\n')
                    .filter((line, i, arr) => !(i === arr.length - 1 && line === ''))
                    .map(line => line.split('\t'));
                grid.forEach((gridRow, gri) => {
                    const tRi = ri + gri;
                    while (tRi >= rows.length) rows.push(Array(cols.length).fill(''));
                    gridRow.forEach((val, gci) => {
                        const tCi = ci + gci;
                        if (tCi >= cols.length) return;
                        rows[tRi][tCi] = val;
                    });
                });
                render(); sync();
                focusCell(ri, ci);
            });

            function syncCell() {
                rows[ri][ci] = inp.value;
                if (!isSheet) {
                    gaugeSpecs.forEach((spec, gi) => {
                        let tpCol, uutCol, errCol;
                        if (gaugeSpecs.length === 1 && gi === 0) {
                            tpCol = cols.indexOf('TEST POINT');
                            uutCol = cols.indexOf('UUT');
                            errCol = cols.indexOf('% ERROR');
                        } else {
                            tpCol = cols.indexOf('Gauge ' + (gi + 1));
                            uutCol = cols.indexOf('UUT ' + (gi + 1));
                            errCol = cols.indexOf('% ERROR ' + (gi + 1));
                        }
                        if (tpCol < 0 || uutCol < 0 || errCol < 0) return;
                        if (ci === tpCol || ci === uutCol) {
                            calcError(ri);
                            const errInp = tableWrap.querySelector(`input[data-ri="${ri}"][data-ci="${errCol}"]`);
                            if (errInp) errInp.value = rows[ri][errCol] || '';
                        }
                    });
                }
                sync();
            }
            inp.addEventListener('input', syncCell);
            inp.addEventListener('blur',  syncCell);

            return inp;
        }

        function makeRenameHandler(th, ci, col, isSheet) {
            th.addEventListener('dblclick', () => {
                const inp = Object.assign(document.createElement('input'), {
                    value: col, className: 'cal-head-edit'
                });
                if (isSheet) inp.style.cssText = 'color:#001c40;background:#fff;border:1px solid #1a73e8;';
                th.textContent = ''; th.appendChild(inp);
                inp.focus(); inp.select();
                function commit() {
                    const newName = inp.value.trim() || col;
                    cols[ci] = newName; // shared array — visible to linked table immediately
                    group.widgets.forEach(w => { w.render(); w.sync(); });
                }
                inp.addEventListener('blur', commit);
                inp.addEventListener('keydown', e => {
                    if (e.key === 'Enter')  { e.preventDefault(); commit(); }
                    if (e.key === 'Escape') { inp.value = col; commit(); }
                });
            });
        }

        // ── CARD VIEW ─────────────────────────────────────────────────────────
        function renderCard() {
            tableWrap.innerHTML = '';
            const table = document.createElement('table');
            table.className = 'cal-table';

            const hrow = table.createTHead().insertRow();
            const thNum = document.createElement('th');
            thNum.className = 'cal-th-fixed'; thNum.style.width = '26px';
            hrow.appendChild(thNum);

            cols.forEach((col, ci) => {
                const th = document.createElement('th');
                th.textContent = col; th.title = 'Double-click to rename';
                makeRenameHandler(th, ci, col, false);
                hrow.appendChild(th);
            });

            const thDel = document.createElement('th');
            thDel.className = 'cal-th-fixed'; thDel.style.width = '26px';
            hrow.appendChild(thDel);

            const tbody = table.createTBody();
            rows.forEach((row, ri) => {
                while (row.length < cols.length) row.push('');
                const tr = tbody.insertRow();
                const tdNum = tr.insertCell(); tdNum.className = 'row-num'; tdNum.textContent = ri + 1;
                cols.forEach((_, ci) => { const td = tr.insertCell(); td.appendChild(makeInput(ri, ci, false)); });
                const tdDel = tr.insertCell(); tdDel.className = 'del-col';
                const delBtn = document.createElement('button');
                delBtn.type = 'button'; delBtn.textContent = '\u00d7'; delBtn.title = 'Delete row';
                delBtn.addEventListener('click', () => { group.widgets.forEach(w => w.removeRow(ri)); });
                tdDel.appendChild(delBtn);
            });

            tableWrap.appendChild(table);
            refreshErrorCols();
        }

        // ── SHEET VIEW ────────────────────────────────────────────────────────
        function renderSheet() {
            tableWrap.innerHTML = '';
            const table = document.createElement('table');
            table.className = 'cal-sheet-table';

            const thead = table.createTHead();
            const letterRow = thead.insertRow();

            const corner = document.createElement('th'); corner.className = 'cal-sheet-corner';
            letterRow.appendChild(corner);

            cols.forEach((col, ci) => {
                const th = document.createElement('th'); th.className = 'cal-sheet-letter';
                th.textContent = colLetter(ci); th.title = col + ' — double-click to rename';
                makeRenameHandler(th, ci, col, true);
                letterRow.appendChild(th);
            });

            const delCorner = document.createElement('th'); delCorner.className = 'cal-sheet-corner';
            letterRow.appendChild(delCorner);

            const tbody = table.createTBody();
            rows.forEach((row, ri) => {
                while (row.length < cols.length) row.push('');
                const tr = tbody.insertRow();
                const tdNum = tr.insertCell(); tdNum.className = 'cal-sheet-rownum'; tdNum.textContent = ri + 1;
                cols.forEach((_, ci) => {
                    const td = tr.insertCell(); td.className = 'cal-sheet-cell';
                    td.appendChild(makeInput(ri, ci, true));
                });
                const tdDel = tr.insertCell(); tdDel.className = 'del-col';
                const delBtn = document.createElement('button');
                delBtn.type = 'button'; delBtn.textContent = '\u00d7'; delBtn.title = 'Delete row';
                delBtn.addEventListener('click', () => { group.widgets.forEach(w => w.removeRow(ri)); });
                tdDel.appendChild(delBtn);
            });

            tableWrap.appendChild(table);
        }

        function updateColumnButtons() {
            addColBtn.disabled = cols.length >= MAX_COLS;
            addGaugeBtn.disabled = cols.length + 3 > MAX_COLS;
            delColBtn.disabled = cols.length <= 1;
        }

        function render() {
            wrapper.classList.remove('cal-mode-card', 'cal-mode-sheet');
            wrapper.classList.add(group.viewMode === 'sheet' ? 'cal-mode-sheet' : 'cal-mode-card');
            cardBtn.classList.toggle('active', group.viewMode === 'card');
            sheetBtn.classList.toggle('active', group.viewMode === 'sheet');
            if (group.viewMode === 'sheet') renderSheet();
            else renderCard();
            updateErrorHeaders();
            updateColumnButtons();
        }

        // ── Action bar ────────────────────────────────────────────────────────

        const modeSwitch = document.createElement('div'); modeSwitch.className = 'cal-mode-switch';
        const cardBtn  = document.createElement('button'); cardBtn.type  = 'button'; cardBtn.textContent  = 'Card';
        const sheetBtn = document.createElement('button'); sheetBtn.type = 'button'; sheetBtn.textContent = 'Sheet';

        // Card/Sheet is a shared, linked setting — switching on either table switches both.
        function applyViewMode(mode) {
            group.viewMode = mode;
            group.widgets.forEach(w => {
                if (mode === 'sheet') {
                    while (w._rows.length < w._config.defaultRows) w._rows.push(Array(cols.length).fill(''));
                }
                w.render();
                w.sync();
            });
        }
        cardBtn.addEventListener('click', () => applyViewMode('card'));
        sheetBtn.addEventListener('click', () => applyViewMode('sheet'));
        modeSwitch.appendChild(cardBtn); modeSwitch.appendChild(sheetBtn);
        actions.appendChild(modeSwitch);

        const specWrap = document.createElement('div');
        specWrap.style.cssText = 'margin-top:2px;font-size:12px;color:#555;';
        wrapper.appendChild(specWrap);

        function buildSpecRows() {
            specWrap.innerHTML = '';
            gaugeSpecs.forEach((spec, gi) => {
                const row = document.createElement('div');
                row.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin-bottom:2px;';

                const label = document.createElement('span');
                label.style.cssText = 'font-weight:600;color:#265c89;min-width:55px;';
                label.textContent = gaugeSpecs.length > 1 ? 'Gauge ' + (gi + 1) : 'Specs';
                row.appendChild(label);

                const unitDatalistId = 'cal-unit-dl-' + gi;
                const unitInp = document.createElement('input');
                unitInp.className = 'cal-col-input';
                unitInp.style.cssText = 'width:90px;font-size:12px;';
                unitInp.type = 'text';
                unitInp.placeholder = 'Unit';
                unitInp.value = spec.unit || '';
                unitInp.setAttribute('list', unitDatalistId);
                const datalist = document.createElement('datalist');
                datalist.id = unitDatalistId;
                ['Degrees', 'LBS', 'PSI', 'VDC', 'VAC'].forEach(u => {
                    const opt = document.createElement('option');
                    opt.value = u;
                    datalist.appendChild(opt);
                });
                row.appendChild(unitInp);
                row.appendChild(datalist);
                unitInp.addEventListener('input', () => {
                    spec.unit = unitInp.value; sync();
                    if (!isSlave) {
                        group.widgets.forEach(w => {
                            if (w !== widget && w.isSlave) { w._gaugeSpecs[gi].unit = unitInp.value; w.buildSpecRows(); }
                        });
                    }
                });

                row.appendChild(Object.assign(document.createElement('span'), { className: 'cal-hint', textContent: '%FS:' }));
                const fsInp = Object.assign(document.createElement('input'), { className: 'cal-col-input', type: 'text', placeholder: '0' });
                fsInp.style.cssText = 'width:50px;font-size:12px;'; fsInp.value = spec.fsPct || '';
                fsInp.addEventListener('input', () => {
                    spec.fsPct = fsInp.value; updateErrorHeaders(); sync();
                    if (!isSlave) {
                        group.widgets.forEach(w => {
                            if (w !== widget && w.isSlave) { w._gaugeSpecs[gi].fsPct = fsInp.value; w.updateErrorHeadersUI(); w.buildSpecRows(); }
                        });
                    }
                });
                row.appendChild(fsInp);

                row.appendChild(Object.assign(document.createElement('span'), { className: 'cal-hint', textContent: '#FS:' }));
                const fsNumInp = Object.assign(document.createElement('input'), { className: 'cal-col-input', type: 'text', placeholder: '0' });
                fsNumInp.style.cssText = 'width:50px;font-size:12px;'; fsNumInp.value = spec.fsVal || '';
                fsNumInp.addEventListener('input', () => {
                    spec.fsVal = fsNumInp.value; updateErrorHeaders(); sync();
                    if (!isSlave) {
                        group.widgets.forEach(w => {
                            if (w !== widget && w.isSlave) { w._gaugeSpecs[gi].fsVal = fsNumInp.value; w.updateErrorHeadersUI(); w.buildSpecRows(); }
                        });
                    }
                });
                row.appendChild(fsNumInp);

                row.appendChild(Object.assign(document.createElement('span'), { className: 'cal-hint', textContent: 'S/N:' }));
                const snInp = Object.assign(document.createElement('input'), { className: 'cal-col-input', type: 'text', placeholder: 'Serial #' });
                snInp.style.cssText = 'width:110px;font-size:12px;'; snInp.value = spec.serial || '';
                snInp.addEventListener('input', () => {
                    spec.serial = snInp.value; sync();
                    if (!isSlave) {
                        group.widgets.forEach(w => {
                            if (w !== widget && w.isSlave) { w._gaugeSpecs[gi].serial = snInp.value; w.buildSpecRows(); }
                        });
                    }
                });
                row.appendChild(snInp);

                specWrap.appendChild(row);
            });
        }
        buildSpecRows();

        function updateErrorHeaders() {
            if (group.viewMode === 'sheet') return;
            gaugeSpecs.forEach((spec, gi) => {
                let errCol;
                if (gaugeSpecs.length === 1 && gi === 0) errCol = cols.indexOf('% ERROR');
                else errCol = cols.indexOf('% ERROR ' + (gi + 1));
                if (errCol < 0) return;
                const fsPct = parseFloat(spec.fsPct);
                const fsVal = parseFloat(spec.fsVal);
                const label = (!isNaN(fsPct) && !isNaN(fsVal) && fsVal !== 0) ? '% FS ERROR' : '% ERROR';
                const displayLabel = gaugeSpecs.length > 1 ? label + ' ' + (gi + 1) : label;
                tableWrap.querySelectorAll('thead th').forEach((th, i) => {
                    if (i === errCol + 1) th.textContent = displayLabel;
                });
            });
        }

        // ── Structural changes (columns/gauges) broadcast to every linked widget ─
        function broadcastStructureChange() {
            group.widgets.forEach(w => w.onStructureChange());
        }

        const addGaugeBtn = document.createElement('button');
        addGaugeBtn.className = 'cal-btn cal-btn-col-add'; addGaugeBtn.type = 'button';
        addGaugeBtn.textContent = '+ Gauge';
        addGaugeBtn.title = 'Add another gauge (duplicates columns), up to ' + MAX_COLS + ' columns total';
        addGaugeBtn.addEventListener('click', () => {
            if (cols.length + 3 > MAX_COLS) { alert('Maximum of ' + MAX_COLS + ' columns (PDF page width limit).'); return; }
            const existingGaugeNums = cols.filter(c => /^Gauge \d+$/.test(c)).map(c => parseInt(c.match(/Gauge (\d+)/)[1], 10));
            const maxGauge = existingGaugeNums.length ? Math.max(...existingGaugeNums) : 0;
            if (maxGauge === 0 && group.viewMode === 'card') {
                const tpIdx = cols.indexOf('TEST POINT');
                const uutIdx = cols.indexOf('UUT');
                const errIdx = cols.indexOf('% ERROR');
                if (tpIdx >= 0) cols[tpIdx] = 'Gauge 1';
                if (uutIdx >= 0) cols[uutIdx] = 'UUT 1';
                if (errIdx >= 0) cols[errIdx] = '% ERROR 1';
            }
            const gaugeNum = maxGauge === 0 ? 2 : maxGauge + 1;
            cols.push('Gauge ' + gaugeNum, 'UUT ' + gaugeNum, '% ERROR ' + gaugeNum);
            gaugeSpecs.push({ unit: '', fsPct: '', fsVal: '', serial: '' });
            group.widgets.forEach(w => {
                if (w !== widget && w.isSlave) w._gaugeSpecs.push({ unit: '', fsPct: '', fsVal: '', serial: '' });
            });
            broadcastStructureChange();
        });
        actions.appendChild(addGaugeBtn);

        const addRowBtn = document.createElement('button');
        addRowBtn.className = 'cal-btn cal-btn-add'; addRowBtn.type = 'button'; addRowBtn.textContent = '+ Row';
        addRowBtn.addEventListener('click', () => { group.widgets.forEach(w => w.addRow()); });
        actions.appendChild(addRowBtn);

        const colInput = Object.assign(document.createElement('input'), { className: 'cal-col-input', type: 'text', placeholder: 'New column name\u2026' });
        actions.appendChild(colInput);
        const addColBtn = document.createElement('button');
        addColBtn.className = 'cal-btn cal-btn-col-add'; addColBtn.type = 'button'; addColBtn.textContent = '+ Column';
        addColBtn.addEventListener('click', () => {
            if (cols.length >= MAX_COLS) { alert('Maximum of ' + MAX_COLS + ' columns (PDF page width limit).'); return; }
            const name = colInput.value.trim() || `Col ${cols.length + 1}`;
            cols.push(name);
            broadcastStructureChange();
            colInput.value = '';
        });
        actions.appendChild(addColBtn);

        const delColBtn = document.createElement('button');
        delColBtn.className = 'cal-btn cal-btn-col-del'; delColBtn.type = 'button'; delColBtn.textContent = '\u2212 Last column';
        delColBtn.addEventListener('click', () => {
            if (cols.length > 1) {
                cols.pop();
                broadcastStructureChange();
            }
        });
        actions.appendChild(delColBtn);

        const clearBtn = document.createElement('button');
        clearBtn.className = 'cal-btn cal-btn-clear'; clearBtn.type = 'button'; clearBtn.textContent = 'Clear';
        clearBtn.addEventListener('click', () => {
            if (!confirm('Clear this table\u2019s data? Column headers are shared with the linked table and will also reset.')) return;
            cols.length = 0; cols.push(...config.columns);
            gaugeSpecs.length = 0; gaugeSpecs.push({ unit: '', fsPct: '', fsVal: '', serial: '' });
            group.widgets.forEach(w => {
                if (w !== widget && w.isSlave) { w._gaugeSpecs.length = 0; w._gaugeSpecs.push({ unit: '', fsPct: '', fsVal: '', serial: '' }); }
            });
            group.widgets.forEach(w => { if (w === widget) w.resetRows(); else w.onStructureChange(); });
        });
        actions.appendChild(clearBtn);

        actions.appendChild(Object.assign(document.createElement('span'), { className: 'cal-hint', textContent: 'Tab · Enter · Arrows · Dbl-click header to rename · =formula (e.g. =A1+B1) · max ' + MAX_COLS + ' cols' }));
        if (!isSlave) attachSerialControls(actions);

        // ── Widget object exposed for linking ───────────────────────────────
        widget = {
            isSlave,
            _rows: rows,
            _config: config,
            _gaugeSpecs: gaugeSpecs,
            render,
            sync,
            buildSpecRows,
            updateErrorHeadersUI: updateErrorHeaders,
            addRow() {
                rows.push(Array(cols.length).fill(''));
                render(); sync();
            },
            removeRow(ri) {
                if (rows.length > 1 && ri < rows.length) {
                    rows.splice(ri, 1);
                    render(); sync();
                }
            },
            onStructureChange() {
                rows.forEach(r => {
                    while (r.length < cols.length) r.push('');
                    while (r.length > cols.length) r.pop();
                });
                buildSpecRows();
                render();
                sync();
            },
            resetRows() {
                rows.length = 0;
                Array.from({ length: config.defaultRows }, () => Array(cols.length).fill('')).forEach(r => rows.push(r));
                buildSpecRows();
                render();
                sync();
            },
            pullTestPoints(masterRows) {
                if (group.viewMode === 'sheet') return;
                let rowsAdded = false;
                masterRows.forEach((_, ri) => {
                    while (ri >= rows.length) { rows.push(Array(cols.length).fill('')); rowsAdded = true; }
                });
                if (rowsAdded) render();
                const tpColIdxs = [];
                cols.forEach((name, ci) => { if (/^(TEST POINT|Gauge \d+)$/i.test(name)) tpColIdxs.push(ci); });
                masterRows.forEach((mRow, ri) => {
                    tpColIdxs.forEach(ci => { rows[ri][ci] = mRow[ci] || ''; });
                    calcError(ri);
                });
                rows.forEach((row, ri) => {
                    row.forEach((val, ci) => {
                        const inp = tableWrap.querySelector(`input[data-ri="${ri}"][data-ci="${ci}"]`);
                        if (inp && document.activeElement !== inp) inp.value = val || '';
                    });
                });
                const resolved = rows.map((row, ri) => row.map((_, ci) => cellVal(ri, ci)));
                ta.value = hasAnyData() ? serialize(resolved, cols, null, null, null, null, gaugeSpecs) : '';
                ta.dispatchEvent(new Event('change', { bubbles: true }));
            },
        };
        ta._widget = widget;
        group.widgets.push(widget);

        render(); sync();
        return true;
    }

    // ─── SERIAL TESTER INPUT ─────────────────────────────────────────────────
    // Reads torque readings from a Norbar tester over Web Serial. A reading
    // fills whichever calibration-table cell currently has keyboard focus,
    // then dispatches a synthetic Enter keypress — reusing the exact same
    // sync/tolerance/row-advance logic that a real keystroke triggers above.
    // Click into any cell (including a previous row, to retest a point) before
    // pulling the wrench, and that's where the reading lands.
    let serialPort = null;
    let serialAutoReconnectAttempted = false;

    // Appends a Connect button + baud field + status text into a table's own
    // action bar (same row as Card/Sheet/Gauge/Row/Column/Clear). Multiple
    // tables each get their own copy of these controls, but they all drive
    // the same single serial connection — clicking Connect on either table
    // connects the one physical tester, and status updates everywhere at once.
    function attachSerialControls(actions) {
        const wrap = document.createElement('span');
        wrap.className = 'cal-serial-controls';
        wrap.innerHTML = `
            <span class="cal-hint">Tester:</span>
            <input class="cal-col-input cal-serial-baud" type="text" value="9600" title="Baud rate — match the tester's SETUP > SERIAL PORT setting (Norbar factory default is 9600)">
            <button class="cal-btn cal-btn-col-add cal-serial-connect-btn" type="button">Connect</button>
            <span class="cal-serial-status cal-hint">Not connected</span>
        `;
        actions.appendChild(wrap);

        const baudInp = wrap.querySelector('.cal-serial-baud');
        baudInp.addEventListener('input', () => {
            document.querySelectorAll('.cal-serial-baud').forEach(el => { if (el !== baudInp) el.value = baudInp.value; });
        });
        wrap.querySelector('.cal-serial-connect-btn').addEventListener('click', connectSerial);
    }

    function getBaud() {
        const el = document.querySelector('.cal-serial-baud');
        return (el && parseInt(el.value, 10)) || 9600;
    }

    async function connectSerial() {
        if (!navigator.serial) {
            setSerialStatus('Web Serial not supported in this browser (use Chrome or Edge)', false);
            return;
        }
        try {
            serialPort = await navigator.serial.requestPort();
            await openSerial();
        } catch (err) {
            setSerialStatus('Connection cancelled', false);
        }
    }

    async function openSerial() {
        try {
            // dataBits: 8, stopBits: 2, parity: none — matches the TTT's factory-default
            // "8-2" data/stop-bit setting and OFF parity from its SETUP > SERIAL PORT menu.
            // Change these if the tester's own serial settings have been customized.
            await serialPort.open({ baudRate: getBaud(), dataBits: 8, stopBits: 2, parity: 'none' });
            setSerialStatus('Connected — click a UUT cell, then pull the wrench', true);
            readSerialLoop();
        } catch (err) {
            setSerialStatus('Open failed: ' + err.message, false);
        }
    }

    function setSerialStatus(text, good) {
        document.querySelectorAll('.cal-serial-status').forEach(el => {
            el.textContent = text;
            el.classList.toggle('good', !!good);
        });
    }

    // One-time auto-reopen of a previously authorized port, run after the
    // first table finishes building (so status elements already exist).
    function tryAutoReconnectSerial() {
        if (serialAutoReconnectAttempted || !navigator.serial) return;
        serialAutoReconnectAttempted = true;
        navigator.serial.getPorts().then(ports => {
            if (ports.length) { serialPort = ports[0]; openSerial(); }
        });
    }

    async function readSerialLoop() {
        const reader = serialPort.readable.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value);
                // The tester's factory default sends lines ending in \r only (no \n) —
                // handle \r, \n, or \r\n so this works whether or not "Output line feed" is on.
                let idx;
                while ((idx = buffer.search(/[\r\n]/)) >= 0) {
                    const line = buffer.slice(0, idx).trim();
                    buffer = buffer.slice(idx + 1);
                    if (line) handleSerialReading(line);
                }
            }
        } catch (err) {
            setSerialStatus('Disconnected: ' + err.message, false);
        }
    }

    function handleSerialReading(rawLine) {
        const match = rawLine.match(/-?\d+(\.\d+)?/);
        if (!match) {
            setSerialStatus('Received unreadable data: "' + rawLine + '"', false);
            return;
        }
        const value = match[0];

        const active = document.activeElement;
        const inTable = active && active.tagName === 'INPUT' &&
            active.closest && active.closest('.cal-table-wrap');
        if (!inTable) {
            setSerialStatus('No cell selected — click a cell first (last reading was ' + value + ')', false);
            return;
        }

        active.value = value;
        active.dispatchEvent(new Event('input', { bubbles: true }));
        active.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        setSerialStatus('Wrote ' + value + ' — connected', true);
    }

    const observer = new MutationObserver(tryBuildAll);
    observer.observe(document.body, { childList: true, subtree: true });
    tryBuildAll();

    function tryBuildAll() {
        const allFound = TABLES.every(config => document.getElementById(config.textareaId));
        if (!allFound) return;
        TABLES.forEach(config => buildWidget(config));
        // Once a linked pair is fully built, do a one-time push of master's
        // test points into the slave (handles first load / previously drifted data).
        Object.keys(LINK_GROUPS).forEach(gid => {
            const group = LINK_GROUPS[gid];
            if (!group.initialSyncDone && group.widgets.length > 1) {
                const master = group.widgets.find(w => !w.isSlave);
                if (master) master.sync();
                group.initialSyncDone = true;
            }
        });
        tryAutoReconnectSerial();
    }

})();
