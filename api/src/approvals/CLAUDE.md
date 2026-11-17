# Motor de aprobaciones: cómo está implementado

El patrón general está en el `CLAUDE.md` de la raíz.

- `stateMachine.ts`: reglas como **funciones puras** (aprobar, rechazar con motivo, reenviar, cancelar, a quién le toca decidir).
- `chains.ts`: cadena por tipo de solicitud. Registrados: `timesheet_week` (supervisor; admite reenvío) y `hiring_request` (RRHH → Dirección; rechazo definitivo) y `absence_request` (supervisor → RRHH; rechazo definitivo, cancelable; sin supervisor, solo RRHH: `create` admite una cadena propia en `steps`). Cada módulo registra el suyo al construirse. El tipo `demo` solo existe en local.
- Un paso puede tener **varios aprobadores en paralelo** (todos deben aprobar): lo necesita Bajas (Controlling y Almacén).
- `service.ts`: guarda estado e historial en una transacción, con la fila bloqueada. Tablas `approval_requests` y `approval_actions` (`db/migrations/002_approvals.sql`). La solicitud guarda una copia de su cadena.
- `routes.ts`: `/api/approvals` → `pending`, `mine`, `:id`, `:id/approve`, `:id/reject`, `:id/resubmit`, `:id/cancel`. Solo se monta si hay base de datos.
- `notifications.ts`: punto de enganche; hoy solo escribe en el registro, sin datos personales.
- **Solicitud propia (confirmado el 2026-11-13):** quien tiene el rol aprobador de un paso decide también sobre su propia solicitud. No vale para el paso de supervisor ni para el comodín de administrador (`matchesOwnRequest` en `stateMachine.ts`).
- Página de prueba solo en local: `/dev/aprobaciones`.
