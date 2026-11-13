# Parte de Horas: detalle de las etapas hechas

Las decisiones, las reglas de cálculo y el estado de cada etapa están en el `CLAUDE.md` de la raíz. Aquí va el detalle de implementación y las reglas confirmadas de las etapas 3 a 7.

3. Fichaje con conexión — **hecha**: tabla `time_entries` (migración 005), API en `api/src/timesheet/` (`/api/timesheet/today`, `clock-in`, `clock-out`, `today/comment`) y pantalla `/parte-horas` (`web/src/pages/timesheet/`). La tarjeta 01 está disponible para todos.
4. Mi semana — **hecha**: `/parte-horas/semana` con selector de semana, estado, totales y una tarjeta por día con su nota; menú inferior «Fichar / Mi Semana» (`TimesheetLayout`). API: `/api/timesheet/weeks`, `/week?date=` y `/entries/:id/comment`. Las horas se muestran como `h:mm`.
5. Supervisión — **hecha**: consolidado del equipo con filtros, detalle día por día, aprobar, rechazar marcando días, corregir jornadas e historial (`/parte-horas/equipo`; API `/api/timesheet/team/*`; `api/src/timesheet/team.ts`).
   - **Corrección** (`api/src/timesheet/corrections.ts`, `PUT /team/entries/:id`): horario, analítica, tipo y dieta. Cada corrección guarda el antes y el después en `time_entry_changes` (migración 007). Si cambian las horas, el día queda marcado como «editado». **Corregir un día ya aprobado lo devuelve a pendiente** (confirmado el 2026-11-13). Límites: salida posterior a la entrada y jornada de 24 h como máximo.
   - Las horas corregidas viajan como instantes completos calculados en el dispositivo; una salida anterior a la entrada se entiende del día siguiente.
   - **Historial** (`GET /team/week/history`): une las decisiones del motor de aprobaciones con las correcciones, de la más reciente a la más antigua.
   - El supervisor solo ve y valida a quienes lo tienen como `supervisor_id` (equipo directo). Los demás responden 404.
   - Cada decisión se registra en el motor de aprobaciones (tipo `timesheet_week`, entidad `empleado:lunes`): comprueba que decide el supervisor y guarda el historial. Cada ronda de revisión es una solicitud; se reutiliza la pendiente o se abre una nueva.
   - El estado actual de cada día vive en `time_entries` (migración 006: motivo, quién revisó, corrección enviada).
   - **Regla confirmada (2026-11-13):** no se puede aprobar una semana con una jornada sin salida; hay que corregirla o rechazarla antes.
   - La decisión del motor y el cambio de estado de los días se guardan en dos pasos; si el segundo fallara, basta repetir la acción.
6. Corrección y reenvío — **hecha**: en «Mi Semana» el colaborador ve el motivo, corrige **solo** los días rechazados (`PUT /api/timesheet/entries/:id`) y pulsa «Enviar corrección» con una nota opcional (`POST /week/send-correction`). Esos días vuelven a pendiente y el supervisor ve la semana como «Corregida». Aviso de días rechazados en la pantalla de fichar.
   - No se puede enviar la corrección mientras un día rechazado siga sin salida.
   - Un día corregido sigue rechazado hasta que se envía; enviado, ya no se puede cambiar.
   - El motivo original se conserva en el día hasta la siguiente decisión del supervisor.
   - El reenvío queda en el historial del motor (`resubmitted`, con la nota) y la corrección en `time_entry_changes`.
7. RRHH: semanas aprobadas y CSV de nómina — **hecha**: `/parte-horas/nomina` (pestaña «Nómina», solo RRHH y administrador) con filtros por período, departamento y búsqueda, detalle día por día y «Exportar CSV». API `/api/timesheet/payroll/*` (`summary`, `week`, `export`); `api/src/timesheet/payroll.ts`.
   - **Solo lectura y solo semanas aprobadas** (todas sus jornadas aprobadas). RRHH no aprueba, rechaza ni corrige. Una semana no aprobada responde 404.
   - El panel **no exige ficha de empleado** ni la crea: se monta antes que el resto de `/api/timesheet`.
   - **CSV:** una línea por colaborador y semana, con exactamente las semanas a la vista tras filtrar. Columnas: `Periodo, No_Empleado, Empleado, Correo, Departamento, Analiticas, H_Normales, H_Extras, H_Domingo, H_Festivo, Dietas, Dias_Inactiva, Total_Horas`. Horas en decimal con dos cifras y punto (8 h 30 min → `8.50`); separador coma, BOM y CRLF para Excel; los textos que empiezan por `=`, `+`, `-` o `@` llevan apóstrofo para que Excel no los ejecute. **El formato no está validado con quien hace la nómina.**
   - El detalle reutiliza la pantalla del supervisor en modo `readOnly` (sin historial).
   - Pendiente: el resumen carga todas las jornadas y agrupa en memoria; habrá que acotarlo por fechas cuando crezca el histórico.
