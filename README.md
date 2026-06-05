# Bristow Scripts

Auto-updating userscripts for the Bristow app.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) in your browser
2. Go to the [install page](https://bristow-scripts.github.io/bristow-scripts/)
3. Click **▶ Install** on the scripts for your role
4. Scripts update automatically once per day

---

## Scripts by Role

### ALL — Everyone installs these

| Script | Description |
|--------|-------------|
| [Floating Text Blaze Box](ALL---Floating-Text-Blaze-Box.user.js) | Adds a small floating text box in the toolbar for pasting Text Blaze macros. Type your shortcut and let Text Blaze expand it. No auto-update. |
| [Set Qty Default to 1](ALL---Set-Qty-Default-to-1.user.js) | When adding parts or services, quantity defaults to 1 instead of 0 — saves a click every time. |
| [Manuals Remember State](ALL---Manuals-Remember-State.user.js) | The Manuals section remembers whether you left it open or closed, even after saving or editing the order. |

### TECH — Technicians

| Script | Description |
|--------|-------------|
| [Auto Add Labor + Tech Time Panel](TECH---Auto-Add-Labor-Tech-Time-Panel.user.js) | Automatically adds and processes the Labour service line on every work order. Also adds a floating panel to log tech hours directly from the order page without opening the Job. |
| [Auto Grow Work Order Description](TECH---Auto-Grow-Work-Order-Description.user.js) | The Work Order Description text box grows automatically as you type so you can always see the full text. |
| [Force Contact Section Collapsed](TECH---Force-Contact-Section-Collapsed.user.js) | Keeps the Contact section collapsed by default. Techs rarely need it — this keeps it out of the way. |
| [Hide Totals Footer](TECH---Hide-Totals-Footer.user.js) | Hides the cost totals bar at the bottom of the order page. Techs don't set pricing so this removes the distraction. |
| [Orders Grid Filter Optimizer](TECH---Orders-Grid-Filter-Optimizer.user.js) | Makes the Customer Orders list much faster by loading all orders locally. Adds WIP filter, Clear Filters, and Order Status dropdown. Completed and Cancelled orders are hidden by default. |
| [Parts Preloader](TECH---Parts-Preloader.user.js) | Loads and caches the full parts list so searching for parts is instant. Refreshes once per day automatically — use the Refresh Parts button to force an update. |
| [Time Expanded Section Trimmed](TECH---Time-Expanded-Section-Trimmed.user.js) | Adds a Time Expanded section below the parts list showing hours logged on the job. No need to open the Job separately. Clutter removed — shows service lines only. |
| [Uppercase Forced Work Order Description](TECH---Uppercase-Forced-work-order-description.user.js) | Automatically converts the Work Order Description, Customer Snag, and Internal Snag to uppercase when you save. |

### FE — Front End / Estimators

| Script | Description |
|--------|-------------|
| [Force Contact Section Expanded](FE---Force-Contact-Section-Expanded.user.js) | Keeps the Contact section expanded by default. Front end staff need this visible to verify contact details. |
| [Manuals Section Collapsed Default](FE---Manuals-Section-Collapsed-Default.user.js) | Collapses the Manuals section by default to keep the order page tidier for front end staff. |
| [Second Save Button](FE---Second-Save-Button.user.js) | Adds a second Save button fixed to the screen for saving order line items — useful when scrolled far down. No auto-update. |
| [Time Expanded Section Full Version](FE---Time-Expanded-Section-full-version.user.js) | Adds a Time Expanded section below the parts list with the full job view embedded — shows all service lines and hours logged. |
| [Parts Preloader](FE---Parts-Preloader.user.js) | Loads and caches the full parts list so searching for parts is instant. Refreshes every hour automatically — use the Refresh Parts button to force an update. |

### SH — Shop / Shipping

| Script | Description |
|--------|-------------|
| [Auto Add Labor & Process W/ WO Desc](SH---Auto-Add-Labor-Process-W-WO-Desc.user.js) | Automatically fills the standard Work Order Description template, adds the Labour service line, sets it to Job type, and processes it in one step. |
| [Orders Grid Filter Optimizer](SH---Orders-Grid-Filter-Optimizer.user.js) | Makes the Customer Orders list much faster by loading all orders locally. Adds WIP filter, Clear Filters, Print List, and Order Status dropdown. Completed and Cancelled orders shown by default. |

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
