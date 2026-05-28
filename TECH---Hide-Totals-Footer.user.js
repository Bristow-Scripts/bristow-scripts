// ==UserScript==
// @name         TECH - Hide Totals Footer
// @namespace    http://tampermonkey.net/
// @version      1.0
// @updateURL    https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Hide-Totals-Footer.user.js
// @downloadURL  https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Hide-Totals-Footer.user.js
// @description  Keeps footer buttons while permanently hiding totals section
// @match        *://*/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    function hideTotalsArea() {

        // Hide ONLY the totals section
        const totals = document.querySelector('#footer > .container-fluid');

        if (totals) {
            totals.style.setProperty('display', 'none', 'important');
            totals.style.setProperty('height', '0', 'important');
            totals.style.setProperty('min-height', '0', 'important');
            totals.style.setProperty('margin', '0', 'important');
            totals.style.setProperty('padding', '0', 'important');
            totals.style.setProperty('overflow', 'hidden', 'important');
        }

        // Let footer resize naturally
        const footer = document.querySelector('#footer');

        if (footer) {
            footer.style.setProperty('height', 'auto', 'important');
            footer.style.setProperty('min-height', '0', 'important');
            footer.style.setProperty('padding-bottom', '0', 'important');
        }
    }

    // Run immediately
    hideTotalsArea();

    // Keep enforcing it
    const observer = new MutationObserver(() => {
        hideTotalsArea();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true
    });

})();