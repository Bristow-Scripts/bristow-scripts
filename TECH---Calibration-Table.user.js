// ==UserScript==
// @name         TECH - Calibration Table
// @namespace    http://tampermonkey.net/
// @version      6.8
// @description  Replace calibration textareas with an editable Excel-like table; serializes back for PDF printing.
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
            labelPatterns: ['Pre Data', 'Pre-Test Data', 'Pre Cal'],
            textareaId: 'OrderHead_CustomFields_12__Text',
            label: 'Calibration Data',
            columns: ['TEST POINT', 'UUT', '% ERROR', 'PASS/FAIL'],
            defaultRows: 5,
        },
        {
            labelPatterns: ['Post Data', 'Post-Test Data', 'Post Cal'],
            textareaId: 'OrderHead_CustomFields_13__Text',
            label: 'Calibration Data (cont.)',
            columns: ['TEST POINT', 'UUT', '% ERROR', 'PASS/FAIL'],
            defaultRows: 5,
            linkedFrom: 0,
        },
    ];

    const MAX_COLS = 8; // 4 columns per gauge (Gauge/UUT/% ERROR/PASS/FAIL), up to 2 gauges
    // ───────────────────────────────────────────────────────────────────────────

    // ── Label-based field discovery ──
    // Scans for <label> elements whose text matches any of the given patterns,
    // then finds the <textarea> in the same <tr>. Falls back to the hardcoded
    // textareaId if no label match is found.
    function resolveTextareaId(config) {
        if (!config.labelPatterns || !config.labelPatterns.length) return config.textareaId;
        var labels = document.querySelectorAll('label.control-label');
        for (var i = 0; i < labels.length; i++) {
            var labelText = labels[i].textContent.trim();
            for (var j = 0; j < config.labelPatterns.length; j++) {
                if (labelText.indexOf(config.labelPatterns[j]) !== -1) {
                    var tr = labels[i].closest('tr');
                    if (tr) {
                        var ta = tr.querySelector('textarea');
                        if (ta) return ta.id;
                    }
                }
            }
        }
        return config.textareaId;
    }

    // Resolve linkedFrom (index or textareaId) to a groupId
    function resolveGroupId(config) {
        if (typeof config.linkedFrom === 'number') {
            return resolveTextareaId(TABLES[config.linkedFrom]);
        }
        if (typeof config.linkedFrom === 'string') {
            // Could be a textareaId or labelPatterns ref
            var linked = TABLES.find(function(t) { return resolveTextareaId(t) === config.linkedFrom; });
            if (linked) return resolveTextareaId(linked);
            return config.linkedFrom;
        }
        return resolveTextareaId(config);
    }

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
        .cal-table tbody td input.cal-pass { background: #d4edda; color: #155724; font-weight: 600; cursor: default; }
        .cal-table tbody td input.cal-fail { background: #f8d7da; color: #721c24; font-weight: 600; cursor: default; }
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

        /* ── FOOTER COPY BUTTONS ── */
        .cal-table tfoot td button { transition: background .12s; }
        .cal-table tfoot td button:hover { background: #2b6699 !important; }

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
        .cal-col-input::placeholder { letter-spacing: 1px; }
        .cal-hint { font-size: 11px; color: #999; }
        .cal-tol-cb { width: 16px; height: 16px; vertical-align: middle; cursor: pointer; }

        /* ── TOGGLE SWITCH ── */
        .cal-toggle { position: relative; display: inline-block; height: 22px; vertical-align: middle; margin: 0 4px; cursor: pointer; }
        .cal-toggle input { opacity: 0; width: 0; height: 0; position: absolute; }
        .cal-toggle-track {
            display: flex; align-items: center; height: 22px; border-radius: 11px;
            background: #e0e0e0; font-size: 10px; font-weight: 700;
            overflow: hidden; user-select: none; border: 1px solid #bbb;
        }
        .cal-toggle-track span { padding: 0 7px; white-space: nowrap; transition: background .2s, color .2s; position: relative; z-index: 1; line-height: 22px; }
        .cal-toggle-track .cal-toggle-on { color: #fff; background: #337ab7; border-radius: 0 11px 11px 0; }
        .cal-toggle-track .cal-toggle-off { color: #555; background: transparent; border-radius: 11px 0 0 11px; }
        .cal-toggle input:checked + .cal-toggle-track .cal-toggle-on { background: #337ab7; color: #fff; }
        .cal-toggle input:checked + .cal-toggle-track .cal-toggle-off { background: #e0e0e0; color: #999; }
        .cal-toggle input:not(:checked) + .cal-toggle-track .cal-toggle-on { background: #e0e0e0; color: #999; }
        .cal-toggle input:not(:checked) + .cal-toggle-track .cal-toggle-off { background: #337ab7; color: #fff; }
        .cal-toggle input:disabled + .cal-toggle-track { opacity: .4; cursor: not-allowed; }

        /* ── SPEC ROW LABELS ── */
        .cal-spec-label { font-size: 11px; font-weight: 700; color: #333; }
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

        /* Printing now opens a dedicated window (see the Print button handler)
           with its own minimal stylesheet, so no @media print rules are needed
           here for the live page. */
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
                        if (spec.tolMode === 'section') {
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
        const specParts = [];
        if (gaugeSpecs && gaugeSpecs.length > 0) {
            const showGaugeLabel = gaugeSpecs.length > 1;
            gaugeSpecs.forEach((spec, i) => {
                const p = [];
                if (showGaugeLabel) p.push('Gauge ' + (i + 1));
                if (spec.serial) p.push('SN: ' + spec.serial);
                if (spec.unit) p.push('Unit: ' + spec.unit);
                if (p.length) specParts.push(p.join(' - '));
            });
        }
        // Center each gauge label over its column section
        const totalW = sep.length - 1;
        let header = '';
        if (specParts.length === 1) {
            const pad = Math.max(0, totalW - specParts[0].length);
            header = ' '.repeat(Math.floor(pad / 2)) + specParts[0] + '\n';
        } else if (specParts.length > 1) {
            const sectionW = Math.floor(totalW / specParts.length);
            header = specParts.map(label => {
                const pad = Math.max(0, sectionW - label.length);
                return ' '.repeat(Math.floor(pad / 2)) + label;
            }).join('') + '\n';
        }
        const nonEmptyRows = rows.filter(r => r.some(c => c.trim() !== ''));
        return header + [sep, fmt(displayCols), sep, ...nonEmptyRows.map(fmt), sep].join('\n');
    }

    // ── localStorage helpers for gaugeSpecs (tolerance, serial, unit) ──────────
    const _gaugeSpecsStore = {};
    function saveGaugeSpecs(textareaId, specs) {
        try { localStorage.setItem('cal_specs_' + textareaId, JSON.stringify(specs)); } catch(e) {}
    }
    function loadGaugeSpecs(textareaId) {
        try { const s = localStorage.getItem('cal_specs_' + textareaId); return s ? JSON.parse(s) : null; } catch(e) { return null; }
    }

    // ── localStorage helpers for column layout (card labels, sheet labels, roles, mode) ──
    // This is the source of truth for column structure on a given browser/profile —
    // far more reliable than re-parsing it from the saved ASCII text, which breaks the
    // moment a column is renamed away from its default text (see roleIdx below for why).
    function saveLayout(groupId, layout) {
        try { localStorage.setItem('cal_layout_' + groupId, JSON.stringify(layout)); } catch(e) {}
    }
    function loadLayout(groupId) {
        try { const s = localStorage.getItem('cal_layout_' + groupId); return s ? JSON.parse(s) : null; } catch(e) { return null; }
    }

    // One-time fallback used only when no saved layout exists yet on this browser
    // (e.g. an older order, or a different computer). Infers each column's role
    // (test point / UUT / % error / pass-fail, per gauge) from its position, using
    // the same 4-per-gauge / legacy 3-per-gauge template this script has always used.
    // Unlike the old text-matching approach, this never has to be re-run once a
    // layout is saved, so a later rename can't corrupt it.
    function inferRoles(n) {
        const roles = [];
        if (n > 0 && n % 4 === 0) {
            for (let i = 0; i < n; i += 4) {
                const g = (i / 4) + 1;
                roles.push('tp' + g, 'uut' + g, 'err' + g, 'pf' + g);
            }
            return roles;
        }
        if (n > 0 && n % 3 === 0) {
            for (let i = 0; i < n; i += 3) {
                const g = (i / 3) + 1;
                roles.push('tp' + g, 'uut' + g, 'err' + g);
            }
            return roles;
        }
        return Array(n).fill(null);
    }

    // ── Restore previously saved table data ──────────────────────────────────
    function deserialize(text) {
        if (!text || !text.includes('|')) return { rows: null, headers: null, gaugeSpecs: [{ unit: '', fsPct: '', fsVal: '', serial: '', tolerance: '', tolMode: 'simple', tolLow: '0', tolHigh: '', tolSplit: '' }] };
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
        // New format (v5.7): "Gauge 1 - SN: 123 - Unit: PSI\tGauge 2 - SN: 456 - Unit: LBS"
        // Old format:        "Gauge 1\nUnit: Degrees, SN: 123\nGauge 2\nUnit: VDC, %FS: 1, #FS: 300, SN: 456"
        const specLines = lines.filter(l => !l.startsWith('|') && !l.startsWith('+'));
        const gaugeBlocks = [];

        for (const line of specLines) {
            // New format: tab-separated gauge blocks, each "Gauge N - Key: Val - Key: Val"
            if (line.includes('Gauge') && line.includes(' - ')) {
                const blocks = line.split('\t');
                for (const block of blocks) {
                    const trimmed = block.trim();
                    const gm = trimmed.match(/^Gauge (\d+)/);
                    if (!gm) continue;
                    const gb = { gauge: parseInt(gm[1], 10), parts: {} };
                    const parts = trimmed.split(' - ');
                    for (let j = 1; j < parts.length; j++) {
                        const kv = parts[j].split(': ');
                        if (kv.length === 2) {
                            const key = kv[0].trim();
                            const val = kv[1].trim();
                            if (key === 'Unit') gb.parts.unit = val;
                            else if (key === '%FS') gb.parts.fsPct = val;
                            else if (key === '#FS') gb.parts.fsVal = val;
                            else if (key === 'SN') gb.parts.serial = val;
                            else if (key === 'Tol') gb.parts.tolerance = val;
                            else if (key === 'Low') { gb.parts.tolLow = val; gb.parts.tolMode = 'section'; }
                            else if (key === 'High') gb.parts.tolHigh = val;
                            else if (key === 'Split') gb.parts.tolSplit = val;
                        }
                    }
                    gaugeBlocks.push(gb);
                }
            } else if (line.includes(':')) {
                // Old format fallback
                let currentBlock = gaugeBlocks.length ? gaugeBlocks[gaugeBlocks.length - 1] : null;
                if (!currentBlock) {
                    currentBlock = { gauge: 1, parts: {} };
                    gaugeBlocks.push(currentBlock);
                }
                line.split(',').forEach(part => {
                    const kv = part.trim().split(': ');
                    if (kv.length === 2) {
                        const key = kv[0].trim();
                        const val = kv[1].trim();
                        if (key === 'Unit') currentBlock.parts.unit = val;
                        else if (key === '%FS') currentBlock.parts.fsPct = val;
                        else if (key === '#FS') currentBlock.parts.fsVal = val;
                        else if (key === 'SN') currentBlock.parts.serial = val;
                        else if (key === 'Tol') currentBlock.parts.tolerance = val;
                        else if (key === 'TolMode') currentBlock.parts.tolMode = val;
                        else if (key === 'TolLow') currentBlock.parts.tolLow = val;
                        else if (key === 'TolHigh') currentBlock.parts.tolHigh = val;
                        else if (key === 'TolSplit') currentBlock.parts.tolSplit = val;
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
                serial: block ? block.parts.serial || '' : '',
                tolerance: block ? block.parts.tolerance || '' : '',
                tolMode: block ? block.parts.tolMode || 'simple' : 'simple',
                tolLow: block ? block.parts.tolLow || '' : '',
                tolHigh: block ? block.parts.tolHigh || '' : '',
                tolSplit: block ? block.parts.tolSplit || '' : ''
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

    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // Format error value: auto-trim trailing zeros, max 4 decimal places
    function formatError(val) {
        if (val === '' || val === undefined || val === null) return '';
        const n = parseFloat(val);
        if (isNaN(n)) return '';
        if (n === 0) return '0';
        return parseFloat(n.toFixed(4)).toString();
    }

    // Determine PASS/FAIL: |error| <= tolerance → PASS, otherwise FAIL
    // In 'section' mode, tolerance depends on where TP falls within the range.
    function passFail(errorStr, spec, tpStr) {
        if (spec.tolMode === 'section') {
            const tol = sectionTolerance(spec, tpStr);
            if (tol === null) return '';
            const err = parseFloat(errorStr);
            if (isNaN(err)) return '';
            return Math.abs(err) <= tol ? 'PASS' : 'FAIL';
        }
        // Simple mode
        if (!spec.tolerance || spec.tolerance.trim() === '') return '';
        const tol = parseFloat(spec.tolerance);
        if (isNaN(tol) || tol <= 0) return '';
        const err = parseFloat(errorStr);
        if (isNaN(err)) return '';
        return Math.abs(err) <= tol ? 'PASS' : 'FAIL';
    }

    // Calculate section-based tolerance from %FS field.
    // Single number (e.g. "3") → ±3% of full scale across the entire range.
    // Split format (e.g. "3-2-3") → divide range into N sections, each with
    // its own tolerance as a % of full scale.
    // Lower-bound inclusive: TP=10 in 0-30 with 3 sections → section 2.
    function sectionTolerance(spec, tpStr) {
        const tp = parseFloat(tpStr);
        const low = parseFloat(spec.tolLow);
        const high = parseFloat(spec.tolHigh);
        const fsVal = high;
        if (isNaN(tp) || isNaN(low) || isNaN(high) || isNaN(fsVal) || fsVal === 0) return null;
        if (high <= low) return null;
        const raw = (spec.tolSplit || '').trim();
        if (!raw) return null;
        const parts = raw.split(/[-/,]/).map(s => parseFloat(s.trim()));
        if (parts.length === 1 && !isNaN(parts[0])) {
            return parts[0];
        }
        if (parts.length < 2 || parts.some(isNaN)) return null;
        const n = parts.length;
        const span = high - low;
        const sectionSize = span / n;
        let idx = Math.floor((tp - low) / sectionSize);
        if (idx < 0) idx = 0;
        if (idx >= n) idx = n - 1;
        return parts[idx];
    }

    // Toggle cal-pass / cal-fail classes on a PASS/FAIL cell input
    function togglePfClass(inp, val) {
        if (!inp) return;
        inp.classList.toggle('cal-pass', val === 'PASS');
        inp.classList.toggle('cal-fail', val === 'FAIL');
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
        // 3-column pattern: Gauge/UUT/% ERROR (legacy)
        if (headers.length >= 3 && headers.length % 3 === 0) {
            for (let i = 0; i < headers.length; i += 3) {
                if (!/UUT/i.test(headers[i + 1]) || !/ERROR/i.test(headers[i + 2])) return false;
            }
            return true;
        }
        // 4-column pattern: Gauge/UUT/% ERROR/PASS/FAIL
        if (headers.length >= 4 && headers.length % 4 === 0) {
            for (let i = 0; i < headers.length; i += 4) {
                if (!/UUT/i.test(headers[i + 1]) || !/ERROR/i.test(headers[i + 2])) return false;
            }
            return true;
        }
        return false;
    }

    // ── Linked-table shared state registry ─────────────────────────────────────
    // Linked tables share the SAME cardCols/sheetCols/roles array objects, so a
    // structural change (add/remove column/gauge) or a card-mode rename is
    // instantly visible on both tables. Card and Sheet each keep their own
    // label array (cardCols / sheetCols) so renaming in one view never touches
    // the other. "roles" is a stable, never-renamed tag per column (tp1/uut1/
    // err1/pf1, tp2/uut2/..., or null for a free-text column) used for all
    // % ERROR / PASS-FAIL lookups, so renaming a column's display label never
    // breaks its calculations. gaugeSpecs is shared for the master but
    // deep-copied for each slave, so tolerance edits are one-way (master →
    // slave). Structural changes still broadcast to all widgets via
    // broadcastStructureChange().
    const LINK_GROUPS = {}; // groupId -> { cardCols, sheetCols, roles, gaugeSpecs, viewMode, widgets: [] }
    const _built = new Set(); // track which textarea IDs have already been built

    // ── Build one table widget ────────────────────────────────────────────────
    function buildWidget(config) {
        const resolvedId = resolveTextareaId(config);
        const ta = document.getElementById(resolvedId);
        if (!ta || ta.tagName !== 'TEXTAREA') return false;
        if (_built.has(resolvedId)) return true;
        if (ta.previousElementSibling && ta.previousElementSibling.classList.contains('cal-wrapper')) { _built.add(resolvedId); return true; }

        const groupId = resolveGroupId(config);
        const isSlave = config.linkedFrom !== undefined && config.linkedFrom !== null;
        const existing = deserialize(ta.value);

        let group = LINK_GROUPS[groupId];
        if (!group) {
            const savedLayout = loadLayout(groupId);
            let cardCols, sheetCols, roles, viewMode;
            if (savedLayout && savedLayout.cardCols && savedLayout.cardCols.length) {
                // Trust the saved layout on this browser — it's immune to the
                // renamed-column-breaks-detection problem that text parsing has.
                cardCols = savedLayout.cardCols.slice();
                const n = cardCols.length;
                sheetCols = (savedLayout.sheetCols && savedLayout.sheetCols.length === n) ? savedLayout.sheetCols.slice() : Array(n).fill('');
                roles = (savedLayout.roles && savedLayout.roles.length === n) ? savedLayout.roles.slice() : inferRoles(n);
                viewMode = savedLayout.viewMode === 'sheet' ? 'sheet' : 'card';
            } else {
                // No saved layout yet on this browser (older order, or a different
                // computer) — fall back to inferring structure from the saved ASCII
                // header line, same as before.
                const cardMode = existing.headers ? isCardModeHeaders(existing.headers, config.columns) : true;
                cardCols = (existing.headers && existing.headers.length) ? existing.headers.slice() : config.columns.slice();
                sheetCols = Array(cardCols.length).fill('');
                roles = inferRoles(cardCols.length);
                viewMode = cardMode ? 'card' : 'sheet';
            }
            // Try localStorage first, then textarea, then default
            const savedSpecs = loadGaugeSpecs(resolvedId);
            let gaugeSpecs;
            if (savedSpecs && savedSpecs.length) {
                gaugeSpecs = savedSpecs;
            } else if (existing.gaugeSpecs && existing.gaugeSpecs.length) {
                gaugeSpecs = existing.gaugeSpecs;
            } else {
                gaugeSpecs = [{ unit: '', fsPct: '', fsVal: '', serial: '', tolerance: '', tolMode: 'simple', tolLow: '0', tolHigh: '', tolSplit: '' }];
            }
            group = LINK_GROUPS[groupId] = {
                cardCols, sheetCols, roles, gaugeSpecs,
                viewMode,
                widgets: [],
            };
        }

        // cardCols/sheetCols/roles are shared array objects across the linked
        // pair (same as before) — a structural change on either table is
        // immediately visible on the other.
        const cardCols = group.cardCols;
        const sheetCols = group.sheetCols;
        const roles = group.roles;
        const cols = cardCols; // structural length + card-mode display labels
        function roleIdx(kind, gaugeNum) { return roles.indexOf(kind + gaugeNum); }
        function persistLayout() {
            saveLayout(groupId, { viewMode: group.viewMode, cardCols: group.cardCols, sheetCols: group.sheetCols, roles: group.roles });
        }
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
            if (gaugeSpecs.some(s => s.unit || s.fsPct || s.fsVal || s.serial || s.tolerance)) return true;
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

        function cardDisplayLabels() {
            // Auto-relabel a gauge's error column to "% FS ERROR" when that gauge uses
            // section tolerance — but only if the user hasn't renamed it to something
            // else, so a genuine custom rename is never silently overwritten.
            return cardCols.map((label, ci) => {
                for (let gi = 0; gi < gaugeSpecs.length; gi++) {
                    if (roles[ci] === 'err' + (gi + 1) && gaugeSpecs[gi].tolMode === 'section') {
                        if (/^% ERROR(\s*\d+)?$/.test(label)) {
                            return gaugeSpecs.length > 1 ? '% FS ERROR ' + (gi + 1) : '% FS ERROR';
                        }
                    }
                }
                return label;
            });
        }

        let _isSyncing = false;
        function sync() {
            if (_isSyncing) return;
            _isSyncing = true;
            if (group.viewMode !== 'sheet') rows.forEach((_, ri) => calcError(ri));
            if (group.viewMode === 'card') {
                gaugeSpecs.forEach((spec, gi) => {
                    const errCol = roleIdx('err', gi + 1);
                    const pfCol = roleIdx('pf', gi + 1);
                    if (errCol < 0) return;
                    rows.forEach((row, ri) => {
                        const inp = tableWrap.querySelector(`input[data-ri="${ri}"][data-ci="${errCol}"]`);
                        if (inp) inp.value = row[errCol] || '';
                        if (pfCol >= 0) {
                            const pfInp = tableWrap.querySelector(`input[data-ri="${ri}"][data-ci="${pfCol}"]`);
                            if (pfInp) { pfInp.value = row[pfCol] || ''; togglePfClass(pfInp, row[pfCol]); }
                        }
                    });
                });
            }
            refreshFormulaDisplay();
            const resolved = rows.map((row, ri) => row.map((_, ci) => cellVal(ri, ci)));
            // Sheet mode saves with blank headers (unless the user renamed a column)
            // and no gauge-spec summary line — pre/post sheets are freeform, not tied
            // to a gauge. Card mode keeps its normal labeled + gauge-spec output.
            const activeLabels = group.viewMode === 'sheet' ? sheetCols.map((c, ci) => c || colLetter(ci)) : cardDisplayLabels();
            const specsForSave = group.viewMode === 'sheet' ? null : gaugeSpecs;
            ta.value = hasAnyData() ? serialize(resolved, activeLabels, null, null, null, null, specsForSave) : '';
            saveGaugeSpecs(resolvedId, gaugeSpecs);
            persistLayout();
            ta.dispatchEvent(new Event('change', { bubbles: true }));
            ta.dispatchEvent(new Event('input',  { bubbles: true }));
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
                const tpCol = roleIdx('tp', gi + 1);
                const uutCol = roleIdx('uut', gi + 1);
                const errCol = roleIdx('err', gi + 1);
                const pfCol = roleIdx('pf', gi + 1);
                if (tpCol < 0 || uutCol < 0 || errCol < 0) return;
                const tp  = parseFloat(cellVal(ri, tpCol));
                const uut = parseFloat(cellVal(ri, uutCol));
                if (isNaN(tp) || isNaN(uut)) { rows[ri][errCol] = ''; if (pfCol >= 0) rows[ri][pfCol] = ''; return; }
                // Error formula: section mode uses #FS (tolHigh) as denominator;
                // simple mode uses old %FS/#FS fields if present, else test point.
                let fsVal = NaN;
                if (spec.tolMode === 'section') {
                    fsVal = parseFloat(spec.tolHigh);
                } else {
                    const fp = parseFloat(spec.fsPct);
                    const fv = parseFloat(spec.fsVal);
                    if (!isNaN(fp) && !isNaN(fv) && fv !== 0) fsVal = fv;
                }
                if (!isNaN(fsVal) && fsVal !== 0) {
                    rows[ri][errCol] = formatError(((uut - tp) / fsVal) * 100);
                } else if (tp !== 0) {
                    rows[ri][errCol] = formatError(((uut - tp) / tp) * 100);
                } else {
                    rows[ri][errCol] = '';
                }
                if (pfCol >= 0) rows[ri][pfCol] = passFail(rows[ri][errCol], spec, cellVal(ri, tpCol));
            });
        }

        function refreshErrorCols() {
            if (group.viewMode === 'sheet') return;
            gaugeSpecs.forEach((spec, gi) => {
                const errCol = roleIdx('err', gi + 1);
                const pfCol = roleIdx('pf', gi + 1);
                if (errCol < 0) return;
                rows.forEach((_, ri) => {
                    calcError(ri);
                    const inp = tableWrap.querySelector(`input[data-ri="${ri}"][data-ci="${errCol}"]`);
                    if (inp) inp.value = rows[ri][errCol] || '';
                    if (pfCol >= 0) {
                        const pfInp = tableWrap.querySelector(`input[data-ri="${ri}"][data-ci="${pfCol}"]`);
                        if (pfInp) { pfInp.value = rows[ri][pfCol] || ''; togglePfClass(pfInp, rows[ri][pfCol]); }
                    }
                });
            });
        }

        function nextEditable(c, dir, isSheet) {
            const skipCols = new Set();
            if (!isSheet) {
                gaugeSpecs.forEach((spec, gi) => {
                    skipCols.add(roleIdx('err', gi + 1));
                    skipCols.add(roleIdx('pf', gi + 1));
                });
            }
            let nc = c + dir;
            while (nc >= 0 && nc < cols.length && skipCols.has(nc)) nc += dir;
            return nc;
        }

        function calcRowError(ri) {
            if (group.viewMode === 'sheet') return;
            gaugeSpecs.forEach((spec, gi) => {
                const tpCol = roleIdx('tp', gi + 1);
                const uutCol = roleIdx('uut', gi + 1);
                const errCol = roleIdx('err', gi + 1);
                const pfCol = roleIdx('pf', gi + 1);
                if (tpCol < 0 || uutCol < 0 || errCol < 0) return;
                const errInp = tableWrap.querySelector(`input[data-ri="${ri}"][data-ci="${errCol}"]`);
                const tp  = parseFloat(cellVal(ri, tpCol));
                const uut = parseFloat(cellVal(ri, uutCol));
                if (isNaN(tp) || isNaN(uut)) {
                    rows[ri][errCol] = '';
                    if (errInp) errInp.value = '';
                    if (pfCol >= 0) { rows[ri][pfCol] = ''; const pfInp = tableWrap.querySelector(`input[data-ri="${ri}"][data-ci="${pfCol}"]`); if (pfInp) pfInp.value = ''; }
                    return;
                }
                let fsVal = NaN;
                if (spec.tolMode === 'section') {
                    fsVal = parseFloat(spec.tolHigh);
                } else {
                    const fp = parseFloat(spec.fsPct);
                    const fv = parseFloat(spec.fsVal);
                    if (!isNaN(fp) && !isNaN(fv) && fv !== 0) fsVal = fv;
                }
                let err;
                if (!isNaN(fsVal) && fsVal !== 0) {
                    err = formatError(((uut - tp) / fsVal) * 100);
                } else if (tp !== 0) {
                    err = formatError(((uut - tp) / tp) * 100);
                } else {
                    err = '';
                }
                rows[ri][errCol] = err;
                if (errInp) errInp.value = err;
                if (pfCol >= 0) {
                    const pf = passFail(err, spec, cellVal(ri, tpCol));
                    rows[ri][pfCol] = pf;
                    const pfInp = tableWrap.querySelector(`input[data-ri="${ri}"][data-ci="${pfCol}"]`);
                    if (pfInp) { pfInp.value = pf; togglePfClass(pfInp, pf); }
                }
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
            const skipCols = new Set();
            const isSheet = group.viewMode === 'sheet';
            if (!isSheet) {
                gaugeSpecs.forEach((spec, gi) => {
                    skipCols.add(roleIdx('err', gi + 1));
                    skipCols.add(roleIdx('pf', gi + 1));
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
                        while (firstCol < C && skipCols.has(firstCol)) firstCol++;
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
                        while (lastCol >= 0 && skipCols.has(lastCol)) lastCol--;
                        if (lastCol >= 0) focusCell(ri - 1, lastCol);
                    }
                }

            } else if (e.key === 'Enter') {
                e.preventDefault();
                e.stopImmediatePropagation();
                calcRowError(ri);
                let targetCol = tabAnchorCol;
                if (!isSheet && skipCols.has(targetCol)) targetCol = nextEditable(targetCol, 1, isSheet);
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
            const calcCols = new Set();
            if (!isSheet) {
                gaugeSpecs.forEach((spec, gi) => {
                    calcCols.add(roleIdx('err', gi + 1));
                    calcCols.add(roleIdx('pf', gi + 1));
                });
            }
            const inp = document.createElement('input');
            inp.type = 'text';
            inp.tabIndex = -1;
            inp.dataset.ri = ri;
            inp.dataset.ci = ci;

            const raw = rows[ri][ci] || '';
            inp.value = (typeof raw === 'string' && raw.startsWith('=')) ? evalFormula(raw, rows, cols, ri, ci) : raw;

            const isCalcCell = !isSheet && calcCols.has(ci);
            if (isCalcCell) inp.classList.add('cal-calc-cell');
            // PASS/FAIL coloring
            if (!isSheet && roles[ci] && roles[ci].startsWith('pf')) {
                if (raw === 'PASS') inp.classList.add('cal-pass');
                else if (raw === 'FAIL') inp.classList.add('cal-fail');
            }
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
                        const tpCol = roleIdx('tp', gi + 1);
                        const uutCol = roleIdx('uut', gi + 1);
                        const errCol = roleIdx('err', gi + 1);
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
                    const newName = inp.value.trim();
                    // Card and sheet each keep their own label for the same structural
                    // column — renaming one never touches the other, and never touches
                    // the underlying role used for % ERROR / PASS-FAIL calculations.
                    if (isSheet) sheetCols[ci] = newName;
                    else cardCols[ci] = newName || col;
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

            const displayLabels = cardDisplayLabels();
            displayLabels.forEach((displayCol, ci) => {
                const th = document.createElement('th');
                th.textContent = displayCol; th.title = 'Double-click to rename';
                makeRenameHandler(th, ci, cardCols[ci], false);
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

            // Per-column "↓ Post" buttons — master table only
            if (!isSlave) {
                const tfoot = document.createElement('tfoot');
                const ftr = tfoot.insertRow();
                const ftdNum = document.createElement('td'); ftdNum.className = 'row-num'; ftr.appendChild(ftdNum);
                cols.forEach((col, ci) => {
                    const ftd = document.createElement('td');
                    ftd.style.cssText = 'text-align:center;padding:2px;border:1px solid #dde3ea;';
                    const r = roles[ci] || '';
                    const isCopyable = r.startsWith('tp') || r.startsWith('uut');
                    if (isCopyable) {
                        const btn = document.createElement('button');
                        btn.type = 'button'; btn.textContent = '\u2193 Post';
                        btn.title = 'Copy ' + col + ' values to Post Data table';
                        btn.style.cssText = 'font-size:12px;padding:3px 10px;background:#337ab7;color:#fff;border:none;border-radius:3px;cursor:pointer;font-weight:600;';
                        btn.addEventListener('click', () => {
                            const slave = group.widgets.find(w => w.isSlave);
                            if (!slave) return;
                            slave._rows.forEach((sRow, ri) => { sRow[ci] = rows[ri] ? rows[ri][ci] || '' : ''; });
                            slave.render(); slave.sync();
                        });
                        ftd.appendChild(btn);
                    }
                    ftr.appendChild(ftd);
                });
                const ftdDel = document.createElement('td'); ftdDel.style.cssText = 'border:1px solid #dde3ea;'; ftr.appendChild(ftdDel);
                table.appendChild(tfoot);
            }

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

            cols.forEach((_, ci) => {
                const th = document.createElement('th'); th.className = 'cal-sheet-letter';
                const sLabel = sheetCols[ci] || '';
                th.textContent = sLabel || colLetter(ci);
                th.title = (sLabel ? sLabel + ' — ' : '') + 'double-click to rename (used for the printed/saved column header)';
                makeRenameHandler(th, ci, sLabel, true);
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
            addGaugeBtn.disabled = cols.length + 4 > MAX_COLS;
            delColBtn.disabled = cols.length <= 1;
        }

        function render() {
            wrapper.classList.remove('cal-mode-card', 'cal-mode-sheet');
            wrapper.classList.add(group.viewMode === 'sheet' ? 'cal-mode-sheet' : 'cal-mode-card');
            cardBtn.classList.toggle('active', group.viewMode === 'card');
            sheetBtn.classList.toggle('active', group.viewMode === 'sheet');
            specWrap.style.display = group.viewMode === 'sheet' ? 'none' : '';
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
                label.className = 'cal-spec-label';
                label.style.cssText = 'color:#265c89;min-width:55px;';
                label.textContent = gaugeSpecs.length > 1 ? 'Gauge ' + (gi + 1) : 'Specs';
                row.appendChild(label);

                // S/N first
                row.appendChild(Object.assign(document.createElement('span'), { className: 'cal-spec-label', textContent: 'S/N:' }));
                const snInp = Object.assign(document.createElement('input'), { className: 'cal-col-input', type: 'text', placeholder: 'Serial #' });
                snInp.style.cssText = 'width:110px;font-size:12px;'; snInp.value = spec.serial || '';
                snInp.addEventListener('input', () => {
                    spec.serial = snInp.value; sync();
                    if (!isSlave) {
                        group.widgets.forEach(w => {
                            if (w !== widget && w.isSlave) { w._gaugeSpecs[gi].serial = snInp.value; }
                        });
                    }
                });
                row.appendChild(snInp);

                // Unit
                row.appendChild(Object.assign(document.createElement('span'), { className: 'cal-spec-label', textContent: 'Units:' }));
                const unitDatalistId = 'cal-unit-dl-' + gi;
                const unitInp = document.createElement('input');
                unitInp.className = 'cal-col-input';
                unitInp.style.cssText = 'width:90px;font-size:12px;';
                unitInp.type = 'text';
                unitInp.placeholder = 'Units';
                unitInp.value = spec.unit || '';
                unitInp.setAttribute('list', unitDatalistId);
                const datalist = document.createElement('datalist');
                datalist.id = unitDatalistId;
                ['PSI', 'inHg Vacuum', 'inHg Pressure', 'inWC Vacuum', 'inWC Pressure', 'LBS', 'Grams', 'KG'].forEach(u => {
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
                            if (w !== widget && w.isSlave) { w._gaugeSpecs[gi].unit = unitInp.value; }
                        });
                    }
                });

                // ── Tolerance section ──
                const isSection = spec.tolMode === 'section';

                // Toggle switch (always visible, placed after Unit)
                const tolToggle = document.createElement('label');
                tolToggle.className = 'cal-toggle';
                tolToggle.title = 'Toggle between %TOL± (simple) and %FS (section-based) tolerance';
                const tolCheckbox = document.createElement('input');
                tolCheckbox.type = 'checkbox'; tolCheckbox.checked = isSection;
                const tolTrack = document.createElement('span');
                tolTrack.className = 'cal-toggle-track';
                const offLabel = document.createElement('span'); offLabel.className = 'cal-toggle-off'; offLabel.textContent = '%TOL';
                const onLabel = document.createElement('span'); onLabel.className = 'cal-toggle-on'; onLabel.textContent = '%FS';
                tolTrack.appendChild(offLabel);
                tolTrack.appendChild(onLabel);
                tolToggle.appendChild(tolCheckbox);
                tolToggle.appendChild(tolTrack);
                tolCheckbox.addEventListener('change', () => {
                    spec.tolMode = tolCheckbox.checked ? 'section' : 'simple'; sync();
                    if (!isSlave) {
                        group.widgets.forEach(w => {
                            if (w !== widget && w.isSlave) { w._gaugeSpecs[gi].tolMode = spec.tolMode; }
                        });
                    }
                    render();
                    buildSpecRows();
                });
                row.appendChild(tolToggle);

                // Simple mode: %TOL± input
                const tolSimpleWrap = document.createElement('span');
                tolSimpleWrap.style.cssText = isSection ? 'display:none' : 'display:inline-flex;align-items:center;gap:3px;';
                tolSimpleWrap.appendChild(Object.assign(document.createElement('span'), { className: 'cal-spec-label', textContent: '%TOL±:' }));
                const tolInp = Object.assign(document.createElement('input'), { className: 'cal-col-input', type: 'text', placeholder: '%' });
                tolInp.style.cssText = 'width:50px;font-size:12px;'; tolInp.value = spec.tolerance || '';
                tolInp.addEventListener('input', () => {
                    spec.tolerance = tolInp.value; sync();
                    if (!isSlave) {
                        group.widgets.forEach(w => {
                            if (w !== widget && w.isSlave) { w._gaugeSpecs[gi].tolerance = tolInp.value; }
                        });
                    }
                });
                tolSimpleWrap.appendChild(tolInp);
                row.appendChild(tolSimpleWrap);

                // Section mode: Lo, Hi, %FS
                const tolSectionWrap = document.createElement('span');
                tolSectionWrap.style.cssText = isSection ? 'display:inline-flex;align-items:center;gap:3px;' : 'display:none';
                tolSectionWrap.appendChild(Object.assign(document.createElement('span'), { className: 'cal-spec-label', textContent: 'Lo:' }));
                const lowInp = Object.assign(document.createElement('input'), { className: 'cal-col-input', type: 'text', placeholder: '#' });
                lowInp.style.cssText = 'width:50px;font-size:12px;'; lowInp.value = spec.tolLow || '';
                lowInp.addEventListener('input', () => {
                    spec.tolLow = lowInp.value; sync();
                    if (!isSlave) {
                        group.widgets.forEach(w => {
                            if (w !== widget && w.isSlave) { w._gaugeSpecs[gi].tolLow = lowInp.value; }
                        });
                    }
                });
                tolSectionWrap.appendChild(lowInp);
                tolSectionWrap.appendChild(Object.assign(document.createElement('span'), { className: 'cal-spec-label', textContent: 'Hi:' }));
                const highInp = Object.assign(document.createElement('input'), { className: 'cal-col-input', type: 'text', placeholder: '#' });
                highInp.style.cssText = 'width:50px;font-size:12px;'; highInp.value = spec.tolHigh || '';
                highInp.addEventListener('input', () => {
                    spec.tolHigh = highInp.value; sync();
                    if (!isSlave) {
                        group.widgets.forEach(w => {
                            if (w !== widget && w.isSlave) { w._gaugeSpecs[gi].tolHigh = highInp.value; }
                        });
                    }
                });
                tolSectionWrap.appendChild(highInp);
                tolSectionWrap.appendChild(Object.assign(document.createElement('span'), { className: 'cal-spec-label', textContent: '%FS:' }));
                const splitInp = Object.assign(document.createElement('input'), { className: 'cal-col-input', type: 'text', placeholder: '%-%-%' });
                splitInp.style.cssText = 'width:65px;font-size:12px;'; splitInp.value = spec.tolSplit || '';
                splitInp.addEventListener('input', () => {
                    spec.tolSplit = splitInp.value; sync();
                    if (!isSlave) {
                        group.widgets.forEach(w => {
                            if (w !== widget && w.isSlave) { w._gaugeSpecs[gi].tolSplit = splitInp.value; }
                        });
                    }
                });
                tolSectionWrap.appendChild(splitInp);
                row.appendChild(tolSectionWrap);

                specWrap.appendChild(row);
            });
        }
        buildSpecRows();

        function updateErrorHeaders() {
            // No-op: renderCard() already computes the correct header text
            // (including the FS-ERROR relabel) while respecting any rename.
            // Kept as a stub since it's referenced on the widget object below.
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
            if (cols.length + 4 > MAX_COLS) { alert('Maximum of ' + MAX_COLS + ' columns (4 per gauge).'); return; }
            const existingGaugeNums = roles.filter(r => r && /^tp\d+$/.test(r)).map(r => parseInt(r.slice(2), 10));
            const maxGauge = existingGaugeNums.length ? Math.max(...existingGaugeNums) : 0;
            if (maxGauge === 0) {
                // Cosmetic only — relabels the existing gauge-1 card columns from
                // TEST POINT/UUT/etc. to Gauge 1/UUT 1/etc. Their roles (tp1/uut1/
                // err1/pf1) don't change, so this never affects calculations.
                const tpIdx = roleIdx('tp', 1);
                const uutIdx = roleIdx('uut', 1);
                const errIdx = roleIdx('err', 1);
                const pfIdx = roleIdx('pf', 1);
                if (tpIdx >= 0) cardCols[tpIdx] = 'Gauge 1';
                if (uutIdx >= 0) cardCols[uutIdx] = 'UUT 1';
                if (errIdx >= 0) cardCols[errIdx] = '% ERROR 1';
                if (pfIdx >= 0) cardCols[pfIdx] = 'PASS/FAIL 1';
            }
            const gaugeNum = maxGauge === 0 ? 2 : maxGauge + 1;
            cardCols.push('Gauge ' + gaugeNum, 'UUT ' + gaugeNum, '% ERROR ' + gaugeNum, 'PASS/FAIL ' + gaugeNum);
            sheetCols.push('', '', '', '');
            roles.push('tp' + gaugeNum, 'uut' + gaugeNum, 'err' + gaugeNum, 'pf' + gaugeNum);
            gaugeSpecs.push({ unit: '', fsPct: '', fsVal: '', serial: '', tolerance: '', tolMode: 'simple', tolLow: '0', tolHigh: '', tolSplit: '' });
            group.widgets.forEach(w => {
                if (w !== widget && w.isSlave) w._gaugeSpecs.push({ unit: '', fsPct: '', fsVal: '', serial: '', tolerance: '', tolMode: 'simple', tolLow: '0', tolHigh: '', tolSplit: '' });
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
            cardCols.push(name);
            sheetCols.push('');
            roles.push(null);
            broadcastStructureChange();
            colInput.value = '';
        });
        actions.appendChild(addColBtn);

        const delColBtn = document.createElement('button');
        delColBtn.className = 'cal-btn cal-btn-col-del'; delColBtn.type = 'button'; delColBtn.textContent = '\u2212 Last column';
        delColBtn.addEventListener('click', () => {
            if (cols.length > 1) {
                cardCols.pop();
                sheetCols.pop();
                roles.pop();
                broadcastStructureChange();
            }
        });
        actions.appendChild(delColBtn);

        const clearBtn = document.createElement('button');
        clearBtn.className = 'cal-btn cal-btn-clear'; clearBtn.type = 'button'; clearBtn.textContent = 'Clear';
        clearBtn.addEventListener('click', () => {
            if (!confirm('Clear this table\u2019s data? Column headers are shared with the linked table and will also reset.')) return;
            cardCols.length = 0; cardCols.push(...config.columns);
            sheetCols.length = 0; sheetCols.push(...Array(config.columns.length).fill(''));
            roles.length = 0; roles.push(...inferRoles(config.columns.length));
            gaugeSpecs.length = 0; gaugeSpecs.push({ unit: '', fsPct: '', fsVal: '', serial: '', tolerance: '', tolMode: 'simple', tolLow: '0', tolHigh: '', tolSplit: '' });
            group.widgets.forEach(w => {
                if (w !== widget && w.isSlave) { w._gaugeSpecs.length = 0; w._gaugeSpecs.push({ unit: '', fsPct: '', fsVal: '', serial: '', tolerance: '', tolMode: 'simple', tolLow: '0', tolHigh: '', tolSplit: '' }); }
            });
            group.widgets.forEach(w => { if (w === widget) w.resetRows(); else w.onStructureChange(); });
        });
        actions.appendChild(clearBtn);

        if (!isSlave) actions.appendChild(Object.assign(document.createElement('span'), { className: 'cal-hint', textContent: 'Tab · Enter · Arrows · Dbl-click header to rename · =formula (e.g. =A1+B1) · max ' + MAX_COLS + ' cols' }));
        if (!isSlave) attachSerialControls(actions);

        // Print button — opens a small clean window with just the pre/post
        // calibration tables (built from the live data model, not by cloning
        // DOM inputs, so it's always accurate) so it can be handed to someone
        // for a quick review without the rest of the order page.
        function buildPrintHTML() {
            const activeCols = group.viewMode === 'sheet' ? sheetCols : cardDisplayLabels();
            const showSpecs = group.viewMode === 'card';
            // Pick exactly one master and one slave (first found), skipping stale/duplicate widgets
            const master = group.widgets.find(w => !w.isSlave);
            const slave = group.widgets.find(w => w.isSlave);
            const ordered = [master, slave].filter(Boolean);
            let body = '<h2>Calibration Data</h2>';
            let hasAnyContent = false;
            ordered.forEach(w => {
                const dataRows = w._rows.filter(r => r.some(c => c && String(c).trim() !== ''));
                if (!dataRows.length) return; // skip empty tables
                hasAnyContent = true;
                const title = w.isSlave ? 'Post Data' : 'Pre Data';
                body += `<h3>${title}</h3>`;
                if (showSpecs) {
                    const specLines = w._gaugeSpecs
                        .map((s, gi) => {
                            const parts = [];
                            if (w._gaugeSpecs.length > 1) parts.push('Gauge ' + (gi + 1));
                            if (s.serial) parts.push('S/N: ' + s.serial);
                            if (s.unit) parts.push('Units: ' + s.unit);
                            return parts.length ? parts.join(' \u2014 ') : null;
                        })
                        .filter(Boolean);
                    if (specLines.length) body += `<div class="cal-print-specs">${specLines.map(escapeHtml).join(' &nbsp;|&nbsp; ')}</div>`;
                }
                const labels = activeCols.map((c, ci) => (c && c.trim()) ? c : (group.viewMode === 'sheet' ? colLetter(ci) : ('Col ' + (ci + 1))));
                body += '<table><thead><tr>' + labels.map(l => `<th>${escapeHtml(l)}</th>`).join('') + '</tr></thead><tbody>';
                dataRows.forEach(row => {
                    body += '<tr>' + activeCols.map((_, ci) => {
                        const val = row[ci] || '';
                        const isPf = !!(roles[ci] && roles[ci].startsWith('pf'));
                        const cls = isPf && val === 'PASS' ? 'cal-print-pass' : (isPf && val === 'FAIL' ? 'cal-print-fail' : '');
                        return `<td class="${cls}">${escapeHtml(val)}</td>`;
                    }).join('') + '</tr>';
                });
                body += '</tbody></table>';
            });
            if (!hasAnyContent) body += '<p style="color:#999;font-style:italic;">No data entered yet.</p>';
            return body;
        }

        const printBtn = document.createElement('button');
        printBtn.className = 'cal-btn'; printBtn.type = 'button'; printBtn.textContent = 'Print';
        printBtn.title = 'Print just the pre/post calibration data tables';
        printBtn.addEventListener('click', () => {
            const win = window.open('', '_blank', 'width=900,height=700');
            if (!win) { alert('Pop-up blocked \u2014 please allow pop-ups for this site to print.'); return; }
            const css = `
                body { font-family: Roboto, system-ui, sans-serif; color: #001c40; margin: 24px; }
                h2 { margin: 0 0 12px; }
                h3 { margin: 20px 0 4px; color: #265c89; }
                .cal-print-specs { font-size: 12px; color: #555; margin-bottom: 6px; }
                table { border-collapse: collapse; width: 100%; margin-bottom: 4px; font-size: 12px; }
                th, td { border: 1px solid #999; padding: 4px 7px; text-align: left; }
                th { background: #265c89; color: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                tbody tr:nth-child(even) { background: #EEF6FF; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                .cal-print-pass { background: #d4edda; color: #155724; font-weight: 600; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                .cal-print-fail { background: #f8d7da; color: #721c24; font-weight: 600; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                .cal-print-empty { color: #999; font-style: italic; text-align: center; }
                @media print { body { margin: 0.4in; } }
            `;
            win.document.write(`<!DOCTYPE html><html><head><title>Calibration Data</title><meta charset="utf-8"><style>${css}</style></head><body>${buildPrintHTML()}</body></html>`);
            win.document.close();
            win.onload = () => { win.focus(); win.print(); };
        });
        actions.appendChild(printBtn);

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
        };
        ta._widget = widget;
        group.widgets.push(widget);
        _built.add(resolvedId);

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
    let serialReader = null;
    let serialAutoReconnectAttempted = false;

    // Some USB-serial drivers (CH340 in particular) are slow to release the port
    // if it isn't explicitly closed before the page unloads — leaving the next
    // page's connection attempt to fail, or "succeed" but silently receive no
    // data. Cancel the reader and close the port before navigating away so the
    // driver gets a clean handoff.
    window.addEventListener('pagehide', () => {
        try { if (serialReader) serialReader.cancel(); } catch (e) {}
        try { if (serialPort && serialPort.readable) serialPort.close(); } catch (e) {}
    });

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

    async function openSerial(isRetry) {
        try {
            // dataBits: 8, stopBits: 1, parity: none — matches this unit's ACTUAL working
            // configuration (confirmed via the old WedgeLink setup), not the printed manual's
            // factory default of 2 stop bits. Real-world config takes precedence here since
            // settings can drift from factory defaults over a unit's life.
            await serialPort.open({ baudRate: getBaud(), dataBits: 8, stopBits: 2, parity: 'none' });
            setSerialStatus('Connected — click a UUT cell, then pull the wrench', true);
            readSerialLoop();
        } catch (err) {
            if (!isRetry) {
                // The adapter's driver can be slow to release the port right after a
                // page refresh/navigation — wait briefly and try once more before
                // reporting a real failure.
                setSerialStatus('Reconnecting…', false);
                setTimeout(() => openSerial(true), 600);
                return;
            }
            setSerialStatus('Open failed: ' + err.message + ' — try unplugging and replugging the adapter', false);
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
        serialReader = serialPort.readable.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        try {
            while (true) {
                const { value, done } = await serialReader.read();
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
        } finally {
            try { serialReader.releaseLock(); } catch (e) {}
            serialReader = null;
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

        const ri = parseInt(active.dataset.ri, 10);
        const ci = parseInt(active.dataset.ci, 10);
        if (!Number.isNaN(ri) && !Number.isNaN(ci)) {
            const wrapper = active.closest('.cal-wrapper');
            if (wrapper) {
                const ta = wrapper.nextElementSibling;
                if (ta && ta._widget) {
                    ta._widget._rows[ri][ci] = value;
                }
            }
        }

        active.dispatchEvent(new Event('input', { bubbles: true }));

        setTimeout(() => {
            if (active.isConnected) {
                active.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
            }
            setSerialStatus('Wrote ' + value + ' — connected', true);
        }, 60);
    }

    const observer = new MutationObserver(tryBuildAll);
    observer.observe(document.body, { childList: true, subtree: true });
    tryBuildAll();

    function tryBuildAll() {
        const allFound = TABLES.every(config => document.getElementById(resolveTextareaId(config)));
        if (!allFound) return;
        TABLES.forEach(config => {
            const resolvedId = resolveTextareaId(config);
            const ta = document.getElementById(resolvedId);
            const groupId = resolveGroupId(config);
            const grp = LINK_GROUPS[groupId];
            if (grp) {
                // Remove stale widgets whose wrapper is no longer in the DOM
                grp.widgets = grp.widgets.filter(w => {
                    const wResolvedId = resolveTextareaId(w._config);
                    const wta = document.getElementById(wResolvedId);
                    return wta && wta.previousElementSibling && wta.previousElementSibling.classList.contains('cal-wrapper');
                });
            }
            // If wrapper was removed (page save/DOM update), allow rebuild
            if (ta && !ta.previousElementSibling?.classList.contains('cal-wrapper')) {
                _built.delete(resolvedId);
            }
            buildWidget(config);
        });
        tryAutoReconnectSerial();
    }

})();
