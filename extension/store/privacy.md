# Child Monitor - privacy policy

Child Monitor is a private parental-monitoring tool used within one family on devices the family owns.

## What is collected

- The URL of the active browser tab.
- The title of that page.
- Timestamps (start and end of time spent on the tab).

Page content, form input, passwords, cookies and browsing in non-supervised Windows accounts are not collected.

## Where it goes

1. The extension sends the data only to the Child Monitor native host on the same PC (Chrome/Edge native messaging).
2. The Child Monitor service on that PC uploads it to the family's own Supabase backend.

No other destination exists. Data is not sent to the extension developer's servers, advertisers or any third party.

## Who can see it

Only the parent, signed in with the authorized Google account on the family dashboard. Access is enforced with row-level security in the database.

## Retention

Data is kept for 90 days and then deleted.

## Sale and sharing

Data is never sold, shared or used for advertising, creditworthiness or any purpose unrelated to the single purpose of parental monitoring.

## Contact

The repository owner: https://github.com/itaibech/childMonitor
