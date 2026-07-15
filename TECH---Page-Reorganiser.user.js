// ==UserScript==
// @name         TECH - Page Reorganiser
// @namespace    https://bristow-scripts.github.io/bristow-scripts
// @version      5.8
// @description  Cleans up the order page for techs. Uses TechShared core for observer management.
// @match        https://bristow-app.azurewebsites.net/*
// @noframes
// @grant        none
// @updateURL    https://bristow-scripts.github.io/bristow-scripts/TECH---Page-Reorganiser.meta.js
// @downloadURL  https://bristow-scripts.github.io/bristow-scripts/TECH---Page-Reorganiser.user.js
// @require      https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Shared-Core.user.js
// ==/UserScript==

(function () {
    'use strict';
    if (location.pathname.startsWith('/ReportGenerator')) return;
    var TS = window.TechShared || null;
    var STORAGE_KEY = 'techModeEnabled';
    var techMode = localStorage.getItem(STORAGE_KEY) !== 'false';

    let isOrderPage = location.pathname.startsWith('/Orders/Orders/Edit');
    let isJobsPage = location.pathname.startsWith('/Orders/Jobs/Edit');
    let isTechPage = isOrderPage || isJobsPage;

    // ── Static config ──
    const HIDDEN_BUTTON_IDS = ['forceCancel','forceComplete','emailSubmit','readyButton','completeButton'];
    const HIDDEN_HREF_FRAGMENTS = [
        'ReportName=Order_Report','ReportName=OrderAlt_Report','ReportName=AeroOrder_Report',
        'ReportName=Optional_Report1','ReportName=Optional_Report2','ReportName=Optional_Report3',
        'ReportName=Optional_Report4','ReportName=Optional_Report5','ReportName=Optional_Report6',
        'ReportName=Optional_Report8','ReportName=Job_Report','ReportName=JobDetailed_Report',
        '/TimeTracking/ServiceTimeTracking','/Orders/Jobs/PerformServices',
    ];
    const HIDDEN_HEADER_SECTIONS = ['#collapseContactInfo'];
    const HIDDEN_STATIC_SECTIONS = [
        '#collapseCustomerDocs','#collapseRQs','#collapsePOs','#collapseFulfillments',
        '#collapseInvoices','#collapseReturns','#collapseExpenses',
    ];
    const HIDDEN_FIELD_ROW_SELECTORS = [
        '#OrderHead_CustomFields_3__Date','#OrderHead_CustomFields_4__Date','#OrderHead_CustomFields_5__Date',
        '#OrderHead_CustomFields_6__Text',
        '#OrderHead_CustomFields_16__Label','#OrderHead_CustomFields_16__Text',
        '#AerospaceHead_CostCenter','#AerospaceHead_EASA',
        '#AerospaceHead_ShippedBy','#OrderHead_CustomerContactId','#OrderHead_TermsAndConditions',
        '#OrderHead_ShippingInstructions',
    ];
    const FROZEN_FIELDS = [
        { pickerId:'OrderHead_CustomerId' },{ pickerId:'OrderHead_SelectedOrderTaxes', isMulti:true },
        { pickerId:'OrderHead_Project', isPlainInput:true },{ pickerId:'OrderHead_CustomFields_1__OptionId' },
        { pickerId:'OrderHead_CustomFields_2__OptionId' },{ pickerId:'OrderHead_CustomFields_9__Text', isPlainInput:true },
        { pickerId:'AerospaceHead_AircraftTailNumber', isPlainInput:true },
        { pickerId:'AerospaceHead_SerialNumber', isPlainInput:true },
        { pickerId:'AerospaceHead_ControlledGood', isCheckbox:true },
        { pickerId:'AerospaceHead_IsWarranty', isCheckbox:true },
    ];
    const FREEZE_CLASS = 'tech-frozen-overlay';
    const INLINE_NOTE_CLASS = 'tech-inline-note-row';
    const PINNED_SERVICE_NUM = 'S-100217';
    const JOBS_HIDE_CLASS = 'tech-jobs-hidden';
    const HIDE_BUTTONS_CLASS = 'tech-buttons-hidden';

    let pinnedServiceCaptured = false;
    let techAjaxSaveUrl = null, techAjaxSaveData = null, techLineIdFieldName = null;

    // ═════════════════════════════════════════════════════════════════════════
    //  CSS — built ONCE, only rebuilt on techMode toggle
    // ═════════════════════════════════════════════════════════════════════════

    let staticCSS = null;

    function buildCSS(techModeOn) {
        if (!techModeOn) return '';
        if (staticCSS) return staticCSS;

        var css = [
            '#notificationArea, li:has(a[href="/Search/Index"]), li.dropdown:has(a[href="/Companies/Contacts/Index"]) { display: none !important; }',
            'li.dropdown:has(a[href="/Inventory"]) .dropdown-menu > li:not(:has(a[href="/Inventory"])) { display: none !important; }',
            'li.dropdown:has(a[href="/Orders/Orders"]) .dropdown-menu > li:not(:has(a[href="/Orders/Orders"])) { display: none !important; }',
            'li.dropdown:has(a[href="/Catalog/Parts/PartList"]) a[href="/Catalog/Services/ServiceList"] { display: none !important; }'
        ];

        if (isTechPage) {
            css.push(HIDDEN_HREF_FRAGMENTS.map(function(f){ return 'a[href*="' + f + '"]' }).join(',') + ' { display: none !important; }');
            css.push('button[onclick*="openAdvanceSelectByOption"],a.btn-success[href="#AddPartTarget"],a[href*="handler=Template"],button[onclick*="importWizard"],button[onclick*="addPartFromSearch"],button[onclick*="lockComponents"] { display: none !important; }');
            css.push('.row.content-group:has(a[data-target="#collapseRQs"]),.row.content-group:has(a[data-target="#collapseCustomerDocs"]) { display: none !important; }');
            css.push('a[href="#RQsTarget"] { display: none !important; }');
            css.push('.btn-group.btn-group-sm:has(a[href="#HeaderTarget"]) { margin-left: -710px; }');
            css.push('@media (max-width: 1400px) { .flex-row:has(.btn-group.btn-group-sm) > .custom-header-col:has(.btn-group) { flex-basis: 100% !important; order: 2 !important; margin-top: 8px !important; } .flex-row:has(.btn-group.btn-group-sm) > .custom-header-col:has(.btn-group) > .text-center { display: flex !important; flex-wrap: nowrap !important; justify-content: flex-start !important; align-items: center !important; gap: 4px !important; } .flex-row:has(.btn-group.btn-group-sm) > .vertical-col { order: 1 !important; } .flex-row:has(.btn-group.btn-group-sm) > .order-action-toolbar { order: 0 !important; } .btn-group.btn-group-sm:has(a[href="#HeaderTarget"]) { margin-left: 0 !important; } .btn-group.btn-group-sm:has(a[href="#HeaderTarget"]) + a.btn { margin-left: 0 !important; } }');
            css.push('.jump-target { scroll-margin-top: 100px !important; }');
            css.push('tr:has(a[href^="/Orders/Quotes/Edit"]),tr:has(span[data-valmsg-for="OrderHead.OrderTaxes"]) { display: none !important; }');
            css.push('tr:has(a.btn-primary[href="#AddPartTarget"]):has(a.btn-danger[onclick="removeComponent()"]) { display: none !important; }');
            css.push('button[onclick*="listBoxToComment"]:not([onclick*="OrderHead_CustomFields_0__OptionId"]),button[onclick*="dateBoxToComment"],button[onclick*="textBoxToComment"] { display: none !important; }');

            HIDDEN_HEADER_SECTIONS.forEach(function(s){
                css.push(s + ' { display: none !important; }');
                css.push('.well.well-sm:has(.accordion-toggle[data-target="' + s + '"]) { display: none !important; }');
            });
            HIDDEN_STATIC_SECTIONS.forEach(function(s){
                css.push(s + ' { display: none !important; }');
                css.push('.well.well-sm:has(.accordion-toggle[data-target="' + s + '"]) { display: none !important; }');
            });
            css.push('a.btn-info[href*="Optional_Report7"]:not([data-tech-inspected]) { display: none !important; }');
            HIDDEN_FIELD_ROW_SELECTORS.forEach(function(s){ css.push('tr:has(' + s + ') { display: none !important; }'); });
            css.push('tr:has(label[for="OrderHead_TermsAndConditions"]),tr:has(label[for="OrderHead_ShippingInstructions"]) { display: none !important; }');

            css.push('tr.line-item > td:has(input[id^="OrderLineCostMask_"]),tr.line-item > td:has(input[id^="OrderLineMarkup_"]),tr.line-item > td:has(input[id^="OrderLinePriceMask_"]),tr.line-item > td:has(input[id^="OrderLinePricedPerDefault_"]),tr.line-item > td:has(input[id^="OrderLineSubtotal_"]) { display: none !important; }');
            css.push('tr.sourceLine > td:has(input[id^="OrderLineSourceCost_"]),tr.sourceLine > td:has(input[id^="OrderLineSourceMarkup_"]),tr.sourceLine > td:has(input[id^="OrderLineSourcePrice_"]),tr.sourceLine > td:has(input[id^="OrderLineSourceSubtotal_"]) { display: none !important; }');
            css.push('tr.sourceLine > td:nth-child(8) { display: none !important; }');
            css.push('.col-md-8:has([data-target="#order_colAdvSearch"]),#order_colAdvSearch { display: none !important; }');
            css.push('#collapseAdditional > div:nth-child(10),#collapseAerospace > div:nth-child(1) { display: none !important; }');
            css.push('#collapseAerospace > div:nth-child(2) > table > tbody > tr:nth-child(2) { display: none !important; }');
            css.push('#collapseAerospace > div:nth-child(2) { display: inline-block !important; width: auto !important; float: none !important; vertical-align: top !important; margin-right: 20px; }');
            css.push('#collapseAerospace > div:nth-child(3) { display: inline-block !important; width: auto !important; float: none !important; vertical-align: top !important; }');
            css.push('#collapseAerospace > div:nth-child(3) > table > tbody { display: flex !important; flex-direction: row !important; }');
            css.push('#collapseAerospace > div:nth-child(3) > table > tbody > tr { margin-right: 20px; }');
            css.push('tr.forex { display: none !important; }');
            css.push('a.field-history-link { display: none !important; }');
            css.push('.form-group.label-card:has(#order_TagSearch_6c43dba4-9971-42a6-c94d-08dbe5ef7f76),.form-group.label-card:has(#order_TagSearch_6bbb6e2c-1dfc-4c89-8046-08dd04dda163) { display: none !important; }');
            css.push('.col-md-2:has(#order_CategorySearch),.col-md-2:has(#order_PartNumberSearch) { display: none !important; }');
            css.push('.form-group.label-card:has(#TagSearch_5f550335-12e2-418b-e158-08daa4c0721f),.form-group.label-card:has(#TagSearch_1e236238-0f22-4822-e159-08daa4c0721f),.form-group.label-card:has(#TagSearch_115ac658-0136-4f3b-e15a-08daa4c0721f),.form-group.label-card:has(#TagSearch_6a18f17d-4a4c-46cc-23c8-08daa573adc5) { display: none !important; }');
            css.push('.col-md-2:has(#ServiceCategorySearch),.col-md-2:has(#ServiceNumberSearch),.col-md-2:has(#ServiceAltServiceNumberSearch) { display: none !important; }');
            css.push('button.btn-danger[title="Hide All"],button.btn-warning[title="Hide"] { display: none !important; }');

            css.push('#collapseAdditional.collapse.in { display: grid !important; grid-template-columns: repeat(3, 1fr); column-gap: 20px; row-gap: 10px; align-items: start; }');
            css.push('#collapseAdditional.collapse.in > [class*="col-md-"] { width: auto !important; max-width: none !important; flex: none !important; margin-bottom: 0; }');
            css.push('#collapseAdditional .table.lq-table-info { margin-bottom: 0; }');
            css.push('#collapseAdditional .k-datepicker,#collapseAdditional .k-picker { width: 100% !important; }');
            css.push('#collapseAdditional > div:has(#OrderHead_CustomFields_16__Label) { display: none !important; }');
            css.push('#collapseAdditional > div:has(a[href*="ReportName=Optional_Report"]) { grid-column: 1 / -1; order: 1; }');
            css.push('#collapseAdditional > br { display: none; }');

            var fieldOrder = [
                ['OrderHead_CustomFields_0__Label',2,1], ['OrderHead_CustomFields_1__Label',3,2], ['OrderHead_CustomFields_2__Label',4,3],
                ['OrderHead_CustomFields_8__Label',5,1], ['OrderHead_CustomFields_7__Label',6,2], ['OrderHead_CustomFields_9__Label',7,3],
                ['OrderHead_CustomFields_3__Label',8,1], ['OrderHead_CustomFields_4__Label',9,2], ['OrderHead_CustomFields_5__Label',10,3],
                ['OrderHead_CustomFields_6__Label',11,1], ['OrderHead_CustomFields_15__Label',12,1]
            ];
            fieldOrder.forEach(function(f) {
                css.push('#collapseAdditional > div:has(#' + f[0] + ') { order: ' + f[1] + '; grid-column: ' + f[2] + '; }');
            });
            css.push('#collapseAdditional > div:has(#OrderHead_CustomFields_10__Label),#collapseAdditional > div:has(#OrderHead_CustomFields_11__Label),#collapseAdditional > div:has(#OrderHead_CustomFields_12__Label) { grid-column: 1 / -1; }');
            css.push('#collapseAdditional > div:has(#OrderHead_CustomFields_10__Label) { order: 13; }');
            css.push('#collapseAdditional > div:has(#OrderHead_CustomFields_11__Label) { order: 14; }');
            css.push('#collapseAdditional > div:has(#OrderHead_CustomFields_12__Label) { order: 15; }');
            css.push('#collapseAdditional > div:has(#OrderHead_CustomFields_13__Label) { grid-column: 1 / -1; order: 16; }');
            css.push('#collapseAdditional > div:has(#OrderHead_CustomFields_14__Label) { grid-column: 1 / -1; order: 17; }');
            // Hide the Uploads section
            //css.push('div.row:has(#HeaderInfo_Description),div.row:has(#HeaderInfo_JobNotes),div.row:has(.bom-line),div.row:has(input[value="Save"]),div.well-sm:has(a[data-target="#collapseDocs"]) { display: none !important; }');
        }
        staticCSS = css.join('\n');
        return staticCSS;
    }

    function applyTechStyles() {
        var style = document.getElementById('tech-mode-style');
        if (!style) return;
        if (techMode) {
            style.textContent = buildCSS(true);
        } else {
            style.textContent = '';
        }
    }

    function injectStaticStyles() {
        if (document.getElementById('tech-kendo-style')) return;
        var k = document.createElement('style');
        k.id = 'tech-kendo-style';
        k.textContent = '.k-master-row .k-table-td { vertical-align: middle !important; height: 37px; padding-top: 3px !important; padding-bottom: 3px !important; } input.form-control[id^="qtyInput_"] { height: auto !important; padding: 6px 12px; } table.table-bordered.table-condensed.small { margin-bottom: 0 !important; }';
        document.head.appendChild(k);
        var s = document.createElement('style');
        s.id = 'tech-mode-style';
        s.textContent = techMode ? buildCSS(true) : '';
        document.head.appendChild(s);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  Field freeze / unfreeze (only on techMode toggle, not every mutation)
    // ═════════════════════════════════════════════════════════════════════════

    function getPickerText(field) {
        var el = document.getElementById(field.pickerId);
        if (!el) return null;
        if (field.isCheckbox) return el.checked ? 'Yes' : 'No';
        if (field.isPlainInput) return el.value.trim() || '\u2014';
        if (field.isMulti) {
            var ms = el.closest('.k-multiselect');
            if (!ms) return null;
            var chips = ms.querySelectorAll('.k-chip-label');
            return chips.length ? Array.from(chips).map(function(c){ return c.textContent.trim() }).join(', ') : '\u2014';
        }
        var pk = el.closest('.k-picker');
        if (!pk) return null;
        var vt = pk.querySelector('.k-input-value-text');
        return vt ? vt.textContent.trim() : null;
    }

    function freezeFields() {
        if (!techMode) return;
        FROZEN_FIELDS.forEach(function(field) {
            var input = document.getElementById(field.pickerId);
            if (!input) return;
            var target = (field.isPlainInput || field.isCheckbox) ? input : input.closest('.k-picker, .k-multiselect');
            if (!target || target.dataset.techFrozen) return;
            var text = getPickerText(field);
            if (text === null) return;
            target.dataset.techFrozen = 'true';
            target.style.display = 'none';
            var span = document.createElement('span');
            span.className = FREEZE_CLASS;
            span.textContent = text;
            target.insertAdjacentElement('afterend', span);
        });
    }

    function unfreezeFields() {
        document.querySelectorAll('.' + FREEZE_CLASS).forEach(function(el){ el.remove() });
        document.querySelectorAll('[data-tech-frozen]').forEach(function(el){
            el.style.display = '';
            delete el.dataset.techFrozen;
        });
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  Dropdown filter — hide non-tech shelf options
    // ═════════════════════════════════════════════════════════════════════════

    var SHELF_WHITELIST = [
        'Work in Progress','Quality Control Shelf','Assigned',
        'Estimate Required Shelf','Parts Required Shelf',
        'Manual Required Shelf','Subcontract Shelf'
    ];

    function applyShelfFilter() {
        if (!techMode) return;
        document.querySelectorAll('#OrderHead_CustomFields_0__OptionId_listbox .k-list-item').forEach(function(li) {
            var txt = ((li.querySelector('.k-list-item-text') || {}).textContent || '').trim();
            li.style.display = SHELF_WHITELIST.indexOf(txt) < 0 ? 'none' : '';
        });
    }

    var shelfBodyObs = new MutationObserver(function() {
        var lb = document.getElementById('OrderHead_CustomFields_0__OptionId_listbox');
        if (lb) applyShelfFilter();
    });
    shelfBodyObs.observe(document.body, { childList: true, subtree: true });

    // ═════════════════════════════════════════════════════════════════════════
    //  Toggle tech mode
    // ═════════════════════════════════════════════════════════════════════════

    function restoreShelfFilter() {
    document.querySelectorAll('#OrderHead_CustomFields_0__OptionId_listbox .k-list-item').forEach(function(li) {
        li.style.display = '';
    });
}
    function toggleTechMode() {
        techMode = !techMode;
        localStorage.setItem(STORAGE_KEY, techMode);

        var track = document.getElementById('tm-mode-track');
        var knob = document.getElementById('tm-mode-knob');
        if (track) track.style.background = techMode ? '#28a745' : '#555';
        if (knob) knob.style.left = techMode ? '22px' : '2px';

        applyTechStyles();
        try {
            if (techMode) {
                hideButtonsById();
                hideHeaderSections();
                hideStaticSections();
                hideJobsContent();
                hideBtns();
                freezeFields();
                renameCompleteOrderByHeader();
                setTimeout(function(){ fixJumpLinks(); moveSerialNumberRow(); moveInspectionButton(); }, 100);
            } else {
                restoreButtonsById();
                restoreHeaderSections();
                restoreStaticSections();
                restoreJobsContent();
                restoreBtns();
                unfreezeFields();
                restoreSerialNumberRow();
                restoreOrderLineHeaders();
                restoreShelfFilter();
            }
        } catch(e) { console.warn('[TechMode] toggle error:', e); }
    }


    function hideButtonsById() {
        if (!techMode) return;
        HIDDEN_BUTTON_IDS.forEach(function(id){
            var el = document.getElementById(id);
            if (el) el.style.setProperty('display', 'none', 'important');
        });
        HIDDEN_HEADER_SECTIONS.forEach(function(target){
            var tog = document.querySelector('.accordion-toggle[data-target="' + target + '"]');
            if (tog) {
                var w = tog.closest('.well.well-sm');
                if (w) w.style.display = 'none';
            }
        });
    }


    function restoreButtonsById() {
        HIDDEN_BUTTON_IDS.forEach(function(id){
            var el = document.getElementById(id);
            if (el) el.style.setProperty('display', '', 'important');
        });
        HIDDEN_HEADER_SECTIONS.forEach(function(target){
            var tog = document.querySelector('.accordion-toggle[data-target="' + target + '"]');
            if (tog) {
                var w = tog.closest('.well.well-sm');
                if (w) w.style.display = '';
            }
        });
    }
    function hideHeaderSections() {
        if (!techMode) return;
        HIDDEN_HEADER_SECTIONS.forEach(function(target){
            var el = document.querySelector(target);
            if (el) { el.closest('.row') ? el.closest('.row').style.display = 'none' : el.style.display = 'none'; }
        });
    }
    function restoreHeaderSections() {
        HIDDEN_HEADER_SECTIONS.forEach(function(target){
            var el = document.querySelector(target);
            if (el) { el.closest('.row') ? el.closest('.row').style.display = '' : el.style.display = ''; }
        });
    }
    function hideStaticSections() {
        if (!techMode) return;
        HIDDEN_STATIC_SECTIONS.forEach(function(target){
            var tog = document.querySelector('.accordion-toggle[data-target="' + target + '"]');
            if (tog) {
                var w = tog.closest('.well.well-sm');
                if (w) { w.style.display = 'none'; var c = w.closest('.col-md-12'); if (c) c.style.display = 'none'; }
            }
        });
    }
    function restoreStaticSections() {
        HIDDEN_STATIC_SECTIONS.forEach(function(target){
            var tog = document.querySelector('.accordion-toggle[data-target="' + target + '"]');
            if (tog) {
                var w = tog.closest('.well.well-sm');
                if (w) { w.style.display = ''; var c = w.closest('.col-md-12'); if (c) c.style.display = ''; }
            }
        });
    }
    function hideJobsContent() {
        if (!isJobsPage || !techMode) return;
        document.querySelectorAll('.btn-group a[href="#HeaderTarget"]').forEach(function(a){
            if (a.textContent.trim() === 'Job Details') { var g = a.closest('.btn-group'); if (g && !g.classList.contains(JOBS_HIDE_CLASS)) { g.classList.add(JOBS_HIDE_CLASS); g.style.display = 'none'; } }
        });
        document.querySelectorAll('a[href="#partPicker"][role="tab"], li:has(a[href="#partPicker"])').forEach(function(el){
            if (!el.classList.contains(JOBS_HIDE_CLASS)) { el.classList.add(JOBS_HIDE_CLASS); el.style.display = 'none'; }
        });
        document.querySelectorAll('#partSearchContainer, #partPicker').forEach(function(el){
            if (!el.classList.contains(JOBS_HIDE_CLASS)) { el.classList.add(JOBS_HIDE_CLASS); el.style.display = 'none'; }
        });
        var st = document.querySelector('a[href="#servicePicker"][role="tab"]');
        if (st) {
            document.querySelectorAll('.nav-tabs li').forEach(function(l){ l.classList.remove('active') });
            st.closest('li').classList.add('active');
            document.querySelectorAll('.tab-pane').forEach(function(p){ p.classList.remove('active','in') });
            var sp = document.getElementById('servicePicker');
            if (sp) sp.classList.add('active','in');
        }
    }
    function restoreJobsContent() {
        if (!isJobsPage) return;
        document.querySelectorAll('.' + JOBS_HIDE_CLASS).forEach(function(el){ el.style.display = ''; el.classList.remove(JOBS_HIDE_CLASS) });
    }
    function hideBtns() {
        if (!techMode || !isOrderPage) return;
        document.querySelectorAll('table.table-bordered.table-condensed.small .btn-warning').forEach(function(btn){
            if (!btn.classList.contains(HIDE_BUTTONS_CLASS)) { btn.classList.add(HIDE_BUTTONS_CLASS); btn.style.display = 'none'; }
        });
        document.querySelectorAll('tr.sourceLine .btn-info').forEach(function(btn){
            if (!btn.classList.contains(HIDE_BUTTONS_CLASS)) { btn.classList.add(HIDE_BUTTONS_CLASS); btn.style.display = 'none'; }
        });
    }
    function restoreBtns() {
        document.querySelectorAll('.' + HIDE_BUTTONS_CLASS).forEach(function(el){ el.style.display = ''; el.classList.remove(HIDE_BUTTONS_CLASS) });
    }
    function renameCompleteOrderByHeader() {
        if (!techMode) return;
        (document.getElementById('HeaderSection') || document).querySelectorAll('th').forEach(function(th){
            if (th.textContent.trim() === 'Complete Order By') th.textContent = 'Completed Order On';
        });
    }
    function fixJumpLinks() {
        if (!techMode) return;
        document.querySelectorAll('.btn-group.btn-group-sm a[href^="#"]').forEach(function(btn){
            btn.onclick = function(e) {
                e.preventDefault();
                var targetId = this.getAttribute('href').substring(1);
                var target = document.getElementById(targetId);
                if (!target) return;
                var at = document.querySelector('.accordion-toggle[data-target="#' + targetId + '"]');
                if (at && at.classList.contains('collapsed')) at.click();
                setTimeout(function(){
                    var r = target.getBoundingClientRect();
                    window.scrollTo({ top: window.scrollY + r.top - 80, behavior:'smooth' });
                }, 300);
            };
        });
    }
    function hideOrderLineHeaders() {
        if (!techMode) return;
        document.querySelectorAll('tr.lq-table-header-w-options th').forEach(function(th){
            if (['Cost','Markup','Price','Per','Subtotal'].indexOf(th.textContent.trim()) !== -1) {
                th.style.setProperty('display','none','important');
            }
        });
    }
    function restoreOrderLineHeaders() {
        document.querySelectorAll('tr.lq-table-header-w-options th').forEach(function(th){
            if (['Cost','Markup','Price','Per','Subtotal'].indexOf(th.textContent.trim()) !== -1) {
                th.style.display = '';
            }
        });
    }

    function moveSerialNumberRow() {
        if (!techMode) return;
        var row = document.querySelector('#collapseAerospace tr:has(#AerospaceHead_ComponentId)');
        if (!row) return;
        var cells = row.children;
        if (cells.length < 4) return;
        var existing = row.parentNode.querySelector('tr[data-serial-clone]');
        if (existing) { existing.remove(); cells[2].style.display = ''; cells[3].style.display = ''; }
        var newRow = document.createElement('tr');
        newRow.dataset.serialClone = 'true';
        var snTh = cells[2].cloneNode(true);
        var snTd = cells[3].cloneNode(true);
        newRow.appendChild(snTh); newRow.appendChild(snTd);
        row.parentNode.insertBefore(newRow, row.nextSibling);
        cells[2].style.display = 'none'; cells[3].style.display = 'none';
        snTd.style.maxWidth = '350px';
        var snInput = snTd.querySelector('input');
        if (snInput && !snInput.dataset.techFrozen) {
            var val = snInput.value || snInput.textContent || '\u2014';
            snInput.style.display = 'none';
            snInput.dataset.techFrozen = 'true';
            var overlay = document.createElement('span');
            overlay.className = FREEZE_CLASS;
            overlay.textContent = val;
            snInput.insertAdjacentElement('afterend', overlay);
        }
    }
    function restoreSerialNumberRow() {
        var existing = document.querySelector('tr[data-serial-clone]');
        if (!existing) return;
        var prevRow = existing.previousElementSibling;
        if (prevRow && prevRow.children.length >= 4) { prevRow.children[2].style.display = ''; prevRow.children[3].style.display = ''; }
        existing.remove();
    }
    function moveInspectionButton() {
        var group = document.querySelector('.btn-group.btn-group-sm:has(a[href="#HeaderTarget"])');
        if (!group) return;
        var parent = group.parentNode;
        var btn = document.querySelector('a.btn-info[href*="Optional_Report7"]:not([data-tech-inspected])');
        if (!btn) return;
        parent.querySelectorAll('a[data-tech-inspected]').forEach(function(el){ el.remove() });
        btn.dataset.techInspected = 'true';
        btn.className = 'btn btn-default btn-sm';
        btn.style.marginLeft = '8px';
        btn.style.display = '';
        parent.insertBefore(btn, group.nextSibling);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  Inline notes — runs once per full mutation cycle, no 2s poll
    // ═════════════════════════════════════════════════════════════════════════

    function getExistingNoteText(lineId) {
        var row = document.getElementById('OrderLineNotes_' + lineId);
        if (!row) return '';
        var span = row.querySelector('span');
        return span ? span.textContent.trim() : '';
    }
    function addInlineNoteRow(lineRow) {
        var lineId = lineRow.id.replace('OrderLine_', '');
        if (!lineId || lineRow.dataset.techNoteAdded) return;
        var textarea = document.createElement('textarea');
        textarea.className = 'form-control';
        textarea.rows = 1;
        textarea.style.cssText = 'width:65%;max-width:400px;display:inline-block;vertical-align:middle;resize:vertical;';
        textarea.placeholder = 'Add note / Missing PO #';
        textarea.value = getExistingNoteText(lineId);
        var saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'btn btn-sm btn-primary';
        saveBtn.style.marginLeft = '6px';
        saveBtn.textContent = 'Save Note';
        saveBtn.onclick = function(){ saveInlineNote(lineId, textarea, saveBtn); };
        textarea.onkeydown = function(e){
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveBtn.click(); }
        };
        var labelTable = lineRow.querySelector('.condensedLabel');
        if (labelTable) {
            var tbl = labelTable.closest('table.table-bordered.table-condensed.small');
            if (tbl) {
                var tb = tbl.querySelector('tbody') || tbl;
                var noteRow = document.createElement('tr');
                noteRow.className = INLINE_NOTE_CLASS;
                noteRow.dataset.lineId = lineId;
                noteRow.dataset.placement = 'source-area';
                var td = document.createElement('td');
                td.colSpan = 2;
                td.style.cssText = 'padding:0px 8px;line-height:1';
                td.appendChild(textarea); td.appendChild(saveBtn);
                noteRow.appendChild(td);
                tb.appendChild(noteRow);
                lineRow.dataset.techNoteAdded = 'true';
                return;
            }
        }
        var sourceArea = document.getElementById('OrderLineSourceArea_' + lineId);
        if (sourceArea) {
            var contentTd = sourceArea.querySelector('td');
            if (contentTd) {
                var noteDiv = document.createElement('div');
                noteDiv.className = INLINE_NOTE_CLASS;
                noteDiv.dataset.lineId = lineId;
                noteDiv.dataset.placement = 'source-area';
                noteDiv.style.cssText = 'padding:0px 8px;border-top:1px solid #ddd';
                noteDiv.appendChild(textarea); noteDiv.appendChild(saveBtn);
                contentTd.appendChild(noteDiv);
                lineRow.dataset.techNoteAdded = 'true';
                return;
            }
        }
        var colCount = lineRow.children.length;
        var newRow = document.createElement('tr');
        newRow.className = INLINE_NOTE_CLASS;
        newRow.dataset.lineId = lineId;
        var tdC = document.createElement('td');
        tdC.colSpan = colCount;
        tdC.style.padding = '0px 8px';
        tdC.appendChild(textarea); tdC.appendChild(saveBtn);
        newRow.appendChild(tdC);
        lineRow.parentNode.insertBefore(newRow, lineRow.nextSibling);
        lineRow.dataset.techNoteAdded = 'true';
    }
    function repositionNoteRow(lineId) {
        var noteRow = document.querySelector('.' + INLINE_NOTE_CLASS + '[data-line-id="' + lineId + '"]');
        if (!noteRow) return;
        var sa = document.getElementById('OrderLineSourceArea_' + lineId);
        if (sa && sa.parentNode === noteRow.parentNode && (sa.compareDocumentPosition(noteRow) & Node.DOCUMENT_POSITION_FOLLOWING)) {
            sa.parentNode.insertBefore(noteRow, sa);
        }
    }
    function updateDisplayedNote(lineId, text) {
        var notesRow = document.getElementById('OrderLineNotes_' + lineId);
        if (notesRow) {
            var span = notesRow.querySelector('span[style*="white-space"]');
            if (span) span.textContent = text;
        } else {
            var lineRow = document.getElementById('OrderLine_' + lineId);
            if (lineRow && lineRow.parentNode) {
                var newRow = document.createElement('tr');
                newRow.id = 'OrderLineNotes_' + lineId;
                newRow.className = 'line-notes group_' + lineId;
                var td1 = document.createElement('td');
                var td2 = document.createElement('td');
                td2.colSpan = 8;
                var span = document.createElement('span');
                span.style.whiteSpace = 'pre-line';
                span.textContent = text;
                td2.appendChild(span);
                newRow.appendChild(td1); newRow.appendChild(td2);
                var sa = document.getElementById('OrderLineSourceArea_' + lineId);
                if (sa && sa.parentNode === lineRow.parentNode) { lineRow.parentNode.insertBefore(newRow, sa); }
                else { lineRow.parentNode.insertBefore(newRow, lineRow.nextSibling); }
            }
        }
    }
    function saveInlineNote(lineId, textarea, saveBtn) {
        var noteText = textarea.value;
        var origLabel = saveBtn.textContent;
        saveBtn.textContent = 'Saving...';
        saveBtn.disabled = true;
        if (techAjaxSaveUrl && techAjaxSaveData && techLineIdFieldName) {
            directSave(lineId, noteText, saveBtn, origLabel);
        } else {
            saveViaPopup(lineId, noteText, saveBtn, origLabel);
        }
    }
    function directSave(lineId, noteText, saveBtn, origLabel) {
        var data = techAjaxSaveData;
        var url = techAjaxSaveUrl;
        data = data.replace(/(^|&)Note=[^&]*/, '$1Note=' + encodeURIComponent(noteText));
        var escField = techLineIdFieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        var origMatch = data.match(new RegExp('(?:^|&)' + escField + '=([^&]+)'));
        var origLineId = origMatch ? decodeURIComponent(origMatch[1]) : null;
        if (origLineId && origLineId !== lineId) {
            var escOrig = origLineId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            data = data.replace(new RegExp(escOrig, 'g'), lineId);
            url = url.replace(new RegExp(escOrig, 'g'), lineId);
        }
        $.ajax({
            url: url, type: 'POST', data: data, processData: false,
            contentType: 'application/x-www-form-urlencoded; charset=UTF-8',
            success: function(){
                closeWindow();
                updateDisplayedNote(lineId, noteText);
                saveBtn.textContent = 'Saved \u2713';
                saveBtn.disabled = false;
                setTimeout(function(){ saveBtn.textContent = origLabel; }, 1500);
                setTimeout(function(){ repositionNoteRow(lineId) }, 200);
            },
            error: function(){
                techAjaxSaveUrl = null; techAjaxSaveData = null; techLineIdFieldName = null;
                saveBtn.textContent = 'Saving...';
                saveViaPopup(lineId, noteText, saveBtn, origLabel);
            }
        });
    }
    function saveViaPopup(lineId, noteText, saveBtn, origLabel) {
        var hider = document.createElement('style');
        hider.id = 'tech-popup-hider';
        hider.textContent = '.k-window, .k-overlay { display: none !important; }';
        document.head.appendChild(hider);
        var origClose = window.closeWindow;
        window.closeWindow = function(){
            document.getElementById('tech-popup-hider')?.remove();
            updateDisplayedNote(lineId, noteText);
            window.closeWindow = origClose;
            return origClose.apply(this, arguments);
        };
        var captureDone = false;
        var prefilter = function(options){
            if (captureDone) return;
            if (options.type && options.type.toUpperCase() === 'POST' && options.url) {
                techAjaxSaveUrl = options.url;
                techAjaxSaveData = typeof options.data === 'string' ? options.data : (options.data && typeof options.data === 'object' ? $.param(options.data) : null);
                captureDone = true;
            }
        };
        $.ajaxPrefilter(prefilter);
        openLineDetails(lineId);
        var tryFill = function(attemptsLeft){
            var noteField = document.getElementById('Note');
            var dialog = document.querySelector('.k-window');
            if (!noteField || !dialog) {
                if (attemptsLeft <= 0) { saveBtn.textContent = 'Failed'; saveBtn.disabled = false; document.getElementById('tech-popup-hider')?.remove(); return; }
                setTimeout(function(){ tryFill(attemptsLeft - 1); }, 100);
                return;
            }
            if (!techLineIdFieldName) {
                document.querySelectorAll('#orderLineDetailsForm input, #orderLineDetailsForm select').forEach(function(el){
                    if (el.name && !el.disabled && String(el.value) === String(lineId)) { techLineIdFieldName = el.name; }
                });
            }
            noteField.value = noteText;
            var popupSaveBtn = document.querySelector('#orderLineDetailsForm input[type="button"][value="Save"]');
            if (!popupSaveBtn) { saveBtn.textContent = 'Failed'; saveBtn.disabled = false; closeWindow(); document.getElementById('tech-popup-hider')?.remove(); return; }
            popupSaveBtn.click();
            document.getElementById('tech-popup-hider')?.remove();
            setTimeout(function(){ closeWindow(); repositionNoteRow(lineId); saveBtn.textContent = 'Saved \u2713'; saveBtn.disabled = false; setTimeout(function(){ saveBtn.textContent = origLabel; }, 1500); }, 2000);
        };
        setTimeout(function(){ tryFill(15); }, 150);
    }
    function addInlineNotesToAllLines() {
        if (!isOrderPage) return;
        document.querySelectorAll('tr.line-item[id^="OrderLine_"]').forEach(function(lineRow){
            var lineId = lineRow.id.replace('OrderLine_', '');
            if (!lineId) return;
            var existing = document.querySelector('.' + INLINE_NOTE_CLASS + '[data-line-id="' + lineId + '"]');
            if (existing) {
                if (existing.dataset.placement !== 'source-area') { existing.remove(); delete lineRow.dataset.techNoteAdded; }
                else { lineRow.dataset.techNoteAdded = 'true'; return; }
            }
            if (!lineId || lineRow.dataset.techNoteAdded) return;
            addInlineNoteRow(lineRow);
        });
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  Service grid helpers
    // ═════════════════════════════════════════════════════════════════════════

    function preserveServiceGridColWidths() {
        var grid = document.querySelector('#serviceGrid');
        if (!grid) return;
        grid.querySelectorAll('colgroup > col').forEach(function(col, i){
            if (col.style.width && /^\d+px$/.test(col.style.width) && parseInt(col.style.width) >= 100) return;
            var headers = grid.querySelectorAll('th[data-title]');
            var th = headers[i];
            if (!th) return;
            var title = th.getAttribute('data-title');
            if (title === 'Add' || title === 'Add Component') col.style.width = '120px';
        });
    }
    function captureAndPinService() {
        if (!isOrderPage || pinnedServiceCaptured) return;
        if (document.querySelector('#tech-pinned-service')) return;
        var grid = document.querySelector('#serviceGrid');
        if (!grid) return;
        var rows = (grid.querySelector('tbody') || grid).querySelectorAll('tr[role="row"]');
        for (var i = 0; i < rows.length; i++) {
            if (rows[i].textContent.includes(PINNED_SERVICE_NUM)) {
                pinRow(rows[i], grid);
                return;
            }
        }
    }
    function pinRow(row, grid) {
        var clone = row.cloneNode(true);
        var cb = clone.querySelector('input[type="checkbox"]');
        if (cb) {
            cb.addEventListener('change', function(){
                grid.querySelectorAll('tbody tr[role="row"]').forEach(function(r){
                    var c = r.querySelector('input[type="checkbox"]');
                    if (c && r.textContent.includes(PINNED_SERVICE_NUM)) { c.checked = this.checked; c.dispatchEvent(new Event('change',{bubbles:true})); }
                }.bind(this));
            });
        }
        var section = document.createElement('div');
        section.id = 'tech-pinned-service';
        section.style.cssText = 'margin-bottom:8px;border:1px solid #4CAF50;border-radius:4px;background:#f1f9f1';
        clone.querySelectorAll('input.form-control').forEach(function(inp){ inp.style.cssText = 'width:70px' });
        var table = document.createElement('table');
        table.style.cssText = 'width:100%;font-size:13px;border-collapse:collapse';
        table.className = 'table table-bordered';
        var cg = grid.querySelector('colgroup');
        if (cg) table.appendChild(cg.cloneNode(true));
        var thead = grid.querySelector('thead');
        if (thead) {
            var hr = thead.querySelector('tr');
            if (hr) { var hd = document.createElement('thead'); hd.appendChild(hr.cloneNode(true)); table.appendChild(hd); }
        }
        var tb2 = document.createElement('tbody');
        tb2.appendChild(clone);
        table.appendChild(tb2);
        section.appendChild(table);
        grid.parentNode.insertBefore(section, grid);
        pinnedServiceCaptured = true;
    }
    function watchServiceGrid() {
        if (!isOrderPage) return;
        preserveServiceGridColWidths();
        captureAndPinService();
        if (pinnedServiceCaptured) return;
        var grid = document.querySelector('#serviceGrid');
        if (!grid || grid.dataset.techWatchSetup) return;
        grid.dataset.techWatchSetup = '1';
        var kg;
        try { kg = $(grid).data('kendoGrid'); } catch(e){}
        if (kg && kg.dataSource) {
            kg.bind('dataBound', function(){ preserveServiceGridColWidths(); });
            kg.dataSource.filter({ field:'Description', operator:'contains', value:'Parts' });
            var onBound = function(){
                if (pinnedServiceCaptured) return;
                captureAndPinService();
                if (pinnedServiceCaptured) { kg.unbind('dataBound', onBound); kg.dataSource.filter(null); }
            };
            kg.bind('dataBound', onBound);
        }
        var obs = new MutationObserver(function(){
            if (!pinnedServiceCaptured) {
                setTimeout(function(){
                    captureAndPinService();
                    if (pinnedServiceCaptured) { obs.disconnect(); try { $(grid).data('kendoGrid').dataSource.filter(null); } catch(e){} }
                }, 50);
            }
        });
        obs.observe(grid, { childList:true, subtree:true });
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  MutationObserver — uses TechShared observer manager or falls back
    // ═════════════════════════════════════════════════════════════════════════

    function runAllUpdates() {
        isOrderPage = location.pathname.startsWith('/Orders/Orders/Edit');
        isJobsPage = location.pathname.startsWith('/Orders/Jobs/Edit');
        isTechPage = isOrderPage || isJobsPage;

        if (techMode) {
            unfreezeFields(); hideButtonsById(); hideHeaderSections();
            hideJobsContent(); freezeFields(); renameCompleteOrderByHeader();
            fixJumpLinks(); moveSerialNumberRow(); moveInspectionButton();
            hideBtns(); hideOrderLineHeaders();
        }
        addInlineNotesToAllLines();
        if (!pinnedServiceCaptured) { captureAndPinService(); }
    }

    if (TS) {
        TS.observer.register(runAllUpdates, { debounce: 300 });
    } else {
        var mutationTimer = null;
        var isTyping = false;
        var singleObserver = new MutationObserver(function(mutations){
            if (isTyping) return;
            clearTimeout(mutationTimer);
            mutationTimer = setTimeout(runAllUpdates, 300);
        });
        singleObserver.observe(document.querySelector('#order-line-area') || document.body, { childList: true, subtree: true });
        document.addEventListener('focusin', function(e) {
            if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') isTyping = true;
        });
        document.addEventListener('focusout', function(e) {
            if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') {
                isTyping = false;
                clearTimeout(mutationTimer);
                mutationTimer = setTimeout(function() { addInlineNotesToAllLines(); }, 100);
            }
        });
        singleObserver.observe(document.body, { childList: true, subtree: true });
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  Toggle button
    // ═════════════════════════════════════════════════════════════════════════

    function createToggleButton() {
        var wrapper = document.createElement('div');
        Object.assign(wrapper.style, { position:'fixed', top:'14px', right:'100px', zIndex:9999, display:'flex', alignItems:'center', gap:'8px' });
        var label = document.createElement('span');
        label.textContent = 'Tech Mode';
        Object.assign(label.style, { color:'#ffffff', fontSize:'13px', fontWeight:'bold' });
        var track = document.createElement('div');
        track.id = 'tm-mode-track';
        Object.assign(track.style, { width:'40px', height:'20px', borderRadius:'10px', background:techMode?'#28a745':'#555', position:'relative', cursor:'pointer' });
        var knob = document.createElement('div');
        knob.id = 'tm-mode-knob';
        Object.assign(knob.style, { width:'16px', height:'16px', borderRadius:'50%', background:'#fff', position:'absolute', top:'2px', left:techMode?'22px':'2px' });
        track.appendChild(knob);
        wrapper.appendChild(label);
        wrapper.appendChild(track);
        track.onclick = toggleTechMode;
        document.body.appendChild(wrapper);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  Keyboard shortcuts
    // ═════════════════════════════════════════════════════════════════════════

    function setupKeyboardShortcuts() {
        document.addEventListener('keydown', function(e){
            if (e.ctrlKey && e.key === 's') {
                e.preventDefault();
                setTimeout(function(){
                    var hb = document.querySelector('button[onclick*="saveOrderHeader"]');
                    if (hb) hb.click();
                }, 100);
                setTimeout(function(){
                    var lb = document.querySelector('button[onclick*="saveLines"], button[title="Save Lines"]');
                    if (lb) lb.click();
                }, 600);
            }
            if (e.ctrlKey && e.key === 'e') {
                e.preventDefault();
                var eb = document.querySelector('button[onclick*="refreshOrderHeader"]');
                if (eb) eb.click();
            }
        });
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  Init
    // ═════════════════════════════════════════════════════════════════════════

    injectStaticStyles();
    createToggleButton();
    setupKeyboardShortcuts();

    // Initial state
    if (techMode) {
        hideButtonsById();
        hideHeaderSections();
        hideJobsContent();
    }

    // Watch tab switches for service grid
    document.addEventListener('shown.bs.tab', function(e){
        if (e.target.getAttribute('href') === '#servicePicker') {
            setTimeout(watchServiceGrid, 100);
        }
    });

    // Initial delayed setup
    setTimeout(function(){
        moveInspectionButton();
        watchServiceGrid();
        preserveServiceGridColWidths();
        addInlineNotesToAllLines();
        hideBtns();
        hideOrderLineHeaders();
        if (techMode) { freezeFields(); renameCompleteOrderByHeader(); fixJumpLinks(); moveSerialNumberRow(); }
    }, 500);
})();
