-- 007: historial de correcciones de una jornada (quién cambió qué, antes y después).
-- Las decisiones de aprobar y rechazar las guarda el motor de aprobaciones; aquí van
-- los cambios de datos hechos a mano por el supervisor o por el colaborador.
-- Solo se añade: nunca se modifica ni se borra.

CREATE TABLE time_entry_changes (
    id          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_time_entry_changes PRIMARY KEY,
    entry_id    INT               NOT NULL CONSTRAINT FK_time_entry_changes_entry REFERENCES time_entries (id),
    actor_id    INT               NOT NULL CONSTRAINT FK_time_entry_changes_actor REFERENCES employees (id),
    -- Quién corrigió: el supervisor o el propio colaborador (solo en días rechazados).
    source      NVARCHAR(10)      NOT NULL
                CONSTRAINT CK_time_entry_changes_source CHECK (source IN ('supervisor', 'employee')),
    -- JSON: { "campo": { "from": valorAnterior, "to": valorNuevo } }
    changes     NVARCHAR(MAX)     NOT NULL,
    created_at  DATETIME2(0)      NOT NULL CONSTRAINT DF_time_entry_changes_created DEFAULT SYSUTCDATETIME()
);

CREATE INDEX IX_time_entry_changes_entry ON time_entry_changes (entry_id, created_at);
