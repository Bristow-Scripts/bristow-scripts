// ==UserScript==
// @name         SH - Process W/ WO Desc.
// @namespace    http://tampermonkey.net/
// @version      3.0
// @updateURL    https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/SH---Auto-Add-Labor-Process-W-WO-Desc.user.js
// @downloadURL  https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/SH---Auto-Add-Labor-Process-W-WO-Desc.user.js
// @description  Automatically fills work order description
// @match        https://bristow-app.azurewebsites.net/Orders/Orders/Edit*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    if (!window.location.href.includes('/Orders/Orders/Edit')) return;

    window.alert = function (msg) { log('Suppressed alert: ' + msg); };

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
    // INIT
    // =========================================================================

    poll('AerospaceHead_WorkOrderDesc', () => document.getElementById('AerospaceHead_WorkOrderDesc'), () => {
        fillWorkOrderDesc();
    });

})();
