# Design system notes

- The application uses Next.js, Tailwind CSS v4, and the existing shadcn/Base UI components.
- Keep the existing Geist typography, semantic surface/border tokens, flat card treatment, and chart tokens from `apps/web/src/app/styles.css`.
- Reports use the approved “Kể bằng số” layout: period and scope filters, key metrics, detailed trend beside status summary, adviser results, then the report-specific table.
- Scope filters must only expose branches and advisers already authorized by the report API. Disbursement results are attributed to the primary adviser assignment active at each disbursement time.
- Reuse existing controls and responsive table scrolling; do not introduce a charting dependency for these report views.
