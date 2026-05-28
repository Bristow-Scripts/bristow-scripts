// ==UserScript==
// @name         ALL - Set Qty Default to 1
// @match        https://bristow-app.azurewebsites.net/Orders/Orders/Edit*
// @updateURL    https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/ALL---Set-Qty-Default-to-1.user.js
// @downloadURL  https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/ALL---Set-Qty-Default-to-1.user.js
// @grant        none
// ==/UserScript==
(function () {
    'use strict';

    // Don't run inside the Jobs iframe
    if (window.location.href.includes('/Orders/Jobs/Edit')) return;

    function fixInputs() {
        document.querySelectorAll('input[type="number"].form-control').forEach(input => {
            if (input.value === "0") {
                input.value = "1";
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });
    }

    fixInputs();
    const observer = new MutationObserver(() => fixInputs());
    observer.observe(document.body, { childList: true, subtree: true });
})();