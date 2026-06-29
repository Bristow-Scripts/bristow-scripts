// ==UserScript==
// @name         ALL - Set Qty Default to 1
// @version      2.2
// @match        https://bristow-app.azurewebsites.net/Orders/Orders/Edit*
// @updateURL    https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/ALL---Set-Qty-Default-to-1.user.js
// @downloadURL  https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/ALL---Set-Qty-Default-to-1.user.js
// @require      https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Shared-Core.user.js
// @grant        none
// ==/UserScript==
(function () {
    'use strict';
    if (window.location.href.includes('/Orders/Jobs/Edit')) return;

    function fixInputs() {
        var activePanes = document.querySelectorAll(
            '#partPicker.active input[id^="qtyInput_"], ' +
            '#servicePicker.active input[id^="qtyInput_"]'
        );
        activePanes.forEach(function (input) {
            if (input.value === '0') {
                input.value = '1';
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });
    }

    fixInputs();

    if (window.TechShared) {
        TechShared.observer.register(fixInputs, { debounce: 150 });
    } else {
        var qtyDebounce = null;
        var observer = new MutationObserver(function () {
            clearTimeout(qtyDebounce);
            qtyDebounce = setTimeout(fixInputs, 150);
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }
})();
