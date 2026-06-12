// ==UserScript==
// @name         TECH - Auto Add Labor + Tech Time Panel
// @namespace    http://tampermonkey.net/
// @version      7.6
// @updateURL    https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Auto-Add-Labor-Tech-Time-Panel.user.js
// @downloadURL  https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Auto-Add-Labor-Tech-Time-Panel.user.js
// @description  Checks for and adds the labor line and processes it, added panel that will add automatically add time tech hourly line.
// @match        https://bristow-app.azurewebsites.net/Orders/Orders/Edit*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    if (!window.location.href.includes('/Orders/Orders/Edit')) return;

    // =========================================================================
    // SHARED UTILITIES
    // =========================================================================

    var SERVICE_ID = '834f33a0-2baf-4b64-6727-08ddb592746f';

    function log(msg)  { console.log('[Tech] ' + msg); }
    function warn(msg) { console.warn('[Tech] ' + msg); }

    function poll(label, conditionFn, onFound, timeoutMs, intervalMs) {
        timeoutMs  = timeoutMs  || 15000;
        intervalMs = intervalMs || 300;
        var elapsed = 0;
        var tid = setInterval(function () {
            var result = conditionFn();
            if (result) {
                clearInterval(tid);
                onFound(result);
                return;
            }
            elapsed += intervalMs;
            if (elapsed >= timeoutMs) {
                clearInterval(tid);
                warn('Timed out: ' + label);
            }
        }, intervalMs);
        return function () { clearInterval(tid); };
    }

    function getCsrfToken() {
        var el = document.querySelector('input[name="__RequestVerificationToken"]')
               || document.querySelector('meta[name="RequestVerificationToken"]');
        return el ? (el.value || el.getAttribute('content')) : null;
    }

    function getOrderId() {
        return new URLSearchParams(window.location.search).get('id');
    }

    // =========================================================================
    // ORDER COMPLETION CHECK
    // =========================================================================

    function isOrderComplete() {
        var rows = document.querySelectorAll('table.lq-table-info th');
        for (var i = 0; i < rows.length; i++) {
            if (rows[i].textContent.trim() === 'Order Status') {
                var td = rows[i].nextElementSibling;
                if (td && td.textContent.trim() === 'Complete') return true;
            }
        }
        return false;
    }

    // =========================================================================
    // PART 1 — AUTO ADD SERVICE LINE
    // =========================================================================

    window.alert = function (msg) { log('Suppressed alert: ' + msg); };

    function tableHasLines() {
        var table = document.getElementById('order-line-area');
        if (!table) return false;
        return table.innerHTML.indexOf('S-100542') !== -1
            || table.innerHTML.indexOf(SERVICE_ID)  !== -1;
    }

    function findServiceRow() {
        var rows = document.querySelectorAll('#order-line-area tbody tr');
        for (var i = 0; i < rows.length; i++) {
            if (rows[i].innerHTML.indexOf('S-100542') !== -1
             || rows[i].innerHTML.indexOf(SERVICE_ID) !== -1) {
                return rows[i];
            }
        }
        return null;
    }

    function getServiceLineId() {
        var row = findServiceRow();
        if (!row) return null;
        var m = row.id.match(/OrderLine_(.+)/);
        return m ? m[1] : null;
    }

    function setSourceTypeToJob() {
        var lineId = getServiceLineId();
        if (!lineId) return;
        var sourceRow = document.getElementById('OrderLineSourceArea_' + lineId);
        if (!sourceRow) return;
        var select = sourceRow.querySelector('select[id^="OrderLineSourceType_"]');
        if (select && select.value !== '6') {
            select.value = '6';
            try { sourceTypeChanged(select); } catch (e) {}
        }
    }

    function setQuantitiesToOne() {
        var row = findServiceRow();
        if (!row) return;
        var input = row.querySelector('input[id^="OrderLineQuantityMask_"]');
        if (input && (parseFloat(input.value) === 0 || input.value === '')) {
            input.value = '1';
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    function phaseProcess() {
        var lineId = getServiceLineId();
        if (!lineId) return;
        var checkbox = document.getElementById('check_' + lineId);
        if (!checkbox) return;
        checkbox.checked = true;
        try { checkLine(checkbox, lineId); } catch (e) {}

        poll('processSourceLines button', function () {
            var btn = document.getElementById('processSourceLines');
            return (btn && btn.style.display !== 'none') ? btn : null;
        }, function () {
            setTimeout(function () {
                try { processSourceLines(); } catch (e) { warn('processSourceLines: ' + e.message); }
            }, 100);
        }, 10000, 100);
    }

    function phaseSave() {
        poll('saveLines fn', function () {
            return typeof saveLines === 'function' ? true : null;
        }, function () {
            saveLines();
            setTimeout(phaseProcess, 1500);
        });
    }

    function phaseConfigureAndSave() {
        poll('OrderLineSourceType', function () {
            return document.querySelector('select[id^="OrderLineSourceType_"]');
        }, function () {
            setSourceTypeToJob();
            poll('OrderLineQuantityMask', function () {
                return document.querySelector('input[id^="OrderLineQuantityMask_"]');
            }, function () {
                setQuantitiesToOne();
                phaseSave();
            });
        });
    }

    function injectHtml(html) {
        var table = document.getElementById('order-line-area');
        if (!table) return;
        var tbody = table.querySelector('tbody');
        if (!tbody) return;
        var tpl = document.createElement('template');
        tpl.innerHTML = html;
        tpl.content.querySelectorAll('script').forEach(function (s) { s.remove(); });
        tbody.appendChild(tpl.content);
        phaseConfigureAndSave();
    }

    function observeForNewLines() {
        var table = document.getElementById('order-line-area');
        if (!table) return;
        var debounce = null;
        var obs = new MutationObserver(function () {
            clearTimeout(debounce);
            debounce = setTimeout(function () {
                setQuantitiesToOne();
                if (findServiceRow()) {
                    obs.disconnect();
                    log('Part1 observer disconnected.');
                }
            }, 200);
        });
        obs.observe(table, { childList: true, subtree: true });
    }

    function addServiceLine() {
        if (tableHasLines()) { setQuantitiesToOne(); return; }
        var orderId = getOrderId();
        if (!orderId) { warn('No order ID.'); return; }
        fetch('/Orders/Orders/Edit?handler=NewServiceLine'
            + '&orderId='   + encodeURIComponent(orderId)
            + '&serviceId=' + encodeURIComponent(SERVICE_ID)
            + '&quantity=1', {
            method: 'POST',
            headers: {
                'Accept': '*/*',
                'Content-Type': 'application/json; charset=utf-8',
                'X-Requested-With': 'XMLHttpRequest',
                'RequestVerificationToken': getCsrfToken() || ''
            },
            credentials: 'include',
            body: ''
        })
        .then(function (r) { return r.ok ? r.text() : null; })
        .then(function (html) { if (html) injectHtml(html); })
        .catch(function (err) { warn('Fetch error: ' + err); });
    }

    poll('order-line-area', function () {
        return document.getElementById('order-line-area');
    }, function () {
        setTimeout(function () {
            if (isOrderComplete()) {
                log('Order is complete — Part 1 skipped.');
                return;
            }
            addServiceLine();
            observeForNewLines();
        }, 500);
    });

    // =========================================================================
    // PART 2 — TECH TIME ENTRY PANEL
    // =========================================================================

    var _iframe     = null;
    var _techList   = null;
    var _panelReady = false;

    function getIframe() {
        var te = document.querySelector('#collapseTimeExpanded iframe');
        if (te) {
            try {
                if (te.contentDocument && te.contentDocument.querySelector('.k-input-value-text'))
                    return te;
            } catch (e) {}
        }
        return _iframe;
    }

    function getIframeDoc() {
        var f = getIframe();
        if (!f) return null;
        try { return f.contentDocument || f.contentWindow.document; } catch (e) { return null; }
    }

    function getIframeWin() {
        var f = getIframe();
        if (!f) return null;
        try { return f.contentWindow; } catch (e) { return null; }
    }

    function getJobId() {
        var link = document.querySelector("a.monospaced[href*='Orders/Jobs/Edit']");
        if (link) {
            try { return new URL(link.href).searchParams.get('id'); } catch (e) {}
        }
        var f = getIframe();
        if (!f) return null;
        try { return new URL(f.src).searchParams.get('id'); } catch (e) { return null; }
    }

    function getCsrfFromIframe() {
        var iDoc = getIframeDoc();
        if (!iDoc) return null;
        var t = iDoc.querySelector('input[name="__RequestVerificationToken"]');
        return t ? t.value : null;
    }

    function findJobUrl() {
        var link = document.querySelector("a.monospaced[href*='Orders/Jobs/Edit']");
        return link ? link.href : null;
    }

    function waitForJobUrl() {
        return new Promise(function (resolve) {
            var existing = findJobUrl();
            if (existing) return resolve(existing);
            var obs = new MutationObserver(function () {
                var link = findJobUrl();
                if (link) { obs.disconnect(); resolve(link); }
            });
            obs.observe(document.body, { childList: true, subtree: true });
            setTimeout(function () { obs.disconnect(); resolve(null); }, 30000);
        });
    }

    function createHiddenIframe(jobUrl) {
        if (_iframe) return;
        var iframe = document.createElement('iframe');
        iframe.src = jobUrl;
        iframe.id  = 'tpHiddenJobFrame';
        iframe.style.cssText = 'display:none';
        document.body.appendChild(iframe);
        _iframe = iframe;
        log('Hidden iframe created.');
    }

    function waitForIframeReady(callback) {
        poll('iframe ready', function () {
            var iDoc = getIframeDoc();
            return (iDoc && iDoc.querySelector('.k-input-value-text')) ? true : null;
        }, callback, 60000, 800);
    }

    function releaseKendoGrid() {
        try {
            var iWin = getIframeWin();
            if (!iWin || !iWin.jQuery) return;
            var grid = iWin.jQuery('#serviceGrid').data('kendoGrid');
            if (grid) {
                grid.dataSource.data([]);
                grid.destroy();
                log('Kendo grid destroyed — memory released.');
            }
        } catch (e) {}
    }

    function getOrderRepName() {
        var rows = document.querySelectorAll('table.lq-table-info th');
        for (var i = 0; i < rows.length; i++) {
            if (rows[i].textContent.trim() === 'Order Rep') {
                var td = rows[i].nextElementSibling;
                if (td) {
                    var span = td.querySelector('span');
                    if (span && span.textContent.trim()) return span.textContent.trim();
                }
            }
        }
        return 'Unknown Tech';
    }

    function getInitials(name) {
        return name.split(' ').filter(Boolean)
            .map(function (w) { return w[0]; })
            .join('').toUpperCase().slice(0, 2);
    }

    var TAG_HOURLY_NAME = 'TagSearch_115ac658-0136-4f3b-e15a-08daa4c0721f_input';

    function setKendoTag(iDoc, iWin, inputName, value, done) {
        var input = iDoc.querySelector('input[name="' + inputName + '"]');
        if (!input) { warn('Tag input not found: ' + inputName); done(); return; }
        var jEl = iWin.jQuery(input).closest('[data-role]');
        var widget = jEl.data('kendoComboBox') || jEl.data('kendoDropDownList') || jEl.data('kendoAutoComplete');
        if (!widget) {
            input.value = value;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
            setTimeout(done, 300);
            return;
        }
        widget.value(value);
        widget.trigger('change');
        setTimeout(done, 300);
    }

    function isValidTechEntry(description) {
        return /^[A-Za-z]+\s+[A-Za-z].*\s-\sHours$/i.test((description || '').trim());
    }

    function loadTechList(callback) {
        if (_techList) { callback(_techList); return; }

        var iWin = getIframeWin();
        var iDoc = getIframeDoc();
        if (!iWin || !iWin.jQuery || !iDoc) return callback([]);
        var kendoGrid = iWin.jQuery('#serviceGrid').data('kendoGrid');
        if (!kendoGrid) return callback([]);

        function doFetch() {
            kendoGrid.dataSource.pageSize(50);
            kendoGrid.dataSource.fetch(function () {
                var data  = kendoGrid.dataSource.data();
                var techs = [];
                for (var i = 0; i < data.length; i++) {
                    var desc = (data[i].Description || '').trim();
                    if (isValidTechEntry(desc)) {
                        techs.push({ name: desc.split(' - ')[0].trim(), serviceId: data[i].Id });
                    }
                }
                techs.sort(function (a, b) { return a.name.localeCompare(b.name); });
                _techList = techs;
                log('Tech list loaded: ' + techs.length + ' entries (filtered).');

                try {
                    var clearBtn = iDoc.querySelector('button[onclick*="clearServiceSearch"]');
                    if (clearBtn) clearBtn.click();
                    else if (typeof iWin.clearServiceSearch === 'function') iWin.clearServiceSearch();
                } catch (e) {}

                releaseKendoGrid();
                callback(techs);
            });
        }

        setKendoTag(iDoc, iWin, TAG_HOURLY_NAME, 'hourly', function () {
            setTimeout(doFetch, 400);
        });
    }

    function getServiceIdForTech(techName, techs) {
        var parts = techName.toLowerCase().split(' ');
        var first = parts[0], last = parts[1] || '';
        for (var i = 0; i < techs.length; i++) {
            var n = techs[i].name.toLowerCase();
            if (n.indexOf(first) !== -1 && (!last || n.indexOf(last) !== -1))
                return techs[i].serviceId;
        }
        return null;
    }

    function getTotalHours() {
        // Try both iframes — Time Expanded may be collapsed, hidden iframe may not be ready
        var docs = [];
        var te = document.querySelector('#collapseTimeExpanded iframe');
        if (te) { try { if (te.contentDocument) docs.push(te.contentDocument); } catch (e) {} }
        if (_iframe) { try { if (_iframe.contentDocument) docs.push(_iframe.contentDocument); } catch (e) {} }
        for (var d = 0; d < docs.length; d++) {
            var iDoc = docs[d];
            var inputs = iDoc.querySelectorAll('input[id^="OrderLineQuantity_"]');
            if (!inputs.length) continue;
            var total = 0, found = false;
            inputs.forEach(function (el) { var v = parseFloat(el.value); if (!isNaN(v)) { total += v; found = true; } });
            if (found) return Math.round(total * 100) / 100;
        }
        return null;
    }

    function updateTotalDisplay() {
        var el = document.getElementById('tp-total');
        if (!el) return;
        var total = getTotalHours();
        el.textContent = total !== null ? total + 'h' : '—';
    }

    function findTechMainLine(techName) {
        var iDoc = getIframeDoc();
        if (!iDoc) return null;
        var first = techName.split(' ')[0].toLowerCase();
        var last  = techName.split(' ')[1] ? techName.split(' ')[1].toLowerCase() : '';
        var inputs = iDoc.querySelectorAll('input[id^="OrderLineQuantity_"]');
        for (var i = 0; i < inputs.length; i++) {
            var row = inputs[i].closest('tr');
            if (!row) continue;
            var cells = row.querySelectorAll('.condensedCell');
            for (var j = 0; j < cells.length; j++) {
                var t = cells[j].textContent.trim().toLowerCase();
                if (t.indexOf(first) !== -1 && (!last || t.indexOf(last) !== -1))
                    return { lineId: inputs[i].id.replace('OrderLineQuantity_', ''), input: inputs[i] };
            }
        }
        return null;
    }

    function getSubLineQuantities(lineId) {
        var iDoc = getIframeDoc();
        if (!iDoc) return [];
        var results = [];
        iDoc.querySelectorAll('input[id^="OrderLineSourceQuantity_"]').forEach(function (el) {
            if ((el.getAttribute('onchange') || '').indexOf(lineId) !== -1)
                results.push({ id: el.id, input: el, value: parseFloat(el.value) || 0 });
        });
        return results;
    }

    function clickAddSourceLine(lineId) {
        var iDoc = getIframeDoc(), iWin = getIframeWin();
        if (!iDoc || !iWin) return false;
        if (typeof iWin.addNewSourceLine === 'function') {
            try { iWin.addNewSourceLine(lineId); return true; } catch (e) {}
        }
        var btns = iDoc.querySelectorAll('button[onclick*="addNewSourceLine"]');
        for (var i = 0; i < btns.length; i++) {
            if (btns[i].getAttribute('onclick').indexOf(lineId) !== -1) {
                btns[i].click(); return true;
            }
        }
        return false;
    }

    function updateMainLineTotal(lineId) {
        var iDoc = getIframeDoc(), iWin = getIframeWin();
        if (!iDoc || !iWin) return;
        var subs  = getSubLineQuantities(lineId);
        var total = Math.round(subs.reduce(function (s, x) { return s + x.value; }, 0) * 100) / 100;
        var main  = iDoc.getElementById('OrderLineQuantity_' + lineId);
        if (!main) return;
        main.value = total;
        main.focus();
        var oc = main.getAttribute('onchange');
        if (oc && typeof iWin.setLineQuantity === 'function') {
            try {
                var m = oc.match(/setLineQuantity\('[^']+',\s*([\d.]+),/);
                iWin.setLineQuantity(lineId, m ? parseFloat(m[1]) : 1, main);
            } catch (e) {}
        }
        main.dispatchEvent(new Event('change', { bubbles: true }));
        main.dispatchEvent(new Event('input',  { bubbles: true }));
        main.blur();
    }

    function clickSaveInIframe() {
        var iDoc = getIframeDoc(), iWin = getIframeWin();
        if (!iDoc) return;
        if (iWin && typeof iWin.saveLines === 'function') { iWin.saveLines(); return; }
        var btns = iDoc.querySelectorAll('button');
        for (var i = 0; i < btns.length; i++) {
            if (btns[i].innerHTML.indexOf('floppy-disk') !== -1) { btns[i].click(); return; }
        }
    }

    function setFeedback(msg, ok) {
        var color = ok === false ? '#c0392b' : '#3B6D11';
        ['tp-feedback', 'tp-feedback-hdr'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) { el.textContent = msg; el.style.color = color; }
        });
    }

    function resetBtn() {
        var btn = document.getElementById('tp-set');
        if (btn) { btn.disabled = false; btn.textContent = 'Log Hours'; }
        var btnM = document.getElementById('tp-set-m');
        if (btnM) { btnM.disabled = false; btnM.textContent = 'Log Hours'; }
    }

    function doAddSubLine(lineId, hours, techName, isNewLine) {
        setFeedback('Logging hours...', true);

        function applyAndSave(subInput) {
            subInput.value = hours;
            subInput.focus();
            subInput.dispatchEvent(new Event('change', { bubbles: true }));
            subInput.blur();
            setTimeout(function () {
                updateMainLineTotal(lineId);
                setTimeout(function () {
                    clickSaveInIframe();
                    setFeedback('✔ ' + hours + 'h logged for ' + techName, true);
                    resetBtn();
                    setTimeout(updateTotalDisplay, 600);
                }, 400);
            }, 300);
        }

        if (isNewLine) {
            var existing = getSubLineQuantities(lineId);
            if (existing.length > 0) { applyAndSave(existing[existing.length - 1].input); return; }
        }

        var before = getSubLineQuantities(lineId).length;
        if (!clickAddSourceLine(lineId)) {
            resetBtn();
            return setFeedback('Could not find + button in iframe.', false);
        }

        poll('new sub-line', function () {
            var subs = getSubLineQuantities(lineId);
            return subs.length > before ? subs : null;
        }, function (subs) {
            var lastInput = subs[subs.length - 1].input;
            applyAndSave(lastInput);
        }, 5000, 250);
    }

    function injectLabourLineIntoIframe(html) {
        var iDoc = getIframeDoc();
        if (!iDoc) return;
        var tbody = null;
        iDoc.querySelectorAll('tbody').forEach(function (tb) {
            if (tb.querySelector('input[id^="OrderLineQuantity_"]')) tbody = tb;
        });
        if (!tbody) {
            var tbs = iDoc.querySelectorAll('tbody');
            if (tbs.length >= 4) tbody = tbs[3];
        }
        if (!tbody) return;
        var tpl = iDoc.createElement('template');
        tpl.innerHTML = html;
        tpl.content.querySelectorAll('script').forEach(function (s) { s.remove(); });
        tbody.appendChild(tpl.content);
    }

    function addLabourLineToJob(techName, serviceId, onDone) {
        var jobId = getJobId();
        var csrf  = getCsrfFromIframe();
        if (!jobId)     return onDone(false, 'Could not find Job ID.');
        if (!csrf)      return onDone(false, 'Could not find CSRF token.');
        if (!serviceId) return onDone(false, 'No service ID for ' + techName + '.');

        fetch('/Orders/Jobs/Edit?handler=NewServiceLine'
            + '&jobId='     + jobId
            + '&serviceId=' + serviceId
            + '&quantity=1', {
            method: 'POST',
            headers: {
                'Accept': '*/*',
                'Content-Type': 'application/json; charset=utf-8',
                'X-Requested-With': 'XMLHttpRequest',
                'RequestVerificationToken': csrf
            },
            credentials: 'include',
            body: ''
        })
        .then(function (r) { return r.ok ? r.text() : Promise.reject('POST ' + r.status); })
        .then(function (html) {
            if (!html) return onDone(false, 'Empty response.');
            injectLabourLineIntoIframe(html);
            onDone(true, '');
        })
        .catch(function (err) { onDone(false, 'Error: ' + err); });
    }

    function logHours(hours, techName, serviceId) {
        var mainLine = findTechMainLine(techName);
        if (mainLine) {
            doAddSubLine(mainLine.lineId, hours, techName, false);
        } else {
            setFeedback('Adding labour line for ' + techName + '...', true);
            addLabourLineToJob(techName, serviceId, function (ok, msg) {
                if (!ok) { setFeedback(msg, false); resetBtn(); return; }
                poll('tech main line after add', function () {
                    return findTechMainLine(techName);
                }, function (line) {
                    setTimeout(function () { doAddSubLine(line.lineId, hours, techName, true); }, 300);
                }, 10000, 500);
            });
        }
    }

    function updateBadge(name, isOrderRep) {
        var nameDiv   = document.getElementById('tp-name');
        var avatarDiv = document.getElementById('tp-avatar');
        var subDiv    = document.getElementById('tp-sub');
        var techCard  = document.getElementById('tp-tech');
        if (nameDiv)   nameDiv.textContent   = name;
        if (avatarDiv) avatarDiv.textContent = getInitials(name);
        if (isOrderRep) {
            if (avatarDiv) { avatarDiv.style.background = '#B5D4F4'; avatarDiv.style.color = '#0C447C'; }
            if (subDiv)    subDiv.textContent = 'Order Rep';
            if (techCard)  techCard.style.background = '#f4f6f8';
        } else {
            if (avatarDiv) { avatarDiv.style.background = '#FAEEDA'; avatarDiv.style.color = '#854F0B'; }
            if (subDiv)    subDiv.textContent = 'Assisting Tech';
            if (techCard)  techCard.style.background = '#FEF3E2';
        }
    }

    function createPanel(readOnly) {
        if (_panelReady || document.getElementById('timePanelRoot')) return;
        _panelReady = true;
        readOnly = !!readOnly;

        var orderRep = getOrderRepName();
        var initials = getInitials(orderRep);

        var style = document.createElement('style');
        style.textContent = [
            '#timePanelRoot{position:fixed;bottom:24px;right:24px;z-index:99999;width:380px;background:#fff;border:1px solid #ddd;border-radius:10px;padding:11px 14px;font-family:system-ui,sans-serif;font-size:12px;color:#222;cursor:default;will-change:transform}',
            '#timePanelRoot *{box-sizing:border-box}',
            '#tp-header{display:flex;align-items:center;gap:6px;margin-bottom:8px;padding-right:50px}',
            '#tp-title{font-weight:700;font-size:13px;white-space:nowrap;margin-right:4px}',
            '#tp-feedback{font-size:11px;color:#3B6D11;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
            '#tp-feedback-hdr{display:none;font-size:11px;flex:1;color:#3B6D11;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
            '#timePanelRoot.tp-mini #tp-feedback-hdr{display:block}',
            '#timePanelRoot.tp-mini #tp-label-row{display:none!important}',
            '#tp-header-btns{position:absolute;top:7px;right:9px;display:flex;gap:2px;z-index:2}',
            '#tp-mini,#tp-close{background:none;border:none;font-size:17px;cursor:pointer;color:#aaa;line-height:1;padding:0 2px}',
            '#tp-mini:hover,#tp-close:hover{color:#333}',
            '#tp-tech{display:flex;align-items:center;gap:6px;background:#f4f6f8;border-radius:7px;padding:7px 10px;margin-bottom:9px;transition:background .2s}',
            '#tp-avatar{width:30px;height:30px;border-radius:50%;background:#B5D4F4;color:#0C447C;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;flex-shrink:0;transition:background .2s,color .2s}',
            '#tp-name-block{flex:1;min-width:0;overflow:hidden}',
            '#tp-name{font-weight:600;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
            '#tp-sub{font-size:10px;color:#888}',
            '#tp-alt-badge{display:none}',
            '#tp-mini-target{display:none;flex-direction:column;gap:3px;align-items:stretch;flex-shrink:0}',
            '#tp-total-box{background:#EAF3DE;border-radius:6px;padding:5px 9px;text-align:center;flex-shrink:0}',
            '#tp-total{font-weight:700;color:#3B6D11;font-size:14px;line-height:1.2}',
            '#tp-total-lbl{font-size:9px;color:#3B6D11;text-transform:uppercase;letter-spacing:.04em}',
            '#tp-label-row{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:4px;margin-top:8px}',
            '#tp-select-lbl{font-size:12px;color:#666}',
            '#tp-row{display:flex;gap:5px;align-items:center}',
            '#tp-tech-select{flex:1;padding:5px 6px;border:1px solid #ccc;border-radius:5px;font-size:11px;background:#fff;min-width:0}',
            '#tp-tech-select:focus{outline:none;border-color:#378ADD}',
            '#tp-hours{width:50px;padding:5px 5px;border:1px solid #ccc;border-radius:5px;font-size:12px;text-align:center;flex-shrink:0}',
            '#tp-hours:focus{outline:none;border-color:#378ADD}',
            '#tp-set,#tp-set-m{flex-shrink:0;padding:5px 10px;border:none;border-radius:5px;background:#378ADD;color:#fff;cursor:pointer;font-size:11px;font-weight:600;white-space:nowrap}',
            '#tp-set:hover,#tp-set-m:hover{background:#2a6cb5}',
            '#tp-set:disabled,#tp-set-m:disabled{opacity:.5;cursor:not-allowed}',
            '#timePanelRoot.tp-mini{width:auto;min-width:260px}',
            '#tp-mini-controls{display:none;flex-direction:row;gap:4px;align-items:center;flex-shrink:0;margin-left:auto}',
            '#tp-hours-m{width:48px;padding:3px 4px;border:1px solid #ccc;border-radius:5px;font-size:12px;text-align:center}',
            '#tp-hours-m:focus{outline:none;border-color:#378ADD}',
            '#tp-set-m{padding:4px 8px;border:none;border-radius:5px;background:#378ADD;color:#fff;cursor:pointer;font-size:11px;font-weight:600;white-space:nowrap}',
            '#tp-set-m:hover{background:#2a6cb5}',
            '#tp-set-m:disabled{opacity:.5;cursor:not-allowed}',
            '#timePanelRoot.tp-mini{width:auto;min-width:280px}',
            '#timePanelRoot.tp-mini #tp-select-lbl,#timePanelRoot.tp-mini #tp-row{display:none!important}',
            '#timePanelRoot.tp-mini #tp-tech{margin-bottom:0}',
            '#timePanelRoot.tp-mini #tp-sub{display:none}',
            '#timePanelRoot.tp-mini #tp-mini-controls{display:flex!important}'
        ].join('\n');
        document.head.appendChild(style);

        var panel = document.createElement('div');
        panel.id = 'timePanelRoot';
        panel.innerHTML = [
            '<div id="tp-header">',
            '  <span id="tp-title">' + (readOnly ? '⏱ Tech Time — View Only' : '⏱ Log Tech Time') + '</span>',
            '  <span id="tp-feedback-hdr" style="display:none;font-size:11px;color:#3B6D11;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0 6px"></span>',
            '  <div id="tp-header-btns">',
            '    <button id="tp-mini" title="Mini mode">▬</button>',
            '    <button id="tp-close" title="Collapse">&#8212;</button>',
            '  </div>',
            '</div>',
            '<div id="tp-tech">',
            '  <div id="tp-avatar">' + initials + '</div>',
            '  <div id="tp-name-block">',
            '    <div style="display:flex;align-items:center;gap:4px">',
            '      <div id="tp-name">' + orderRep + '</div>',
            '      <span id="tp-alt-badge"></span>',
            '    </div>',
            '    <div id="tp-sub">Order Rep</div>',
            '  </div>',
            '  <div id="tp-mini-controls">',
            '    <input type="number" id="tp-hours-m" min="0.1" step="0.5" value="1.0" />',
            '    <button type="button" id="tp-set-m">Log Hours</button>',
            '  </div>',
            '  <div id="tp-total-box">',
            '    <div id="tp-total">—</div>',
            '    <div id="tp-total-lbl">Total Hours</div>',
            '  </div>',
            '</div>',
            '<div id="tp-feedback-mini" style="display:none;font-size:12px;margin-top:5px"></div>',
            '<div id="tp-label-row">',
            '  <label id="tp-select-lbl" for="tp-tech-select">Log time for</label>',
            '  <span id="tp-feedback"></span>',
            '</div>',
            '<div id="tp-row">',
            '  <select id="tp-tech-select"><option value="">Loading techs...</option></select>',
            '  <input type="number" id="tp-hours" min="0.1" step="0.5" value="1.0" placeholder="hrs" />',
            '  <button id="tp-set">Log Hours</button>',
            '</div>'
        ].join('');
        document.body.appendChild(panel);

        var pill = document.createElement('button');
        pill.id = 'tp-pill';
        pill.title = 'Show Tech Time Panel';
        pill.textContent = '⏱ Tech Time';
        pill.style.cssText = [
            'display:none', 'position:fixed', 'bottom:24px', 'right:24px',
            'z-index:99999', 'background:#1a2a4a', 'color:#fff',
            'border:none', 'border-radius:20px', 'padding:7px 14px',
            'font-family:system-ui,sans-serif', 'font-size:12px',
            'font-weight:600', 'cursor:pointer', 'box-shadow:0 2px 8px rgba(0,0,0,0.25)'
        ].join(';');
        document.body.appendChild(pill);

        function restorePosition(isMini) {
            try {
                var key = isMini ? 'bristow_tp_pos_mini' : 'bristow_tp_pos_full';
                var pos = JSON.parse(localStorage.getItem(key) || 'null');
                if (pos && (pos.left || pos.top)) {
                    panel.style.left   = pos.left   || '';
                    panel.style.top    = pos.top    || '';
                    panel.style.right  = pos.right  || '';
                    panel.style.bottom = pos.bottom || '';
                } else {
                    panel.style.left   = '';
                    panel.style.top    = '';
                    panel.style.right  = '24px';
                    panel.style.bottom = '24px';
                }
            } catch (e) {}
        }

        function setCollapsed(collapsed) {
            try { localStorage.setItem('bristow_tp_collapsed', collapsed ? '1' : '0'); } catch(e) {}
        }

        restorePosition(false);

        try {
            var wasCollapsed = localStorage.getItem('bristow_tp_collapsed') === '1';
            if (wasCollapsed) {
                panel.style.display = 'none';
                pill.style.display  = 'block';
            } else if (localStorage.getItem('bristow_tp_mode') === 'mini') {
                setTimeout(function () {
                    var miniBtn = document.getElementById('tp-mini');
                    if (miniBtn) miniBtn.click();
                }, 100);
            }
        } catch (e) {}

        loadTechList(function (techs) {
            var select = document.getElementById('tp-tech-select');
            if (!select) return;
            select.innerHTML = '';
            var def = document.createElement('option');
            def.value = orderRep; def.textContent = orderRep + ' (Order Rep)';
            select.appendChild(def);
            var sep = document.createElement('option');
            sep.disabled = true; sep.textContent = '── Assisting Techs ──';
            select.appendChild(sep);
            techs.forEach(function (t) {
                if (t.name.toLowerCase() === orderRep.toLowerCase()) return;
                var opt = document.createElement('option');
                opt.value = t.name; opt.textContent = t.name;
                select.appendChild(opt);
            });
            select.value = orderRep;
            updateTotalDisplay();

            // Read-only mode: hide all input controls, leaving only the Total Hours box
            if (readOnly) {
                var lr  = document.getElementById('tp-label-row');
                var fr  = document.getElementById('tp-row');
                var mc  = document.getElementById('tp-mini-controls');
                if (lr) lr.style.display = 'none';
                if (fr) fr.style.display = 'none';
                if (mc) mc.style.display = 'none';
                // Shrink panel width to fit just the tech card + total box
                var root = document.getElementById('timePanelRoot');
                if (root) root.style.width = 'auto';
                // Retry updating total hours — iframe may not be fully ready yet
                var totalRetries = 0;
                function tryUpdateTotal() {
                    var total = getTotalHours();
                    if (total !== null) {
                        var el = document.getElementById('tp-total');
                        if (el) el.textContent = total + 'h';
                    } else if (totalRetries < 10) {
                        totalRetries++;
                        setTimeout(tryUpdateTotal, 1000);
                    }
                }
                tryUpdateTotal();
            }
        });

        var isDragging = false, dragOffX, dragOffY;
        var DRAG_IGNORE = { 'tp-close': 1, 'tp-mini': 1, 'tp-set': 1, 'tp-hours': 1, 'tp-tech-select': 1 };
        panel.addEventListener('pointerdown', function (e) {
            if (DRAG_IGNORE[e.target.id]) return;
            isDragging = true;
            dragOffX = e.clientX - panel.getBoundingClientRect().left;
            dragOffY = e.clientY - panel.getBoundingClientRect().top;
            panel.setPointerCapture(e.pointerId);
            panel.style.cursor = 'grabbing';
        });
        panel.addEventListener('pointermove', function (e) {
            if (!isDragging) return;
            panel.style.right  = 'auto';
            panel.style.bottom = 'auto';
            panel.style.left   = (e.clientX - dragOffX) + 'px';
            panel.style.top    = (e.clientY - dragOffY) + 'px';
        });
        panel.addEventListener('pointerup', function () {
            isDragging = false;
            panel.style.cursor = '';
            try {
                var posKey = panel.classList.contains('tp-mini') ? 'bristow_tp_pos_mini' : 'bristow_tp_pos_full';
                localStorage.setItem(posKey, JSON.stringify({
                    left: panel.style.left,
                    top:  panel.style.top,
                    right:  panel.style.right,
                    bottom: panel.style.bottom
                }));
            } catch (e) {}
        });

        function selectOnFocus(el) {
            el.addEventListener('focus', function () {
                var inp = this;
                inp.type = 'text';
                inp.select();
                inp.type = 'number';
            });
        }

        var hoursInput = document.getElementById('tp-hours');
        selectOnFocus(hoursInput);

        hoursInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                document.getElementById('tp-set').click();
            }
        });

        document.getElementById('tp-close').addEventListener('click', function () {
            panel.style.display = 'none';
            pill.style.display  = 'block';
            setCollapsed(true);
        });

        pill.addEventListener('click', function () {
            pill.style.display  = 'none';
            panel.style.display = 'block';
            setCollapsed(false);
        });

        var hoursMini = document.getElementById('tp-hours-m');
        selectOnFocus(hoursMini);
        hoursMini.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                var h = parseFloat(document.getElementById('tp-hours-m').value);
                document.getElementById('tp-hours').value = h;
                handleLogHours(h);
            }
        });

        document.getElementById('tp-set-m').addEventListener('mousedown', function (e) {
            e.preventDefault();
            var h = parseFloat(document.getElementById('tp-hours-m').value);
            document.getElementById('tp-hours').value = h;
            handleLogHours(h);
        });

        document.getElementById('tp-mini').addEventListener('click', function () {
            var isMini = panel.classList.toggle('tp-mini');
            this.title       = isMini ? 'Expand' : 'Mini mode';
            this.textContent = isMini ? '▣' : '▬';
            try { localStorage.setItem('bristow_tp_mode', isMini ? 'mini' : 'full'); } catch (e) {}
            restorePosition(isMini);

            var mc  = document.getElementById('tp-mini-controls');
            var lr  = document.getElementById('tp-label-row');
            var fr  = document.getElementById('tp-row');
            var sub = document.getElementById('tp-sub');
            if (mc)  mc.style.display  = isMini ? 'flex'  : 'none';
            if (lr)  lr.style.display  = isMini ? 'none'  : 'flex';
            if (fr)  fr.style.display  = isMini ? 'none'  : 'flex';
            if (sub) sub.style.display = isMini ? 'none'  : 'block';
            var fhd = document.getElementById('tp-feedback-hdr');
            if (fhd) fhd.style.display = isMini ? 'block' : 'none';
        });

        document.getElementById('tp-tech-select').addEventListener('change', function () {
            updateBadge(this.value, this.value === orderRep);
        });

        function handleLogHours(hoursVal) {
            if (isNaN(hoursVal) || hoursVal <= 0)
                return setFeedback('Enter a valid number of hours.', false);
            var select       = document.getElementById('tp-tech-select');
            var selectedName = (select && select.value) ? select.value : orderRep;
            var serviceId    = getServiceIdForTech(selectedName, _techList || []);
            if (!serviceId)
                return setFeedback('Could not find service ID for ' + selectedName + '.', false);
            var fullBtn = document.getElementById('tp-set');
            var miniBtn = document.getElementById('tp-set-m');
            if (fullBtn) { fullBtn.disabled = true; fullBtn.textContent = 'Working...'; }
            if (miniBtn) { miniBtn.disabled = true; miniBtn.textContent = 'Working...'; }
            logHours(hoursVal, selectedName, serviceId);
            setTimeout(function () {
                if (select) { select.value = orderRep; updateBadge(orderRep, true); }
            }, 500);
        }

        document.getElementById('tp-set').addEventListener('click', function () {
            handleLogHours(parseFloat(document.getElementById('tp-hours').value));
        });
    }

   function initPanel() {
    waitForJobUrl().then(function (jobUrl) {
        if (!jobUrl) { warn('No job URL found — panel skipped.'); return; }
        poll('lq-table-info', function () {
            return document.querySelector('table.lq-table-info th') ? true : null;
        }, function () {
            var readOnly = isOrderComplete();
            var teIframe = document.querySelector('#collapseTimeExpanded iframe');
            if (!teIframe) createHiddenIframe(jobUrl);
            if (readOnly) {
                createPanel(readOnly);
            } else {
                waitForIframeReady(function () { createPanel(readOnly); });
            }
        }, 15000, 300);
    });
}

    initPanel();

})();
