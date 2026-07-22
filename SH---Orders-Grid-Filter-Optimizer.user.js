// ==UserScript==
// @name         SH - Orders Grid Filter Optimizer
// @namespace    http://tampermonkey.net/
// @version      7.0
// @updateURL    https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/SH---Orders-Grid-Filter-Optimizer.user.js
// @downloadURL  https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/SH---Orders-Grid-Filter-Optimizer.user.js
// @description  WIP, Print, Clear buttons. Defaults filters to contains.
// @match        https://bristow-app.azurewebsites.net/Orders/Orders
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    var wipActive = false;
    var wipApplying = false;
    var injected = false;

    var BTN = 'padding:5px 14px;border:none;border-radius:5px;font-size:13px;font-family:system-ui,sans-serif;font-weight:600;cursor:pointer;';

    function grid() { return $('#grid').data('kendoGrid'); }
    function searchGrid() { try { grid().dataSource.read(); } catch (e) {} }

    function clearFilters() {
        wipActive = false;
        var wb = document.getElementById('ofg-wip-btn');
        if (wb) wb.style.background = '#8e44ad';
        ['OrderRepSearch','OrderNumberSearch','ProjectSearch','CompanySearch','ContactSearch'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.value = '';
        });
        try { $('#officeSelect').data('kendoMultiSelect').value([]); } catch (e) {}
        try { grid().dataSource.filter([]); } catch (e) {}
    }

    function wipFilter() {
        ['OrderRepSearch','OrderNumberSearch','ProjectSearch','CompanySearch','ContactSearch'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.value = '';
        });
        try {
            var ms = $('#officeSelect').data('kendoMultiSelect');
            if (ms) {
                var yeg = null;
                ms.dataSource.data().forEach(function (item) {
                    if (item.Text && item.Text.indexOf('YEG') !== -1) yeg = item.Value;
                });
                if (yeg) ms.value([yeg]);
            }
        } catch (e) {}
        try {
            var sw = $('#wCompleted').data('kendoSwitch');
            if (sw && sw.check()) sw.check(false);
        } catch (e) {}
        wipActive = true;
        var wb = document.getElementById('ofg-wip-btn');
        if (wb) wb.style.background = '#6c3483';
        searchGrid();
    }

    function printList() {
        var g = grid();
        if (!g) return;
        var ds = g.dataSource;
        var all = ds.data();
        var rows = ds.filter()
            ? kendo.data.Query.process(all, { filter: ds.filter(), sort: ds.sort() }).data
            : (all.toJSON ? all.toJSON() : [].slice.call(all));

        rows.sort(function (a, b) {
            var ra = (a.OrderRep || '').toLowerCase();
            var rb = (b.OrderRep || '').toLowerCase();
            return ra < rb ? -1 : ra > rb ? 1 : 0;
        });

        var cols = [
            { t: 'Order Rep',  g: function (r) { return r.OrderRep; } },
            { t: 'Order',      g: function (r) { return r.OrderNumber; } },
            { t: 'Customer',   g: function (r) { return r.Company; } },
            { t: 'Component',  g: function (r) { return r.Aero && r.Aero.Component; } },
            { t: 'Serial No.', g: function (r) { return r.Aero && r.Aero.SerialNumber; } },
            { t: 'Created At', g: function (r) { return r.CreatedAt ? new Date(r.CreatedAt).toLocaleDateString() : ''; } },
            { t: 'QA',         g: function () { return 'WIP  SHIP  HOLD  EST'; }, center: true }
        ];

        var h = '<html><head><title>Orders</title><style>';
        h += 'body{font-family:Arial,sans-serif;font-size:11px;margin:20px}';
        h += 'table{border-collapse:collapse;width:100%}';
        h += 'th{background:#378ADD;color:#fff;padding:5px 8px;text-align:left;font-size:11px}';
        h += 'td{padding:4px 8px;border-bottom:1px solid #ddd;vertical-align:top}';
        h += 'tr:nth-child(even) td{background:#f5f5f5}';
        h += '@media print{button{display:none}}';
        h += '</style></head><body>';
        h += '<h2>Customer Orders &mdash; ' + rows.length + ' &mdash; ' + new Date().toLocaleDateString() + '</h2>';
        h += '<table><thead><tr>';
        cols.forEach(function (c) { h += '<th' + (c.center ? ' style="text-align:center"' : '') + '>' + c.t + '</th>'; });
        h += '</tr></thead><tbody>';
        var last = null;
        rows.forEach(function (r) {
            if (last !== null && r.OrderRep !== last) {
                h += '<tr><td colspan="' + cols.length + '" style="padding:4px 0;border:none"></td></tr>';
                h += '<tr><td colspan="' + cols.length + '" style="padding:0;border:none;border-top:2px solid #378ADD"></td></tr>';
                h += '<tr><td colspan="' + cols.length + '" style="padding:4px 0;border:none"></td></tr>';
            }
            last = r.OrderRep;
            h += '<tr>';
            cols.forEach(function (c) {
                var s = c.center ? ' style="text-align:center;font-weight:600;letter-spacing:2px;white-space:nowrap"' : '';
                h += '<td' + s + '>' + (c.g(r) || '') + '</td>';
            });
            h += '</tr>';
        });
        h += '</tbody></table></body></html>';
        var w = window.open('', '_blank', 'width=1000,height=700');
        w.document.write(h);
        w.document.close();
        setTimeout(function () { w.print(); }, 500);
    }

    function injectUI() {
        if (injected) return;
        injected = true;

        var well = document.querySelector('.well.well-sm.open-bottom');
        if (!well) return;

        var row = document.createElement('div');
        row.style.cssText = 'margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;';

        var clearBtn = document.createElement('button');
        clearBtn.id = 'ofg-clear-btn';
        clearBtn.textContent = '\u2715 Clear Filters';
        clearBtn.style.cssText = BTN + 'background:#fff;color:#c0392b;border:1px solid #c0392b;';
        clearBtn.addEventListener('click', clearFilters);

        var wipBtn = document.createElement('button');
        wipBtn.id = 'ofg-wip-btn';
        wipBtn.textContent = '\uD83D\uDD27 WIP Orders';
        wipBtn.title = 'Filter to Work in Progress orders only';
        wipBtn.style.cssText = BTN + 'background:#8e44ad;color:#fff;';
        wipBtn.addEventListener('click', wipFilter);

        var printBtn = document.createElement('button');
        printBtn.id = 'ofg-print-btn';
        printBtn.textContent = '\uD83D\uDCA8 Print List';
        printBtn.style.cssText = BTN + 'background:#27ae60;color:#fff;';
        printBtn.addEventListener('click', printList);

        row.appendChild(clearBtn);
        row.appendChild(wipBtn);
        row.appendChild(printBtn);
        well.appendChild(row);
    }

    function init() {
        var g = grid();
        if (!g) return;

        try {
            g.options.filterable = g.options.filterable || {};
            g.options.filterable.extra = false;
            g.options.filterable.operators = {
                string: { contains: 'Contains', eq: 'Is equal to', startswith: 'Starts with', doesnotcontain: 'Does not contain', neq: 'Is not equal to' },
                number: { eq: 'Is equal to', gte: 'Is greater than or equal to', lte: 'Is less than or equal to' },
                date: { eq: 'Is equal to', gte: 'Is after or equal to', lte: 'Is before or equal to' },
                enums: { eq: 'Is equal to' }
            };
        } catch (e) {}

        g.bind('dataBound', function () {
            if (!wipActive || wipApplying) return;
            wipApplying = true;
            try {
                var ds = g.dataSource;
                var f = ds.filter() ? ds.filter().filters.slice() : [];
                f = f.filter(function (x) { return !x._wip; });
                f.push({ field: 'CustomFieldValues[0].Value', operator: 'eq', value: 'Work in Progress', _wip: true });
                ds.filter(f);
            } catch (e) {}
            wipApplying = false;
        });
    }

    window.addEventListener('load', function () {
        var t = 0, id = setInterval(function () {
            t++;
            if (window.$ && grid()) {
                clearInterval(id);
                injectUI();
                init();
            }
            if (t > 40) clearInterval(id);
        }, 250);
    });
})();
