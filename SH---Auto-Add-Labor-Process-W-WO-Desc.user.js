// ==UserScript==
// @name         SH - Auto Add Labor & Process W/ WO Desc.
// @namespace    http://tampermonkey.net/
// @version      2.3
// @updateURL    https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/SH---Auto-Add-Labor-Process-W-WO-Desc.user.js
// @downloadURL  https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/SH---Auto-Add-Labor-Process-W-WO-Desc.user.js
// @description  Automatically fills work order desc, adds a Service line, sets to Job, quantity 1, saves, checks, and processes
// @match        https://bristow-app.azurewebsites.net/Orders/Orders/Edit*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    window.alert = function(msg) {
        console.log('[AutoLine] Auto-dismissed alert:', msg);
    };

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

    function fillWorkOrderDesc() {
        var textarea = document.getElementById('AerospaceHead_WorkOrderDesc');
        if (textarea && textarea.value === '') {
            textarea.value = WORK_ORDER_TEXT;
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            console.log('[AutoLine] Work order description filled.');
        } else if (!textarea) {
            console.warn('[AutoLine] Work order textarea not found.');
        } else {
            console.log('[AutoLine] Work order description already has content, skipping.');
        }
    }

    // Only set quantity to 1 on the specific service line row — not all inputs
    function setServiceLineQuantityToOne() {
        var row = findServiceRow();
        if (!row) return;
        var input = row.querySelector('input[id^="OrderLineQuantityMask_"]');
        if (input && (parseFloat(input.value) === 0 || input.value === '')) {
            input.value = '1';
            try { input.dispatchEvent(new Event('change', { bubbles: true })); } catch(e) {}
            console.log('[AutoLine] Service line quantity set to 1.');
        }
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

    function setSourceTypeToJob() {
        document.querySelectorAll('select[id^="OrderLineSourceType_"]').forEach(function(select) {
            if (select.value !== '6') {
                select.value = '6';
                try {
                    sourceTypeChanged(select);
                    console.log('[AutoLine] Source type set to Job.');
                } catch(e) {
                    console.warn('[AutoLine] sourceTypeChanged error (non-fatal):', e.message);
                }
            }
        });
    }

    function getCsrfToken() {
        var tokenInput = document.querySelector('input[name="__RequestVerificationToken"]');
        if (tokenInput) return tokenInput.value;
        var tokenMeta = document.querySelector('meta[name="RequestVerificationToken"]');
        if (tokenMeta) return tokenMeta.getAttribute('content');
        return null;
    }

    function waitForCheckboxAndProcess() {
        var attempts = 0;
        var checkInterval = setInterval(function() {
            attempts++;
            var checkbox = document.querySelector('input.orderline-checkbox');
            if (checkbox) {
                clearInterval(checkInterval);
                console.log('[AutoLine] Found main checkbox after', attempts, 'attempt(s).');
                var lineId = checkbox.id.replace('check_', '');
                checkbox.checked = true;
                try {
                    checkLine(checkbox, lineId);
                    console.log('[AutoLine] checkLine() called for:', lineId);
                } catch(e) {
                    console.warn('[AutoLine] checkLine error:', e.message);
                }

                setTimeout(function() {
                    var processBtn = document.getElementById('processSourceLines');
                    if (processBtn) {
                        processBtn.click();
                        console.log('[AutoLine] Process Source Lines clicked.');
                    } else if (typeof processSourceLines === 'function') {
                        processSourceLines();
                        console.log('[AutoLine] processSourceLines() called directly.');
                    } else {
                        console.warn('[AutoLine] Could not find processSourceLines.');
                    }
                }, 1000);

            } else if (attempts >= 20) {
                clearInterval(checkInterval);
                console.warn('[AutoLine] Gave up waiting for main checkbox after 20 attempts.');
            } else {
                console.log('[AutoLine] Waiting for main checkbox, attempt', attempts);
            }
        }, 500);
    }

    function injectHtml(html) {
        var table = document.getElementById('order-line-area');
        if (!table) return;
        var tbody = table.querySelector('tbody');

        var template = document.createElement('template');
        template.innerHTML = html;
        var fragment = template.content;
        fragment.querySelectorAll('script').forEach(function(s) { s.remove(); });
        tbody.appendChild(fragment);

        console.log('[AutoLine] Service line injected into table.');

        setTimeout(function() {
            setSourceTypeToJob();
            setTimeout(function() {
                setServiceLineQuantityToOne(); // scoped — only touches service line
                setTimeout(function() {
                    if (typeof saveLines === 'function') {
                        console.log('[AutoLine] Saving lines...');
                        saveLines();
                        waitForCheckboxAndProcess();
                    } else {
                        console.warn('[AutoLine] saveLines() not found on page.');
                    }
                }, 500);
            }, 500);
        }, 800);
    }

    function tableHasLines() {
        return !!findServiceRow();
    }

    function addServiceLine() {
        if (tableHasLines()) {
            console.log('[AutoLine] Lines already exist, skipping auto-add.');
            return; // removed setQuantitiesToOne() here — was stamping all rows
        }

        var urlParams = new URLSearchParams(window.location.search);
        var orderId = urlParams.get('id');
        if (!orderId) {
            console.warn('[AutoLine] No order ID found in URL.');
            return;
        }

        var csrfToken = getCsrfToken();
        if (!csrfToken) {
            console.warn('[AutoLine] No CSRF token found — POST may be rejected.');
        }

        var postUrl = '/Orders/Orders/Edit?handler=NewServiceLine'
            + '&orderId=' + orderId
            + '&serviceId=' + SERVICE_ID
            + '&quantity=1';

        console.log('[AutoLine] POSTing new service line...');

        fetch(postUrl, {
            method: 'POST',
            headers: {
                'Accept': '*/*',
                'Content-Type': 'application/json; charset=utf-8',
                'X-Requested-With': 'XMLHttpRequest',
                'RequestVerificationToken': csrfToken || ''
            },
            credentials: 'include',
            body: ''
        })
        .then(function(response) {
            if (!response.ok) {
                console.warn('[AutoLine] POST failed:', response.status);
                return null;
            }
            return response.text();
        })
        .then(function(html) {
            if (!html) return;
            injectHtml(html);
        })
        .catch(function(err) {
            console.error('[AutoLine] Error:', err);
        });
    }

    function observeForNewLines() {
        var table = document.getElementById('order-line-area');
        if (!table) return;
        var observer = new MutationObserver(function(mutations) {
            var hasNewInputs = mutations.some(function(m) {
                return Array.from(m.addedNodes).some(function(node) {
                    return node.nodeType === 1 && (
                        node.matches('input[id^="OrderLineQuantityMask_"]') ||
                        node.querySelector && node.querySelector('input[id^="OrderLineQuantityMask_"]')
                    );
                });
            });
            if (hasNewInputs) {
                setServiceLineQuantityToOne(); // scoped — only touches service line
            }
        });
        observer.observe(table, { childList: true, subtree: true });
    }

    var waitForTable = setInterval(function() {
        if (document.getElementById('order-line-area')) {
            clearInterval(waitForTable);
            fillWorkOrderDesc();
            setTimeout(function() {
                addServiceLine();
                observeForNewLines();
            }, 800);
        }
    }, 200);

})();
