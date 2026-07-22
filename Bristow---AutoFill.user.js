// ==UserScript==
// @name         Bristow - Auto-Fill
// @namespace    http://tampermonkey.net/
// @version      6.5
// @updateURL    https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/Bristow---Auto-Fill.user.js
// @downloadURL  https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/Bristow---AutoFill.user.js
// @description  Type /wip to fully automate starting a work order: status, docs, text, parts, tools, save.
// @author       You
// @match        https://bristow-app.azurewebsites.net/Orders/Orders/Edit*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'bristow_wip_templates_v5';
  const TRIGGER     = '/wip';
  const WIP_GUID    = 'b90ca3e5-722b-4d29-9f7c-08daafcba656';
  const STEP_DELAY  = 600;

  // ═══════════════════════════════════════════════════════
  // LABEL-BASED FIELD DISCOVERY
  // Scans <label class="control-label"> for matching text,
  // then finds the associated input/picker/textarea in the
  // same <tr>. Falls back to hardcoded ID if not found.
  // ═══════════════════════════════════════════════════════
  function findByLabel(labelPatterns, fallbackId) {
    if (!labelPatterns || !labelPatterns.length) return fallbackId ? document.getElementById(fallbackId) : null;
    var labels = document.querySelectorAll('label.control-label');
    for (var i = 0; i < labels.length; i++) {
      var text = labels[i].textContent.trim();
      for (var j = 0; j < labelPatterns.length; j++) {
        if (text.indexOf(labelPatterns[j]) !== -1) {
          var tr = labels[i].closest('tr');
          if (!tr) continue;
          // Try to find the most specific element first
          var inp = tr.querySelector('input.form-control, textarea, select, .k-picker, .k-multiselect');
          if (inp) return inp;
        }
      }
    }
    return fallbackId ? document.getElementById(fallbackId) : null;
  }

  function findDropdownByLabel(labelPatterns, fallbackId) {
    if (!labelPatterns || !labelPatterns.length) return fallbackId ? document.getElementById(fallbackId) : null;
    var labels = document.querySelectorAll('label.control-label');
    for (var i = 0; i < labels.length; i++) {
      var text = labels[i].textContent.trim();
      for (var j = 0; j < labelPatterns.length; j++) {
        if (text.indexOf(labelPatterns[j]) !== -1) {
          var tr = labels[i].closest('tr');
          if (!tr) continue;
          // Look for the hidden input that holds the OptionId value
          var inp = tr.querySelector('input[id*="OptionId"]');
          if (inp) return inp;
          // Also try the picker widget
          var picker = tr.querySelector('.k-picker');
          if (picker) {
            var pickerInput = picker.querySelector('input[data-role]');
            if (pickerInput) return pickerInput;
          }
        }
      }
    }
    return fallbackId ? document.getElementById(fallbackId) : null;
  }

  const DEFAULT_TEMPLATES = {
    '2478': {
      rank: 10,
      description: 'Triple Tachometer Indicator 8DJ131AAB1',
      workOrderDesc: `WORK PERFORMED: VISUAL EVALUATION, PRETEST & DISASSEMBLY, CLEAN & POLISHED ALL PARTS, REPLACE BEARINGS, REBALANCED MOVEMENT, RECAL AND TEST, NEW PAINT
DATA: SEE ATTACHED
AIRWORTHINESS DIRECTIVE: NONE | LIST OF MODS: NONE | SERVICE DIFFICULTY REPORT: NO | TOOL CONTROL FORM: YES | PARTS CONTROL FORM: NO | ADDITIONAL WORK ASSESSMENT FORM: NO
WORK PERFORMED IN ACCORDANCE WITH BRISTOW MPM USING APPROVED LIBRARY DOCUMENTS AND APPLICABLE ADS.
REVIEWED BY: BOB GRELA, #9 INITIAL.______`,
      internalSnag: 'OUT OF CALIBRATION',
      tools: ['T-16', 'T-67', 'T-207', 'T-2241'],
      parts: [
        { search: '4152116P001', partNum: '', qty: 6 },
      ],
    },
    '2596': {
      rank: 9,
      description: 'Percent Tachometer 8DJ81CAA4',
      workOrderDesc: `WORK PERFORMED: VISUAL EVALUATION, PRETEST & DISASSEMBLY, CLEAN & POLISHED ALL PARTS, REPLACE BEARINGS, RECAL AND TEST, SEAL, LEAK TEST & EVACUATION, NEW PAINT
DATA: SEE ATTACHED
AIRWORTHINESS DIRECTIVE: NONE | LIST OF MODS: NONE | SERVICE DIFFICULTY REPORT: NO | TOOL CONTROL FORM: YES | PARTS CONTROL FORM: NO | ADDITIONAL WORK ASSESSMENT FORM: NO
WORK PERFORMED IN ACCORDANCE WITH BRISTOW MPM USING APPROVED LIBRARY DOCUMENTS AND APPLICABLE ADS.
REVIEWED BY: BOB GRELA, #9 INITIAL.______`,
      internalSnag: 'OUT OF CALIBRATION',
      tools: ['T-16', 'T-67', 'T-207', 'T-2241'],
      parts: [
        { search: '4152116P001', partNum: '', qty: 2 },
      ],
    },
    '407': {
      rank: 8,
      description: 'Tachometer A27817-10-004',
      workOrderDesc: `WORK PERFORMED: VISUAL EVALUATION, PRETEST & DISASSEMBLY, CLEAN & POLISHED ALL PARTS, RECLEAN & RELUBE BEARINGS, RECAL AND TEST, NEW PAINT
DATA: SEE ATTACHED
AIRWORTHINESS DIRECTIVE: NONE | LIST OF MODS: NONE | SERVICE DIFFICULTY REPORT: NO | TOOL CONTROL FORM: YES | PARTS CONTROL FORM: NO | ADDITIONAL WORK ASSESSMENT FORM: NO
WORK PERFORMED IN ACCORDANCE WITH BRISTOW MPM USING APPROVED LIBRARY DOCUMENTS AND APPLICABLE ADS.
REVIEWED BY: BOB GRELA, #9 INITIAL.______`,
      internalSnag: 'OUT OF CAL',
      tools: ['T-67', 'T-207'],
      parts: [],
    },
    '1179': {
      rank: 7,
      description: 'Synchro Transmitter ST-104A / Pressure Transmitter MS28005-2 / Pressure Transmitter ST-3A',
      workOrderDesc: `WORK PERFORMED: VISUAL EVALUATION, PRETEST & DISASSEMBLY, CLEAN & POLISHED ALL PARTS, REPLACED BEARINGS, RECAL & TEST, SEAL, LEAK TEST & EVACUATION, NEW PAINT
DATA: SEE ATTACHED
AIRWORTHINESS DIRECTIVE: NONE | LIST OF MODS: NONE | SERVICE DIFFICULTY REPORT: NO | TOOL CONTROL FORM: NO | PARTS CONTROL FORM: YES | ADDITIONAL WORK ASSESSMENT FORM: NO
WORK PERFORMED IN ACCORDANCE WITH BRISTOW MPM USING APPROVED LIBRARY DOCUMENTS AND APPLICABLE ADS.
REVIEWED BY: BOB GRELA, #9 INITIAL.______`,
      internalSnag: 'BEARING FAILURE',
      tools: ['T-41', 'T-50', 'T-2338'],
      parts: [
        { search: 'CODE B2 - OIL', partNum: '', qty: 2 },
        { search: 'AH-13-A',       partNum: '', qty: 1 },
      ],
    },
    '3066': {
      rank: 6,
      description: 'Cable Tensiometer T5-2002-101-00',
      workOrderDesc: `WORK PERFORMED: TEST ONLY
DATA: SEE ATTACHED
WORK PERFORMED PER BRISTOW MPM USING APPROVED LIBRARY DOCUMENTS REVIEWED: BOB GRELA, #9 INITIAL.______`,
      internalSnag: 'RECERTIFY',
      tools: ['T-14'],
      parts: [],
    },
    '2368': {
      rank: 5,
      description: 'Pressure Transmitter ST-53A',
      workOrderDesc: `WORK PERFORMED: VISUAL EVALUATION, PRETEST & DISASSEMBLY, CLEAN & POLISHED ALL PARTS, REPLACED BEARINGS, RECAL & TEST, SEAL, LEAK TEST & EVACUATION, NEW PAINT
DATA: SEE ATTACHED
AIRWORTHINESS DIRECTIVE: NONE | LIST OF MODS: NONE | SERVICE DIFFICULTY REPORT: NO | TOOL CONTROL FORM: NO | PARTS CONTROL FORM: NO | ADDITIONAL WORK ASSESSMENT FORM: NO
WORK PERFORMED IN ACCORDANCE WITH BRISTOW MPM USING APPROVED LIBRARY DOCUMENTS AND APPLICABLE ADS.
REVIEWED BY: BOB GRELA, #9 INITIAL.______`,
      internalSnag: 'BEARING FAILURE',
      tools: ['T-15', 'T-50', 'T-2338'],
      parts: [
        { search: 'CODE B2 - OIL', partNum: '', qty: 2 },
        { search: 'AH-13-A',       partNum: '', qty: 1 },
        { search: 'C-25B',         partNum: '', qty: 1 },
      ],
    },
    '258': {
      rank: 4,
      description: 'Pressure XMTR 7707-111A25-1',
      workOrderDesc: `WORK PERFORMED: VISUAL EVALUATION, PRETEST & DISASSEMBLY, CLEAN & POLISHED ALL PARTS, RECLEAN & LUBE BEARINGS, RECAL AND TEST, SEAL, LEAK TEST AND EVACUATION, NEW PAINT
DATA: SEE ATTACHED
AIRWORTHINESS DIRECTIVE: NONE | LIST OF MODS: NONE | SERVICE DIFFICULTY REPORT: NO | TOOL CONTROL FORM: YES | PARTS CONTROL FORM: YES | ADDITIONAL WORK ASSESSMENT FORM: NO
WORK PERFORMED IN ACCORDANCE WITH BRISTOW MPM USING APPROVED LIBRARY DOCUMENTS AND APPLICABLE ADS.
REVIEWED BY: BOB GRELA, #9 INITIAL.______`,
      internalSnag: 'STICKY',
      tools: ['T-41', 'T-50'],
      parts: [
        { search: 'CODE AA',      partNum: '', qty: 1 },
        { search: 'CODE B2 - OIL', partNum: '', qty: 1 },
      ],
    },
    '366': {
      rank: 3,
      description: 'Blower Assy 206-070-475-005 Globe Motors',
      workOrderDesc: `WORK PERFORMED: VISUAL EVALUATION, PRETEST & DISASSEMBLY, CLEAN & POLISHED ALL PARTS, REPLACED ARMATURER, REPLACE BEARINGS, REPLACE BRUSHES, RUN BRUSHES, SEAL
DATA: SEE ATTACHED
AIRWORTHINESS DIRECTIVE: NONE | LIST OF MODS: NONE | SERVICE DIFFICULTY REPORT: NO | TOOL CONTROL FORM: NO | PARTS CONTROL FORM: NO | ADDITIONAL WORK ASSESSMENT FORM: NO
WORK PERFORMED IN ACCORDANCE WITH BRISTOW MPM USING APPROVED LIBRARY DOCUMENTS AND APPLICABLE ADS.
REVIEWED BY: BOB GRELA, #9 INITIAL.______`,
      internalSnag: 'BEARINGS U/S, ARMATURE FAILURE, BRUSHES WORN OUT',
      tools: ['T-221', 'T-2368'],
      parts: [
        { search: '15D203AE056', partNum: '', qty: 1 },
        { search: '15D163AE056', partNum: '', qty: 1 },
        { search: '7A3920',      partNum: '', qty: 1 },
        { search: '40D1275',     partNum: '', qty: 2 },
      ],
    },
    '207': {
      rank: 2,
      description: 'Tachometer Indicator 212-075-037-111 INSCO',
      workOrderDesc: `VISUAL EXAMINATION
PRETEST & DISASSEMBLY
CLEAN & POLISHED ALL PARTS
REPLACED BEARINGS
REBALANCE MOVMENT
RECAL AND TEST
SEAL, LEAK TEST AND EVACUATION
NEW PAINT
DATA: SEE ATTACHED
AIRWORTHINESS DIRECTIVE: NONE | LIST OF MODS: NONE | SERVICE DIFFICULTY REPORT: NO | TOOL CONTROL FORM: YES | PARTS CONTROL FORM: NO | ADDITIONAL WORK ASSESSMENT FORM: NO
WORK PERFORMED IN ACCORDANCE WITH BRISTOW MPM USING APPROVED LIBRARY DOCUMENTS AND APPLICABLE ADS.
REVIEWED BY: BOB GRELA, #9 INITIAL.______`,
      internalSnag: 'BEARING FAILURE',
      tools: ['T-16', 'T-67', 'T-207', 'T-2241'],
      parts: [
        { search: 'CODE B2 - OIL', partNum: '', qty: 2 },
        { search: 'AML6153AS15',   partNum: '', qty: 3 },
      ],
    },
    '2378': {
      rank: 1,
      description: 'Triple Tachometer 412-075-010-115 INSCO',
      workOrderDesc: `WORK PERFORMED: VISUAL EVALUATION, PRETEST & DISASSEMBLY, CLEAN & POLISHED ALL PARTS, REPLACED BEARINGS, RECAL AND TEST, SEAL, LEAK TEST AND EVACUATION, NEW PAINT UNIT
DATA: SEE ATTACHED
AIRWORTHINESS DIRECTIVE: NONE | LIST OF MODS: NONE | SERVICE DIFFICULTY REPORT: NO | TOOL CONTROL FORM: YES | PARTS CONTROL FORM: NO | ADDITIONAL WORK ASSESSMENT FORM: NO
WORK PERFORMED IN ACCORDANCE WITH BRISTOW MPM USING APPROVED LIBRARY DOCUMENTS AND APPLICABLE ADS.
REVIEWED BY: BOB GRELA, #9 INITIAL.______`,
      internalSnag: 'Out of calibration',
      tools: ['T-67', 'T-207', 'T-2241'],
      parts: [
        { search: 'CODE B2 - OIL', partNum: '', qty: 6 },
      ],
    },
  };

  // ═══════════════════════════════════════════════════════
  // STORAGE
  // ═══════════════════════════════════════════════════════
  function loadTemplates() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return Object.assign({}, DEFAULT_TEMPLATES, parsed);
      }
      const seed = Object.assign({}, DEFAULT_TEMPLATES);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
      return seed;
    } catch (e) { return Object.assign({}, DEFAULT_TEMPLATES); }
  }
  function saveTemplates(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  // ═══════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function setNativeValue(el, value) {
    try {
      const proto = el.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value');
      if (setter) setter.set.call(el, value);
    } catch (e) { el.value = value; }
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function getComponentName() {
    const inp = findByLabel(['Component ID', 'Component'], 'AerospaceHead_ComponentId');
    if (inp) {
      const row = inp.closest('tr');
      if (row) {
        const span = row.querySelector('td span:not(.text-danger)');
        if (span && span.innerText.trim()) return span.innerText.trim();
      }
    }
    return null;
  }

  // Get the manual number from the selected manual row.
  function getSelectedManualNumber() {
    const docRows = document.querySelectorAll('tr.k-master-row, tr.k-table-row');
    for (const row of docRows) {
      const selectedCell = row.querySelector('[aria-colindex="2"]');
      if (!selectedCell) continue;
      if (selectedCell.innerText.trim().toLowerCase() !== 'true') continue;

      const filenameCell = row.querySelector('[aria-colindex="4"]');
      if (filenameCell) {
        const text = filenameCell.innerText.trim();
        const match = text.match(/^(\d+)/);
        if (match) return match[1];
      }

      const originCell = row.querySelector('[aria-colindex="7"]');
      if (originCell) {
        const text = originCell.innerText.trim();
        const match = text.match(/^(\d+)/);
        if (match) return match[1];
      }
    }
    return null;
  }

  function getTemplateKey() {
    return getSelectedManualNumber() || getComponentName();
  }

  // ═══════════════════════════════════════════════════════
  // FUZZY MATCHING
  // ═══════════════════════════════════════════════════════
  function normalizeForMatch(s) {
    return String(s).replace(/[-\s/]/g, '').toUpperCase();
  }

  function extractPartNum(name) {
    const match = String(name).match(/[A-Z0-9]{2,}[-/][A-Z0-9][-A-Z0-9/]*/);
    return match ? match[0] : null;
  }

  function findTemplate(compName) {
    if (!compName || typeof compName !== 'string') return null;
    const templates  = loadTemplates();
    const name       = compName.trim().toUpperCase();
    const nameNorm   = normalizeForMatch(name);
    const namePN     = extractPartNum(name);
    const namePNNorm = namePN ? normalizeForMatch(namePN) : null;

    if (templates[compName]) return { key: compName, tpl: templates[compName] };

    for (const key of Object.keys(templates)) {
      if (key.trim().toUpperCase() === name) return { key, tpl: templates[key] };
    }

    for (const key of Object.keys(templates)) {
      if (normalizeForMatch(key) === nameNorm) return { key, tpl: templates[key] };
    }

    if (namePNNorm) {
      for (const key of Object.keys(templates)) {
        const keyPN = extractPartNum(key.toUpperCase());
        if (keyPN && normalizeForMatch(keyPN) === namePNNorm) return { key, tpl: templates[key] };
      }
    }

    for (const key of Object.keys(templates)) {
      const k = normalizeForMatch(key);
      if (nameNorm.includes(k) || k.includes(nameNorm)) return { key, tpl: templates[key] };
    }

    return null;
  }

  // ═══════════════════════════════════════════════════════
  // MODE DETECTION
  // ═══════════════════════════════════════════════════════
  let isEditMode = false;

  function detectEditMode() {
    const saveBtn = [...document.querySelectorAll('button.btn-success')]
      .find(b => (b.getAttribute('onclick') || '').includes('saveOrderHeader'));
    if (saveBtn && saveBtn.offsetParent !== null) return true;
    const ta = findByLabel(['Work Order Description'], 'AerospaceHead_WorkOrderDesc');
    if (ta && ta.tagName === 'TEXTAREA' && !ta.disabled && !ta.readOnly && ta.offsetParent !== null) return true;
    return false;
  }

  function refreshMode() {
    const prev = isEditMode;
    isEditMode = detectEditMode();
    if (prev !== isEditMode) updatePanelHint();
  }

  // ═══════════════════════════════════════════════════════
  // STEP 1 — Click Edit Info
  // ═══════════════════════════════════════════════════════
  async function clickEditInfo() {
    if (isEditMode) return true;
    const editBtn = [...document.querySelectorAll('button.btn-warning')]
      .find(b => (b.getAttribute('onclick') || '').includes('refreshOrderHeader'));
    if (!editBtn) {
      showToast('⚠️ Could not find Edit Info button', 'orange');
      return false;
    }
    editBtn.click();
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      if (detectEditMode()) { isEditMode = true; updatePanelHint(); return true; }
    }
    showToast('⚠️ Edit mode did not activate in time', 'orange');
    return false;
  }

  // ═══════════════════════════════════════════════════════
  // STEP 2 — Set Bristow Status to Work in Progress
  // ═══════════════════════════════════════════════════════
  async function setBristowStatus() {
    const input = findDropdownByLabel(['Bristow Status'], 'OrderHead_CustomFields_0__OptionId');
    if (!input) { showToast('⚠️ Bristow Status field not found', 'orange'); return false; }
    const widget = typeof jQuery !== 'undefined'
      ? jQuery('#' + CSS.escape(input.id)).data('kendoDropDownList')
      : null;
    if (widget) {
      widget.value(WIP_GUID);
      widget.trigger('change');
    } else {
      setNativeValue(input, WIP_GUID);
    }
    await sleep(STEP_DELAY);
    return true;
  }

  // ═══════════════════════════════════════════════════════
  // STEP 3 — Stamp to Comments
  // ═══════════════════════════════════════════════════════
  async function stampToComments() {
    const stampBtn = [...document.querySelectorAll('button')]
      .find(b => (b.getAttribute('onclick') || '').includes("listBoxToComment('Bristow Status'"));
    if (stampBtn) { stampBtn.click(); await sleep(STEP_DELAY); }
    return true;
  }

  // ═══════════════════════════════════════════════════════
  // STEP 4 — Fill text fields
  // ═══════════════════════════════════════════════════════
  async function fillTextFields(tpl) {
    const descEl = findByLabel(['Work Order Description'], 'AerospaceHead_WorkOrderDesc');
    if (descEl) setNativeValue(descEl, tpl.workOrderDesc || '');
    if (tpl.internalSnag) {
      const snagEl = findByLabel(['Internal Snag'], 'AerospaceHead_InternalSnag');
      if (snagEl && !snagEl.value.trim()) setNativeValue(snagEl, tpl.internalSnag);
    }
    await sleep(300);
    return true;
  }

  // ═══════════════════════════════════════════════════════
  // STEP 5 — Acknowledge tool/parts control forms only
  // ═══════════════════════════════════════════════════════
  const ACK_KEYWORDS = [
    'tool substitution', 'tool form', 'tool control',
    'parts form', 'parts substitution', 'parts control',
  ];

  async function acknowledgeDocs() {
    const docRows = document.querySelectorAll('tr.k-master-row, tr.k-table-row');
    for (const row of docRows) {
      const filenameCell = row.querySelector('[aria-colindex="4"]');
      if (!filenameCell) continue;
      const filename = filenameCell.innerText.trim().toLowerCase();
      if (!ACK_KEYWORDS.some(kw => filename.includes(kw))) continue;

      const ackFlagCell = row.querySelector('[aria-colindex="3"]');
      if (ackFlagCell && ackFlagCell.innerText.trim().toLowerCase() === 'true') continue;

      const ackBtn = row.querySelector('button.btn-primary[title="Acknowledge"]');
      if (!ackBtn) continue;
      ackBtn.click();
      await sleep(500);
    }
    return true;
  }

  // ═══════════════════════════════════════════════════════
  // STEP 6 — Click Use on matching tools
  // ═══════════════════════════════════════════════════════
  async function clickTools(toolNumbers) {
    if (!toolNumbers || !toolNumbers.length) return true;
    const rows = document.querySelectorAll('.k-table-tbody .k-table-row, tbody .k-master-row');
    for (const row of rows) {
      const cells = row.querySelectorAll('.k-table-td, td');
      const cellTexts = [...cells].map(c => c.innerText.trim());
      const toolNum = cellTexts.find(t => /^T-\d+/.test(t));
      if (!toolNum) continue;
      if (!toolNumbers.some(t => t.trim().toUpperCase() === toolNum.trim().toUpperCase())) continue;
      const useBtn = row.querySelector('button[title="Use"]');
      if (useBtn) { useBtn.click(); await sleep(500); }
    }
    return true;
  }

  // ═══════════════════════════════════════════════════════
  // STEP 7 — Add parts
  // ═══════════════════════════════════════════════════════
  async function addParts(parts) {
    if (!parts || !parts.length) return true;
    for (const part of parts) {
      await addOnePart(part);
      await sleep(STEP_DELAY);
    }
    const saveLineBtn = [...document.querySelectorAll('button')]
      .find(b => (b.getAttribute('onclick') || '').includes('saveLines'));
    if (saveLineBtn) { saveLineBtn.click(); await sleep(800); }
    return true;
  }

  async function addOnePart(part) {
    const searchBox = document.getElementById('order_DescriptionSearch');
    if (!searchBox) { showToast('⚠️ Part search box not found', 'orange'); return; }

    setNativeValue(searchBox, part.search);
    searchBox.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    await sleep(1200);

    const partRows = document.querySelectorAll(
      '#order-line-area tbody tr.k-master-row, .k-grid tbody tr.k-master-row, table tbody tr[data-uid]'
    );
    let targetRow = null;
    for (const row of partRows) {
      const text = row.innerText.toUpperCase();
      if (text.includes(part.search.toUpperCase())) {
        if (part.partNum && !text.includes(part.partNum.toUpperCase())) continue;
        targetRow = row;
        break;
      }
    }
    if (!targetRow) { showToast(`⚠️ Part not found: "${part.search}"`, 'orange'); return; }

    const qtyInput = targetRow.querySelector('input[id^="qtyInput_"]');
    if (qtyInput) setNativeValue(qtyInput, part.qty);
    await sleep(300);

    const addBtn = targetRow.querySelector('button.btn-success[onclick*="addNewLine"]');
    if (!addBtn) { showToast(`⚠️ Add button not found for: "${part.search}"`, 'orange'); return; }
    addBtn.click();
    await sleep(1500);

    setNativeValue(searchBox, '');
    searchBox.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    await sleep(800);

    await fixPartSourceToStock();
  }

  async function fixPartSourceToStock() {
    const lineRows = document.querySelectorAll('tr.line-item');
    if (!lineRows.length) return;
    const lastLine = lineRows[lineRows.length - 1];
    const lineId   = lastLine.id.replace('OrderLine_', '');

    await sleep(500);
    const sourceArea = document.getElementById(`OrderLineSourceArea_${lineId}`);
    if (!sourceArea) return;

    const allSourceSelects = sourceArea.querySelectorAll('select[id^="OrderLineSourceType_"]');
    for (const sel of allSourceSelects) {
      if (sel.value !== '0') {
        sel.value = '0';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(800);
      }
    }

    await sleep(600);
    await selectLowestPOStock(sourceArea);
  }

  async function selectLowestPOStock(sourceArea) {
    if (!sourceArea) return;
    const stockInputs = sourceArea.querySelectorAll('input[id^="OrderLineSourceValueGroup_"]');
    for (const inp of stockInputs) {
      const widget = typeof jQuery !== 'undefined'
        ? jQuery(`#${inp.id}`).data('kendoDropDownList') : null;
      if (!widget) continue;

      widget.open();
      await sleep(1000);
      const items = widget.dataSource.data();
      widget.close();
      if (!items.length) continue;

      function extractPONumber(text) {
        const withPrefix = text.match(/PO\s+(\d{4,})/i);
        if (withPrefix) return parseInt(withPrefix[1]);
        const parts = text.split('|').map(s => s.trim());
        for (let i = parts.length - 1; i >= 0; i--) {
          const bare = parts[i].match(/^(\d{4,})$/);
          if (bare) return parseInt(bare[1]);
        }
        return null;
      }

      let lowestPO = null, lowestVal = Infinity;
      items.forEach(item => {
        const text = String(item.Text || item.text || '');
        const poNum = extractPONumber(text);
        if (poNum !== null && poNum < lowestVal) {
          lowestVal = poNum;
          lowestPO  = item.Value || item.value;
        }
      });

      widget.open();
      await sleep(300);
      if (lowestPO) {
        widget.value(lowestPO);
      } else {
        const first = items[0];
        if (first) widget.value(first.Value || first.value);
      }
      widget.trigger('change');
      widget.close();
      await sleep(400);
    }
  }



  // ═══════════════════════════════════════════════════════
  // STEP 9 — Save order header
  // ═══════════════════════════════════════════════════════
  async function saveOrderHeader() {
    const saveBtn = [...document.querySelectorAll('button.btn-success')]
      .find(b => (b.getAttribute('onclick') || '').includes('saveOrderHeader'));
    if (saveBtn) { saveBtn.click(); await sleep(800); }
    return true;
  }

  // ═══════════════════════════════════════════════════════
  // MAIN /wip SEQUENCE
  // ═══════════════════════════════════════════════════════
  let wipRunning = false;

  function getProcessedOrders() {
    try { return JSON.parse(localStorage.getItem('bristow_wip_processed') || '[]'); }
    catch (e) { return []; }
  }
  function markOrderProcessed(orderId) {
    const processed = getProcessedOrders();
    if (!processed.includes(orderId)) {
      processed.push(orderId);
      if (processed.length > 50) processed.splice(0, processed.length - 50);
      localStorage.setItem('bristow_wip_processed', JSON.stringify(processed));
    }
  }
  function isOrderProcessed(orderId) {
    return getProcessedOrders().includes(orderId);
  }

  async function runWip(forcedKey = null) {
    if (wipRunning) { showToast('⚠️ /wip already running...', 'orange'); return; }
    wipRunning = true;

    try {
      const currentOrderId = (document.getElementById('orderId') || {}).value || location.href;
      if (isOrderProcessed(currentOrderId)) {
        const confirmed = confirm('⚠️ /wip has already been run on this order.\n\nRunning it again will duplicate parts and re-fill fields.\n\nAre you sure you want to continue?');
        if (!confirmed) return;
      }

      let templateKey;
      if (forcedKey) {
        templateKey = forcedKey;
      } else {
        templateKey = getSelectedManualNumber();
        if (!templateKey) {
          showToast('⚠️ Could not find a selected manual or instrument name.\nMake sure a manual is selected (green ✓ button) in the Manuals section.', 'orange');
          return;
        }
      }

      const match = findTemplate(templateKey);
      if (!match) {
        const manualNum = getSelectedManualNumber();
        const hint = manualNum
          ? `Manual: ${manualNum}\n\nClick 📋 Manage Templates and add a template with key "${manualNum}".`
          : `Instrument: ${templateKey}\n\nClick 📋 Manage Templates to add one.`;
        showToast(`⚠️ No template found.\n${hint}`, 'orange');
        return;
      }

      const tpl = match.tpl;
      showToast(`🚀 Starting /wip for:\n${match.key}`, 'blue');

      showProgress('Step 1/8: Entering edit mode...');
      const editOk = await clickEditInfo();
      if (!editOk) return;
      await sleep(STEP_DELAY);

      showProgress('Step 2/8: Setting status to Work in Progress...');
      await setBristowStatus();

      showProgress('Step 3/8: Stamping status to comments...');
      await stampToComments();

      showProgress('Step 4/8: Filling work description...');
      await fillTextFields(tpl);

      showProgress('Step 5/8: Acknowledging documents...');
      await acknowledgeDocs();

      showProgress('Step 6/8: Selecting tools...');
      await clickTools(tpl.tools || []);

      if (tpl.parts && tpl.parts.length) {
        showProgress('Step 7/8: Adding parts...');
        await addParts(tpl.parts);
      }

      showProgress('Step 8/8: Downloading checksheet...');
      await downloadChecksheet();
      showProgress('Saving...');
      await saveOrderHeader();

      markOrderProcessed(currentOrderId);
      showToast(`✅ /wip complete!\n\nReview and:\n• Edit description if needed\n• Delete unused parts\n• Change the 2 dropdowns\n• Select completion date\n• Print inspection page`, 'green');

    } catch (err) {
      showToast(`⚠️ Error during /wip:\n${err.message}`, 'orange');
      console.error('[WIP]', err);
    } finally {
      wipRunning = false;
    }
  }

  // ═══════════════════════════════════════════════════════
  // MACRO HANDLER
  // ═══════════════════════════════════════════════════════
  function handleMacroInput(e) {
    const el = e.target;
    if (!el || el.id !== 'tm-floating-box') return;
    if (el.value.trim().toLowerCase() !== TRIGGER) return;
    el.value = '';
    runWip();
  }

  // ═══════════════════════════════════════════════════════
  // PANEL
  // ═══════════════════════════════════════════════════════
  function btnCSS(bg) {
    return `background:${bg};color:#fff;border:none;padding:8px 13px;border-radius:5px;
            cursor:pointer;font-family:monospace;font-size:12px;font-weight:bold;
            box-shadow:0 2px 6px rgba(0,0,0,0.3);display:block;width:100%;text-align:left;margin:0;`;
  }

  function injectPanel() {
    if (document.getElementById('wip-panel')) return;

    const wipBtn = document.createElement('button');
    wipBtn.id = 'wip-run-btn';
    wipBtn.type = 'button';
    wipBtn.innerHTML = '▶ Start WIP';
    wipBtn.style.cssText = `
      background:#1a6e40;color:#fff;border:none;padding:5px 14px;
      border-radius:5px;cursor:pointer;font-family:monospace;font-size:12px;font-weight:bold;
      box-shadow:0 2px 6px rgba(0,0,0,0.3);white-space:nowrap;
      display:inline-block;margin-left:10px;vertical-align:middle;`;
    wipBtn.addEventListener('click', runWip);

    const manageBtn = document.createElement('button');
    manageBtn.id = 'wip-manage-btn';
    manageBtn.type = 'button';
    manageBtn.innerHTML = '📋 Templates';
    manageBtn.style.cssText = `
      background:#1a5c8a;color:#fff;border:none;padding:5px 12px;
      border-radius:5px;cursor:pointer;font-family:monospace;font-size:11px;font-weight:bold;
      box-shadow:0 2px 6px rgba(0,0,0,0.3);white-space:nowrap;
      margin-right:8px;vertical-align:middle;`;
    manageBtn.addEventListener('click', showTemplateManager);

    const hint = document.createElement('div');
    hint.id = 'wip-hint';
    hint.style.cssText = `color:#7df;font-family:monospace;font-size:10px;
      display:block;margin-top:2px;`;

    function anchorWipButton() {
      const titleLabel = document.querySelector('label.custom-h3');
      if (titleLabel) {
        const firstLink = titleLabel.querySelector('a');
        if (firstLink) {
          titleLabel.insertBefore(wipBtn, firstLink);
          titleLabel.insertBefore(hint, firstLink);
        } else {
          titleLabel.appendChild(wipBtn);
          titleLabel.appendChild(hint);
        }
        wipBtn.insertAdjacentElement('afterend', hint);
      } else {
        wipBtn.style.cssText += 'position:fixed;top:72px;left:12px;z-index:999998;display:block;margin:0;';
        hint.style.cssText   += 'position:fixed;top:102px;left:12px;z-index:999998;';
        document.body.appendChild(wipBtn);
        document.body.appendChild(hint);
      }
    }

    function anchorTemplatesButton() {
      const navRight = document.querySelector('.navbar-right, .navbar-nav.pull-right, nav .navbar-right');
      if (navRight) {
        const li = document.createElement('li');
        li.style.cssText = 'display:inline-block;vertical-align:middle;padding:8px 4px;';
        li.appendChild(manageBtn);
        navRight.insertBefore(li, navRight.firstChild);
      } else {
        manageBtn.style.cssText += 'position:fixed;top:8px;right:60px;z-index:999998;display:block;margin:0;';
        document.body.appendChild(manageBtn);
      }
    }

    anchorWipButton();
    anchorTemplatesButton();
    anchorCompleteButton();

    const hourglassBtn = document.querySelector('a[href*="TimeTracking"][title="Add Time"]');
    if (hourglassBtn) hourglassBtn.style.display = 'none';

    const panel = document.createElement('div');
    panel.id = 'wip-panel';
    panel.style.display = 'none';
    document.body.appendChild(panel);

    updatePanelHint();
  }

  function updatePanelHint() {
    const hint = document.getElementById('wip-hint');
    if (!hint) return;
    const comp  = getTemplateKey();
    const match = comp ? findTemplate(comp) : null;
    const label = match && match.tpl.description ? match.tpl.description.slice(0,24) : match ? match.key : null;
    hint.textContent = label ? `👁 /wip ready: ${label}…` : '';
    hint.style.color = '#7df';
  }

  // ═══════════════════════════════════════════════════════
  // PROGRESS
  // ═══════════════════════════════════════════════════════
  function showProgress(msg) {
    const old = document.getElementById('wip-progress');
    if (old) old.textContent = '⚙️ ' + msg;
    else {
      const t = document.createElement('div');
      t.id = 'wip-progress';
      t.style.cssText = `position:fixed;top:60px;right:14px;background:#1a3a6a;color:#fff;
        padding:10px 14px;border-radius:8px;font-family:monospace;font-size:12px;
        max-width:300px;z-index:9999999;box-shadow:0 4px 16px rgba(0,0,0,0.45);`;
      t.textContent = '⚙️ ' + msg;
      document.body.appendChild(t);
    }
  }

  function clearProgress() {
    const el = document.getElementById('wip-progress');
    if (el) el.remove();
  }

  // ═══════════════════════════════════════════════════════
  // TOAST
  // ═══════════════════════════════════════════════════════
  function showToast(message, color = 'green') {
    clearProgress();
    const old = document.getElementById('wip-toast');
    if (old) old.remove();
    const bg = color === 'green' ? '#1a6e40' : color === 'orange' ? '#9a5000'
             : color === 'blue'  ? '#1a3a6a' : '#333';
    const t = document.createElement('div');
    t.id = 'wip-toast';
    t.style.cssText = `position:fixed;bottom:80px;right:14px;background:${bg};color:#fff;
      padding:12px 16px;border-radius:8px;font-family:monospace;font-size:12px;
      max-width:360px;z-index:9999999;box-shadow:0 4px 16px rgba(0,0,0,0.45);
      line-height:1.6;white-space:pre-wrap;transition:opacity 0.4s;`;
    t.textContent = message;
    document.body.appendChild(t);
    const dur = color === 'green' ? 8000 : 6000;
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 500); }, dur);
  }

  // ═══════════════════════════════════════════════════════
  // TEMPLATE MANAGER MODAL
  // ═══════════════════════════════════════════════════════
  function showTemplateManager() {
    const existing = document.getElementById('wip-modal');
    if (existing) existing.remove();

    const templates      = loadTemplates();
    const allInstruments = Object.keys(templates).sort((a, b) => {
      const ra = (templates[a] && templates[a].rank)
              || (DEFAULT_TEMPLATES[a] && DEFAULT_TEMPLATES[a].rank)
              || 999;
      const rb = (templates[b] && templates[b].rank)
              || (DEFAULT_TEMPLATES[b] && DEFAULT_TEMPLATES[b].rank)
              || 999;
      if (ra !== rb) return ra - rb;
      return a.localeCompare(b);
    });

    const overlay = document.createElement('div');
    overlay.id = 'wip-modal';
    overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,0.7);
      z-index:9999999;display:flex;align-items:flex-start;justify-content:center;
      padding-top:30px;overflow-y:auto;`;

    const box = document.createElement('div');
    box.style.cssText = `background:#1c1c1c;color:#eee;border-radius:10px;
      padding:24px;width:min(740px,95vw);font-family:monospace;font-size:13px;
      box-shadow:0 8px 32px rgba(0,0,0,0.7);margin-bottom:40px;`;

    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <h3 style="margin:0;color:#7dd;">🛠 WIP Template Manager</h3>
        <button id="wip-close" style="${btnCSS('#444')}width:auto;padding:6px 12px;">✖ Close</button>
      </div>
      <p style="color:#999;margin:0 0 12px;font-size:11px;">
        Select a manual number, fill in its standard values, Save Template.<br>
        Type <strong style="color:#7f7;">/wip</strong> in the macro box to run the full automation.<br>
        <span style="color:#7af;">Keys are manual numbers (e.g. 2378) — set by the librarian's green ✓ selection.</span>
      </p>
      <div style="margin-bottom:12px;">
        <select id="wip-instrument-select" style="flex:1;background:#2a2a2a;color:#eee;
          border:1px solid #444;border-radius:4px;padding:6px;font-family:monospace;font-size:12px;">
          <option value="">— Select manual number —</option>
          ${allInstruments.map(name => {
            const tpl = templates[name];
            const hasData = tpl && (tpl.workOrderDesc || (tpl.parts && tpl.parts.length) || (tpl.tools && tpl.tools.length));
            const desc = (tpl && tpl.description) || (DEFAULT_TEMPLATES[name] && DEFAULT_TEMPLATES[name].description) || '';
            const isManualNum = /^\d+$/.test(name);
            const label = isManualNum
              ? (desc ? `Manual ${name} — ${desc}` : `Manual ${name}`)
              : `⚠️ Legacy: ${name} (delete me)`;
            return `<option value="${esc(name)}" ${hasData ? 'style="color:#7fd;"' : 'style="color:#f88;"'}>${esc(label)}</option>`;
          }).join('')}
        </select>
      </div>
      <div id="wip-editor" style="display:none;">
        <div style="background:#111;border-radius:6px;padding:16px;border:1px solid #333;">
          <div style="color:#fc0;font-weight:bold;margin-bottom:12px;" id="wip-editor-title"></div>
          <label style="color:#aaa;font-size:11px;display:block;margin-bottom:3px;">Unit Description (shown in dropdown)</label>
          <input id="wip-f-description" type="text" placeholder="e.g. Triple Tachometer 412-075-010-115 INSCO"
            style="width:100%;background:#1a1a1a;color:#eee;border:1px solid #444;border-radius:4px;
            padding:6px;font-family:monospace;font-size:12px;box-sizing:border-box;margin-bottom:10px;">
          <label style="color:#aaa;font-size:11px;display:block;margin-bottom:3px;">Work Order Description</label>
          <textarea id="wip-f-workOrderDesc" rows="6" style="width:100%;background:#1a1a1a;color:#eee;
            border:1px solid #444;border-radius:4px;padding:6px;font-family:monospace;font-size:12px;
            box-sizing:border-box;margin-bottom:10px;"></textarea>
          <label style="color:#aaa;font-size:11px;display:block;margin-bottom:3px;">Internal Snag (fills if blank)</label>
          <input id="wip-f-internalSnag" type="text" placeholder="e.g. Out of calibration"
            style="width:100%;background:#1a1a1a;color:#eee;border:1px solid #444;border-radius:4px;
            padding:6px;font-family:monospace;font-size:12px;box-sizing:border-box;margin-bottom:10px;">
          <label style="color:#aaa;font-size:11px;display:block;margin-bottom:3px;">
            Tools (comma-separated T-numbers, e.g. T-67, T-207, T-2241)
          </label>
          <input id="wip-f-tools" type="text" placeholder="e.g. T-67, T-207, T-2241"
            style="width:100%;background:#1a1a1a;color:#eee;border:1px solid #444;border-radius:4px;
            padding:6px;font-family:monospace;font-size:12px;box-sizing:border-box;margin-bottom:10px;">
          <label style="color:#aaa;font-size:11px;display:block;margin-bottom:6px;">
            Parts (one per line: search term | part# | qty) <span style="color:#666;">— part# optional</span>
          </label>
          <textarea id="wip-f-parts" rows="5" placeholder="CODE B2 - OIL | P-219656 | 6&#10;ANOTHER PART | | 2"
            style="width:100%;background:#1a1a1a;color:#eee;border:1px solid #444;border-radius:4px;
            padding:6px;font-family:monospace;font-size:12px;box-sizing:border-box;margin-bottom:4px;"></textarea>
          <div style="color:#666;font-size:10px;margin-bottom:12px;">Format: search term | part number (optional) | quantity</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button id="wip-save-tpl" style="${btnCSS('#1a6e40')}width:auto;padding:8px 18px;">💾 Save Template</button>
            <button id="wip-delete-tpl" style="${btnCSS('#6a1515')}width:auto;padding:8px 14px;">🗑 Delete</button>
            <button id="wip-test-tpl" style="${btnCSS('#3a3a6a')}width:auto;padding:8px 14px;">🚀 Run /wip now</button>
            <button id="wip-add-new" style="${btnCSS('#2a4a2a')}width:auto;padding:8px 14px;">＋ New</button>
          </div>
        </div>
      </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    box.querySelector('#wip-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    const sel    = box.querySelector('#wip-instrument-select');
    const editor = box.querySelector('#wip-editor');

    function partsToText(parts) {
      if (!parts || !parts.length) return '';
      return parts.map(p => `${p.search} | ${p.partNum || ''} | ${p.qty}`).join('\n');
    }

    function textToParts(text) {
      return text.split('\n').map(line => {
        const cols = line.split('|').map(s => s.trim());
        if (!cols[0]) return null;
        return { search: cols[0], partNum: cols[1] || '', qty: parseFloat(cols[2]) || 1 };
      }).filter(Boolean);
    }

    function loadIntoEditor(name) {
      if (!name) { editor.style.display = 'none'; return; }
      editor.style.display = 'block';
      box.querySelector('#wip-editor-title').textContent = name;
      const tpl = templates[name] || {};
      box.querySelector('#wip-f-description').value  = tpl.description   || '';
      box.querySelector('#wip-f-workOrderDesc').value = tpl.workOrderDesc || '';
      box.querySelector('#wip-f-internalSnag').value  = tpl.internalSnag  || '';
      box.querySelector('#wip-f-tools').value = (tpl.tools || []).join(', ');
      box.querySelector('#wip-f-parts').value = partsToText(tpl.parts || []);
    }

    sel.addEventListener('change', () => loadIntoEditor(sel.value));

    box.querySelector('#wip-add-new').addEventListener('click', () => {
      const name = prompt('Enter the manual number (e.g. 2378):');
      if (!name || !name.trim()) return;
      const trimmed = name.trim();
      if (!sel.querySelector(`option[value="${esc(trimmed)}"]`)) {
        const opt = document.createElement('option');
        opt.value = trimmed; opt.textContent = trimmed;
        sel.appendChild(opt);
      }
      sel.value = trimmed;
      loadIntoEditor(trimmed);
    });

    box.querySelector('#wip-save-tpl').addEventListener('click', () => {
      const name = sel.value;
      if (!name) { showToast('⚠️ Select an instrument first', 'orange'); return; }
      const tpls = loadTemplates();
      tpls[name] = {
        description   : box.querySelector('#wip-f-description').value.trim(),
        workOrderDesc : box.querySelector('#wip-f-workOrderDesc').value.trim(),
        internalSnag  : box.querySelector('#wip-f-internalSnag').value.trim(),
        tools         : box.querySelector('#wip-f-tools').value.split(',').map(s => s.trim()).filter(Boolean),
        parts         : textToParts(box.querySelector('#wip-f-parts').value),
      };
      saveTemplates(tpls);
      const opt = sel.querySelector(`option[value="${esc(name)}"]`);
      if (opt) opt.style.color = '#7fd';
      showToast(`✅ Template saved for:\n${name}`, 'green');
    });

    box.querySelector('#wip-delete-tpl').addEventListener('click', () => {
      const name = sel.value;
      if (!name || !confirm(`Delete template for:\n${name}?`)) return;
      const tpls = loadTemplates();
      delete tpls[name];
      saveTemplates(tpls);
      const opt = sel.querySelector(`option[value="${esc(name)}"]`);
      if (opt) opt.style.color = '';
      editor.style.display = 'none';
      sel.value = '';
      showToast('Template deleted.', 'grey');
    });

    box.querySelector('#wip-test-tpl').addEventListener('click', () => {
      const key = sel.value;
      if (!key) { showToast('⚠️ Select a template first', 'orange'); return; }
      overlay.remove();
      runWip(key);
    });

    const comp = getTemplateKey();
    if (comp) {
      const match = findTemplate(comp);
      if (match && sel.querySelector(`option[value="${esc(match.key)}"]`)) {
        sel.value = match.key;
        loadIntoEditor(match.key);
      }
    }
  }

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ═══════════════════════════════════════════════════════
  // COMPLETE WO — checklist confirmation then completes order
  // ═══════════════════════════════════════════════════════
  function anchorCompleteButton() {
    if (document.getElementById('wip-complete-btn')) return;
    const completeBtn = document.createElement('button');
    completeBtn.id = 'wip-complete-btn';
    completeBtn.type = 'button';
    completeBtn.innerHTML = '✓ Complete WO';
    completeBtn.style.cssText = `
      background:#1a3a8a;color:#fff;border:none;padding:5px 14px;
      border-radius:5px;cursor:pointer;font-family:monospace;font-size:12px;font-weight:bold;
      box-shadow:0 2px 6px rgba(0,0,0,0.3);white-space:nowrap;
      display:inline-block;margin-left:8px;vertical-align:middle;`;
    completeBtn.addEventListener('click', showCompleteChecklist);

    const titleLabel = document.querySelector('label.custom-h3');
    if (titleLabel) {
      const firstLink = titleLabel.querySelector('a');
      if (firstLink) titleLabel.insertBefore(completeBtn, firstLink);
      else titleLabel.appendChild(completeBtn);
      completeBtn.insertAdjacentElement('afterend', completeBtn);
      const wipBtn = document.getElementById('wip-run-btn');
      if (wipBtn) wipBtn.insertAdjacentElement('afterend', completeBtn);
      else titleLabel.appendChild(completeBtn);
    } else {
      completeBtn.style.cssText += 'position:fixed;top:72px;left:140px;z-index:999998;display:block;margin:0;';
      document.body.appendChild(completeBtn);
    }
  }

  function showCompleteChecklist() {
    const existing = document.getElementById('wip-complete-modal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'wip-complete-modal';
    overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,0.7);
      z-index:9999999;display:flex;align-items:center;justify-content:center;`;

    const box = document.createElement('div');
    box.style.cssText = `background:#1c1c1c;color:#eee;border-radius:10px;
      padding:28px;width:min(480px,92vw);font-family:monospace;font-size:13px;
      box-shadow:0 8px 32px rgba(0,0,0,0.7);`;

    const items = [
      'Work Order Description Reviewed & Complete',
      'Tool Substitutions Acknowledged',
      'Parts Substitutions Acknowledged',
      'Tools Selected & Correct',
      'Correct Parts Added / Removed & Quantities Verified',
      'Parts PO Numbers Confirmed',
      'Tech Total Hours Entered & Correct',
    ];

    const itemsHtml = items.map(item => `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;line-height:1.4;">
        <span style="color:#7dd;font-size:14px;flex-shrink:0;">✓</span>
        <span>${item}</span>
      </div>`).join('');

    box.innerHTML = `
      <h3 style="margin:0 0 6px;color:#7dd;">✓ Complete Work Order</h3>
      <p style="color:#999;margin:0 0 18px;font-size:11px;">
        Please confirm you have reviewed all of the following before completing:
      </p>
      <div style="margin-bottom:20px;">
        ${itemsHtml}
      </div>
      <div style="display:flex;gap:10px;">
        <button id="wip-complete-yes" style="flex:1;background:#1a6e40;color:#fff;border:none;
          padding:10px;border-radius:6px;cursor:pointer;font-family:monospace;font-size:13px;
          font-weight:bold;box-shadow:0 2px 6px rgba(0,0,0,0.3);">
          ✓ Yes — Complete Order
        </button>
        <button id="wip-complete-no" style="flex:1;background:#6a1515;color:#fff;border:none;
          padding:10px;border-radius:6px;cursor:pointer;font-family:monospace;font-size:13px;
          font-weight:bold;box-shadow:0 2px 6px rgba(0,0,0,0.3);">
          ✗ No — Go Back
        </button>
      </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    box.querySelector('#wip-complete-no').addEventListener('click', () => overlay.remove());

    box.querySelector('#wip-complete-yes').addEventListener('click', () => {
      overlay.remove();
      showWorkPerformedPicker();
    });
  }

  function showWorkPerformedPicker() {
    const existing = document.getElementById('wip-work-modal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'wip-work-modal';
    overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,0.7);
      z-index:9999999;display:flex;align-items:center;justify-content:center;`;

    const box = document.createElement('div');
    box.style.cssText = `background:#1c1c1c;color:#eee;border-radius:10px;
      padding:28px;width:min(380px,92vw);font-family:monospace;font-size:13px;
      box-shadow:0 8px 32px rgba(0,0,0,0.7);`;

    box.innerHTML = `
      <h3 style="margin:0 0 6px;color:#7dd;">🔧 Work Performed</h3>
      <p style="color:#999;margin:0 0 16px;font-size:11px;">
        Select the type of work performed on this order:
      </p>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:20px;">
        <button class="wip-work-btn" data-value="299e5751-c9d6-4ba2-2cb9-08de73f744dc" style="background:#2a2a2a;color:#eee;border:1px solid #444;padding:10px 16px;border-radius:6px;cursor:pointer;font-family:monospace;font-size:13px;text-align:left;transition:background 0.15s;">Inspected/Tested</button>\n<button class="wip-work-btn" data-value="ad96b868-df11-40f7-2cba-08de73f744dc" style="background:#2a2a2a;color:#eee;border:1px solid #444;padding:10px 16px;border-radius:6px;cursor:pointer;font-family:monospace;font-size:13px;text-align:left;transition:background 0.15s;">Repaired</button>\n<button class="wip-work-btn" data-value="72b60791-d804-4bce-2cbb-08de73f744dc" style="background:#2a2a2a;color:#eee;border:1px solid #444;padding:10px 16px;border-radius:6px;cursor:pointer;font-family:monospace;font-size:13px;text-align:left;transition:background 0.15s;">Overhauled</button>\n<button class="wip-work-btn" data-value="9575f44e-89c3-4257-2cbc-08de73f744dc" style="background:#2a2a2a;color:#eee;border:1px solid #444;padding:10px 16px;border-radius:6px;cursor:pointer;font-family:monospace;font-size:13px;text-align:left;transition:background 0.15s;">Modified</button>\n<button class="wip-work-btn" data-value="513d5f0d-9715-4b09-2cbd-08de73f744dc" style="background:#2a2a2a;color:#eee;border:1px solid #444;padding:10px 16px;border-radius:6px;cursor:pointer;font-family:monospace;font-size:13px;text-align:left;transition:background 0.15s;">Unserviceable</button>
      </div>
      <button id="wip-work-cancel" style="width:100%;background:#6a1515;color:#fff;border:none;
        padding:10px;border-radius:6px;cursor:pointer;font-family:monospace;font-size:13px;
        font-weight:bold;">✗ Cancel</button>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    box.querySelector('#wip-work-cancel').addEventListener('click', () => overlay.remove());

    box.querySelectorAll('.wip-work-btn').forEach(btn => {
      btn.addEventListener('mouseenter', () => btn.style.background = '#1a5c8a');
      btn.addEventListener('mouseleave', () => btn.style.background = '#2a2a2a');
      btn.addEventListener('click', async () => {
        const value = btn.dataset.value;
        overlay.remove();
        await runCompleteOrder(value);
      });
    });
  }

  async function runCompleteOrder(workPerformedValue) {
    try {
      showProgress('Step 1/5: Entering edit mode...');
      const editOk = await clickEditInfo();
      if (!editOk) return;
      await sleep(STEP_DELAY);

      showProgress('Step 2/5: Saving WO description as comment...');
      const saveCommentBtn = [...document.querySelectorAll('button')]
        .find(b => (b.getAttribute('onclick') || '').includes("saveAsComment('Work Order Description'"));
      if (saveCommentBtn) { saveCommentBtn.click(); await sleep(STEP_DELAY); }

      // Set Bristow Status to Estimate Required
      showProgress('Step 3/5: Setting status to Estimate Required...');
      const statusInput = findDropdownByLabel(['Bristow Status'], 'OrderHead_CustomFields_0__OptionId');
      if (statusInput) {
        const statusWidget = typeof jQuery !== 'undefined'
          ? jQuery('#' + CSS.escape(statusInput.id)).data('kendoDropDownList') : null;
        if (statusWidget) {
          statusWidget.value('64e657bd-38a5-4052-3f3b-08de7ef0c675');
          statusWidget.trigger('change');
        } else {
          setNativeValue(statusInput, '64e657bd-38a5-4052-3f3b-08de7ef0c675');
        }
      }
      await sleep(STEP_DELAY);

      const stampBtn = [...document.querySelectorAll('button')]
        .find(b => (b.getAttribute('onclick') || '').includes("listBoxToComment('Bristow Status'"));
      if (stampBtn) { stampBtn.click(); await sleep(STEP_DELAY); }

      // Set Work Performed dropdown
      if (workPerformedValue) {
        const wpInput = findDropdownByLabel(['Work Performed'], 'OrderHead_CustomFields_8__OptionId');
        if (wpInput) {
          const wpWidget = typeof jQuery !== 'undefined'
            ? jQuery('#' + CSS.escape(wpInput.id)).data('kendoDropDownList') : null;
          if (wpWidget) {
            wpWidget.value(workPerformedValue);
            wpWidget.trigger('change');
          } else {
            setNativeValue(wpInput, workPerformedValue);
          }
        }
        await sleep(300);
      }

      // Set Status/Work Level to "WIC"
      showProgress('Step 4/5: Setting Work Level to WIC...');
      const workLevelEl = findByLabel(['Status/Work Level'], 'OrderHead_CustomFields_7__Text');
      if (workLevelEl) setNativeValue(workLevelEl, 'WIC');
      await sleep(300);

      // Set completion date to today
      showProgress('Step 5/5: Setting completion date...');
      const dateInput = findByLabel(['Completion Date', 'Complete Order By'], 'OrderHead_OrderCompletionDeadline');
      if (dateInput) {
        const dateWidget = typeof jQuery !== 'undefined'
          ? jQuery('#' + CSS.escape(dateInput.id)).data('kendoDatePicker') : null;
        if (dateWidget) {
          dateWidget.value(new Date());
          dateWidget.trigger('change');
        } else {
          const today = new Date();
          const dateStr = String(today.getMonth()+1).padStart(2,'0') + '/' +
                          String(today.getDate()).padStart(2,'0') + '/' +
                          today.getFullYear();
          setNativeValue(dateInput, dateStr);
        }
      }
      await sleep(300);

      // Grab inspection URL before saving
      const additionalSection = document.getElementById('collapseAdditional');
      if (additionalSection && !additionalSection.classList.contains('in')) {
        const toggle = document.querySelector('[data-target="#collapseAdditional"]');
        if (toggle) toggle.click();
        await sleep(400);
      }
      const inspectionHref = document.querySelector('a[href*="Optional_Report7"]')?.href;

      showProgress('Saving...');
      await saveOrderHeader();
      await sleep(1200);

      if (inspectionHref) {
        window.open(inspectionHref, '_blank');
      }

      showToast('✅ Work Order Complete!\nInspection PDF opened for printing.', 'green');

    } catch (err) {
      showToast(`⚠️ Error completing order:\n${err.message}`, 'orange');
      console.error('[WIP Complete]', err);
    }
  }

  // ═══════════════════════════════════════════════════════
  // STEP 8 — Download checksheet
  // ═══════════════════════════════════════════════════════
  async function downloadChecksheet() {
    const docRows = document.querySelectorAll('tr.k-master-row, tr.k-table-row');
    for (const row of docRows) {
      const filenameCell = row.querySelector('[aria-colindex="4"]');
      if (!filenameCell) continue;
      const docName = filenameCell.innerText.trim().toLowerCase();
      if (!docName.includes('checksheet') && !docName.includes('check sheet') && !docName.includes('check-sheet')) continue;
      const downloadLink = row.querySelector('a[href*="DownloadAeroFile"]');
      if (downloadLink) {
        downloadLink.click();
        await sleep(500);
        break;
      }
    }
    return true;
  }

  // ═══════════════════════════════════════════════════════
  // MODE WATCHING
  // ═══════════════════════════════════════════════════════
  function watchMode() {
    document.addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const oc = btn.getAttribute('onclick') || '';
      if (oc.includes('saveOrderHeader') || oc.includes('refreshOrderHeader')) {
        setTimeout(refreshMode, 700);
        setTimeout(refreshMode, 1600);
      }
    }, true);
    new MutationObserver(refreshMode)
      .observe(document.body, { childList:true, subtree:true,
                                 attributes:true, attributeFilter:['style','class','disabled'] });
  }

  // ═══════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════
  function init() {
    if (!location.pathname.includes('/Orders/Orders/Edit')) return;
    document.addEventListener('input', handleMacroInput, true);
    setTimeout(() => {
      refreshMode();
      injectPanel();
      watchMode();
    }, 1200);
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : init();

})();
