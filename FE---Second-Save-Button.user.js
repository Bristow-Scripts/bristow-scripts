// ==UserScript==
// @name         FE - Second Save Button
// @namespace    http://tampermonkey.net/
// @version      1.4
// @description  Adds back the missing second Save button in the header
// @match        https://bristow-app.azurewebsites.net/Orders/Orders/Edit*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    window.addEventListener('load', () => {

        const btn = document.createElement('button');
        btn.className = 'btn btn-primary pull-right';
        btn.title = 'Save Lines';
        btn.style.cssText = `
            position: fixed;
            top: 160px;
            right: 80px;
            z-index: 99999;
            box-shadow: 0 2px 6px rgba(0,0,0,0.35);
            margin: 0;
        `;
        btn.innerHTML = `<span class="glyphicon glyphicon-floppy-disk" aria-hidden="true"></span> Save`;
        btn.addEventListener('click', () => {
            if (typeof saveLines === 'function') saveLines();
            else console.warn('saveLines() not found.');
        });

        document.body.appendChild(btn);
    });
})();
