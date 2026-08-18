// ==UserScript==
// @name         FE - Parts Creation Guard
// @namespace    https://bristow-scripts.github.io/bristow-scripts
// @version      1.3
// @description  Shows a note when the Airworthiness Directives tag is blank; blocks Save when the Alternate Part Number is missing from the Description on the PartList Edit page
// @match        https://bristow-app.azurewebsites.net/Catalog/Parts/PartList/Edit*
// @noframes
// @grant        none
// @updateURL    https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/FE---Parts-Creation-Guard.user.js
// @downloadURL  https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/FE---Parts-Creation-Guard.user.js
// @tag          LIB
// ==/UserScript==

(function () {
    'use strict';

    var TAG_INPUT_ID = 'EditPartModel_PartTags_3__selectedTagValue';
    var ALT_PART_INPUT_ID = 'EditPartModel_Part_AltPartNum';
    var DESC_INPUT_ID = 'EditPartModel_Part_Description';
    var SAVE_SELECTOR = 'input[type="submit"][value="Save"]';

    function field(id) {
        return document.getElementById(id);
    }

    function isBlank() {
        var el = field(TAG_INPUT_ID);
        if (!el) return false;
        return (el.value || '').trim() === '';
    }

    // Whole-token match: AltPartNum must appear in Description as its own token
    // (surrounded by non-alphanumerics or string edges) — "S18" must NOT match
    // "S1840510-02".
    function partNumberMatch(desc, partNum) {
        if (!desc || !partNum) return false;
        var p = String(partNum).toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp('(^|[^A-Z0-9])' + p + '($|[^A-Z0-9])').test(desc.toUpperCase());
    }

    function isMismatch() {
        var alt = field(ALT_PART_INPUT_ID);
        var desc = field(DESC_INPUT_ID);
        if (!alt || !desc) return false;
        var av = (alt.value || '').trim();
        var dv = (desc.value || '').trim();
        if (!av || !dv) return false;
        return !partNumberMatch(dv, av);
    }

    // ── Warning note above the Save button (AD tag blank) ──
    function ensureWarning() {
        var warn = document.getElementById('parts-tag-warning');
        if (!warn) {
            warn = document.createElement('div');
            warn.id = 'parts-tag-warning';
            warn.style.cssText = 'display:none;background:#fdecea;color:#c0392b;border:1px solid #c0392b;border-radius:4px;padding:8px 12px;font-size:13px;font-family:system-ui,sans-serif;margin-bottom:8px;font-weight:600;';
            warn.textContent = 'Airworthiness Directives tag is blank.';
            var save = document.querySelector(SAVE_SELECTOR);
            if (save) {
                var container = save.closest('.form-group');
                (container || save).parentNode.insertBefore(warn, (container || save));
            } else {
                document.body.appendChild(warn);
            }
        }
        return warn;
    }

    function refreshWarning() {
        var warn = ensureWarning();
        warn.style.display = isBlank() ? 'block' : 'none';
    }

    // ── Mismatch block ──
    function closePopup() {
        var o = document.getElementById('parts-mismatch-overlay');
        if (o) o.remove();
    }

    function showMismatchPopup() {
        closePopup();
        var alt = field(ALT_PART_INPUT_ID);
        var desc = field(DESC_INPUT_ID);
        var altVal = alt ? (alt.value || '').trim() : '';
        var descVal = desc ? (desc.value || '').trim() : '';

        if (alt) {
            alt.style.borderColor = '#c0392b';
            setTimeout(function () { alt.style.borderColor = ''; }, 2500);
        }

        var overlay = document.createElement('div');
        overlay.id = 'parts-mismatch-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:20000;display:flex;align-items:flex-start;justify-content:center;padding-top:12vh;';

        var box = document.createElement('div');
        box.style.cssText = 'background:#fff;border-radius:6px;width:460px;max-width:92vw;box-shadow:0 6px 24px rgba(0,0,0,.35);padding:18px 20px;font-family:system-ui,sans-serif;color:#222;box-sizing:border-box;';

        var h = document.createElement('h4');
        h.style.cssText = 'margin:0 0 10px;color:#c0392b;';
        h.textContent = 'Part Number Mismatch';

        var msg = document.createElement('p');
        msg.style.cssText = 'margin:0 0 14px;font-size:13px;white-space:pre-line;';
        msg.textContent = 'There is a mismatch between the Alternate Part Number and the Description.\n\n' +
            'Alternate Part Number: "' + altVal + '"\nDescription: "' + descVal + '"\n\n' +
            'Update the Description so it includes the Alternate Part Number before saving.';

        var actions = document.createElement('div');
        actions.style.cssText = 'margin-top:16px;text-align:right;';

        var ok = document.createElement('button');
        ok.type = 'button';
        ok.textContent = 'OK';
        ok.style.cssText = 'padding:6px 18px;border:none;border-radius:4px;background:#c0392b;color:#fff;font-size:13px;font-weight:600;cursor:pointer;';
        ok.addEventListener('click', closePopup);
        ok.focus();

        actions.appendChild(ok);
        box.appendChild(h);
        box.appendChild(msg);
        box.appendChild(actions);
        overlay.appendChild(box);

        overlay.addEventListener('click', function (e) { if (e.target === overlay) closePopup(); });
        document.addEventListener('keydown', function onKey(e) {
            if (e.key === 'Escape') { closePopup(); document.removeEventListener('keydown', onKey); }
        });

        document.body.appendChild(overlay);
    }

    function mismatchBlocked() {
        if (!isMismatch()) return false;
        showMismatchPopup();
        return true;
    }

    function setup() {
        var save = document.querySelector(SAVE_SELECTOR);
        if (!save || save.__partsGuard) return;
        save.__partsGuard = true;

        save.addEventListener('click', function (e) {
            refreshWarning();
            if (mismatchBlocked()) {
                e.preventDefault();
                e.stopPropagation();
                return false;
            }
        });

        var form = save.closest('form');
        if (form) {
            form.addEventListener('submit', function (e) {
                refreshWarning();
                if (mismatchBlocked()) {
                    e.preventDefault();
                    e.stopPropagation();
                    return false;
                }
            });
        }

        [TAG_INPUT_ID, ALT_PART_INPUT_ID, DESC_INPUT_ID].forEach(function (id) {
            var el = field(id);
            if (el && el.addEventListener) el.addEventListener('change', refreshWarning);
        });
    }

    refreshWarning();
    var tries = 0;
    var id = setInterval(function () {
        tries++;
        setup();
        refreshWarning();
        if ((field(TAG_INPUT_ID) && document.querySelector(SAVE_SELECTOR)) || tries > 80) clearInterval(id);
    }, 250);
})();