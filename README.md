# Bristow Scripts

Auto-updating userscripts for the Bristow app.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) in your browser
2. Go to the [install page](https://bristow-scripts.github.io/bristow-scripts)
3. Click **▶ Install** on the scripts for your role
4. Scripts update automatically once per day

---

## Scripts by Role

### ALL — Everyone installs these

| Script | Description |
|--------|-------------|
| [Floating Text Blaze Box](ALL---Floating-Text-Blaze-Box.user.js) | Adds a floating macro input box |
| [Set Qty Default to 1](ALL---Set-Qty-Default-to-1.user.js) | Auto-sets quantity inputs to 1 |
| [Manuals Remember State](ALL---Manuals-Remember-State.user.js) | Remembers collapsed/expanded state of the manuals section |

### TECH — Technicians

| Script | Description |
|--------|-------------|
| [Auto Add Labor + Tech Time Panel](TECH---Auto-Add-Labor-Tech-Time-Panel.user.js) | Adds labor service line and processes and adds time logging panel |
| [Auto Grow Work Order Description](TECH---Auto-Grow-Work-Order-Description.user.js) | Auto-resizes the WO description field |
| [Force Contact Section Collapsed](TECH---Force-Contact-Section-Collapsed.user.js) | Collapses contact section by default |
| [Hide Totals Footer](TECH---Hide-Totals-Footer.user.js) | Hides the order totals section |
| [Orders Grid Filter Optimizer](TECH---Orders-Grid-Filter-Optimizer.user.js) | Makes the Customer orders page faster and easier to navigate (completed OFF by default) |
| [Parts Preloader](TECH---Parts-Preloader.user.js) | Caches parts data for instant load |
| [Time Expanded Section Trimmed](TECH---Time-Expanded-Section-Trimmed.user.js) | Adds link embedded in the main workorder below parts — no need to open "job" link (trimmed version) |
| [Uppercase Forced Work Order Description](TECH---Uppercase-Forced-work-order-description.user.js) | Forces uppercase on WO fields and internal snag — hit save button to apply |

### FE — Front End / Estimators

| Script | Description |
|--------|-------------|
| [Force Contact Section Expanded](FE---Force-Contact-Section-Expanded.user.js) | Keeps contact section expanded |
| [Manuals Section Collapsed Default](FE---Manuals-Section-Collapsed-Default.user.js) | Collapses manuals section by default |
| [Second Save Button](FE---Second-Save-Button.user.js) | Adds a second fixed Save button for line items |
| [Time Expanded Section Full Version](FE---Time-Expanded-Section-full-version.user.js) | Adds below the add parts section full version — the job link embedded in the main work order |
| [Parts Preloader](FE---Parts-Preloader.user.js) | Caches full parts dataset in IndexedDB — instant load after first fetch |

### SH — Shop / Shipping

| Script | Description |
|--------|-------------|
| [Auto Add Labor & Process W/ WO Desc](SH---Auto-Add-Labor-Process-W-WO-Desc.user.js) | Auto-fills and processes work orders |
| [Orders Grid Filter Optimizer](SH---Orders-Grid-Filter-Optimizer.user.js) | Fast client-side orders grid (completed ON by default) |

---

## Updating Scripts

1. Edit the script file
2. Bump the `@version` number (e.g. `1.0` → `1.1`)
3. Commit and push to `main`
4. Everyone gets the update within 24 hours, or they can manually click **Check for updates** in the Tampermonkey dashboard

---

## Disabling Auto-Updates for a Script

If someone wants to customize a script locally and stop it from receiving updates:

1. Open the Tampermonkey Dashboard
2. Click the script name to open it in the editor
3. Delete these two lines from the top of the script:
```
// @updateURL    https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/SCRIPT-NAME.user.js
// @downloadURL  https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/SCRIPT-NAME.user.js
```
4. Make your customizations and hit **Save** (Ctrl+S)

The script will no longer receive automatic updates and will stay exactly as you left it.

---

## Scripts NOT in this repo (local install only)

- **Bob - WO Auto-Fill** — personal work order templates
- **SH - Bristow QZ Tray Direct Print** — contains printer credentials
- **WIP scripts** — not ready for deployment
