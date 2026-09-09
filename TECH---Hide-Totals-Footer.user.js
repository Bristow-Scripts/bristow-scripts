// ==UserScript==
// @name         TECH - Hide Totals Footer
// @namespace    http://tampermonkey.net/
// @version      1.9
// @description  Hides totals section via CSS only
// @match        https://liquid-264-drc0bgd0eje0ckcg.westus3-01.azurewebsites.net/Orders/Orders/Edit*
// @match        https://liquid-264-drc0bgd0eje0ckcg.westus3-01.azurewebsites.net/Orders/Jobs/Edit*
// @grant        none
// @tag          TECH
// ==/UserScript==

(function () {
    'use strict';
    // SINGLE CSS RULE replaces the previous MutationObserver + hideTotalsArea() calls
    // that ran on every single DOM mutation. No observer, no debounce, no CPU cost.
    var style = document.createElement('style');
    style.textContent = [
        '#footer > .container-fluid { display: none !important; height: 0 !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; overflow: hidden !important; }',
        '#footer { height: auto !important; min-height: 0 !important; padding-bottom: 0 !important; }'
    ].join(' ');
    document.head.appendChild(style);
})();
