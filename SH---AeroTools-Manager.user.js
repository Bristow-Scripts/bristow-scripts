// ==UserScript==
// @name         SH - AeroTools Manager
// @namespace    http://tampermonkey.net/
// @version      3.1
// @description  Clear filters, Print Tool Report, Bulk Edit, Print Label for AeroTools
// @match        https://bristow-app.azurewebsites.net/Catalog/AeroTools*
// @updateURL    https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/SH---AeroTools-Manager.user.js
// @downloadURL  https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/SH---AeroTools-Manager.user.js
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    var BTN = 'padding:5px 14px;border:none;border-radius:5px;font-size:13px;font-family:system-ui,sans-serif;font-weight:600;cursor:pointer;';
    var selectedTools = {};
    var isEditing = false;
    var isEditPage = window.location.pathname.includes('EditAeroTool');

    function grid() { return $('#grid').data('kendoGrid'); }

    function createButton(text, bg, color, onClick) {
        var btn = document.createElement('button');
        btn.textContent = text;
        btn.style.cssText = BTN + 'background:' + bg + ';color:' + color + ';';
        btn.addEventListener('click', onClick);
        return btn;
    }

    // ==================== LIST PAGE ====================

    function initListPage() {
        clearDefaultFilter();
        injectListUI();

        var g = grid();
        if (g) {
            g.bind('dataBound', addCheckboxes);
            g.bind('dataBound', formatGridDates);
            g.one('dataBound', function () { setTimeout(formatGridDates, 500); });
        }
    }

    function formatGridDates() {
        var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        var cells = document.querySelectorAll('#grid td[role="gridcell"]');
        cells.forEach(function (cell) {
            var text = cell.textContent.trim();
            if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
                var d = new Date(text);
                if (!isNaN(d.getTime())) {
                    cell.textContent = String(d.getDate()).padStart(2, '0') + '-' + months[d.getMonth()] + '-' + d.getFullYear();
                }
            }
        });
    }

    function clearDefaultFilter() {
        var g = grid();
        if (!g) return;
        var ds = g.dataSource;

        // Clear the filter entirely on the data source
        ds.filter([]);

        // Force a full re-read from the server (bypasses client cache)
        ds.read();

        // Remove the visual "active filter" indicator on the IsEnabled column
        setTimeout(function () {
            var icons = document.querySelectorAll('[data-field="IsEnabled"] .k-grid-filter-menu');
            icons.forEach(function (el) { el.classList.remove('k-active'); });
        }, 500);
    }

    function injectListUI() {
        var well = document.querySelector('.well.well-sm.open-bottom');
        if (!well) return;

        var row = document.createElement('div');
        row.style.cssText = 'margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;';

        var clearBtn = createButton('\u2715 Clear Filters', '#fff', '#c0392b', clearAllFilters);
        clearBtn.style.cssText += 'border:1px solid #c0392b;';

        var printBtn = createButton('\uD83D\uDDA8 Print Tool Report', '#27ae60', '#fff', printToolReport);

        var bulkBtn = createButton('\u270F Edit', '#8e44ad', '#fff', enterEditMode);
        bulkBtn.id = 'bulk-edit-btn';
        bulkBtn.style.display = 'none';

        row.appendChild(clearBtn);
        row.appendChild(printBtn);
        row.appendChild(bulkBtn);
        well.appendChild(row);

        // Toggle row for In Service filter
        var toggleRow = document.createElement('div');
        toggleRow.style.cssText = 'margin-top:5px;display:flex;gap:8px;align-items:center;';

        var toggleLabel = document.createElement('span');
        toggleLabel.style.cssText = 'font-size:13px;font-weight:600;';
        toggleLabel.textContent = 'In Service:';

        var toggleContainer = document.createElement('div');
        toggleContainer.style.cssText = 'position:relative;width:40px;height:20px;border-radius:10px;background:#888;cursor:pointer;transition:background 0.3s;';
        toggleContainer.id = 'in-service-toggle';

        var toggleKnob = document.createElement('div');
        toggleKnob.style.cssText = 'position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:left 0.3s;';
        toggleKnob.id = 'in-service-knob';

        toggleContainer.appendChild(toggleKnob);
        toggleContainer.addEventListener('click', toggleInServiceFilter);

        var toggleState = document.createElement('span');
        toggleState.id = 'toggle-state-label';
        toggleState.style.cssText = 'font-size:12px;color:#666;';
        toggleState.textContent = 'All';

        toggleRow.appendChild(toggleLabel);
        toggleRow.appendChild(toggleContainer);
        toggleRow.appendChild(toggleState);
        well.appendChild(toggleRow);
    }

    var inServiceFilterState = 'all'; // 'all', 'in', 'out'

    function toggleInServiceFilter() {
        var g = grid();
        if (!g) return;
        var ds = g.dataSource;
        var currentFilter = ds.filter() || {};
        var filters = (currentFilter.filters || []).filter(function (x) { return x.field !== 'IsEnabled'; });

        if (inServiceFilterState === 'all') {
            inServiceFilterState = 'in';
        } else if (inServiceFilterState === 'in') {
            inServiceFilterState = 'out';
        } else {
            inServiceFilterState = 'all';
        }

        var toggleContainer = document.getElementById('in-service-toggle');
        var toggleKnob = document.getElementById('in-service-knob');
        var toggleLabel = document.getElementById('toggle-state-label');

        if (inServiceFilterState === 'in') {
            filters.push({ field: 'IsEnabled', operator: 'eq', value: true });
            toggleContainer.style.background = '#27ae60';
            toggleKnob.style.left = '22px';
            toggleLabel.textContent = 'In Service';
            toggleLabel.style.color = '#27ae60';
        } else if (inServiceFilterState === 'out') {
            filters.push({ field: 'IsEnabled', operator: 'eq', value: false });
            toggleContainer.style.background = '#c0392b';
            toggleKnob.style.left = '22px';
            toggleLabel.textContent = 'Not In Service';
            toggleLabel.style.color = '#c0392b';
        } else {
            toggleContainer.style.background = '#888';
            toggleKnob.style.left = '2px';
            toggleLabel.textContent = 'All';
            toggleLabel.style.color = '#666';
        }

        if (filters.length > 0) {
            ds.filter({ logic: 'and', filters: filters });
        } else {
            ds.filter([]);
        }
    }

    function clearAllFilters() {
        selectedTools = {};
        isEditing = false;
        updateBulkEditButton();
        ['ToolNumberSearch', 'AltToolNumberSearch', 'ToolDescriptionSearch'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.value = '';
        });
        try { grid().dataSource.filter([]); } catch (e) {}

        // Reset toggle to "All"
        inServiceFilterState = 'all';
        var toggleContainer = document.getElementById('in-service-toggle');
        var toggleKnob = document.getElementById('in-service-knob');
        var toggleLabel = document.getElementById('toggle-state-label');
        if (toggleContainer) {
            toggleContainer.style.background = '#888';
            toggleKnob.style.left = '2px';
            toggleLabel.textContent = 'All';
            toggleLabel.style.color = '#666';
        }
    }

    function addCheckboxes() {
        var g = grid();
        if (!g) return;

        g.thead.find('tr:first th:first .header-checkbox').closest('th').remove();
        g.tbody.find('td:first .tool-checkbox').closest('td').remove();

        var headerRow = g.thead.find('tr:first');
        var th = $('<th style="text-align:center;width:40px;"></th>');
        var hcb = $('<input type="checkbox" class="header-checkbox">');
        hcb.on('change', function () {
            var checked = this.checked;
            g.tbody.find('.tool-checkbox').each(function () {
                $(this).prop('checked', checked).trigger('change');
            });
        });
        th.append(hcb);
        headerRow.prepend(th);

        g.tbody.find('tr').each(function () {
            var row = $(this);
            var uid = row.attr('data-uid');
            var dataItem = g.dataSource.getByUid(uid);
            if (!dataItem) return;

            var td = $('<td style="text-align:center;vertical-align:middle;"></td>');
            var cb = $('<input type="checkbox" class="tool-checkbox" data-id="' + dataItem.Id + '">');

            if (selectedTools[dataItem.Id]) cb.prop('checked', true);

            cb.on('change', function () {
                if (this.checked) {
                    selectedTools[dataItem.Id] = dataItem;
                } else {
                    delete selectedTools[dataItem.Id];
                }
                updateBulkEditButton();
            });

            td.append(cb);
            row.prepend(td);
        });
    }

    function updateBulkEditButton() {
        var btn = document.getElementById('bulk-edit-btn');
        if (!btn) return;
        var count = Object.keys(selectedTools).length;
        if (count === 0) {
            btn.style.display = 'none';
        } else if (isEditing) {
            btn.style.display = 'inline-block';
            btn.textContent = '\u2714 Save (' + count + ')';
            btn.style.background = '#27ae60';
        } else {
            btn.style.display = 'inline-block';
            btn.textContent = '\u270F Edit (' + count + ')';
            btn.style.background = '#8e44ad';
        }
    }

    // ==================== PRINT TOOL REPORT ====================

    function printToolReport() {
        var g = grid();
        var ds = g.dataSource;

        var today = new Date();
        today.setHours(0, 0, 0, 0);
        var endDate = new Date(today);
        endDate.setDate(endDate.getDate() + 45);

        var printFilter = {
            logic: 'and',
            filters: [
                { field: 'IsEnabled', operator: 'eq', value: true },
                { field: 'CalDueDate', operator: 'gte', value: today },
                { field: 'CalDueDate', operator: 'lte', value: endDate }
            ]
        };

        var all = ds.data();
        var items = kendo.data.Query.process(all, {
            filter: printFilter,
            sort: [{ field: 'CalDueDate', dir: 'asc' }]
        }).data;

        var result = [];
        for (var i = 0; i < items.length; i++) {
            result.push(items[i].toJSON ? items[i].toJSON() : items[i]);
        }

        generateToolReportPrintout(result);

        ds.filter({
            logic: 'and',
            filters: [
                { field: 'IsEnabled', operator: 'eq', value: true },
                { field: 'CalDueDate', operator: 'gte', value: today },
                { field: 'CalDueDate', operator: 'lte', value: endDate }
            ]
        });
    }

    function generateToolReportPrintout(data) {
        var h = '<html><head><title>Aerospace Tools Report</title><style>';
        h += 'body{font-family:Arial,sans-serif;font-size:7pt;margin:8px;line-height:1.2;color:#000}';
        h += 'table{border-collapse:collapse;width:100%;print-color-adjust:exact;-webkit-print-color-adjust:exact}';
        h += 'th{background:#000;color:#fff;padding:2px 4px;text-align:left;font-size:7pt;font-weight:bold;border:1px solid #000;print-color-adjust:exact;-webkit-print-color-adjust:exact}';
        h += 'td{padding:2px 4px;border:1px solid #000;vertical-align:top;font-size:7pt;color:#000;min-height:28px;height:28px}';
        h += 'tr:nth-child(even) td{background:#eee}';
        h += '.col-tool{width:60px;min-width:60px}';
        h += '.col-alt{width:80px;min-width:80px}';
        h += '.col-serial{width:75px;min-width:75px}';
        h += '.col-desc{min-width:200px}';
        h += '.col-cal{width:80px;min-width:80px}';
        h += '.col-notes{width:140px;min-width:140px}';
        h += 'h2{font-size:10pt;margin:0 0 4px 0;font-weight:bold}';
        h += 'p{font-size:6pt;margin:0 0 6px 0}';
        h += '@media print{button{display:none}}';
        h += '</style></head><body>';
        h += '<h2>Aerospace Tools - Calibration Due Within 45 Days</h2>';
        h += '<p>Generated: ' + new Date().toLocaleDateString() + ' | In-Service items due by: ' + new Date(Date.now() + 45 * 86400000).toLocaleDateString() + ' | Items: ' + data.length + '</p>';
        h += '<table><thead><tr>';
        h += '<th class="col-tool">LQ Tool #</th><th class="col-alt">Alt Tool #</th><th class="col-serial">Serial #</th><th class="col-desc">Description</th><th class="col-cal">Cal Due</th><th class="col-notes">Notes</th>';
        h += '</tr></thead><tbody>';

        data.forEach(function (r) {
            var calDate = r.CalDueDate ? new Date(r.CalDueDate) : null;
            var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            var calStr = calDate ? String(calDate.getDate()).padStart(2, '0') + '-' + months[calDate.getMonth()] + '-' + calDate.getFullYear() : '';
            var desc = (r.Description || '').replace(/\n/g, ' ');

            h += '<tr>';
            h += '<td class="col-tool">' + (r.ToolNumber || '') + '</td>';
            h += '<td class="col-alt">' + (r.AltToolNumber || '') + '</td>';
            h += '<td class="col-serial">' + (r.SerialNumber || '') + '</td>';
            h += '<td class="col-desc">' + desc + '</td>';
            h += '<td class="col-cal">' + calStr + '</td>';
            h += '<td class="col-notes"></td>';
            h += '</tr>';
        });

        h += '</tbody></table></body></html>';

        var w = window.open('', '_blank', 'width=1000,height=700');
        w.document.write(h);
        w.document.close();
        setTimeout(function () { w.print(); }, 500);
    }

    // ==================== BULK EDIT ====================

    function enterEditMode() {
        if (isEditing) {
            saveInlineEdits();
            return;
        }
        var toolIds = Object.keys(selectedTools);
        if (toolIds.length === 0) return;

        isEditing = true;
        updateBulkEditButton();

        var g = grid();
        g.tbody.find('tr').each(function () {
            var row = $(this);
            var uid = row.attr('data-uid');
            var dataItem = g.dataSource.getByUid(uid);
            if (!dataItem || !selectedTools[dataItem.Id]) return;

            var descCell = row.find('td:nth-child(5)');
            if (!descCell.length) return;
            var currentText = (dataItem.Description || '').replace(/<br\s*\/?>/gi, '\n');
            var ta = document.createElement('textarea');
            ta.className = 'inline-desc-edit';
            ta.style.cssText = 'width:100%;min-height:28px;font-size:12px;padding:2px;border:2px solid #8e44ad;border-radius:3px;box-sizing:border-box;resize:vertical;overflow:hidden;';
            ta.value = currentText;

            function autoResize() {
                ta.style.height = 'auto';
                ta.style.height = ta.scrollHeight + 'px';
            }
            ta.addEventListener('input', autoResize);
            descCell.empty().append(ta);
            autoResize();
        });
    }

    function saveInlineEdits() {
        var toolIds = Object.keys(selectedTools);
        if (toolIds.length === 0) return;

        var g = grid();
        var token = document.querySelector('input[name="__RequestVerificationToken"]').value;
        var total = 0;
        var completed = 0;
        var errors = 0;

        g.tbody.find('tr').each(function () {
            var row = $(this);
            var uid = row.attr('data-uid');
            var dataItem = g.dataSource.getByUid(uid);
            if (!dataItem || !selectedTools[dataItem.Id]) return;

            var descCell = row.find('td:nth-child(5)');
            var ta = descCell.find('textarea');
            if (!ta.length) return;

            total++;
            var newDesc = ta.val();
            var id = dataItem.Id;

            var formData = new URLSearchParams();
            formData.append('Tool.Id', id);
            formData.append('Tool.ToolNumber', dataItem.ToolNumber || '');
            formData.append('Tool.AltToolNumber', dataItem.AltToolNumber || '');
            formData.append('Tool.SerialNumber', dataItem.SerialNumber || '');
            formData.append('Tool.Manufacturer', dataItem.Manufacturer || '');
            formData.append('Tool.Location', dataItem.Location || '');
            formData.append('Tool.Description', newDesc);
            if (dataItem.CalDueDate) {
                formData.append('Tool.CalDueDate', new Date(dataItem.CalDueDate).toISOString().split('T')[0]);
            } else {
                formData.append('Tool.CalDueDate', '');
            }
            formData.append('Tool.IsEnabled', dataItem.IsEnabled ? 'true' : 'false');
            formData.append('__RequestVerificationToken', token);

            fetch('/Catalog/AeroTools/EditAeroTool', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: formData.toString()
            })
            .then(function (response) {
                if (!response.ok) errors++;
            })
            .catch(function () { errors++; })
            .finally(function () {
                completed++;
                if (completed === total) {
                    isEditing = false;
                    updateBulkEditButton();
                    grid().dataSource.read();
                }
            });
        });

        if (total === 0) {
            isEditing = false;
            updateBulkEditButton();
        }
    }

    // ==================== EDIT PAGE ====================

    function initEditPage() {
        injectPrintLabelButton();
        injectPrintCalFormButton();
        var ta = document.getElementById('Tool_Description');
        if (ta) {
            ta.style.height = 'auto';
            ta.style.height = ta.scrollHeight + 'px';
            ta.addEventListener('input', function () {
                this.style.height = 'auto';
                this.style.height = this.scrollHeight + 'px';
            });
        }
    }

    function injectPrintLabelButton() {
        if (document.getElementById('print-label-btn')) return;
        var saveBtn = document.querySelector('button[type="submit"].btn-success')
                   || document.querySelector('button.btn-success')
                   || document.querySelector('input[type="submit"].btn-success');
        if (!saveBtn) return;

        var labelBtn = document.createElement('button');
        labelBtn.type = 'button';
        labelBtn.id = 'print-label-btn';
        labelBtn.className = 'btn btn-info';
        labelBtn.style.cssText = 'margin-left:8px;';
        labelBtn.innerHTML = '<span class="glyphicon glyphicon-print" aria-hidden="true"></span> Print Label';
        labelBtn.addEventListener('click', printLabel);

        saveBtn.parentNode.insertBefore(labelBtn, saveBtn.nextSibling);
    }

    function injectPrintCalFormButton() {
        if (document.getElementById('print-calform-btn')) return;
        var saveBtn = document.querySelector('button[type="submit"].btn-success')
                   || document.querySelector('button.btn-success')
                   || document.querySelector('input[type="submit"].btn-success');
        if (!saveBtn) return;

        var calBtn = document.createElement('button');
        calBtn.type = 'button';
        calBtn.id = 'print-calform-btn';
        calBtn.className = 'btn btn-warning';
        calBtn.style.cssText = 'margin-left:8px;';
        calBtn.innerHTML = '<span class="glyphicon glyphicon-print" aria-hidden="true"></span> Print Shop Cal Form';
        calBtn.addEventListener('click', printCalForm);

        var labelBtn = document.getElementById('print-label-btn');
        if (labelBtn) {
            labelBtn.parentNode.insertBefore(calBtn, labelBtn.nextSibling);
        } else {
            saveBtn.parentNode.insertBefore(calBtn, saveBtn.nextSibling);
        }
    }

    function printCalForm() {
        var toolNumber = document.getElementById('Tool_ToolNumber').value || '';
        var altToolNumber = document.getElementById('Tool_AltToolNumber').value || '';
        var serialNumber = document.getElementById('Tool_SerialNumber').value || '';
        var manufacturer = document.getElementById('Tool_Manufacturer').value || '';
        var description = document.getElementById('Tool_Description').value || '';
        var calDueDate = document.getElementById('Tool_CalDueDate').value || '';

        var catMatch = description.match(/Category[:\s]+([^\n]+)/i);
        var category = catMatch ? catMatch[1].trim() : '';

        var locMatch = description.match(/Location[:\s]+([^\n]+)/i);
        var location = locMatch ? locMatch[1].trim() : '';

        var firstLine = description.split('\n')[0] || '';

        var h = '<html><head><title>Shop Cal Form</title><style>';
        h += '@page { size: letter; margin: 5mm; }';
        h += 'body { font-family: Arial, sans-serif; font-size: 8pt; margin: 0; padding: 5mm; }';
        h += '.title { text-align: center; font-family: "Times New Roman", Times, serif; font-size: 17pt; font-weight: bold; margin: 0 0 2px 0; height: 0.80cm; display: flex; align-items: center; justify-content: center; }';
        h += '.outer { border: 2px solid #000; padding: 1px; }';
        h += 'table { width: 100%; border-collapse: collapse; }';
        h += 'td { border: 1px solid #000; padding: 2px 4px; font-size: 8pt; vertical-align: middle; height: 20px; box-sizing: border-box; }';
        h += 'label { white-space: nowrap; font-weight: bold; font-size: 6.3pt; }';
        h += '.val { font-size: 8pt; }';
        h += '.data-header td { text-align: center; font-weight: bold; font-size: 8pt; border-top: 2px solid #000; height: 22px; }';
        h += '.data-grid td { height: 0.64cm; }';
        h += '.data-grid:last-child td { height: 0.69cm; }';
        h += '.as-found td:nth-child(n+4) { border-left: none !important; border-right: none !important; }';
        h += '.as-found td:nth-child(4) { border-left: 1px solid #000 !important; }';
        h += '.as-found td:last-child { border-right: 1px solid #000 !important; }';
        h += '.footer { position: relative; margin-top: 2px; padding: 0 2px; font-size: 7pt; height: 22px; }';
        h += '.footer-left { position: absolute; left: 50%; transform: translateX(-50%); }';
        h += '.footer-right { position: absolute; right: 0; top: 0; text-align: center; line-height: 1.2; }';
        h += '@media print { body { padding: 4mm; } }';
        h += '</style></head><body>';
        h += '<div class="title">Shop Cal Form</div>';

        h += '<div class="outer">';

        var COLS = '<col style="width:11.85%"><col style="width:8.46%"><col style="width:11.85%"><col style="width:15.36%"><col style="width:8.46%"><col style="width:11.85%"><col style="width:11.85%"><col style="width:8.46%"><col style="width:11.85%">';

        h += '<table style="width:100%;">';
        h += COLS;

        h += '<tr>';
        h += '<td><label>TOOL NUMBER:</label></td><td colspan="2"><span class="val">' + toolNumber + '</span></td>';
        h += '<td><label>DATE:</label></td><td colspan="2"></td>';
        h += '<td><label>TIME:</label></td><td colspan="2"></td>';
        h += '</tr>';

        h += '<tr>';
        h += '<td><label>DESCRIPTION:</label></td><td colspan="2"><span class="val">' + firstLine + '</span></td>';
        h += '<td><label>TECH:</label></td><td colspan="2"></td>';
        h += '<td><label>WORK LEVEL:</label></td><td colspan="2"></td>';
        h += '</tr>';

        h += '<tr>';
        h += '<td><label>PART NUMBER:</label></td><td colspan="2"><span class="val">' + altToolNumber + '</span></td>';
        h += '<td><label>CALIBRATION TOOL:</label></td><td colspan="2"></td>';
        h += '<td><label>MIN CAL RATIO:</label></td><td colspan="2"></td>';
        h += '</tr>';

        h += '<tr>';
        h += '<td><label>SERIAL NUMBER:</label></td><td colspan="2"><span class="val">' + serialNumber + '</span></td>';
        h += '<td><label>CAL PROCEDURE:</label></td><td colspan="5"></td>';
        h += '</tr>';

        h += '<tr class="as-found">';
        h += '<td><label>MANUFACTURE:</label></td><td colspan="2"><span class="val">' + manufacturer + '</span></td>';
        h += '<td><label>AS FOUND:</label></td>';
        h += '<td style="text-align:center;border-right:none !important;">IN CAL</td>';
        h += '<td style="text-align:center;border-left:none !important;border-right:none !important;">&lt;1TB</td>';
        h += '<td style="text-align:center;border-left:none !important;border-right:none !important;">&gt;1&lt;2TB</td>';
        h += '<td style="text-align:center;border-left:none !important;border-right:none !important;">&gt;2&lt;4TB</td>';
        h += '<td style="text-align:center;border-left:none !important;">&gt;4T</td>';
        h += '</tr>';

        h += '<tr>';
        h += '<td><label>CATAGORY:</label></td><td colspan="2"><span class="val">' + category + '</span></td>';
        h += '<td><label>TOOL DUE CALC:</label></td><td colspan="5"></td>';
        h += '</tr>';

        h += '<tr>';
        h += '<td><label>LOCATION:</label></td><td colspan="2"><span class="val">' + location + '</span></td>';
        h += '<td><label>SCAN FILE NAME:</label></td><td colspan="5"></td>';
        h += '</tr>';

        h += '</table>';

        h += '<table style="width:100%; margin-top:8px;">';
        h += '<col style="width:11.11%"><col style="width:11.11%"><col style="width:11.11%"><col style="width:11.11%"><col style="width:11.11%"><col style="width:11.11%"><col style="width:11.11%"><col style="width:11.11%"><col style="width:11.11%">';

        h += '<tr class="data-header"><td colspan="9">CALIBRATION DATA</td></tr>';
        for (var i = 0; i < 30; i++) {
            h += '<tr class="data-grid"><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>';
        }

        h += '</table>';
        h += '</div>';

        h += '<div style="height:6px;"></div>';

        h += '<div class="footer">';
        h += '<span class="footer-left">Form 26 Page 1 of 1</span>';
        h += '<div class="footer-right">March 2026<br>Rev3</div>';
        h += '</div>';
        h += '</body></html>';

        var w = window.open('', '_blank', 'width=900,height=800');
        w.document.write(h);
        w.document.close();
        setTimeout(function () { w.print(); }, 500);
    }

    function printLabel() {
        var toolNumber = document.getElementById('Tool_ToolNumber').value || '';
        var altToolNumber = document.getElementById('Tool_AltToolNumber').value || '';
        var serialNumber = document.getElementById('Tool_SerialNumber').value || '';
        var description = document.getElementById('Tool_Description').value || '';
        var calDueDate = document.getElementById('Tool_CalDueDate').value || '';

        var ownerMatch = description.match(/(?:Owner|COWNER)[:\s]+([^\n]+)/i);
        var owner = ownerMatch ? ownerMatch[1].trim() : '';

        var locMatch = description.match(/Location[:\s]+([^\n]+)/i);
        var location = locMatch ? locMatch[1].trim() : '';

        var catMatch = description.match(/Category[:\s]+(\w+)/i);
        var category = catMatch ? catMatch[1].trim().toUpperCase() : '';
        var catLetter = '';
        if (category === 'SECONDARY') catLetter = 'S';
        else if (category === 'PRIMARY') catLetter = 'P';

        var formattedDate = '';
        if (calDueDate) {
            var parts = calDueDate.split(/[-/]/);
            var d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            formattedDate = String(d.getDate()).padStart(2, '0') + '/' + months[d.getMonth()] + '/' + d.getFullYear();
        }

        var firstLine = description.split('\n')[0] || '';

        var html = '<html><head><title>Print Label</title><style>';
        html += '@page { size: 57mm 32mm; margin: 1mm; }';
        html += 'body { margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; }';
        html += '.label { width: 55mm; height: 30mm; border: 2px solid #000; box-sizing: border-box; padding: 1mm 1.5mm; }';
        html += '.header { border-bottom: 2px solid #000; padding-bottom: 0.5mm; margin-bottom: 0.5mm; display: flex; justify-content: space-between; align-items: baseline; }';
        html += '.header-title { font-size: 11px; font-weight: bold; }';
        html += '.header-number { font-size: 13px; font-weight: bold; }';
        html += '.body { display: flex; height: calc(100% - 6mm); }';
        html += '.data { flex: 1; padding-right: 1mm; }';
        html += '.cal-due { font-size: 9px; }';
        html += '.cal-date { font-size: 11px; font-weight: bold; }';
        html += '.detail { font-size: 9px; line-height: 1.3; }';
        html += '.detail-row { display: flex; gap: 4mm; }';
        html += '.detail-label { font-weight: normal; }';
        html += '.detail-value { font-weight: bold; }';
        html += '.desc { font-size: 9px; font-weight: bold; text-align: left; margin-top: 0mm; }';
        html += '.owner { font-size: 9px; margin-top: auto; }';
        html += '.owner-label { font-weight: normal; }';
        html += '.owner-value { font-weight: bold; }';
        html += '.right { display: flex; }';
        html += '.cat-badge { display: flex; align-items: center; justify-content: center; width: 6mm; min-width: 6mm; height: 6mm; border: 2px solid #000; font-size: 12px; font-weight: bold; }';
        html += '.stamp-area { width: 12mm; min-width: 12mm; flex: 1; border: 2px solid #000; }';
        html += '@media print { body { margin: 0; } }';
        html += '</style></head><body>';
        html += '<div class="label">';
        html += '<div class="header">';
        html += '<span class="header-title">BRISTOW TOOL #</span>';
        html += '<span class="header-number">' + toolNumber + '</span>';
        html += '</div>';
        html += '<div class="body">';
        html += '<div class="data">';
        html += '<div class="cal-due"><span class="detail-label">Calibration Due:</span></div>';
        html += '<div class="cal-date">' + formattedDate + '</div>';
        if (altToolNumber) {
            html += '<div class="detail"><span class="detail-label">P/N: </span><span class="detail-value">' + altToolNumber + '</span></div>';
        }
        if (serialNumber) {
            html += '<div class="detail"><span class="detail-label">S/N: </span><span class="detail-value">' + serialNumber + '</span></div>';
        }
        if (location) {
            html += '<div class="detail"><span class="detail-label">LOC: </span><span class="detail-value">' + location + '</span></div>';
        }
        if (firstLine) {
            html += '<div class="desc">' + firstLine + '</div>';
        }
        html += '<div class="owner"><span class="owner-label">OWNER: </span><span class="owner-value">' + (owner || 'N/A') + '</span></div>';
        html += '</div>';
        html += '<div class="right">';
        if (catLetter) {
            html += '<div class="cat-badge">' + catLetter + '</div>';
        }
        html += '<div class="stamp-area"></div>';
        html += '</div>';
        html += '</div>';
        html += '</div>';
        html += '</body></html>';

        var w = window.open('', '_blank', 'width=800,height=600');
        w.document.write(html);
        w.document.close();
        setTimeout(function () { w.print(); }, 500);
    }

    // ==================== INIT ====================

    function tryInit() {
        if (window.$ && isEditPage && !document.getElementById('print-label-btn')) {
            injectPrintLabelButton();
        }
        if (window.$ && !isEditPage && grid()) {
            initListPage();
            return true;
        }
        return false;
    }

    function startInit() {
        if (isEditPage) {
            initEditPage();
            var t = 0;
            var id = setInterval(function () {
                t++;
                if (!document.getElementById('print-label-btn')) {
                    injectPrintLabelButton();
                }
                if (document.getElementById('print-label-btn') || t > 80) clearInterval(id);
            }, 500);
        } else {
            var t2 = 0;
            var id2 = setInterval(function () {
                t2++;
                if (tryInit() || t2 > 40) clearInterval(id2);
            }, 250);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startInit);
    } else {
        startInit();
    }
})();
