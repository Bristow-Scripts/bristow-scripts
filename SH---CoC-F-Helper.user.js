// ==UserScript==
// @name         SH - CoC-F Helper
// @namespace    https://bristow-scripts.github.io/bristow-scripts
// @version      3.1
// @description  Report guards for shipping: CoC auto-fills/stamps dates; CoC/Sub CoC/Form 1 grayed by Work Performed & Cost Center (dropdown); CoC & Form 1 blocked until a manual is Selected and not expired; Form 1 adds CARs 571 remarks with Unit Certified to prompt, Bell Helicopters REV, blocks on Part No./Description mismatch and missing manual Revision Info.
// @match        https://bristow-app.azurewebsites.net/*
// @noframes
// @grant        none
// @updateURL    https://bristow-scripts.github.io/bristow-scripts/SH---CoC-F-Helper.meta.js
// @downloadURL  https://bristow-scripts.github.io/bristow-scripts/SH---CoC-F-Helper.user.js
// @require      https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Shared-Core.user.js
// @tag          SH
// ==/UserScript==

(function () {
    'use strict';
    var TS = window.TechShared || null;

    if (location.pathname.startsWith('/ReportGenerator')) return;
    if (location.search.includes('handler=ViewAeroFile')) return;
    var isOrderPage = location.pathname.startsWith('/Orders/Orders/Edit');
    var isJobsPage = location.pathname.startsWith('/Orders/Jobs/Edit');
    if (!isOrderPage && !isJobsPage) return;

    var DISABLED_CLASS = 'shp-coc-disabled';

    // ── Reports under watch ──
    // flow: 'coc'    = date-stamping flow on click
    //       'form1'  = CARs 571 remark rules + Bell Helicopters REV check
    //                  + block until the Selected manual's Revision Info is filled
    //       'normal' = opens normally when not blocked
    var REPORTS = [
        {
            href: 'ReportName=Optional_Report4',
            title: 'Certificate of Calibration',
            flow: 'coc',
            grayCostCenters: ['AAC', 'GYR', 'ELC', 'CAP'],
            noWorkMessage: 'Work Performed is BLANK / Unserviceable - No CoC Required',
            blankCostCenterMessage: 'Cost Center - Blank - No CoC Required',
            costCenterMessage: 'Cost Center is not eligible - No CoC Required'
        },
        {
            href: 'ReportName=Optional_Report3',
            title: 'Sub Contract CoC',
            flow: 'normal',
            grayCostCenters: ['AAC', 'GYR', 'ELC', 'CAP'],
            noWorkMessage: 'Work Performed is BLANK / Unserviceable - No Sub CoC Required',
            blankCostCenterMessage: 'Cost Center - Blank - No Sub CoC Required',
            costCenterMessage: 'Cost Center is not eligible - No Sub CoC Required'
        },
        {
            href: 'ReportName=Optional_Report5',
            title: 'Form 1',
            flow: 'form1',
            grayCostCenters: ['GAC', 'PTE'],
            noWorkMessage: 'Work Performed is BLANK / Unserviceable - No Form 1 Required',
            blankCostCenterMessage: 'Cost Center - Blank - No Form 1 Required',
            costCenterMessage: 'Cost Center is not eligible - No Form 1 Required'
        }
    ];

    var reportMeta = {}; // href -> { el: <a> }
    REPORTS.forEach(function (r) { reportMeta[r.href] = { el: null }; });

    var CoC = {
        workPerformedTextEl: null,
        calDateInput: null,
        dueDateInput: null,
        userCalInput: null,
        cdnHeliRow: null,
        cdnHeliInput: null,
        partNumberCheck: { componentId: null, altPartNum: null, mismatch: false, pending: false },
        partNumberFetchGen: 0,
        pendingForm1Click: null
    };

    // ── Are the Calibration/Due date inputs actually writable? ──
    function fieldsAreEditable() {
        return !!CoC.calDateInput && !CoC.calDateInput.disabled &&
               !!CoC.dueDateInput && !CoC.dueDateInput.disabled;
    }

    // ── Button finding: prefer visible, but always fall back to any match ──
    function getEditInfoButton() {
        var all = document.querySelectorAll('button[onclick*="refreshOrderHeader"], input[onclick*="refreshOrderHeader"], a[onclick*="refreshOrderHeader"]');
        for (var i = 0; i < all.length; i++) {
            if (all[i].offsetParent !== null) return all[i];
        }
        if (all.length) return all[0];
        var bs = document.querySelectorAll('button, input[type="button"], a');
        for (var k = 0; k < bs.length; k++) {
            if ((bs[k].textContent || bs[k].value || '').trim() === 'Edit Info') return bs[k];
        }
        return null;
    }

    function getSaveButton() {
        var all = document.querySelectorAll('button[onclick*="saveOrderHeader"], button[onclick*="saveLines"]');
        for (var i = 0; i < all.length; i++) {
            if (all[i].offsetParent !== null) return all[i];
        }
        if (all.length) return all[0];
        var sb = document.querySelectorAll('button.btn-success');
        for (var j = 0; j < sb.length; j++) {
            if (sb[j].offsetParent !== null) return sb[j];
        }
        if (sb.length) return sb[0];
        return null;
    }

    // ── Field discovery ──
    function rowText(el) {
        return el.textContent.replace(/[\t\n\r\s]+/g, ' ').trim();
    }

    function findRowByLabel(labelText) {
        var labels = document.querySelectorAll('label.control-label');
        for (var i = 0; i < labels.length; i++) {
            var t = rowText(labels[i]);
            if (t === labelText || t.indexOf(labelText) === 0) {
                var r = labels[i].closest('tr');
                if (r) return r;
            }
        }
        var ths = document.querySelectorAll('th');
        for (var j = 0; j < ths.length; j++) {
            var t2 = rowText(ths[j]);
            if (t2 === labelText || t2.indexOf(labelText) === 0) {
                var r2 = ths[j].closest('tr');
                if (r2) return r2;
            }
        }
        return null;
    }

    function findDateInput(row) {
        if (!row) return null;
        return row.querySelector('input[data-role="datepicker"]') || row.querySelector('input[id$="__Date"]');
    }

    function refreshTargets() {
        REPORTS.forEach(function (r) {
            reportMeta[r.href].el = document.querySelector('a[href*="' + r.href + '"]');
        });
        var wpRow = findRowByLabel('Work Performed');
        CoC.workPerformedTextEl = wpRow
            ? (wpRow.querySelector('.k-input-value-text') || wpRow.querySelector('input[id$="__OptionId"]'))
            : null;
        CoC.calDateInput = findDateInput(findRowByLabel('Calibration Date'));
        CoC.dueDateInput = findDateInput(findRowByLabel('Due Date'));
        CoC.userCalInput = findDateInput(findRowByLabel('User Cal. Due Date'));
        CoC.cdnHeliRow = findRowByLabel('CDN Heli Cal. Due Date');
        CoC.cdnHeliInput = CoC.cdnHeliRow
            ? CoC.cdnHeliRow.querySelector('input[data-role], input.form-control, input[type="text"]')
            : null;
        refreshPartNumberCheck();
        setupCostCenterDropdown();
    }

    // ── Cost Center dropdown ──
    // The app renders Cost Center as a free-text input. Replace it with a select
    // of the valid codes (kept synced to the hidden input so saving still works).
    var COST_CENTERS = ['AAC', 'GYR', 'ELC', 'CAP', 'GAC', 'PTE'];

    function setupCostCenterDropdown() {
        var input = document.getElementById('AerospaceHead_CostCenter');
        if (!input) return;
        if (!input._shpSelect) {
            var sel = document.createElement('select');
            sel.className = 'form-control';
            sel.id = 'shp-cost-center-select';
            var cur = (input.value || '').trim().toUpperCase();
            var options = ['']; // blank option is the default
            if (cur && COST_CENTERS.indexOf(cur) === -1) options.push(cur);
            for (var i = 0; i < COST_CENTERS.length; i++) options.push(COST_CENTERS[i]);
            for (var j = 0; j < options.length; j++) {
                var opt = document.createElement('option');
                opt.value = options[j];
                opt.textContent = options[j] || 'Select Cost Center';
                sel.appendChild(opt);
            }
            sel.value = cur || '';
            // Keep the hidden input in sync so the app actually saves the visible
            // selection (default included) without the user having to click it.
            input.value = sel.value;
            sel.addEventListener('change', function () {
                input.value = sel.value;
                try { $(input).trigger('change'); } catch (e) {}
                try { input.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
                applyButtonState();
            });
            input._shpSelect = sel;
            input.style.display = 'none';
            input.parentNode.insertBefore(sel, input);
        } else {
            var s = input._shpSelect;
            var cv = (input.value || '').trim().toUpperCase();
            if (cv && s.value !== cv) s.value = cv;
            else if (!cv && s.value) input.value = s.value; // restore visible selection if app cleared it
            s.disabled = !!input.disabled || input.readOnly;
        }
    }

    // ── Date helpers ──
    function formatDate(d) {
        var m = d.getMonth() + 1, day = d.getDate();
        return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
    }

    function parseDate(str) {
        var parts = String(str).split('-');
        if (parts.length !== 3) return null;
        var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        return isNaN(d.getTime()) ? null : d;
    }

    function addYears(date, years) {
        var d = new Date(date);
        d.setFullYear(d.getFullYear() + years);
        return d;
    }

    function setKendoDate(input, dateOrString) {
        if (!input) return;
        var kd = null;
        try { kd = $(input).data('kendoDatePicker'); } catch (e) {}
        var val = dateOrString instanceof Date ? formatDate(dateOrString) : String(dateOrString);
        if (kd) {
            var d = dateOrString instanceof Date ? dateOrString : parseDate(dateOrString);
            if (d) kd.value(d); else kd.value(val);
        }
        input.value = val;
        try { $(input).trigger('change'); } catch (e) {}
    }

    // ── Field reads ──
    function getWorkPerformedText() {
        var el = CoC.workPerformedTextEl;
        if (!el) return null;
        return (el.textContent || el.value || '').trim();
    }

    function isWorkPerformedInvalid() {
        var t = getWorkPerformedText();
        if (t === null) return false;
        return t === '' || /unserviceable/i.test(t);
    }

    function getCostCenterValue() {
        var row = findRowByLabel('Cost Center');
        if (!row) return '';
        var input = row.querySelector('input[id*="CostCenter"], input.form-control, input[type="text"]');
        if (input) {
            var v = (input.value || '').trim();
            if (v) return v;
        }
        var s = row.querySelector('td > span:not(.text-danger):not(.field-validation-valid)');
        if (s) return (s.textContent || '').trim();
        return '';
    }

    function costCenterHasAny(keywords) {
        var up = getCostCenterValue().toUpperCase().replace(/\s+/g, ' ');
        if (!up) return false;
        var re = new RegExp('\\b(?:' + keywords.join('|') + ')\\b');
        return re.test(up);
    }

    function getComponentText() {
        var row = findRowByLabel('Component');
        if (!row) return '';
        var vt = row.querySelector('.k-input-value-text');
        if (vt) { var t = (vt.textContent || '').trim(); if (t) return t; }
        var s = row.querySelector('td > span:not(.text-danger):not(.field-validation-valid)');
        if (s) { var t2 = (s.textContent || '').trim(); if (t2) return t2; }
        var inp = row.querySelector('input.text-box, input.form-control');
        if (inp) { var t3 = (inp.value || '').trim(); if (t3) return t3; }
        return '';
    }

    function componentHasAny(keywords) {
        var up = getComponentText().toUpperCase();
        if (!up) return false;
        return keywords.some(function (k) { return up.indexOf(String(k).toUpperCase()) !== -1; });
    }

    // ── Part No. / Description mismatch check (Form 1 blocks 7 & 8) ──
    // Whole-token match: Part No. must appear as its own token (surrounded by
    // non-alphanumerics or string edges) — "S18" must NOT match "S1840510-02".
    function partNumberMatch(desc, partNum) {
        if (!desc || !partNum) return false;
        var p = String(partNum).toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp('(^|[^A-Z0-9])' + p + '($|[^A-Z0-9])').test(desc.toUpperCase());
    }

    function setForm1ButtonGray(mismatch) {
        var m = reportMeta['ReportName=Optional_Report5'];
        if (!m || !m.el) return;
        if (mismatch) m.el.classList.add(DISABLED_CLASS);
        else m.el.classList.remove(DISABLED_CLASS);
        syncButtonOverlays();
    }

    function getComponentId() {
        var el = document.getElementById('AerospaceHead_ComponentId');
        return el ? (el.value || '').trim() : '';
    }

    // ── Authoritative Alt Part No. lookup ──
    // The #partGrid (Parts Preloader cache) and /handler=Parts JSON endpoint are
    // unreliable (stale after edits / filter ignored, returns wrong row). The
    // catalog part edit page is keyed by the component GUID and always returns
    // the current DB value. Fetched once per component per page load, then
    // cached in memory so re-checks are instant.
    var partNumberCache = {}; // componentId -> altPartNum (string or null)

    function fetchAltPartNumberAuthoritative(componentId, callback) {
        var t1 = performance.now();
        fetch('/Catalog/Parts/PartList/Edit?id=' + encodeURIComponent(componentId), { credentials: 'same-origin' })
            .then(function (resp) { return resp.text(); })
            .then(function (html) {
                var elapsed = Math.round(performance.now() - t1);
                var doc = new DOMParser().parseFromString(html, 'text/html');
                var input = doc.getElementById('EditPartModel_Part_AltPartNum');
                var alt = input ? (input.value || '').trim() : null;
                console.log('[CoC] Part edit page: ' + elapsed + 'ms — AltPartNumber="' + (alt || '') + '"');
                callback(alt);
            })
            .catch(function (e) {
                console.log('[CoC] Part edit page: ' + Math.round(performance.now() - t1) + 'ms — error: ' + e.message);
                callback(null);
            });
    }

    function resolvePartNumber(id, gen, altPartNum) {
        if (CoC.partNumberFetchGen !== gen) return;
        if (partNumberCache.hasOwnProperty(id)) partNumberCache[id] = altPartNum;
        CoC.partNumberCheck.pending = false;
        CoC.partNumberCheck.altPartNum = altPartNum;
        var desc = getComponentText();
        CoC.partNumberCheck.mismatch = !!(altPartNum && !partNumberMatch(desc, altPartNum));
        setForm1ButtonGray(CoC.partNumberCheck.mismatch);
        continuePendingForm1Click();
    }

    // If the user clicked Form 1 while the check was in-flight, re-run the click
    // flow now that we have the answer (block on mismatch, else open normally).
    function continuePendingForm1Click() {
        var link = CoC.pendingForm1Click;
        CoC.pendingForm1Click = null;
        if (!link) return;
        var reason = getBlockReason(REPORTS[2]);
        if (reason) {
            applyButtonState();
            showMessagePopup(reason, REPORTS[2].title);
            return;
        }
        handleForm1Flow(link);
    }

    function refreshPartNumberCheck() {
        var id = getComponentId();
        if (!id) {
            if (CoC.partNumberCheck.componentId !== null) {
                CoC.partNumberCheck = { componentId: null, altPartNum: null, mismatch: false, pending: false };
            }
            return;
        }
        // Single-flight: same component already resolving or resolved — never re-fetch.
        if (CoC.partNumberCheck.componentId === id) return;

        CoC.partNumberCheck.componentId = id;
        CoC.partNumberCheck.pending = true;
        CoC.partNumberCheck.mismatch = false; // don't gray the button while checking
        var gen = ++CoC.partNumberFetchGen;

        if (partNumberCache.hasOwnProperty(id)) {
            resolvePartNumber(id, gen, partNumberCache[id]);
            return;
        }
        fetchAltPartNumberAuthoritative(id, function (altPartNum) {
            resolvePartNumber(id, gen, altPartNum);
        });
    }

    function getSpecialRemarks() {
        var ta = document.getElementById('OrderHead_CustomFields_14__Text');
        if (ta) return (ta.value || '').trim();
        var row = findRowByLabel('Special Release Remarks');
        if (row) {
            var s = row.querySelector('td > span:not(.text-danger):not(.field-validation-valid)');
            if (s) return (s.textContent || '').trim();
        }
        return '';
    }

    function remarksHas(sub) {
        return getSpecialRemarks().toUpperCase().indexOf(String(sub).toUpperCase()) !== -1;
    }

    function getCustomerName() {
        var ca = document.getElementById('customerCompanyName');
        if (ca) { var t = (ca.textContent || '').trim(); if (t) return t; }
        var ci = document.getElementById('OrderHead_CustomerId');
        if (ci) {
            var pk = ci.closest('.k-picker');
            if (pk) {
                var vt = pk.querySelector('.k-input-value-text');
                if (vt && (vt.textContent || '').trim()) return vt.textContent.trim();
            }
        }
        return '';
    }

    function getCalibrationDateValue() {
        return CoC.calDateInput ? (CoC.calDateInput.value || '').trim() : '';
    }

    function getDueDateValue() {
        return CoC.dueDateInput ? (CoC.dueDateInput.value || '').trim() : '';
    }

    function getUserCalValue() {
        return CoC.userCalInput ? (CoC.userCalInput.value || '').trim() : '';
    }

    function getCdnHeliValue() {
        if (CoC.cdnHeliInput) {
            var v = (CoC.cdnHeliInput.value || '').trim();
            if (v) return v;
        }
        if (CoC.cdnHeliRow) {
            var s = CoC.cdnHeliRow.querySelector('td > span:not(.text-danger):not(.field-validation-valid)');
            if (s) return (s.textContent || '').trim();
        }
        return '';
    }

    // ── Tool expiry check ──
    function computeToday() {
        var d = new Date();
        d.setHours(0, 0, 0, 0);
        return d;
    }

    function parseToolDate(str) {
        var s = String(str).trim();
        var m;
        if (m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)) {
            var d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
            return isNaN(d.getTime()) ? null : d;
        }
        var months = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
        if (m = /^(\d{1,2})-(\d{1,2}|\w{3})-(\d{4})$/.exec(s)) {
            var mo = /^\d+$/.test(m[2]) ? parseInt(m[2], 10) - 1 : months[m[2].toUpperCase()];
            if (mo === undefined || mo < 0 || mo > 11) return null;
            var d2 = new Date(parseInt(m[3], 10), mo, parseInt(m[1], 10));
            return isNaN(d2.getTime()) ? null : d2;
        }
        return null;
    }

    // "17-Aug-2026" -> Date; null when not parseable (for the fill popup).
    function parseDdMonYyyy(str) {
        var m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(String(str || '').trim());
        if (!m) return null;
        var months = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
        var mo = months[m[2].toUpperCase()];
        if (mo === undefined) return null;
        var d = new Date(parseInt(m[3], 10), mo, parseInt(m[1], 10));
        return isNaN(d.getTime()) ? null : d;
    }

    function getExpiredTools() {
        var expired = [];
        var grid = document.getElementById('orderAeroToolsGrid');
        if (!grid) return expired;

        var ths = grid.querySelectorAll('thead th');
        var colMap = {};
        for (var i = 0; i < ths.length; i++) {
            var f = ths[i].getAttribute('data-field');
            var ci = parseInt(ths[i].getAttribute('aria-colindex'), 10);
            if (f && ci) colMap[f] = ci;
        }
        var calIdx = colMap['CalDueDate'];
        var toolIdx = colMap['ToolNumber'];
        var descIdx = colMap['Description'];
        if (!calIdx) return expired;

        var today = computeToday();
        var rows = grid.querySelectorAll('tbody tr');
        for (var r = 0; r < rows.length; r++) {
            var byCol = {};
            var cells = rows[r].querySelectorAll('td[role="gridcell"]');
            for (var c = 0; c < cells.length; c++) {
                var ci2 = parseInt(cells[c].getAttribute('aria-colindex'), 10);
                if (ci2) byCol[ci2] = cells[c];
            }
            var dateCell = byCol[calIdx];
            if (!dateCell) continue;
            var dateSpan = dateCell.querySelector('span');
            var dateText = (dateSpan ? dateSpan.textContent : dateCell.textContent || '').trim();
            var dueDate = parseToolDate(dateText);
            var isExpiredFlagged = !!(dateSpan && dateSpan.classList.contains('text-danger'));
            if (!dueDate) continue;
            if (!isExpiredFlagged && dueDate >= today) continue;
            var tCell = byCol[toolIdx];
            var dCell = byCol[descIdx];
            expired.push({
                toolNumber: tCell ? tCell.textContent.trim() : '',
                description: dCell ? dCell.textContent.trim() : '',
                calDueDate: dateText
            });
        }
        return expired;
    }

    // ── Blocking rules ──
    function getBlockReason(rep) {
        if (isWorkPerformedInvalid()) return rep.noWorkMessage;
        var cc = getCostCenterValue();
        if (!cc) return rep.blankCostCenterMessage;
        if (rep.grayCostCenters && costCenterHasAny(rep.grayCostCenters)) return rep.costCenterMessage;
        if (rep.flow === 'coc' || rep.flow === 'form1') {
            if (manualGate.pending) return 'Checking selected manual, please wait...';
            if (manualGate.noSelection) return manualGate.message;
            if (manualGate.expired) return manualGate.message;
        }
        if (rep.flow === 'form1' && CoC.partNumberCheck.pending) {
            return 'Checking Part No. against Description, please wait...';
        }
        if (rep.flow === 'form1' && CoC.partNumberCheck.mismatch) {
            return 'Part No. (' + CoC.partNumberCheck.altPartNum + ') was not found in the Description (' +
                getComponentText() + '). Check the Component selection before generating Form 1.';
        }
        if (rep.flow === 'form1' && manualGate.catalogDown) {
            return manualGate.message;
        }
        if (rep.flow === 'form1' && manualGate.notFound) {
            return manualGate.message;
        }
        if (rep.flow === 'form1' && manualGate.missingRev) {
            return manualGate.message;
        }
        var expired = getExpiredTools();
        if (expired.length) {
            return 'Expired Tool(s):\n' + expired.map(function (t) {
                return 'Tool ' + t.toolNumber + '  ' + t.description + ' Expired on ' + t.calDueDate;
            }).join('\n');
        }
        return null;
    }

    // Cal + Due both filled, plus at least one of User Cal / CDN Heli.
    function requiredFieldsFilled() {
        return !!getCalibrationDateValue() && !!getDueDateValue() &&
               (!!getUserCalValue() || !!getCdnHeliValue());
    }

    function stampCalibrationDates() {
        var today = new Date();
        setKendoDate(CoC.calDateInput, today);
        setKendoDate(CoC.dueDateInput, addYears(today, 1));
    }

    function setUserCal(str) {
        if (!CoC.userCalInput) return;
        setKendoDate(CoC.userCalInput, str);
    }

    function setCdnHeli(str) {
        if (!CoC.cdnHeliInput) return;
        CoC.cdnHeliInput.value = str;
        try { $(CoC.cdnHeliInput).trigger('change'); } catch (e) {}
    }

    // ── Button graying ──
    function applyButtonState() {
        REPORTS.forEach(function (r) {
            var m = reportMeta[r.href];
            if (!m || !m.el) return;
            if (getBlockReason(r)) m.el.classList.add(DISABLED_CLASS);
            else m.el.classList.remove(DISABLED_CLASS);
        });
        syncButtonOverlays();
    }

    // ── Disabled-button overlays ──
    // A transparent layer sits on top of each grayed button so clicks hit the
    // layer, never the <a> itself. This blocks other scripts that intercept
    // PrintPDF clicks (e.g. QZ Tray direct print) no matter the event phase or
    // script load order, because those handlers match a[href*="PrintPDF"] and
    // the overlay is a sibling div, not inside the link.
    function removeOverlay(m) {
        if (m && m.overlay) { m.overlay.remove(); m.overlay = null; }
    }

    function positionOverlay(m) {
        if (!m.overlay || !m.el) return;
        var r = m.el.getBoundingClientRect();
        var o = m.overlay;
        o.style.left = r.left + 'px';
        o.style.top = r.top + 'px';
        o.style.width = r.width + 'px';
        o.style.height = r.height + 'px';
        o.style.display = (r.width > 0 && r.height > 0) ? 'block' : 'none';
    }

    function ensureOverlay(m, rep) {
        if (m.overlay) { positionOverlay(m); return; }
        var o = document.createElement('div');
        o.className = 'shp-coc-btn-overlay';
        o.title = rep.title + ' - blocked';
        o.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopImmediatePropagation();
            var reason = getBlockReason(rep);
            if (reason) showMessagePopup(reason, rep.title);
        });
        m.overlay = o;
        document.body.appendChild(o);
        positionOverlay(m);
    }

    function syncButtonOverlays() {
        REPORTS.forEach(function (r) {
            var m = reportMeta[r.href];
            if (!m || !m.el) { removeOverlay(m); return; }
            if (m.el.classList.contains(DISABLED_CLASS)) ensureOverlay(m, r);
            else removeOverlay(m);
        });
    }

    var _overlayRaf = null;
    function repositionOverlays() {
        if (_overlayRaf) return;
        _overlayRaf = requestAnimationFrame(function () {
            _overlayRaf = null;
            REPORTS.forEach(function (r) {
                var m = reportMeta[r.href];
                if (m && m.overlay) positionOverlay(m);
            });
        });
    }
    window.addEventListener('resize', repositionOverlays);
    document.addEventListener('scroll', repositionOverlays, true);

    // ── Popups ──
    function closePopup() {
        var o = document.getElementById('shp-coc-overlay');
        if (o) o.remove();
    }

    function addActionButton(box, label, cls, onClick) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn-sm ' + cls;
        b.textContent = label;
        b.style.marginLeft = '6px';
        b.onclick = onClick;
        return b;
    }

    function makePopup(title) {
        closePopup();
        var overlay = document.createElement('div');
        overlay.id = 'shp-coc-overlay';
        var box = document.createElement('div');
        box.id = 'shp-coc-box';
        var h = document.createElement('h4');
        h.textContent = title || 'Notice';
        var actions = document.createElement('div');
        actions.className = 'shp-actions';
        box.appendChild(h);
        box.appendChild(actions);
        overlay.appendChild(box);
        overlay.addEventListener('click', function (e) { if (e.target === overlay) closePopup(); });
        document.body.appendChild(overlay);
        return { box: box, actions: actions };
    }

    function showMessagePopup(message, title) {
        var p = makePopup(title);
        var msg = document.createElement('p');
        msg.className = 'shp-msg';
        msg.textContent = message;
        p.actions.appendChild(addActionButton(p.box, 'OK', 'btn-primary', closePopup));
        p.box.insertBefore(msg, p.actions);
    }

    function showFillPopup(link, onDone) {
        var p = makePopup('Certificate of Calibration');
        var msg = document.createElement('p');
        msg.className = 'shp-msg';
        msg.textContent = 'Calibration Date and Due Date have been stamped. Please fill in User Cal. Due Date OR CDN Heli Cal. Due Date to proceed.';

        var ucLabel = document.createElement('label');
        ucLabel.textContent = 'User Cal. Due Date';
        var ucInput = document.createElement('input');
        ucInput.type = 'text';
        ucInput.id = 'shp-uc-input';
        ucLabel.htmlFor = ucInput.id;

        var chLabel = document.createElement('label');
        chLabel.textContent = 'CDN Heli Cal. Due Date';
        var chInput = document.createElement('input');
        chInput.type = 'text';
        chInput.id = 'shp-ch-input';
        chInput.placeholder = 'CH#';
        chLabel.htmlFor = chInput.id;

        var error = document.createElement('div');
        error.className = 'shp-error';
        error.textContent = 'Please fill in at least one of the two due date fields.';

        p.box.insertBefore(msg, p.actions);
        p.box.insertBefore(ucLabel, p.actions);
        p.box.insertBefore(ucInput, p.actions);
        p.box.insertBefore(chLabel, p.actions);
        p.box.insertBefore(chInput, p.actions);
        p.box.insertBefore(error, p.actions);

        // Render User Cal as a Kendo datepicker (dd-MMM-yyyy) matching the app's
        // own field, with a plain-text fallback if Kendo isn't available.
        var ucKd = null;
        try {
            ucKd = $(ucInput).kendoDatePicker({
                format: 'dd-MMM-yyyy',
                parseFormats: ['dd-MMM-yyyy', 'dd-MM-yyyy', 'yyyy-MM-dd']
            }).data('kendoDatePicker');
        } catch (e) { ucKd = null; }
        if (!ucKd) ucInput.placeholder = 'e.g. 17-Aug-2026';
        else ucInput.style.width = '200px';

        p.actions.appendChild(addActionButton(p.box, 'Cancel', 'btn-default', closePopup));
        p.actions.appendChild(addActionButton(p.box, 'Proceed', 'btn-primary', function () {
            var uc = ucInput.value.trim();
            var ch = chInput.value.trim();
            if (!uc && !ch) { error.style.display = 'block'; return; }
            error.style.display = 'none';
            if (uc) {
                var d = null;
                if (ucKd && typeof ucKd.value === 'function') {
                    var v = ucKd.value();
                    if (v instanceof Date && !isNaN(v.getTime())) d = v;
                }
                if (!d) d = parseDdMonYyyy(uc);
                setUserCal(d ? formatDate(d) : uc);
            }
            if (ch) setCdnHeli(ch);
            closePopup();
            onDone();
        }));
        ucInput.focus();
    }

    function showForm1RevPopup(onOk, onSkip) {
        var p = makePopup('Form 1');
        var msg = document.createElement('p');
        msg.className = 'shp-msg';
        msg.textContent = 'BELL HELICOPTERS TEXTRON - No REV ?';

        var lab = document.createElement('label');
        lab.textContent = 'REV';
        var inp = document.createElement('input');
        inp.type = 'text';
        inp.id = 'shp-rev-input';
        inp.placeholder = 'e.g. 3 or 3A';
        lab.htmlFor = inp.id;

        p.box.insertBefore(msg, p.actions);
        p.box.insertBefore(lab, p.actions);
        p.box.insertBefore(inp, p.actions);

        p.actions.appendChild(addActionButton(p.box, 'Skip', 'btn-default', function () {
            closePopup();
            onSkip();
        }));
        p.actions.appendChild(addActionButton(p.box, 'OK', 'btn-primary', function () {
            var v = inp.value.trim();
            closePopup();
            onOk(v ? 'REV ' + v : null);
        }));
        inp.focus();
    }

    function showForm1CertPopup(onOk) {
        var p = makePopup('Form 1');
        var lab = document.createElement('label');
        lab.textContent = 'Unit Certified to:';
        var inp = document.createElement('input');
        inp.type = 'text';
        inp.id = 'shp-cert-input';
        inp.placeholder = 'e.g. 571 to 20000 ft.';
        lab.htmlFor = inp.id;
        p.box.insertBefore(lab, p.actions);
        p.box.insertBefore(inp, p.actions);
        p.actions.appendChild(addActionButton(p.box, 'Cancel', 'btn-default', function () {
            closePopup();
            onOk('');
        }));
        p.actions.appendChild(addActionButton(p.box, 'OK', 'btn-primary', function () {
            var v = inp.value.trim();
            closePopup();
            onOk(v);
        }));
        inp.focus();
    }

    function openReport(link) {
        var href = link && link.getAttribute('href');
        if (href) window.open(href, '_blank');
    }

    // ── Edit-mode helpers ──
    function enterEditMode(callback) {
        refreshTargets();
        if (fieldsAreEditable()) {
            setTimeout(callback, 250);
            return;
        }
        var btn = getEditInfoButton();
        if (!btn) {
            showMessagePopup('Could not find the Edit Info button. Switch to Edit mode manually and try again.', 'Notice');
            return;
        }
        btn.click();
        var tries = 0;
        var timer = setInterval(function () {
            tries++;
            refreshTargets();
            if (fieldsAreEditable()) {
                clearInterval(timer);
                setTimeout(callback, 300);
                return;
            }
            if (tries >= 80) {
                clearInterval(timer);
                showMessagePopup('Could not enter Edit mode. Switch to Edit mode manually and try again.', 'Notice');
            }
        }, 150);
    }

    function saveThenOpen(link) {
        var btn = getSaveButton();
        if (!btn) { openReport(link); return; }
        btn.click();
        var tries = 0;
        var timer = setInterval(function () {
            tries++;
            refreshTargets();
            if (!fieldsAreEditable()) {
                clearInterval(timer);
                openReport(link);
                return;
            }
            if (tries >= 40) {
                clearInterval(timer);
                openReport(link);
            }
        }, 300);
    }

    // ── CoC flow ──
    function doCoCFlow(link) {
        refreshTargets();
        stampCalibrationDates();
        if (getUserCalValue() || getCdnHeliValue()) {
            saveThenOpen(link);
            return;
        }
        showFillPopup(link, function () { saveThenOpen(link); });
    }

    // ── Form 1 flow: CARs 571 remarks + Bell Helicopters REV ──
    var form1CertNeeded = false; // set when a statement needing "Unit Certified to" will be added

    function computeSpecialRemarkLines() {
        var lines = [];
        form1CertNeeded = false;
        // If the base "Work done IAW CARs 571" remark is missing, the specific
        // statements below are almost certainly missing too - one check covers it.
        var missingCars = !remarksHas('Work done IAW CARs 571');
        if (costCenterHasAny(['CAP'])) {
            // Encoder / reporting component
            if (componentHasAny(['encod', 'report']) && missingCars) {
                lines.push('Work done IAW CARs 571 Appendix B and F');
                form1CertNeeded = true;
            }
            // Plain Altimeter (excluded for Radio/Encoding altimeters: contains RAD or ENCOD)
            var comp = getComponentText().toUpperCase();
            if (/ALTIMETER/.test(comp) && !/RAD/.test(comp) && !/ENCOD/.test(comp) && !/REPORT/.test(comp) &&
                missingCars) {
                lines.push('Work Done IAW CARs 571 Appendix B');
                form1CertNeeded = true;
            }
        }
        // Emergency Locator Transmitter (any cost center)
        if (componentHasAny(['emergency locator transmitter']) && missingCars) {
            lines.push('Work Done IAW CARs 571 Appendix G');
        }
        return lines;
    }

    function appendSpecialRemarks(lines) {
        var ta = document.getElementById('OrderHead_CustomFields_14__Text');
        if (!ta) return false;
        var cur = (ta.value || '').trim();
        var missing = lines.filter(function (l) {
            return cur.toUpperCase().indexOf(String(l).toUpperCase()) === -1;
        });
        if (!missing.length) return false;
        ta.value = cur ? cur + '\n' + missing.join('\n') : missing.join('\n');
        try { $(ta).trigger('change'); } catch (e) {}
        return true;
    }

    function applySpecialRemarksAndOpen(link, lines) {
        var missing = lines.filter(function (l) { return !remarksHas(l); });
        if (!missing.length) { openReport(link); return; }
        enterEditMode(function () {
            var changed = appendSpecialRemarks(missing);
            if (changed) saveThenOpen(link);
            else openReport(link);
        });
    }

    function applyForm1WithRemarks(link, lines) {
        var isBell = /BELL HELICOPTERS TEXTRON/i.test(getCustomerName());
        var needsRev = isBell && !/\brev\b/i.test(getSpecialRemarks());
        if (needsRev) {
            showForm1RevPopup(
                function (revLine) {
                    applySpecialRemarksAndOpen(link, revLine ? lines.concat(revLine) : lines);
                },
                function () {
                    applySpecialRemarksAndOpen(link, lines);
                }
            );
            return;
        }
        applySpecialRemarksAndOpen(link, lines);
    }

    function handleForm1Flow(link) {
        refreshTargets();
        var lines = computeSpecialRemarkLines();
        if (form1CertNeeded) {
            showForm1CertPopup(function (cert) {
                var finalLines = lines;
                if (cert) {
                    finalLines = lines.map(function (l) {
                        if (/Work done IAW CARs 571 Appendix B(?: and F)?/i.test(l)) {
                            return l + ' - Unit Certified to: ' + cert;
                        }
                        return l;
                    });
                }
                applyForm1WithRemarks(link, finalLines);
            });
            return;
        }
        applyForm1WithRemarks(link, lines);
    }

    // ── Click routing ──
    function handleReportClick(e, rep, link) {
        refreshTargets();
        if (rep.flow === 'form1' && CoC.partNumberCheck.pending) {
            e.preventDefault();
            showMessagePopup('Checking Part No. against Description, please wait...', rep.title);
            CoC.pendingForm1Click = link;
            return;
        }
        var reason = getBlockReason(rep);
        if (reason) {
            e.preventDefault();
            applyButtonState();
            showMessagePopup(reason, rep.title);
            return;
        }
        if (rep.flow === 'coc') {
            if (requiredFieldsFilled()) return; // all dates present - open normally
            e.preventDefault();
            enterEditMode(function () { doCoCFlow(link); });
        } else if (rep.flow === 'form1') {
            e.preventDefault();
            handleForm1Flow(link);
        }
        // 'normal' flow: let the link open normally
    }

    document.addEventListener('click', function (e) {
        var el = e.target;
        if (!el || !el.closest) return;
        REPORTS.forEach(function (r) {
            var link = el.closest('a[href*="' + r.href + '"]');
            if (link) handleReportClick(e, r, link);
        });
    });

    // ── Documentation Revision Info check ──
    // Revision Info is only on /Catalog/Documentations/EditDocumentation?id=<docId>
    // (#Documentation_RevisionInfo). Fetched once per doc id, then cached in memory.
    var docRevisionCache = {};            // docId -> revisionInfo string ('' = blank)
    var docRevisionPending = {};          // docId -> [callbacks] while fetching

    function fetchDocRevisionInfo(docId, callback) {
        if (docRevisionCache.hasOwnProperty(docId)) { callback(docRevisionCache[docId]); return; }
        if (docRevisionPending[docId]) { docRevisionPending[docId].push(callback); return; }
        docRevisionPending[docId] = [callback];
        var tokenEl = document.querySelector('input[name="__RequestVerificationToken"]');
        var token = tokenEl ? tokenEl.value : '';
        fetch('/Catalog/Documentations/EditDocumentation?id=' + encodeURIComponent(docId), {
            credentials: 'same-origin',
            headers: token ? { 'RequestVerificationToken': token } : {}
        })
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.text();
            })
            .then(function (html) {
                var doc = new DOMParser().parseFromString(html, 'text/html');
                var inp = doc.getElementById('Documentation_RevisionInfo');
                var rev = inp ? (inp.value || '').trim() : '';
                docRevisionCache[docId] = rev;
                console.log('[CoC] Doc edit page: OK — RevisionInfo="' + rev + '"');
                (docRevisionPending[docId] || []).forEach(function (cb) { cb(rev); });
                docRevisionPending[docId] = null;
            })
            .catch(function (e) {
                console.log('[CoC] Doc edit page error: ' + e.message);
                docRevisionCache[docId] = '';
                (docRevisionPending[docId] || []).forEach(function (cb) { cb(''); });
                docRevisionPending[docId] = null;
            });
    }

    // ── File → Documentation mapping ──
    // ViewAeroFile links carry the AeroFile id (e.g. 738a20f8...), which is NOT
    // the Documentation id (bf7f6ca3...). The catalog dump maps documentation
    // Name -> Id, and the file name is "<Name>.pdf", so we strip the extension
    // to look up the doc. The dump is fetched once per page and cached in memory.
    var catalogByName = {};      // upper Name -> [catalog records] (may be several)
    var catalogLoaded = false;
    var catalogLoading = false;
    var catalogPendingCbs = [];

    var DOC_TYPES = { 'MISC': 0, 'MANUAL': 1, 'AD': 2, 'CRN': 3, 'AQP': 4, 'AML': 5 };
    var DOC_STATUS = {
        'ACTIVE': 0, 'NEEDS REVIEW': 1, 'INACTIVE': 2, 'CAIRS': 3, 'TIME SENSITIVE': 4,
        'MANUFACTURER UNSUPPORTED': 5, 'OEM CONTROLLED (XXXX)': 6, 'REVISION SERVICE (XXX)': 7,
        'OEM CONTROLLED (KFC)': 8, 'REVISION SERVICE (ECMM)': 9, 'REVISION SERVICE (P&W)': 10,
        'OEM CONTROLLED (SERV-AERO)': 11, 'TOOL ONLY': 12, 'REVISION SERVICE (SIGMA-TEK)': 13,
        'REVISION SERVICE (SAFT)': 14, 'REVISION SERVICE (KOLLSMAN)': 15, 'NO CAPABILITY': 16,
        'REFERENCE ONLY': 17, 'NO ADDITIONAL INFORMATION': 18, 'AS NEEDED': 19, 'CAC LIBRARY': 20
    };

    function getToken() {
        var el = document.querySelector('input[name="__RequestVerificationToken"]');
        return el ? el.value : '';
    }

    function loadCatalog(callback) {
        if (catalogLoaded) { callback && callback(); return; }
        catalogPendingCbs.push(callback);
        if (catalogLoading) return;
        catalogLoading = true;
        var token = getToken();
        fetch('/Catalog/Documentations?handler=Documentations&wRelated=false&__RequestVerificationToken=' + encodeURIComponent(token), {
            credentials: 'same-origin',
            headers: token ? { 'RequestVerificationToken': token } : {}
        })
            .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .then(function (d) {
                var arr = Array.isArray(d) ? d : (d.Data || d.items || d.rows || []);
                for (var i = 0; i < arr.length; i++) {
                    var nm = String(arr[i].Name || '').trim().toUpperCase();
                    if (!nm) continue;
                    if (!catalogByName[nm]) catalogByName[nm] = [];
                    catalogByName[nm].push(arr[i]);
                }
                console.log('[CoC] Documentation catalog: ' + arr.length + ' records loaded');
                catalogOk = true;
                catalogLoaded = true;
            })
            .catch(function (e) {
                console.log('[CoC] Documentation catalog error: ' + e.message);
            })
            .then(function () {
                catalogLoading = false;
                var cbs = catalogPendingCbs;
                catalogPendingCbs = [];
                cbs.forEach(function (cb) { cb && cb(); });
            });
    }

    // Manuals are identified by a number: 1-4 digits, with no letters/spaces/special
    // chars in it. Files may carry extra text around the number (e.g. the file is
    // "3742_Rev1.pdf" but the catalog Name is "3742"), so we pull the first 1-4
    // digit group out of the file name and look that up - falling back to the
    // exact base name, then the base name minus a revision suffix ("_Rev1"...).
    function docRecordsForFile(fileName) {
        var base = String(fileName || '').replace(/\.(?:pdf|docx?|xlsx?|txt|csv)$/i, '').trim();
        var names = [];

        var numMatch = /(?:^|[^0-9])([0-9]{1,4})(?:[^0-9]|$)/.exec(base);
        if (numMatch) {
            var num = numMatch[1];
            names.push(num);
            var noLeadZeros = String(parseInt(num, 10));
            if (noLeadZeros !== num) names.push(noLeadZeros);
        }

        names.push(base);
        var stripped = base
            .replace(/[_-]\s*rev\s*\d+$/i, '')
            .replace(/\s+rev\s+\d+$/i, '')
            .replace(/[_-]\s*r\d+$/i, '');
        if (stripped && stripped !== base) names.push(stripped);

        var seen = {};
        var out = [];
        for (var i = 0; i < names.length; i++) {
            var key = names[i].toUpperCase();
            if (!key || !catalogByName[key]) continue;
            for (var j = 0; j < catalogByName[key].length; j++) {
                var id = catalogByName[key][j].Id;
                if (id && seen[id]) continue;
                if (id) seen[id] = true;
                out.push(catalogByName[key][j]);
            }
        }
        return out;
    }

    // Read the file's grid row details (Location, DocType text, DocStatus text)
    // so we can pick the right catalog record when several share a Name.
    function rowHints(link) {
        var hints = { location: '', docTypeText: '', docStatusText: '' };
        var row = link.closest('tr');
        if (!row) return hints;
        var cells = row.querySelectorAll('td[role="gridcell"]');
        for (var i = 0; i < cells.length; i++) {
            var ci = parseInt(cells[i].getAttribute('aria-colindex'), 10);
            if (!ci) continue;
            var txt = cells[i].textContent.replace(/[\t\n\r\s]+/g, ' ').trim();
            if (ci === 5) hints.docTypeText = txt;       // Manual / AD / ...
            else if (ci === 6) hints.location = txt;     // J06 / ...
            else if (ci === 9) hints.docStatusText = txt; // As Needed / ...
        }
        return hints;
    }

    // Score a catalog record against the file's row hints; higher = better match.
    function recordScore(rec, hints) {
        var score = 0;
        if (hints.location &&
            String(rec.Location || '').trim().toUpperCase() === hints.location.toUpperCase()) score += 3;
        if (hints.docTypeText) {
            var dt = DOC_TYPES[hints.docTypeText.toUpperCase()];
            if (dt !== undefined && Number(rec.DocType) === dt) score += 2;
        }
        if (hints.docStatusText) {
            var ds = DOC_STATUS[hints.docStatusText.toUpperCase()];
            if (ds !== undefined && Number(rec.DocStatus) === ds) score += 1;
        }
        return score;
    }

    // Pick the best catalog record for a file; fall back to the first candidate.
    function pickDocRecord(fileName, hints) {
        var recs = docRecordsForFile(fileName);
        if (!recs.length) return null;
        if (recs.length === 1) return recs[0];
        var best = recs[0], bestScore = -1;
        for (var i = 0; i < recs.length; i++) {
            var s = recordScore(recs[i], hints);
            if (s > bestScore) { bestScore = s; best = recs[i]; }
        }
        return best;
    }

    // ── Selected-manual gate (CoC + Form 1) ──
    // If the manuals grid is present, CoC and Form 1 are blocked until a manual
    // is Selected. Once one is Selected: an expired expiration date blocks both,
    // and a blank Revision Info (or missing catalog record) blocks Form 1 only.
    // The expiration check is skipped when the expiration date cell is blank.
    var catalogOk = false; // true once the catalog dump parsed successfully
    var manualGate = {
        gridPresent: false,
        hasSelection: false,
        selectedName: '',   // file name of the resolved selection
        pending: false,
        resolved: false,
        noSelection: false, // grid present but nothing Selected
        notFound: false,    // Selected manual not in the catalog
        missingRev: false,  // Selected manual's Revision Info is blank
        catalogDown: false, // catalog failed to load - rev info unverifiable
        expired: false,     // Selected manual is past its expiration date
        expiredDate: '',
        retryTimer: null,
        message: ''
    };

    // The Selected row of #aeroDocsGrid carries a "Selected" button; return the
    // doc link + name for that row (null when no manual is selected yet).
    function getSelectedDocInfo() {
        var grid = document.getElementById('aeroDocsGrid');
        if (!grid) return null;
        var rows = grid.querySelectorAll('tbody tr');
        for (var i = 0; i < rows.length; i++) {
            if (!rows[i].querySelector('button[title="Selected"]')) continue;
            var link = rows[i].querySelector('a[href*="handler=ViewAeroFile"]');
            if (!link) continue;
            return { name: (link.textContent || '').trim(), link: link };
        }
        return null;
    }

    // Expiration Date is the 11th grid column (e.g. "01-JAN-2043"; blank when none).
    function rowExpiration(link) {
        var row = link.closest('tr');
        if (!row) return '';
        var cells = row.querySelectorAll('td[role="gridcell"]');
        for (var i = 0; i < cells.length; i++) {
            var ci = parseInt(cells[i].getAttribute('aria-colindex'), 10);
            if (ci === 11) return cells[i].textContent.replace(/[\t\n\r\s]+/g, ' ').trim();
        }
        return '';
    }

    function resetManualGate() {
        manualGate.gridPresent = false;
        manualGate.hasSelection = false;
        manualGate.selectedName = '';
        manualGate.pending = false;
        manualGate.resolved = false;
        manualGate.noSelection = false;
        manualGate.notFound = false;
        manualGate.missingRev = false;
        manualGate.catalogDown = false;
        manualGate.expired = false;
        manualGate.expiredDate = '';
        clearManualRetry();
        manualGate.message = '';
    }

    function clearManualRetry() {
        if (manualGate.retryTimer) {
            clearTimeout(manualGate.retryTimer);
            manualGate.retryTimer = null;
        }
    }

    function scheduleCatalogRetry() {
        if (manualGate.retryTimer) return;
        manualGate.retryTimer = setTimeout(function () {
            manualGate.retryTimer = null;
            manualGate.resolved = false;
            refreshManualGate();
        }, 5000);
    }

    function refreshManualGate() {
        var grid = document.getElementById('aeroDocsGrid');
        if (!grid) { resetManualGate(); return; }
        manualGate.gridPresent = true;

        var info = getSelectedDocInfo();
        if (!info) {
            manualGate.hasSelection = false;
            manualGate.selectedName = '';
            manualGate.pending = false;
            manualGate.resolved = true;
            manualGate.noSelection = true;
            manualGate.notFound = false;
            manualGate.missingRev = false;
            manualGate.catalogDown = false;
            manualGate.expired = false;
            manualGate.expiredDate = '';
            clearManualRetry();
            manualGate.message = 'No manual selected. Select a manual in the Documentation grid before generating a CoC or Form 1. This check clears automatically once one is selected.';
            applyButtonState();
            return;
        }

        manualGate.hasSelection = true;
        manualGate.noSelection = false;
        if (manualGate.selectedName === info.name && (manualGate.resolved || manualGate.pending)) return;

        manualGate.selectedName = info.name;
        manualGate.pending = true;
        manualGate.resolved = false;
        manualGate.notFound = false;
        manualGate.missingRev = false;
        manualGate.catalogDown = false;
        manualGate.expired = false;
        manualGate.expiredDate = '';
        clearManualRetry();
        manualGate.message = '';

        // Expired check (skipped when the expiration date is blank)
        var expText = rowExpiration(info.link);
        var expDate = parseToolDate(expText);
        if (expDate && expDate < computeToday()) {
            manualGate.expired = true;
            manualGate.expiredDate = expText;
            manualGate.resolved = true;
            manualGate.pending = false;
            manualGate.message = 'Selected manual "' + info.name + '" is expired (' + expText + '). Select a current manual before generating a CoC or Form 1.';
            applyButtonState();
            return;
        }

        loadCatalog(function () {
            if (!catalogOk) {
                // Catalog unavailable - the rev check can't be verified, so
                // block Form 1 (a blank Revision field means no shipment) and
                // retry the catalog periodically in case the outage is brief.
                manualGate.resolved = true;
                manualGate.pending = false;
                manualGate.catalogDown = true;
                manualGate.message = 'Could not verify the Revision Info for selected manual "' + info.name + '" (Documentation catalog unavailable). Form 1 is blocked until this check can be verified.';
                applyButtonState();
                scheduleCatalogRetry();
                return;
            }
            var rec = pickDocRecord(info.name, rowHints(info.link));
            if (!rec) {
                manualGate.resolved = true;
                manualGate.pending = false;
                manualGate.notFound = true;
                manualGate.message = 'Could not find documentation for "' + info.name + '" in the catalog. Verify the Revision Info is filled in before generating Form 1.';
                applyButtonState();
                return;
            }
            fetchDocRevisionInfo(rec.Id, function (rev) {
                manualGate.resolved = true;
                manualGate.pending = false;
                manualGate.missingRev = !rev;
                manualGate.message = 'REV information missing for "' + info.name + '". Update the Revision Info in the Documentations catalog before generating Form 1.';
                applyButtonState();
            });
        });
    }

    // The app swaps the manuals grid via AJAX when Select/Selected is clicked,
    // which the observer may not always catch. Re-evaluate the gate right after
    // such a click (a few retries to outlast the round-trip). The dedup in
    // refreshManualGate makes repeat runs free once the selection is resolved.
    document.addEventListener('click', function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        if (!t.closest('button[onclick*="selectDocument"], a[onclick*="selectDocument"]')) return;
        [400, 900, 1500].forEach(function (ms) {
            setTimeout(function () { refreshManualGate(); }, ms);
        });
    });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closePopup();
    });

    // ── Styles ──
    function injectStyles() {
        if (document.getElementById('shp-coc-style')) return;
        var s = document.createElement('style');
        s.id = 'shp-coc-style';
        s.textContent = [
            'a.' + DISABLED_CLASS + ' { opacity: .5 !important; filter: grayscale(100%); color: #333 !important; background-color: #eee !important; border-color: #aaa !important; pointer-events: auto !important; cursor: not-allowed !important; }',
            '.shp-coc-btn-overlay { position: fixed; z-index: 1200; cursor: not-allowed; border-radius: 4px; }',
            '#shp-coc-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 20000; display: flex; align-items: flex-start; justify-content: center; padding-top: 12vh; }',
            '#shp-coc-box { background: #fff; border-radius: 6px; width: 440px; max-width: 92vw; box-shadow: 0 6px 24px rgba(0,0,0,.35); padding: 18px 20px; font-family: inherit; color: #222; box-sizing: border-box; }',
            '#shp-coc-box h4 { margin: 0 0 10px; }',
            '#shp-coc-box .shp-msg { margin-bottom: 14px; font-size: 13px; white-space: pre-line; }',
            '#shp-coc-box label { display: block; font-weight: 700; font-size: 12px; margin: 8px 0 4px; }',
            '#shp-coc-box input { width: 100%; box-sizing: border-box; padding: 5px 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 13px; }',
            '#shp-coc-box .shp-actions { margin-top: 16px; text-align: right; }',
            '#shp-coc-box .shp-error { color: #c0392b; font-size: 12px; margin-top: 8px; display: none; }'
        ].join('\n');
        document.head.appendChild(s);
    }

    // ── Observer ──
    var _runningUpdates = false;
    function runAllUpdates() {
        if (_runningUpdates) return;
        _runningUpdates = true;
        refreshTargets();
        applyButtonState();
        refreshManualGate();
        _runningUpdates = false;
    }

    if (TS) {
        TS.observer.register(runAllUpdates, { debounce: 300 });
    } else {
        var mutationTimer = null;
        var isTyping = false;
        var singleObserver = new MutationObserver(function () {
            if (isTyping) return;
            clearTimeout(mutationTimer);
            mutationTimer = setTimeout(runAllUpdates, 300);
        });
        document.addEventListener('focusin', function (e) {
            if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') isTyping = true;
        });
        document.addEventListener('focusout', function (e) {
            if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') {
                isTyping = false;
                clearTimeout(mutationTimer);
                mutationTimer = setTimeout(runAllUpdates, 100);
            }
        });
        singleObserver.observe(document.body, { childList: true, subtree: true });
    }

    // ── Init ──
    injectStyles();
    runAllUpdates();
    window.addEventListener('load', runAllUpdates);
    setTimeout(runAllUpdates, 500);
})();
