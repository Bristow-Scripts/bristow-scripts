// ==UserScript==
// @name         FE - Net 0 Customer Warning
// @namespace    https://github.com/Bristow-Scripts/bristow-scripts
// @version      1.2
// @description  Fetches customer company page and highlights the order info panel if payment terms are Net 0
// @match        https://bristow-app.azurewebsites.net/Orders/Orders/Edit*
// @grant        GM_xmlhttpRequest
// @connect      bristow-app.azurewebsites.net
// @updateURL    https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/FE---Net-0-Customer-Warning.meta.js
// @downloadURL  https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/FE---Net-0-Customer-Warning.user.js
// ==/UserScript==

(function () {
    'use strict';

    let lastCompanyHref = null;
    let isNet0 = false;

    function applyWarningUI() {
        const companyLink = document.querySelector('a#customerCompanyName');
        const well = document.querySelector('.well.well-sm');
        if (well) {
            well.style.backgroundColor = '#ffcdd2';
            well.style.borderColor = '#e57373';
            well.style.transition = 'background-color 0.3s ease';
        }
        if (companyLink && !document.getElementById('net0-warning-badge')) {
            const badge = document.createElement('span');
            badge.id = 'net0-warning-badge';
            badge.textContent = '⚠ NET 0';
            badge.style.cssText = `
                display: inline-block;
                margin-left: 10px;
                padding: 2px 8px;
                background-color: #b71c1c;
                color: #ffffff;
                font-size: 11px;
                font-weight: bold;
                border-radius: 3px;
                vertical-align: middle;
                letter-spacing: 0.5px;
            `;
            companyLink.insertAdjacentElement('afterend', badge);
        }
    }

    function resetWarningUI() {
        const well = document.querySelector('.well.well-sm');
        if (well) {
            well.style.backgroundColor = '';
            well.style.borderColor = '';
        }
        const badge = document.getElementById('net0-warning-badge');
        if (badge) badge.remove();
    }

    function fetchAndApply(href) {
        const fullUrl = 'https://bristow-app.azurewebsites.net' + href;
        GM_xmlhttpRequest({
            method: 'GET',
            url: fullUrl,
            onload: function (response) {
                const parser = new DOMParser();
                const doc = parser.parseFromString(response.responseText, 'text/html');
                let termsValue = null;
                for (const th of doc.querySelectorAll('th')) {
                    if (th.textContent.trim() === 'Terms') {
                        const td = th.closest('tr')?.querySelector('td');
                        if (td) { termsValue = td.textContent.trim(); break; }
                    }
                }
                isNet0 = (termsValue === 'Net 0');
                if (isNet0) applyWarningUI();
            },
            onerror: function () {
                console.warn('[Net 0 Warning] Failed to fetch company page:', fullUrl);
            }
        });
    }

    function checkForChange() {
        const link = document.querySelector('a#customerCompanyName');
        if (!link) return;
        const href = link.getAttribute('href');
        if (!href) return;
        if (href !== lastCompanyHref) {
            lastCompanyHref = href;
            isNet0 = false;
            resetWarningUI();
            fetchAndApply(href);
        }
    }

    setInterval(checkForChange, 1000);
    checkForChange();

    // Re-apply badge/highlight after AJAX saves replace the header DOM
    const observer = new MutationObserver(() => {
        if (!isNet0) return;
        const well = document.querySelector('.well.well-sm');
        const badge = document.getElementById('net0-warning-badge');
        // If the warning elements are missing or unstyled, re-apply
        if (!badge || !well || well.style.backgroundColor !== 'rgb(255, 205, 210)') {
            applyWarningUI();
        }
    });

    const observeRoot = document.querySelector('#HeaderSection') || document.body;
    observer.observe(observeRoot, { childList: true, subtree: true });

})();
