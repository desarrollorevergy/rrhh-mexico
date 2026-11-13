-- 005: jornadas del Parte de Horas. Una por empleado y día.

CREATE TABLE time_entries (
    id                 INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_time_entries PRIMARY KEY,
    employee_id        INT               NOT NULL CONSTRAINT FK_time_entries_employee REFERENCES employees (id),
    -- Día de la jornada: aquel en que se fichó la entrada, en la zona horaria del colaborador.
    work_date          DATE              NOT NULL,
    project_id         INT               NOT NULL CONSTRAINT FK_time_entries_project REFERENCES projects (id),
    shift_type         NVARCHAR(10)      NOT NULL
                       CONSTRAINT CK_time_entries_shift_type CHECK (shift_type IN ('activa', 'inactiva')),
    per_diem           BIT               NOT NULL CONSTRAINT DF_time_entries_per_diem DEFAULT 0,
    comment            NVARCHAR(1000)    NULL,
    -- Horas en UTC. Con conexión las pone el servidor.
    clock_in           DATETIME2(0)      NOT NULL,
    clock_out          DATETIME2(0)      NULL,
    -- Zona horaria (IANA) del dispositivo al fichar la entrada, p. ej. America/Mexico_City.
    time_zone          NVARCHAR(64)      NOT NULL,
    -- Fichado sin conexión: la hora la puso el dispositivo, no el servidor.
    clock_in_offline   BIT               NOT NULL CONSTRAINT DF_time_entries_in_offline DEFAULT 0,
    clock_out_offline  BIT               NOT NULL CONSTRAINT DF_time_entries_out_offline DEFAULT 0,
    status             NVARCHAR(10)      NOT NULL CONSTRAINT DF_time_entries_status DEFAULT 'pending'
                       CONSTRAINT CK_time_entries_status CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at         DATETIME2(0)      NOT NULL CONSTRAINT DF_time_entries_created DEFAULT SYSUTCDATETIME(),
    updated_at         DATETIME2(0)      NOT NULL CONSTRAINT DF_time_entries_updated DEFAULT SYSUTCDATETIME(),

    -- Un solo registro por día.
    CONSTRAINT UQ_time_entries_employee_date UNIQUE (employee_id, work_date),
    -- No hay salida sin entrada ni salida anterior a la entrada.
    CONSTRAINT CK_time_entries_clock_out CHECK (clock_out IS NULL OR clock_out >= clock_in)
);

CREATE INDEX IX_time_entries_date ON time_entries (work_date);
CREATE INDEX IX_time_entries_status ON time_entries (status);
