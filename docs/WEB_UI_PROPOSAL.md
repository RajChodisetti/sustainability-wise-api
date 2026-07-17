# SustainabilityWiseUI Web Application Proposal

Prepared: 18 June 2026

## Overview

We propose building **SustainabilityWiseUI**, a web application for managing both **SolarSense** and **EcoAudit Pro** from one place.

This can be delivered at a lower cost because most of the important backend work already exists: the APIs, database, authentication, file storage, PDF generation, DigitalOcean server, and OneDrive backup support are already in place. The main work is to build the business-facing web interface on top of the current system.

## Included Scope

### One Web Application, Two Modules

- One SustainabilityWiseUI web app.
- App-level login and access control.
- App switcher/navigation for:
  - SolarSense
  - EcoAudit Pro
- Role-aware and access-aware screens for existing users:
  - Admin
  - Inspector/user
- Users will only see and manage the data they are allowed to access.
- Responsive layout for desktop and tablet use, with reasonable mobile browser support.

### SolarSense Module

The SolarSense web module will support create, view, copy, edit, and delete workflows for the app data available to the user

### EcoAudit Pro Module

The EcoAudit Pro web module will support create, view, copy, edit, and delete workflows for the app data available to the user

### User Management

- Admin users can manage existing users for each app.
- User management will use the existing roles and permissions already supported by the system.
- No new role model is required for this phase.

### Deployment

- Deploy the web application to the existing DigitalOcean setup.
- Reuse the current API, database, file storage, and PDF generation infrastructure.
- Perform a production smoke test after deployment.

## Hosting and Running Costs

No extra hosting cost is expected at this stage because the current app usage is low and the existing infrastructure can host the web interface.

Future hosting upgrades may be required if usage grows, for example:

- More users are active at the same time.
- Large audits generate PDFs frequently.
- Photo and PDF storage grows significantly.
- The client requires stronger uptime, backup, or performance guarantees.

If that happens, the hosting can be upgraded without rebuilding the web app.

## Fixed Price and Deposit

Fixed project price: **$3,900**.

## Optional Future Add-ons

These are not included in the fixed price above.

| Add-on | Estimated Additional Cost |
|---|---:|
| Dashboard: audit counts, completed reports, photos uploaded, storage usage | $600-$1,000 |
| Inspector productivity/activity reporting | $450-$900 |
| Advanced analytics with charts and date filters | $1,000-$1,750 |
| Advanced audit trail and change history UI | $750-$1,500 |
| Client-facing read-only portal | $1,250+ |

## Included Warranty

A 30-day defect warranty is included for issues related to the delivered scope.

This covers fixes for bugs in the delivered web application. New features, major design changes, new reports, or major backend changes would be quoted separately.


