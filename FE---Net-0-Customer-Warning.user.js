// ==UserScript==
// @name         FE - Net 0 Customer Warning
// @namespace    https://github.com/Bristow-Scripts/bristow-scripts
// @version      1.1
// @description  Fetches customer company page and highlights the order info panel if payment terms are Net 0
// @match        https://bristow-app.azurewebsites.net/Orders/Orders/Edit*
// @grant        GM_xmlhttpRequest
// @connect      bristow-app.azurewebsites.net
// @updateURL    https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/FE---Net-0-Customer-Warning.user.js
// @downloadURL  https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/FE---Net-0-Customer-Warning.user.js
// ==/UserScript==

(function () {
    'use strict';

    function applyNet0Warning() {
        const companyLink = document.querySelector('a#customerCompanyName');
        if (!companyLink) return;
        const href = companyLink.getAttribute('href');
        if (!href) return;
        const fullUrl = 'https://bristow-app.azurewebsites.net' + href;

        GM_xmlhttpRequest({
            method: 'GET',
            url: fullUrl,
            onload: function (response) {
                const parser = new DOMParser();
                const doc = parser.parseFromString(response.responseText, 'text/html');

                const thElements = doc.querySelectorAll('th');
                let termsValue = null;
                for (const th of thElements) {
                    if (th.textContent.trim() === 'Terms') {
                        const td = th.closest('tr')?.querySelector('td');
                        if (td) {
                            termsValue = td.textContent.trim();
                            break;
                        }
                    }
                }

                if (!termsValue) return;

                if (termsValue === 'Net 0') {
                    const well = document.querySelector('.well.well-sm');
                    if (well) {
                        well.style.backgroundColor = '#ffcdd2';
                        well.style.borderColor = '#e57373';
                        well.style.transition = 'background-color 0.3s ease';
                    }
                    const existingBadge = document.getElementById('net0-warning-badge');
                    if (!existingBadge) {
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
            },
            onerror: function () {
                console.warn('[Net 0 Warning] Failed to fetch company page:', fullUrl);
            }
        });
    }

    function resetWarning() {
        const well = document.querySelector('.well.well-sm');
        if (well) {
            well.style.backgroundColor = '';
            well.style.borderColor = '';
        }
        const badge = document.getElementById('net0-warning-badge');
        if (badge) badge.remove();
    }

    let lastCompanyHref = null;

    function checkForChange() {
        const link = document.querySelector('a#customerCompanyName');
        if (link) {
            const href = link.getAttribute('href');
            if (href && href !== lastCompanyHref) {
                lastCompanyHref = href;
                resetWarning();
                applyNet0Warning();
            }
        }
    }

    setInterval(checkForChange, 1000);
    checkForChange();
})();
