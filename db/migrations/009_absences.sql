-- 009: solicitudes de vacaciones y ausentismo (módulo 08).
-- El estado y el historial de aprobación (supervisor -> RRHH) los guarda el motor de
-- aprobaciones; aquí van los datos propios de la ausencia.

CREATE TABLE absence_requests (
    id                   INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_absence_requests PRIMARY KEY,
    employee_id          INT               NOT NULL CONSTRAINT FK_absence_requests_employee REFERENCES employees (id),
    -- Por ahora solo vacaciones e incapacidad; los demás tipos llegarán después.
    absence_type         NVARCHAR(20)      NOT NULL
                         CONSTRAINT CK_absence_requests_type CHECK (absence_type IN ('vacation', 'sick_leave')),
    start_date           DATE              NOT NULL,
    end_date             DATE              NOT NULL,
    comment              NVARCHAR(1000)    NULL,
    approval_request_id  INT               NULL CONSTRAINT FK_absence_requests_approval REFERENCES approval_requests (id),
    -- Cancelación de una solicitud YA APROBADA: solo RRHH, y devuelve el saldo.
    -- (La cancelación de una pendiente por el colaborador queda en el motor de aprobaciones.)
    cancelled_at         DATETIME2(0)      NULL,
    cancelled_by         INT               NULL CONSTRAINT FK_absence_requests_cancelled_by REFERENCES employees (id),
    cancel_reason        NVARCHAR(1000)    NULL,
    created_at           DATETIME2(0)      NOT NULL CONSTRAINT DF_absence_requests_created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_absence_requests_dates CHECK (end_date >= start_date)
);

CREATE INDEX IX_absence_requests_employee ON absence_requests (employee_id, start_date);
CREATE INDEX IX_absence_requests_approval ON absence_requests (approval_request_id);

-- Días laborables que cubre cada solicitud, fijados al crearla (lunes a sábado sin festivos).
-- De aquí sale lo que se descuenta del saldo: un festivo añadido después no cambia la cuenta.
CREATE TABLE absence_days (
    request_id  INT   NOT NULL CONSTRAINT FK_absence_days_request REFERENCES absence_requests (id),
    day         DATE  NOT NULL,
    CONSTRAINT PK_absence_days PRIMARY KEY (request_id, day)
);

CREATE INDEX IX_absence_days_day ON absence_days (day);

-- Ajustes manuales de RRHH al saldo de vacaciones, por año de servicio.
CREATE TABLE vacation_adjustments (
    id            INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_vacation_adjustments PRIMARY KEY,
    employee_id   INT               NOT NULL CONSTRAINT FK_vacation_adjustments_employee REFERENCES employees (id),
    -- Año de servicio al que aplica: 1 = del ingreso al primer aniversario.
    service_year  INT               NOT NULL CONSTRAINT CK_vacation_adjustments_year CHECK (service_year >= 1),
    -- Días que se suman (positivo) o se quitan (negativo).
    days          INT               NOT NULL CONSTRAINT CK_vacation_adjustments_days CHECK (days <> 0),
    reason        NVARCHAR(1000)    NOT NULL
                  CONSTRAINT CK_vacation_adjustments_reason CHECK (LEN(LTRIM(RTRIM(reason))) > 0),
    created_by    INT               NOT NULL CONSTRAINT FK_vacation_adjustments_created_by REFERENCES employees (id),
    created_at    DATETIME2(0)      NOT NULL CONSTRAINT DF_vacation_adjustments_created DEFAULT SYSUTCDATETIME()
);

CREATE INDEX IX_vacation_adjustments_employee ON vacation_adjustments (employee_id, service_year);
