// ==UserScript==
// @name         SH - Auto Add Labor & Process W/ WO Desc.
// @namespace    http://tampermonkey.net/
// @version      2.6
// @updateURL    https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/SH---Auto-Add-Labor-Process-W-WO-Desc.user.js
// @downloadURL  https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/SH---Auto-Add-Labor-Process-W-WO-Desc.user.js
// @description  Automatically fills work order desc + robust labor line handling (prevents duplicates on unprocessed lines)
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

    function log(msg)  { console.log('[SH AutoLine] ' + msg); }
    function warn(msg) { console.warn('[SH AutoLine] ' + msg); }

    function poll(label, conditionFn, onFound, timeoutMs = 15000, intervalMs = 300) {
        let elapsed = 0;
        const tid = setInterval(() => {
            const result = conditionFn();
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
    }

    function getCsrfToken() {
        const el = document.querySelector('input[name="__RequestVerificationToken"]') ||
                   document.querySelector('meta[name="RequestVerificationToken"]');
        return el ? (el.value || el.getAttribute('content')) : null;
    }

    function getOrderId() {
        return new URLSearchParams(window.location.search).get('id');
    }

    // =========================================================================
    // WORK ORDER DESCRIPTION
    // =========================================================================

    function fillWorkOrderDesc() {
        const textarea = document.getElementById('AerospaceHead_WorkOrderDesc');
        if (!textarea) return warn('Work order textarea not found.');

        if (textarea.value.trim() === '') {
            textarea.value = WORK_ORDER_TEXT;
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            log('Work order description filled.');
        } else {
            log('Work order description already has content.');
        }
    }

    // =========================================================================
    // SERVICE LINE HELPERS
    // =========================================================================

    function tableHasLines() {
        const table = document.getElementById('order-line-area');
        if (!table) return false;
        return table.innerHTML.includes('S-100542') || table.innerHTML.includes(SERVICE_ID);
    }

    function findServiceRow() {
        const rows = document.querySelectorAll('#order-line-area tbody tr');
        for (const row of rows) {
            if (row.innerHTML.includes('S-100542') || row.innerHTML.includes(SERVICE_ID)) {
                return row;
            }
        }
        return null;
    }

    function getServiceLineId() {
        const row = findServiceRow();
        if (!row) return null;
        const match = row.id.match(/OrderLine_(.+)/);
        return match ? match[1] : null;
    }

    function setSourceTypeToJob() {
        const lineId = getServiceLineId();
        if (!lineId) return;

        const sourceRow = document.getElementById('OrderLineSourceArea_' + lineId);
        if (!sourceRow) return;

        const select = sourceRow.querySelector('select[id^="OrderLineSourceType_"]');
        if (select && select.value !== '6') {
            select.value = '6';
            try { sourceTypeChanged(select); } catch (e) {}
            log('Source type set to Job');
        }
    }

    function setServiceLineQuantityToOne() {
        const row = findServiceRow();
        if (!row) return;

        const input = row.querySelector('input[id^="OrderLineQuantityMask_"]');
        if (input && (parseFloat(input.value) === 0 || !input.value.trim())) {
            input.value = '1';
            input.dispatchEvent(new Event('change', { bubbles: true }));
            log('Quantity set to 1');
        }
    }

    // =========================================================================
    // PHASED PROCESSING
    // =========================================================================

    function phaseProcess() {
        const lineId = getServiceLineId();
        if (!lineId) return;

        const checkbox = document.getElementById('check_' + lineId);
        if (checkbox) {
            checkbox.checked = true;
            try { checkLine(checkbox, lineId); } catch (e) {}
        }

        poll('processSourceLines', () => {
            const btn = document.getElementById('processSourceLines');
            return (btn && btn.style.display !== 'none') ? btn : null;
        }, () => {
            setTimeout(() => {
                try {
                    processSourceLines();
                    log('processSourceLines called');
                } catch (e) { warn('processSourceLines: ' + e.message); }
            }, 150);
        }, 10000, 150);
    }

    function phaseSave() {
        poll('saveLines', () => typeof saveLines === 'function', () => {
            log('Saving lines...');
            saveLines();
            setTimeout(phaseProcess, 1300);
        });
    }

    function phaseConfigureAndSave() {
        poll('SourceType select', () => document.querySelector('select[id^="OrderLineSourceType_"]'), () => {
            setSourceTypeToJob();
            poll('QuantityMask input', () => document.querySelector('input[id^="OrderLineQuantityMask_"]'), () => {
                setServiceLineQuantityToOne();
                phaseSave();
            });
        });
    }

    function injectHtml(html) {
        const table = document.getElementById('order-line-area');
        if (!table?.querySelector('tbody')) return;

        const tpl = document.createElement('template');
        tpl.innerHTML = html;
        tpl.content.querySelectorAll('script').forEach(s => s.remove());
        table.querySelector('tbody').appendChild(tpl.content);

        log('New service line injected');
        phaseConfigureAndSave();
    }

    function observeForNewLines() {
        const table = document.getElementById('order-line-area');
        if (!table) return;

        const obs = new MutationObserver(() => {
            setServiceLineQuantityToOne();
            if (findServiceRow()) {
                obs.disconnect();
                log('Observer disconnected - line found');
            }
        });

        obs.observe(table, { childList: true, subtree: true });
    }

    // =========================================================================
    // MAIN LABOR LINE LOGIC (Copied/Adapted from TECH script)
    // =========================================================================

    function addServiceLine() {
        // Case 1: Line already exists
        if (tableHasLines()) {
            const lineId = getServiceLineId();
            if (lineId) {
                const sourceArea = document.getElementById('OrderLineSourceArea_' + lineId);
                if (sourceArea) {
                    const locked = sourceArea.querySelector('input[id^="OrderLineSourceLocked_"]');
                    const isProcessed = locked && locked.value;

                    if (!isProcessed) {
                        log('Existing labor line found (unprocessed) — configuring and processing it.');
                        setSourceTypeToJob();
                        setServiceLineQuantityToOne();
                        phaseSave();
                        return;
                    }
                }
            }
            log('Labor line already exists and is processed.');
            return;
        }

        // Case 2: No line exists → Add new one
        const orderId = getOrderId();
        if (!orderId) return warn('No order ID found');

        log('No labor line found — adding new one...');

        fetch('/Orders/Orders/Edit?handler=NewServiceLine' +
            '&orderId='   + encodeURIComponent(orderId) +
            '&serviceId=' + encodeURIComponent(SERVICE_ID) +
            '&quantity=1', {
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
        .then(r => r.ok ? r.text() : null)
        .then(html => { if (html) injectHtml(html); })
        .catch(err => warn('Fetch error: ' + err));
    }

    // =========================================================================
    // INIT
    // =========================================================================

    poll('order-line-area', () => document.getElementById('order-line-area'), () => {
        fillWorkOrderDesc();

        setTimeout(() => {
            addServiceLine();
            observeForNewLines();
        }, 700);
    });

})();
