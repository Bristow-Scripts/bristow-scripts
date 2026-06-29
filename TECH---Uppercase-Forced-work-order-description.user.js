// ==UserScript==
// @name         TECH - Uppercase Forced work order description
// @namespace    http://tampermonkey.net/
// @version      1.5
// @updateURL    https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Uppercase-Forced-work-order-description.user.js
// @downloadURL  https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Uppercase-Forced-work-order-description.user.js
// @require      https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Shared-Core.user.js
// @match        https://bristow-app.azurewebsites.net/Orders/Orders/Edit*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    var TARGET_FIELDS = ['AerospaceHead.WorkOrderDesc', 'AerospaceHead.InternalSnag', 'AerospaceHead.CustomerSnag'];

    function upperCaseField(body, fieldName) {
        var regex = new RegExp('(' + fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=)([^&]*)', 'g');
        return body.replace(regex, function(match, key, value) {
            try {
                return key + encodeURIComponent(decodeURIComponent(value.replace(/\+/g, '%20')).toUpperCase());
            } catch (e) {
                return match;
            }
        });
    }

    var originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function(body) {
        if (typeof body !== 'string') return originalSend.call(this, body);
        if (body.indexOf('AerospaceHead.') === -1) return originalSend.call(this, body);

        try {
            for (var i = 0; i < TARGET_FIELDS.length; i++) {
                body = upperCaseField(body, TARGET_FIELDS[i]);
            }
            if (window.TechShared) window.TechShared.log('Uppercase applied to POST body');
        } catch (e) {}
        return originalSend.call(this, body);
    };
})();
