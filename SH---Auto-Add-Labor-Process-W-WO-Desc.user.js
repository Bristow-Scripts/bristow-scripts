// ==UserScript==
// @name         SH - Auto Add Labor & Process W/ WO Desc.
// @namespace    http://tampermonkey.net/
// @version      2.4
// @updateURL    https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/SH---Auto-Add-Labor-Process-W-WO-Desc.user.js
// @downloadURL  https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/SH---Auto-Add-Labor-Process-W-WO-Desc.user.js
// @description  Automatically fills work order desc, adds a Service line, sets to Job, quantity 1, saves, checks, and processes
// @match        https://bristow-app.azurewebsites.net/Orders/Orders/Edit*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    if (!window.location.href.includes('/Orders/Orders/Edit')) return;

    window.alert = function (msg) { log('Suppressed alert: ' + msg); };

    var SERVICE_ID = '834f33a0-2baf-4b64-6727-08ddb592746f';

    var WORK_ORDER_TEXT = 'WORK PERFORMED: \n' +
        'DATA: SEE ATTACHED\n' +
        'AIRWORTHINESS DIRECTIVE: NONE/NOT APPLICABLE/PREVIOUSLY COMPLIED WITH/COMPLIED WITH AD#XXXXXX | ' +
        'LIST OF MODS: MODS FROM DATA PLATE | ' +
        'SERVICE DIFFICULTY REPORT: NO/ATTACHED | ' +
        'TOOL CONTROL FORM: YES/NO/ATTACHED | ' +
        'PARTS CONTROL FORM: YES/NO/ATTACHED | ' +
        'ADDITIONAL WORK ASSESSMENT FORM: NO/ATTACHED\n' +
        'WORK PERFORMED IN ACCORDANCE WITH BRISTOW MPM USING APPROVED LIBRARY DOCUMENTS AND APPLICABLE ADS.\n' +
        'REVIEWED BY: TECHNICIAN NAME AND NUMBER INITIALS________';

    // =========================================================================
    // UTILITIES
    // =========================================================================

    function log(msg)  { console.log('[AutoLine] ' + msg); }
    function warn(msg) { console.warn('[AutoLine] ' + msg); }

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
    // WORK ORDER DESCRIPTION
    // =========================================================================

    function fillWorkOrderDesc() {
        var textarea = document.getElementById('AerospaceHead_WorkOrderDesc');
        if (textarea && textarea.value === '') {
            textarea.value = WORK_ORDER_TEXT;
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
            textarea.dispatchEvent(new Event('input',  { bubbles: true }));
            log('Work order description filled.');
        } else if (!textarea) {
            warn('Work order textarea not found.');
        } else {
            log('Work order description already has content, skipping.');
        }
    }

    // =========================================================================
    // SERVICE LINE HELPERS
    // =========================================================================

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

    function setServiceLineQuantityToOne() {
        var row = findServiceRow();
        if (!row) return;
        var input = row.querySelector('input[id^="OrderLineQuantityMask_"]');
        if (input && (parseFloat(input.value) === 0 || input.value === '')) {
            input.value = '1';
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    // =========================================================================
    // PHASED PROCESSING — same approach as TECH version
    // =========================================================================

    function phaseProcess() {
        var lineId = getServiceLineId();
        if (!lineId) { warn('phaseProcess: no service line ID'); return; }
        var checkbox = document.getElementById('check_' + lineId);
        if (!checkbox) { warn('phaseProcess: checkbox not found'); return; }
        checkbox.checked = true;
        try { checkLine(checkbox, lineId); } catch (e) {}

        poll('processSourceLines button', function () {
            var btn = document.getElementById('processSourceLines');
            return (btn && btn.style.display !== 'none') ? btn : null;
        }, function () {
            setTimeout(function () {
                try { processSourceLines(); log('processSourceLines called.'); }
                catch (e) { warn('processSourceLines: ' + e.message); }
            }, 100);
        }, 10000, 100);
    }

    function phaseSave() {
        poll('saveLines fn', function () {
            return typeof saveLines === 'function' ? true : null;
        }, function () {
            log('Saving lines...');
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
                setServiceLineQuantityToOne();
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
        log('Service line injected.');
        phaseConfigureAndSave();
    }

    function observeForNewLines() {
        var table = document.getElementById('order-line-area');
        if (!table) return;
        var debounce = null;
        var obs = new MutationObserver(function () {
            clearTimeout(debounce);
            debounce = setTimeout(function () {
                setServiceLineQuantityToOne();
                if (findServiceRow()) {
                    obs.disconnect();
                    log('Observer disconnected.');
                }
            }, 200);
        });
        obs.observe(table, { childList: true, subtree: true });
    }

    function addServiceLine() {
        if (tableHasLines()) { log('Lines already exist, skipping auto-add.'); return; }
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

    // =========================================================================
    // MAIN
    // =========================================================================

    poll('order-line-area', function () {
        return document.getElementById('order-line-area');
    }, function () {
        fillWorkOrderDesc();
        setTimeout(function () {
            addServiceLine();
            observeForNewLines();
        }, 500);
    });

})();
