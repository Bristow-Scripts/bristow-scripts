// ==UserScript==
// @name         ALL - Set Qty Default to 1
// @match        https://bristow-app.azurewebsites.net/Orders/Orders/Edit*
// @updateURL    https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/ALL---Set-Qty-Default-to-1.user.js
// @downloadURL  https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/ALL---Set-Qty-Default-to-1.user.js
// @grant        none
// ==/UserScript==
(function () {
    'use strict';
    if (window.location.href.includes('/Orders/Jobs/Edit')) return;

    function fixInputs() {
        // Only target qty inputs inside active/visible tab panes
        // and only in the search grids (partPicker or servicePicker)
        const activePanes = document.querySelectorAll(
            '#partPicker.active input[id^="qtyInput_"], ' +
            '#servicePicker.active input[id^="qtyInput_"]'
        );
        activePanes.forEach(input => {
            if (input.value === '0') {
                input.value = '1';
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });
    }

    fixInputs();
    const observer = new MutationObserver(() => fixInputs());
    observer.observe(document.body, { childList: true, subtree: true });
})();
