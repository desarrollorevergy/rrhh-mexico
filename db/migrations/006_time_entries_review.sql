-- 006: datos de la validación semanal en cada jornada.
-- El historial completo (quién, cuándo, decisión, motivo) lo guarda el motor de aprobaciones;
-- aquí queda el estado actual de cada día, que es lo que ven las pantallas.

ALTER TABLE time_entries ADD
    -- Motivo indicado por el supervisor en los días que marcó como rechazados.
    reject_reason       NVARCHAR(1000) NULL,
    reviewed_by         INT            NULL CONSTRAINT FK_time_entries_reviewed_by REFERENCES employees (id),
    reviewed_at         DATETIME2(0)   NULL,
    -- Cuándo envió el colaborador la corrección de sus días rechazados, y su nota.
    correction_sent_at  DATETIME2(0)   NULL,
    correction_note     NVARCHAR(1000) NULL,
    -- Las horas se corrigieron a mano (supervisor o colaborador), no salen del fichaje.
    hours_edited        BIT            NOT NULL CONSTRAINT DF_time_entries_hours_edited DEFAULT 0;
