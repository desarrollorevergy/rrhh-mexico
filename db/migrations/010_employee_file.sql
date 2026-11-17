-- 010: expediente completo del empleado (módulo 07, Ficha de Empleado).
-- Datos sensibles (RFC, NSS, CURP, domicilio, tipo de sangre): solo RRHH y el propio empleado.
-- La «Alta IMSS Revergy» es la columna hire_date (migración 008): de ella sale la antigüedad.
-- El estatus (Activo / Baja) es la columna is_active.

ALTER TABLE employees ADD
    -- Analítica con la que se contrató al empleado.
    project_id               INT            NULL CONSTRAINT FK_employees_project REFERENCES projects (id),
    imss_end_date            DATE           NULL,
    rfc                      NVARCHAR(13)   NULL,
    nss                      NVARCHAR(11)   NULL,
    curp                     NVARCHAR(18)   NULL,
    personal_email           NVARCHAR(254)  NULL,
    personal_phone           NVARCHAR(30)   NULL,
    work_phone               NVARCHAR(30)   NULL,
    marital_status           NVARCHAR(20)   NULL
        CONSTRAINT CK_employees_marital_status
        CHECK (marital_status IN ('soltero', 'casado', 'union_libre', 'divorciado', 'viudo')),
    emergency_contact_name   NVARCHAR(200)  NULL,
    emergency_contact_phone  NVARCHAR(30)   NULL,
    blood_type               NVARCHAR(3)    NULL
        CONSTRAINT CK_employees_blood_type
        CHECK (blood_type IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
    home_address             NVARCHAR(500)  NULL,
    size_pants               NVARCHAR(20)   NULL,
    size_tshirt              NVARCHAR(20)   NULL,
    size_shoes               NVARCHAR(20)   NULL,
    size_jacket              NVARCHAR(20)   NULL,
    size_shirt               NVARCHAR(20)   NULL,
    contract_type            NVARCHAR(20)   NULL
        CONSTRAINT CK_employees_contract_type CHECK (contract_type IN ('indefinido', 'proyecto')),
    -- Duración del contrato, por fechas. Un contrato indefinido no tiene fecha de fin.
    contract_start           DATE           NULL,
    contract_end             DATE           NULL,
    -- ¿Entregó la carta de no antecedentes penales? Por ahora solo sí / no, sin el documento.
    criminal_record_letter   BIT            NOT NULL CONSTRAINT DF_employees_criminal_record_letter DEFAULT 0,
    CONSTRAINT CK_employees_contract_dates
        CHECK (contract_start IS NULL OR contract_end IS NULL OR contract_end >= contract_start);

-- Los identificadores oficiales no se repiten entre empleados.
-- Van con EXEC porque SQL Server compila el lote entero antes de ejecutarlo y, sin GO,
-- todavía no conoce las columnas recién añadidas.
EXEC('CREATE UNIQUE INDEX UQ_employees_rfc ON employees (rfc) WHERE rfc IS NOT NULL');
EXEC('CREATE UNIQUE INDEX UQ_employees_nss ON employees (nss) WHERE nss IS NOT NULL');
EXEC('CREATE UNIQUE INDEX UQ_employees_curp ON employees (curp) WHERE curp IS NOT NULL');
