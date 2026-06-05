// ==UserScript==
// @name         TECH - Uppercase Forced work order description
// @namespace    http://tampermonkey.net/
// @version      1.3
// @updateURL    https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Uppercase-Forced-work-order-description.user.js
// @downloadURL  https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Uppercase-Forced-work-order-description.user.js
// @match        https://bristow-app.azurewebsites.net/Orders/Orders/Edit*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    function upperCaseField(body, fieldName) {
        const regex = new RegExp(`(${fieldName}=)([^&]*)`, 'g');

        return body.replace(regex, (match, key, value) => {
            try {
                // Convert + back to spaces BEFORE decoding
                const fixed = value.replace(/\+/g, '%20');

                const decoded = decodeURIComponent(fixed);
                const upper = decoded.toUpperCase();

                return key + encodeURIComponent(upper);
            } catch (e) {
                return match;
            }
        });
    }

    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.send = function(body) {
        try {
            if (typeof body === 'string') {
                body = upperCaseField(body, 'AerospaceHead.WorkOrderDesc');
                body = upperCaseField(body, 'AerospaceHead.InternalSnag');
                body = upperCaseField(body, 'AerospaceHead.CustomerSnag');
            }
        } catch (e) {}

        return originalSend.call(this, body);
    };

})();
