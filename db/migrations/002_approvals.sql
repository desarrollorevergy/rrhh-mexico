-- 002: motor de aprobaciones genérico (solicitud -> uno o varios aprobadores -> resultado).

CREATE TABLE approval_requests (
    id            INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_approval_requests PRIMARY KEY,
    -- Tipo de solicitud (timesheet_week, hiring_request...). Ver api/src/approvals/chains.ts.
    request_type  NVARCHAR(50)      NOT NULL,
    -- Identificador del registro del módulo al que pertenece (la semana, la vacante...).
    entity_id     NVARCHAR(50)      NULL,
    requester_id  INT               NOT NULL CONSTRAINT FK_approval_requests_requester REFERENCES employees (id),
    status        NVARCHAR(20)      NOT NULL
                  CONSTRAINT CK_approval_requests_status CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    current_step  INT               NOT NULL CONSTRAINT DF_approval_requests_step DEFAULT 0,
    -- Vuelta: sube cada vez que el solicitante reenvía tras un rechazo.
    round         INT               NOT NULL CONSTRAINT DF_approval_requests_round DEFAULT 1,
    -- Copia en JSON de la cadena con la que se creó: si la cadena del tipo cambia después,
    -- las solicitudes en curso siguen con la suya.
    steps         NVARCHAR(MAX)     NOT NULL,
    created_at    DATETIME2(0)      NOT NULL CONSTRAINT DF_approval_requests_created DEFAULT SYSUTCDATETIME(),
    updated_at    DATETIME2(0)      NOT NULL CONSTRAINT DF_approval_requests_updated DEFAULT SYSUTCDATETIME()
);

CREATE INDEX IX_approval_requests_status ON approval_requests (status);
CREATE INDEX IX_approval_requests_requester ON approval_requests (requester_id);
CREATE INDEX IX_approval_requests_entity ON approval_requests (request_type, entity_id);

-- Historial completo: quién, cuándo, qué decisión y motivo.
CREATE TABLE approval_actions (
    id          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_approval_actions PRIMARY KEY,
    request_id  INT               NOT NULL CONSTRAINT FK_approval_actions_request REFERENCES approval_requests (id),
    round       INT               NOT NULL,
    -- Paso y aprobador dentro del paso. Vacíos en las acciones del solicitante.
    step        INT               NULL,
    slot        INT               NULL,
    actor_id    INT               NOT NULL CONSTRAINT FK_approval_actions_actor REFERENCES employees (id),
    action      NVARCHAR(20)      NOT NULL
                CONSTRAINT CK_approval_actions_action CHECK (action IN ('submitted', 'approved', 'rejected', 'resubmitted', 'cancelled')),
    reason      NVARCHAR(1000)    NULL,
    created_at  DATETIME2(0)      NOT NULL CONSTRAINT DF_approval_actions_created DEFAULT SYSUTCDATETIME(),
    -- Rechazar exige motivo: también lo garantiza la base de datos.
    CONSTRAINT CK_approval_actions_reject_reason
        CHECK (action <> 'rejected' OR (reason IS NOT NULL AND LEN(LTRIM(RTRIM(reason))) > 0))
);

CREATE INDEX IX_approval_actions_request ON approval_actions (request_id, round, step);
